// dsh-usage-stats — 最小可跑的 DSH 用量统计插件。
//
// 通过 `llm/stream` waterfall 包一层，捕获每次模型调用结尾的 `usage` 块
// （输入 / 输出 / 缓存读 / 缓存写 token），写入本地 SQLite，并提供
// `read_usage` 工具供 agent 查询。只观察、不改流：记账失败绝不影响模型调用。
import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'

export const name = 'dsh-usage-stats'
export const inject = ['tools']

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

export function apply(ctx, config = {}) {
  const db = openDb(config.dbPath || defaultDbPath())
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
      'Query token usage statistics recorded by dsh-usage-stats: totals plus a breakdown by model or by day. Use it to report how many tokens have been consumed.',
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
      return queryUsage(db, args)
    },
  })
}

function queryUsage(db, args = {}) {
  const since = args.since ?? 'all'
  const group = args.group ?? 'model'
  const windowMs = { '1d': 86_400_000, '7d': 604_800_000, '30d': 2_592_000_000 }[since] ?? null
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

  const breakdown =
    group === 'day'
      ? db
          .prepare(
            `SELECT date(ts / 1000, 'unixepoch', 'localtime') AS bucket,
                    COUNT(*) AS requests,
                    COALESCE(SUM(input_tokens), 0) AS input_tokens,
                    COALESCE(SUM(output_tokens), 0) AS output_tokens
             FROM requests ${where}
             GROUP BY bucket ORDER BY bucket DESC LIMIT 90`,
          )
          .all(...params)
      : db
          .prepare(
            `SELECT COALESCE(model, '(unknown)') AS bucket,
                    COUNT(*) AS requests,
                    COALESCE(SUM(input_tokens), 0) AS input_tokens,
                    COALESCE(SUM(output_tokens), 0) AS output_tokens,
                    COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
                    COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens
             FROM requests ${where}
             GROUP BY model ORDER BY requests DESC LIMIT 100`,
          )
          .all(...params)

  return { since, group, totals, breakdown }
}
