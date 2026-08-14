// 冒烟测试：用 mock ctx 跑一遍「包装 llm/stream → 捕获 usage → 落库 → read_usage 查询」。
// 运行：node smoke.mjs
import assert from 'node:assert'
import { apply } from './dsh/index.js'

const tools = {}
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
}

// 用内存库，避免 Windows 下删不掉打开中的 SQLite 文件。
apply(ctx, { dbPath: ':memory:' })
assert(streamHandler, 'llm/stream handler should be registered')
assert(tools.read_usage, 'read_usage tool should be registered')

const upstream = async function* () {
  yield { type: 'block/delta', delta: 'hello' }
  yield {
    type: 'usage',
    usage: { inputTokens: 120, outputTokens: 60, cacheReadTokens: 30, cacheWriteTokens: 10 },
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
assert.strictEqual(chunks[0].type, 'block/delta')
assert.strictEqual(chunks[1].type, 'usage')

const summary = tools.read_usage.execute({ since: 'all', group: 'model' })
assert.strictEqual(summary.totals.requests, 1)
assert.strictEqual(summary.totals.input_tokens, 120)
assert.strictEqual(summary.totals.output_tokens, 60)
assert.strictEqual(summary.totals.cache_read_tokens, 30)
assert.strictEqual(summary.totals.cache_write_tokens, 10)
assert.strictEqual(summary.breakdown[0].bucket, 'deepseek-v4-pro')

console.log('OK — usage recorded and queryable:')
console.log(JSON.stringify(summary, null, 2))
