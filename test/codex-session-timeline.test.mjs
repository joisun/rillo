import assert from 'node:assert/strict'
import test from 'node:test'
import { createCodexSessionAdapter } from '../server/src/runtime/adapters/codex-sessions.mjs'

function fixture(t, { pages, fork = false, timed = true, unsupported = false }) {
  const calls = []
  const metadata = { id: 'child', sessionId: 'shared-root', cwd: '/workspace', createdAt: 100, updatedAt: 500, forkedFromId: fork ? 'original' : null }
  const adapter = createCodexSessionAdapter({
    dataRoot: '/codex-test',
    resolveLaunch: async () => ({ executable: '/bin/codex' }),
    createClient: () => ({
      started: Promise.resolve(), notify: () => {}, close: () => {},
      async request(method, params) {
        calls.push({ method, params })
        if (method === 'initialize') return {}
        if (method === 'thread/read') return { thread: metadata }
        if (method === 'thread/turns/list') {
          if (unsupported) throw Object.assign(new Error('missing'), { code: 'RUNTIME_PROTOCOL_METHOD_UNAVAILABLE' })
          const page = pages[params.cursor ?? 'latest']
          return { data: page.turns.map((row) => ({ ...row, items: params.itemsView === 'full' ? row.items ?? [
            { id: row.id + '-u', type: 'userMessage', content: [{ type: 'text', text: 'Prompt' }] },
            { id: row.id + '-a', type: 'agentMessage', text: 'Answer' },
          ] : [] })), nextCursor: page.next ?? null }
        }
        if (method === 'thread/items/list') {
          if (!timed || unsupported) throw Object.assign(new Error('missing'), { code: 'RUNTIME_PROTOCOL_METHOD_UNAVAILABLE' })
          const page = params.turnId ? { turns: Object.values(pages).flatMap((page) => page.turns).filter((turn) => turn.id === params.turnId) } : pages[params.cursor ?? 'latest']
          return { data: page.turns.flatMap((row) => [
            { turnId: row.id, item: { id: row.id + '-a', type: 'agentMessage', text: 'Answer' }, startedAtMs: Number.isFinite(row.startedAt) ? (row.startedAt + 20) * 1000 : null },
            { turnId: row.id, item: { id: row.id + '-u', type: 'userMessage', content: [{ type: 'text', text: 'Prompt' }] }, startedAtMs: Number.isFinite(row.startedAt) ? (row.startedAt + 10) * 1000 : null },
          ]), nextCursor: page.next ?? null }
        }
        assert.fail(method)
      },
    }),
  })
  t.after(() => adapter.close())
  return { adapter, calls, metadata }
}

const range = { from: '1970-01-01T00:01:40.000Z', to: '1970-01-01T00:10:00.000Z', cursor: null }
const turn = (id, startedAt, completedAt, status = 'completed') => ({ id, startedAt, completedAt, status })

test('forked threads remain distinct and inherited turns are excluded from activity', async (t) => {
  const { adapter } = fixture(t, { fork: true, pages: { latest: { turns: [
    turn('owned', 200, 240), turn('inherited', 50, 70), turn('ongoing', 300, null, 'inProgress'),
  ] } } })
  const page = await adapter.timeline('child', range)
  assert.equal(page.session.session_id, 'child')
  assert.equal(page.session.forked_from.session_id, 'original')
  assert.equal(page.session.native_parent, null)
  assert.deepEqual(page.segments.map((row) => row.turn_id), ['owned'])
  assert.equal(page.unplaced_turns, 1)
  assert.equal(page.coverage, 'complete')
  assert.equal(page.next_cursor, null)
  const before = await adapter.messages('child', { query: '', cursor: null, at: '1970-01-01T00:00:30.000Z', limit: 5 })
  assert.equal(before.seek.state, 'before_start')
  assert.deepEqual(before.messages, [])
})

test('message seek reuses a loaded turn cursor and refines using producer message timestamps', async (t) => {
  const { adapter, calls } = fixture(t, { pages: {
    latest: { turns: [turn('later', 300, 350)], next: 'older' },
    older: { turns: [turn('target', 200, 240)] },
  } })
  await adapter.timeline('child', range)
  const result = await adapter.messages('child', { at: '1970-01-01T00:03:45.000Z', limit: 5 })
  assert.equal(result.seek.precision, 'message')
  assert.equal(result.seek.item_id, 'target-a')
  assert.equal(result.messages.find((row) => row.id === 'target-a').at, '1970-01-01T00:03:40.000Z')
  assert.equal(calls.findLast((call) => call.method === 'thread/turns/list').params.cursor, 'older')
})

test('missing message timestamps fall back honestly to turn-level positioning', async (t) => {
  const { adapter } = fixture(t, { timed: false, pages: { latest: { turns: [turn('target', 200, 240)] } } })
  const result = await adapter.messages('child', { at: '1970-01-01T00:03:45.000Z', limit: 5 })
  assert.equal(result.seek.precision, 'turn')
  assert.equal(result.seek.item_id, 'target-u')
  assert.ok(result.messages.every((row) => row.time_precision === 'turn'))
})

test('bounded timeline pages stay partial rather than inventing zero activity for unscanned history', async (t) => {
  const pages = Object.fromEntries(['latest', 'a', 'b', 'c'].map((key, index, all) => [key, {
    turns: [turn('t' + index, 500 - index * 10, 505 - index * 10)],
    next: all[index + 1] ?? null,
  }]))
  const { adapter } = fixture(t, { pages })
  const result = await adapter.timeline('child', range)
  assert.equal(result.coverage, 'partial')
  assert.match(result.next_cursor, /^density:/)
  await assert.rejects(adapter.messages('child', { at: range.from, limit: 5 }), { code: 'SESSION_TIMELINE_INCOMPLETE' })
  const last = await adapter.timeline('child', { ...range, cursor: result.next_cursor })
  assert.equal(last.coverage, 'complete')
})

test('time seek reserves space for its target even when earlier context fills the response budget', async (t) => {
  const context = turn('older', 150, 190)
  context.items = Array.from({ length: 30 }, (_, i) => ({ id: 'large-' + i, type: 'agentMessage', text: 'x'.repeat(16000) }))
  const { adapter } = fixture(t, { timed: false, pages: { latest: { turns: [turn('target', 200, 240), context] } } })
  const result = await adapter.messages('child', { at: '1970-01-01T00:03:45.000Z', limit: 5 })
  assert.equal(result.seek.item_id, 'target-u')
  assert.ok(result.messages.some((row) => row.id === result.seek.item_id))
  assert.equal(result.truncated, true)
  assert.ok(result.messages.reduce((size, row) => size + row.text.length, 0) <= 256 * 1024)
})

test('unsupported history is explicit and nullable timing does not become a session-length interval', async (t) => {
  const old = fixture(t, { unsupported: true, pages: {} })
  assert.equal((await old.adapter.timeline('child', range)).coverage, 'unsupported')
  const partial = fixture(t, { pages: { latest: { turns: [turn('unknown', null, null)] } } })
  const result = await partial.adapter.timeline('child', range)
  assert.deepEqual(result.segments, [])
  assert.equal(result.unplaced_turns, 1)
})
