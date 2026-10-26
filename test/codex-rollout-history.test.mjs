import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCodexRolloutHistory } from '../server/src/runtime/codex-rollout-history.mjs'
import { createCodexMessageIndex } from '../server/src/runtime/codex-session-timeline/message-index.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'session-history-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'sessions'))
  const path = join(root, 'sessions', 'journal.jsonl')
  await writeFile(path, 'PRIVATE initial journal\n')
  return { root, path, revision: createCodexRolloutHistory({ dataRoot: root, resolvePath: () => path }) }
}

test('history proof accepts only an unchanged file prefix and trusted native paths', async t => {
  const current = await fixture(t)
  const before = await current.revision({})
  await appendFile(current.path, 'appended\n')
  const appended = await current.revision({}, before)
  assert.equal(appended.preserves, true)
  await writeFile(current.path, 'REWRITTEN initial journal, longer than the old prefix\n')
  assert.equal((await current.revision({}, before)).preserves, false)
  await writeFile(current.path, 'short\n')
  assert.equal((await current.revision({}, before)).preserves, false)
  const outside = createCodexRolloutHistory({ dataRoot: current.root, resolvePath: () => join(current.root, 'outside.jsonl') })
  await writeFile(join(current.root, 'outside.jsonl'), 'private\n')
  assert.equal(await outside({}), null)
  assert.equal(JSON.stringify(appended).includes('PRIVATE'), false)
})

test('verified append reuses complete historical points with bounded pages; a rollback or rewrite is reindexed', async t => {
  const current = await fixture(t)
  const point = id => ({ turnId: 'turn-' + id, startedAtMs: 1000 + id, item: { id: 'm' + id, type: 'agentMessage', text: 'PRIVATE BODY' } })
  let rows = Array.from({ length: 450 }, (_, i) => point(450 - i)), calls = 0
  const index = createCodexMessageIndex({ historyRevision: current.revision, request: async (_method, input) => {
    calls++
    const offset = Number(input.cursor ?? 0)
    return { data: rows.slice(offset, offset + 100), nextCursor: offset + 100 < rows.length ? String(offset + 100) : null }
  } })
  const metadata = { session_id: 'session', created_at: new Date(1000).toISOString(), updated_at: 'v1' }
  const range = { from: new Date(0).toISOString(), to: new Date(10000).toISOString() }
  const first = await index.timeline(metadata, range)
  await index.timeline(metadata, { ...range, cursor: first.next_cursor })
  assert.equal(calls, 5)
  rows = [point(500), ...rows]
  await appendFile(current.path, 'new message\n')
  const updated = { ...metadata, updated_at: 'v2' }
  const head = await index.timeline(updated, range)
  assert.equal(calls, 6)
  assert.equal(head.points.length, 300)
  assert.match(head.next_cursor, /^cached:/)
  const older = await index.timeline(updated, { ...range, cursor: head.next_cursor })
  assert.equal(calls, 6)
  assert.equal(new Set([...head.points, ...older.points].map(p => p.item_id)).size, 451)
  assert.equal(older.points_coverage, 'complete')
  assert.equal(JSON.stringify(head).includes('PRIVATE'), false)

  rows = rows.slice(1)
  await appendFile(current.path, 'rollback event\n')
  const rolledBack = await index.timeline({ ...metadata, updated_at: 'v3' }, range)
  assert.equal(calls, 9)
  assert.equal(rolledBack.points.some(p => p.item_id === 'm500'), false)
  await assert.rejects(index.timeline({ ...metadata, updated_at: 'v3' }, { ...range, cursor: head.next_cursor }), { code: 'SESSION_TIMELINE_INCOMPLETE' })
  await index.timeline({ ...metadata, updated_at: 'v3' }, { ...range, cursor: rolledBack.next_cursor })
  await writeFile(current.path, 'changed prefix and longer new native journal\n')
  await index.timeline({ ...metadata, updated_at: 'v4' }, range)
  assert.equal(calls, 14)
})
