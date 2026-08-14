// 冒烟测试：用 mock ctx 跑通「采集 → 落库 → 费用折算 → read_usage 工具 → HTTP 接口」。
// 运行：node smoke.mjs
import assert from 'node:assert'
import { apply } from './dsh/index.js'

const tools = {}
const routes = []
let streamHandler = null
const ctx = {
  on(event, handler) {
    if (event === 'llm/stream') streamHandler = handler
  },
  tools: {
    register(t) {
      tools[t.name] = t
    },
  },
  webServer: {
    register(spec) {
      routes.push(spec)
      return () => {}
    },
  },
  effect(fn) {
    fn()
  },
}

apply(ctx, { dbPath: ':memory:' })
assert(streamHandler, 'llm/stream handler should be registered')
assert(tools.read_usage, 'read_usage tool should be registered')
assert(routes.length === 1 && routes[0].path === '/usage-stats', 'usage-stats route should be registered')

const upstream = async function* () {
  yield { type: 'block/delta', delta: 'hello' }
  yield {
    type: 'usage',
    usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 500, cacheWriteTokens: 0 },
  }
  yield { type: 'finish', kind: 'ok' }
}

const wrapped = streamHandler(
  { provider: 'deepseek-official', model: 'deepseek-v4-pro', sessionId: 'sess-1' },
  () => upstream(),
)
const chunks = []
for await (const chunk of wrapped) chunks.push(chunk)
assert.strictEqual(chunks.length, 3, 'every chunk must pass through unchanged')

// 费用：deepseek-v4-pro 单价 12/24/1/12，每百万
// cost = (1000*12 + 100*24 + 500*1) / 1e6 = 0.0149
const summary = tools.read_usage.execute({ since: 'all', group: 'model' })
assert.strictEqual(summary.totals.requests, 1)
assert.strictEqual(summary.totals.cost_cny, 0.0149)
assert.strictEqual(summary.breakdown[0].bucket, 'deepseek-v4-pro')
assert.strictEqual(summary.breakdown[0].cost_cny, 0.0149)
assert(tools.read_usage.output, 'read_usage must declare output')

// 验证 HTTP summary 路由
const handler = routes[0].handler
function fakeRes() {
  return { status: 200, headers: {}, body: '', writeHead(s, h) { this.status = s; this.headers = h; }, end(b) { this.body = b; } }
}
{
  const res = fakeRes()
  handler({ method: 'GET', url: '/usage-stats/summary?since=all&group=model' }, res)
  assert.strictEqual(res.status, 200)
  const parsed = JSON.parse(res.body)
  assert.strictEqual(parsed.totals.cost_cny, 0.0149)
}
{
  const res = fakeRes()
  handler({ method: 'GET', url: '/usage-stats/panel' }, res)
  assert.strictEqual(res.status, 200)
  assert(String(res.headers['content-type']).includes('text/html'), 'panel serves html')
  assert(String(res.body).includes('用量统计'), 'panel html renders dashboard')
}

console.log('OK — usage recorded, cost computed, tool + HTTP routes all working:')
console.log(JSON.stringify(summary, null, 2))
