// dsh-usage-stats — DSH 用量统计插件。
//
// 1) 通过 `llm/stream` waterfall 包一层，捕获每次模型调用结尾的 `usage` 块，
//    把输入/输出/缓存读/缓存写 token 落进本地 SQLite。
// 2) 按模型单价折算费用（默认 DeepSeek 官方价，可用 config.prices 覆盖）。
// 3) 暴露 `read_usage` 工具 + HTTP 接口（/usage-stats/summary、/usage-stats/panel）。
//
// 只观察、不改流：记账失败绝不影响模型调用。
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'

export const name = 'dsh-usage-stats'
export const inject = ['tools', 'webServer']

// 默认单价：每百万 token 的人民币价格（DeepSeek 官方，2026-08）。
// 未匹配到的模型按 0 计费（也可在 config.prices 里补）。
const DEFAULT_PRICES = {
  'deepseek-v4-flash': { input: 1.0, output: 2.0, cacheRead: 0.2, cacheWrite: 1.0 },
  'deepseek-v4-pro': { input: 12.0, output: 24.0, cacheRead: 1.0, cacheWrite: 12.0 },
}
const FALLBACK_PRICE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

function defaultDbPath() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'usage-stats.db')
}

function openDb(dbPath) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      provider TEXT,
      model TEXT,
      session_id TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_requests_ts ON requests(ts);
  `)
  return db
}

function priceFor(prices, model) {
  if (typeof model === 'string' && model !== '') {
    const exact = prices[model]
    if (exact) return exact
    const lc = model.toLowerCase()
    for (const [key, value] of Object.entries(prices)) if (key.toLowerCase() === lc) return value
  }
  return FALLBACK_PRICE
}

function costOf(price, row) {
  return (
    row.input_tokens * price.input +
    row.output_tokens * price.output +
    row.cache_read_tokens * price.cacheRead +
    row.cache_write_tokens * price.cacheWrite
  ) / 1e6
}

function round4(value) {
  return Math.round(value * 1e4) / 1e4
}

const WINDOWS_MS = { '1d': 86_400_000, '7d': 604_800_000, '30d': 2_592_000_000 }

function queryUsage(db, args, prices) {
  const since = args.since ?? 'all'
  const group = args.group ?? 'model'
  const windowMs = WINDOWS_MS[since] ?? null
  const where = windowMs ? 'WHERE ts >= ?' : ''
  const params = windowMs ? [Date.now() - windowMs] : []

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS requests,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
              COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens
       FROM requests ${where}`,
    )
    .get(...params)

  // 按模型聚合（同时用于费用折算与模型维度分组）。
  const byModel = db
    .prepare(
      `SELECT COALESCE(model, '(unknown)') AS model,
              COUNT(*) AS requests,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
              COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens
       FROM requests ${where}
       GROUP BY model ORDER BY requests DESC LIMIT 100`,
    )
    .all(...params)

  const totalCost = round4(byModel.reduce((sum, row) => sum + costOf(priceFor(prices, row.model), row), 0))

  const breakdown =
    group === 'day'
      ? byDay(db, where, params, prices)
      : byModel.map((row) => ({
          bucket: row.model,
          requests: row.requests,
          input_tokens: row.input_tokens,
          output_tokens: row.output_tokens,
          cache_read_tokens: row.cache_read_tokens,
          cache_write_tokens: row.cache_write_tokens,
          cost_cny: round4(costOf(priceFor(prices, row.model), row)),
        }))

  return {
    since,
    group,
    totals: { ...totals, cost_cny: totalCost },
    breakdown,
  }
}

function byDay(db, where, params, prices) {
  const rows = db
    .prepare(
      `SELECT date(ts / 1000, 'unixepoch', 'localtime') AS day,
              COALESCE(model, '(unknown)') AS model,
              COUNT(*) AS requests,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
              COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens
       FROM requests ${where}
       GROUP BY day, model ORDER BY day DESC LIMIT 500`,
    )
    .all(...params)
  const map = new Map()
  for (const row of rows) {
    const entry =
      map.get(row.day) ??
      {
        bucket: row.day,
        requests: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        cost_cny: 0,
      }
    entry.requests += row.requests
    entry.input_tokens += row.input_tokens
    entry.output_tokens += row.output_tokens
    entry.cache_read_tokens += row.cache_read_tokens
    entry.cache_write_tokens += row.cache_write_tokens
    entry.cost_cny += costOf(priceFor(prices, row.model), row)
    map.set(row.day, entry)
  }
  return [...map.values()].slice(0, 90).map((entry) => ({ ...entry, cost_cny: round4(entry.cost_cny) }))
}

// 面板 HTML 每次请求时从磁盘读取（同包内的 panel.html），改样式无需重启。
const panelHtmlPath = new URL('./panel.html', import.meta.url)

function registerRoutes(ctx, db, prices) {
  const json = (res, value, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(value))
  }
  const handler = (req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405)
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/usage-stats/summary') {
      const since = url.searchParams.get('since') ?? 'all'
      const group = url.searchParams.get('group') ?? 'model'
      json(res, queryUsage(db, { since, group }, prices))
      return
    }
    if (url.pathname === '/usage-stats/panel' || url.pathname === '/usage-stats/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' })
      res.end(readFileSync(panelHtmlPath, 'utf8'))
      return
    }
    res.writeHead(404)
    res.end()
  }
  const disposer = ctx.webServer.register({ kind: 'prefix', path: '/usage-stats', handler })
  return () => disposer()
}

export function apply(ctx, config = {}) {
  const db = openDb(config.dbPath || defaultDbPath())
  const prices = { ...DEFAULT_PRICES, ...(config.prices ?? {}) }
  const insert = db.prepare(`
    INSERT INTO requests
      (ts, provider, model, session_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  // 官方用法：包一层块流。`next()` 返回 AsyncIterable<StreamChunk>；
  // 这里原样转发每个块，只把 `usage` 块记下来。
  ctx.on(
    'llm/stream',
    (options, next) => {
      const inner = next()
      return (async function* () {
        let usage = null
        try {
          for await (const chunk of inner) {
            if (chunk && chunk.type === 'usage' && chunk.usage) usage = chunk.usage
            yield chunk
          }
        } finally {
          if (usage) {
            try {
              insert.run(
                Date.now(),
                options?.provider ?? null,
                options?.model ?? null,
                options?.sessionId ?? null,
                usage.inputTokens ?? 0,
                usage.outputTokens ?? 0,
                usage.cacheReadTokens ?? 0,
                usage.cacheWriteTokens ?? 0,
              )
            } catch (err) {
              console.error('[dsh-usage-stats] record failed:', err)
            }
          }
        }
      })()
    },
    { global: true, prepend: true },
  )

  ctx.on('dispose', () => {
    try {
      db.close()
    } catch {
      /* 已关闭或未支持，忽略 */
    }
  })

  ctx.tools.register({
    name: 'read_usage',
    description:
      'Query token usage and cost statistics recorded by dsh-usage-stats: totals plus a breakdown by model or by day, with estimated cost in CNY. Use it to report how many tokens have been consumed.',
    parameters: {
      type: 'object',
      properties: {
        since: {
          type: 'string',
          enum: ['1d', '7d', '30d', 'all'],
          description: 'Time window. Default "all".',
        },
        group: {
          type: 'string',
          enum: ['model', 'day'],
          description: 'Group the breakdown by model or by day. Default "model".',
        },
      },
      required: [],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
      },
      render: (_args, value) => {
        return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
      },
    },
    execute(args = {}) {
      return queryUsage(db, args, prices)
    },
  })

  ctx.effect(() => registerRoutes(ctx, db, prices), 'usage-stats: /usage-stats routes')
}
