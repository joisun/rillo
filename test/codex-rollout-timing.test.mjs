import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, appendFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createCodexRolloutTiming } from '../server/src/runtime/codex-rollout-timing.mjs'
import { createCodexSessionAdapter } from '../server/src/runtime/adapters/codex-sessions.mjs'

const iso = value => new Date(value).toISOString()
const context = turn => JSON.stringify({ type: 'turn_context', payload: { turn_id: turn } }) + '\n'
const record = (id, ms, text = 'PRIVATE BODY', role = 'assistant') => JSON.stringify({ type: 'response_item', timestamp: iso(ms), payload: { type: 'message', id, role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } }) + '\n'
const item = (id, turnId = 'turn', text = 'PRIVATE BODY') => ({ turnId, startedAtMs: null, completedAtMs: null, item: { id, type: 'agentMessage', text } })

async function fixture(t, text) {
  const root = await mkdtemp(join(tmpdir(), 'codex-rollout-time-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'sessions'))
  const path = join(root, 'sessions', 'rollout-thread.jsonl')
  await writeFile(path, text)
  return { root, path, timing: createCodexRolloutTiming({ dataRoot: root, resolvePath: () => path }) }
}

test('missing producer times use exact native IDs or a unique text match within the same turn', async t => {
  const { timing } = await fixture(t, context('turn') + record('exact', 2000) + record('raw-id', 3000, 'unique') + record('repeat-1', 4000, 'repeat') + record('repeat-2', 5000, 'repeat') + context('other') + record('other', 6000, 'unique'))
  const entries = [item('exact'), item('generated', 'turn', 'unique'), item('ambiguous', 'turn', 'repeat'), item('wrong-turn', 'missing', 'unique'), { ...item('exact'), completedAtMs: 1234 }]
  const result = await timing.hydrate({}, entries)
  assert.deepEqual(result.map(entry => entry.completedAtMs), [2000, 3000, null, null, 1234])
  assert.equal(entries[0].completedAtMs, null)
})

test('ambiguous IDs do not fall through to text matching and updated files invalidate metadata caches', async t => {
  const { path, timing } = await fixture(t, context('turn') + record('reused', 2000) + record('reused', 3000))
  assert.equal((await timing.hydrate({}, [item('reused')]))[0].completedAtMs, null)
  assert.equal((await timing.hydrate({}, [item('new', 'turn', 'appended')]))[0].completedAtMs, null)
  await appendFile(path, record('new', 7000, 'appended'))
  assert.equal((await timing.hydrate({}, [item('new', 'turn', 'appended')]))[0].completedAtMs, 7000)
})

test('native paths outside the configured root, including symlinks, cannot supply timestamps', async t => {
  const { root } = await fixture(t, '')
  const outside = join(root, 'outside.jsonl')
  await writeFile(outside, context('turn') + record('exact', 2000))
  await symlink(outside, join(root, 'sessions', 'link.jsonl'))
  for (const path of [outside, join(root, 'sessions', 'link.jsonl')]) {
    const timing = createCodexRolloutTiming({ dataRoot: root, resolvePath: () => path })
    assert.equal((await timing.hydrate({}, [item('exact')]))[0].completedAtMs, null)
  }
})

test('legacy session charts and displayed messages share recovered times without retaining log bodies', async t => {
  const { root, path } = await fixture(t, context('turn') + record('first', 2000) + record('last', 4500))
  const adapter = createCodexSessionAdapter({ dataRoot: root, resolveLaunch: async () => ({ executable: '/bin/codex' }), createClient: () => ({ started: Promise.resolve(), notify() {}, close() {}, async request(method) {
    if (method === 'initialize') return {}
    if (method === 'thread/read') return { thread: { id: 'thread', createdAt: 1, updatedAt: 9, cwd: root, path } }
    if (method === 'thread/items/list') return { data: [item('last'), item('first')], nextCursor: null }
    assert.fail(method)
  } }) })
  t.after(() => adapter.close())
  const timeline = await adapter.timeline('thread', {})
  assert.equal(timeline.bounds.end_state, 'known')
  assert.equal(timeline.bounds.end_at, iso(4500))
  assert.equal(timeline.untimed_messages, 0)
  assert.equal(JSON.stringify(timeline).includes('PRIVATE'), false)
  const page = await adapter.messages('thread', { at: iso(4500), item_id: 'last' })
  assert.equal(page.seek.item_id, 'last')
  assert.equal(page.messages.find(message => message.id === 'last').at, timeline.bounds.end_at)
})
