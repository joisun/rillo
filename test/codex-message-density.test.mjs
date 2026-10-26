import assert from 'node:assert/strict'
import test from 'node:test'
import { createCodexMessageIndex } from '../server/src/runtime/codex-session-timeline/message-index.mjs'
import { createCodexSessionAdapter } from '../server/src/runtime/adapters/codex-sessions.mjs'

const metadata = { session_id: 'thread', created_at: new Date(1000).toISOString(), updated_at: new Date(9000).toISOString(), forked_from: null }
const bounds = { from: new Date(0).toISOString(), to: new Date(10000).toISOString() }
const message = (id, ms, role = 'agentMessage') => ({ turnId: 'turn-' + id, startedAtMs: ms, item: { id, type: role, text: 'PRIVATE BODY', content: [{ type: 'text', text: 'PRIVATE PROMPT' }] } })

test('density uses native message times, ignores tools, excludes inherited fork messages and retains no body', async () => {
  const entries = [message('new', 4000), message('prompt', 3000, 'userMessage'), message('copied', 500), message('unknown', null), { turnId: 'tool-turn', startedAtMs: 3500, item: { id: 'tool', type: 'commandExecution', aggregatedOutput: 'PRIVATE TOOL' } }]
  const index = createCodexMessageIndex({ request: async () => ({ data: entries, nextCursor: null }) })
  const result = await index.timeline({ ...metadata, forked_from: { session_id: 'original' } }, bounds)
  assert.deepEqual(result.points.map((point) => point.item_id), ['new', 'prompt'])
  assert.equal(result.points[0].at, '1970-01-01T00:00:04.000Z')
  assert.equal(result.untimed_messages, 1)
  assert.equal(result.points_coverage, 'complete')
  assert.ok(!JSON.stringify(result).includes('PRIVATE'))
})

test('message index exposes partial coverage and can seek an earlier page after explicit continuation', async () => {
  const calls = []
  const index = createCodexMessageIndex({ request: async (_method, input) => {
    calls.push(input)
    const page = Number(input.cursor ?? 0)
    return { data: [message('m' + page, 9000 - page * 1000)], nextCursor: page < 3 ? String(page + 1) : null }
  } })
  const first = await index.timeline(metadata, bounds)
  assert.equal(first.points_coverage, 'partial')
  assert.equal(first.next_cursor, '3')
  await assert.rejects(index.read(metadata, { at: new Date(6100).toISOString() }), { code: 'SESSION_TIMELINE_INCOMPLETE' })
  const last = await index.timeline(metadata, { ...bounds, cursor: first.next_cursor })
  assert.equal(last.points_coverage, 'complete')
  const located = await index.read(metadata, { at: new Date(6100).toISOString() })
  assert.equal(located.target.item_id, 'm3')
  assert.equal(calls.at(-1).cursor, '3')
})

test('unknown time and unsupported methods remain explicit, repeated cursors fail closed', async () => {
  const unknown = createCodexMessageIndex({ request: async () => ({ data: [message('untimed', null)], nextCursor: null }) })
  assert.equal((await unknown.timeline(metadata, bounds)).untimed_messages, 1)
  assert.equal((await unknown.read(metadata, { at: bounds.to })).state, 'unavailable')
  const unsupported = createCodexMessageIndex({ request: async () => { throw Object.assign(new Error('missing'), { code: 'SESSION_BROWSER_UNSUPPORTED' }) } })
  assert.equal((await unsupported.timeline(metadata, bounds)).points_coverage, 'unsupported')
  const repeated = createCodexMessageIndex({ request: async (_method, input) => ({ data: [], nextCursor: input.cursor }) })
  await assert.rejects(repeated.timeline(metadata, { ...bounds, cursor: 'same' }), { code: 'SESSION_BROWSER_READ_FAILED' })
})

test('recent reading skips tool-only pages within a bounded budget', async () => {
  let calls = 0
  const index = createCodexMessageIndex({ request: async (_method, input) => {
    calls += 1
    return input.cursor ? { data: [message('visible', 3000)], nextCursor: null } : { data: [{ turnId: 't', item: { id: 'tool', type: 'commandExecution' } }], nextCursor: 'older' }
  } })
  const result = await index.read(metadata)
  assert.equal(calls, 2)
  assert.equal(result.entries[0].item.id, 'visible')
})

test('changed native metadata invalidates stale message points and completion', async () => {
  let changed = false
  const index = createCodexMessageIndex({ request: async () => ({ data: [message(changed ? 'replacement' : 'original', 3000)], nextCursor: null }) })
  await index.timeline(metadata, bounds)
  changed = true
  const updated = { ...metadata, updated_at: new Date(10000).toISOString() }
  const result = await index.timeline(updated, bounds)
  assert.deepEqual(result.points.map((point) => point.item_id), ['replacement'])
  assert.equal((await index.read(updated, { at: new Date(3500).toISOString() })).target.item_id, 'replacement')
})

test('adapter recent and located conversations retain exact producer timestamps and expose no tool payloads', async (t) => {
  const rows = [message('answer', 220123), message('prompt', 210456, 'userMessage'), { turnId: 'turn', startedAtMs: 215000, item: { id: 'tool', type: 'commandExecution', aggregatedOutput: 'TOOL SECRET' } }]
  const adapter = createCodexSessionAdapter({ dataRoot: '/density-test', resolveLaunch: async () => ({ executable: '/bin/codex' }), createClient: () => ({ started: Promise.resolve(), close() {}, notify() {}, async request(method) {
    if (method === 'initialize') return {}
    if (method === 'thread/read') return { thread: { id: 'thread', cwd: '/workspace', createdAt: 100, updatedAt: 400 } }
    if (method === 'thread/items/list') return { data: rows, nextCursor: null }
    assert.fail(method)
  } }) })
  t.after(() => adapter.close())
  const recent = await adapter.messages('thread', {})
  assert.deepEqual(recent.messages.map((row) => row.id), ['prompt', 'answer'])
  assert.ok(recent.messages.every((row) => row.time_precision === 'message'))
  assert.equal(recent.messages[0].at, new Date(210456).toISOString())
  const at = await adapter.messages('thread', { at: new Date(220123).toISOString() })
  assert.equal(at.seek.item_id, 'answer')
  assert.equal(at.seek.at, at.messages.find((row) => row.id === 'answer').at)
  assert.ok(!JSON.stringify(at).includes('TOOL SECRET'))
})

test('whole-session charts use creation and completed message time, never update time or tool activity', async (t) => {
  const rows = [{ ...message('latest', 3000), completedAtMs: 4500 }, message('prompt', 2000, 'userMessage'), { turnId: 't', completedAtMs: 8500, item: { id: 'tool', type: 'commandExecution' } }]
  const adapter = createCodexSessionAdapter({ dataRoot: '/range-test', resolveLaunch: async () => ({ executable: '/bin/codex' }), createClient: () => ({ started: Promise.resolve(), close() {}, notify() {}, async request(method) {
    if (method === 'initialize') return {}
    if (method === 'thread/read') return { thread: { id: 'thread', cwd: '/workspace', createdAt: 1, updatedAt: 9 } }
    if (method === 'thread/items/list') return { data: rows, nextCursor: null }
    assert.fail('Whole-session charts must not read turn durations: ' + method)
  } }) })
  t.after(() => adapter.close())
  const chart = await adapter.timeline('thread', {})
  assert.equal(chart.scope, 'session')
  assert.equal(chart.from, new Date(1000).toISOString())
  assert.equal(chart.to, new Date(4500).toISOString())
  assert.equal(chart.bounds.end_state, 'known')
  assert.equal(chart.points[0].at, chart.to)
  const page = await adapter.messages('thread', { at: chart.to })
  assert.equal(page.seek.item_id, 'latest')
  assert.equal(page.messages.find(item => item.id === 'latest').at, chart.to)
})

test('tool-only head stays pending until the actual last message is read and an unknown last timestamp stays unknown', async () => {
  const index = createCodexMessageIndex({ request: async (_method, input) => {
    const page = Number(input.cursor ?? 0)
    return page < 3 ? { data: [{ turnId: 't', startedAtMs: 9500 - page * 100, item: { id: 'tool-' + page, type: 'commandExecution' } }], nextCursor: String(page + 1) }
      : { data: [message('last', 6000), message('older', 2000)], nextCursor: null }
  } })
  const first = await index.timeline(metadata, bounds)
  assert.equal(index.bounds(metadata).end_state, 'pending')
  await index.timeline(metadata, { ...bounds, cursor: first.next_cursor })
  assert.equal(index.bounds(metadata).end_at, new Date(6000).toISOString())
  assert.equal(index.bounds(metadata).indexed_from, new Date(2000).toISOString())
  const unknown = createCodexMessageIndex({ request: async () => ({ data: [message('new-unknown', null), message('old-known', 2000)], nextCursor: null }) })
  await unknown.timeline(metadata, bounds)
  assert.equal(unknown.bounds(metadata).end_state, 'unknown')
  assert.equal(unknown.bounds(metadata).end_at, null)
})

test('message IDs disambiguate equal timestamps and survive a completion timestamp changing', async () => {
  let completed = 5000
  const index = createCodexMessageIndex({ request: async () => ({ data: [{ ...message('a', 3000), completedAtMs: completed }, message('b', 5000)], nextCursor: null }) })
  await index.timeline(metadata, bounds)
  assert.equal((await index.read(metadata, { at: new Date(5000).toISOString(), itemId: 'b' })).target.item_id, 'b')
  completed = 6000
  const updated = { ...metadata, updated_at: new Date(10000).toISOString() }
  const target = await index.read(updated, { at: new Date(5000).toISOString(), itemId: 'a' })
  assert.equal(target.target.item_id, 'a')
  assert.equal(target.target.at, new Date(6000).toISOString())
  await assert.rejects(index.read(updated, { at: new Date(5000).toISOString(), itemId: 'missing' }), { code: 'SESSION_BROWSER_READ_FAILED' })
})

test('refreshing the head discovers a newly appended message even within the same metadata second', async () => {
  let rows = [message('old', 3000)]
  const index = createCodexMessageIndex({ request: async () => ({ data: rows, nextCursor: null }) })
  await index.timeline(metadata, bounds)
  rows = [message('new', 4000), ...rows]
  await index.timeline(metadata, bounds)
  assert.equal(index.bounds(metadata).end_at, new Date(4000).toISOString())
})

test('a selected historical item survives native metadata updates and shifted page cursors', async () => {
  let changed = false
  const methods = []
  const index = createCodexMessageIndex({ request: async (method, input) => {
    methods.push(method)
    if (method === 'thread/items/read') {
      assert.deepEqual(input.itemIds, ['old'])
      assert.equal(input.turnId, 'turn-old')
      return { data: [message('old', 2000)] }
    }
    const page = Number(input.cursor ?? 0)
    return { data: [message(page === 3 && !changed ? 'old' : 'page-' + page, 9000 - page * 2000)], nextCursor: page < 3 ? String(page + 1) : null }
  } })
  const first = await index.timeline(metadata, bounds)
  await index.timeline(metadata, { ...bounds, cursor: first.next_cursor })
  changed = true
  const found = await index.read({ ...metadata, updated_at: new Date(10000).toISOString() }, { at: new Date(2000).toISOString(), itemId: 'old' })
  assert.equal(found.target.item_id, 'old')
  assert.equal(found.target.at, new Date(2000).toISOString())
  assert.ok(found.entries.some(entry => entry.item.id === 'old'))
  assert.equal(methods.at(-1), 'thread/items/read')
})
