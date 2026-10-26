import assert from 'node:assert/strict'
import test from 'node:test'
import { createSessionMetadata } from '../server/src/runtime/adapters/codex-sessions/metadata.mjs'
import { createCodexSessionAdapter } from '../server/src/runtime/adapters/codex-sessions.mjs'

const params = { cursor: null, limit: 100, archived: false }
const page = id => ({ sessions: id ? [{ session_id: id }] : [], next_cursor: null })
const settle = () => new Promise(resolve => setImmediate(resolve))
function fixture(t, options = {}) {
  let now = 0
  const calls = []
  const value = createSessionMetadata({ dataRoot: '/absent-test-root', clock: () => now, watchImpl() { throw new Error('no watcher') }, load: async input => { calls.push(input); return page('one') }, reconcile: async () => {}, ...options })
  t.after(() => value.close())
  return { value, calls, advance(ms) { now += ms } }
}

test('identical native metadata queries share a flight and a bounded fresh cache', async t => {
  const current = fixture(t)
  const pages = await Promise.all([current.value.list(params), current.value.list(params)])
  assert.equal(current.calls.length, 1)
  assert.equal(pages[0], pages[1])
  await current.value.list(params)
  assert.equal(current.calls.length, 1)
  await current.value.list({ ...params, cwd: '/other' })
  await current.value.list({ ...params, cursor: 'second' })
  await current.value.list({ ...params, archived: true })
  assert.equal(current.calls.length, 4)
  current.advance(31_000)
  await current.value.list(params)
  assert.equal(current.calls.length, 5)
})

test('stale metadata returns immediately, shares its refresh and notifies only on change', async t => {
  let finish, changed = 0, loads = 0
  const current = fixture(t, { onChange: () => changed++, load: async () => ++loads === 1 ? page('old') : new Promise(resolve => { finish = resolve }) })
  await current.value.list(params)
  current.advance(4000)
  const old = await current.value.list(params)
  assert.equal(old.sessions[0].session_id, 'old')
  await current.value.list(params)
  assert.equal(loads, 2)
  finish(page('new'))
  await settle()
  assert.equal(changed, 1)
  assert.equal((await current.value.list(params)).sessions[0].session_id, 'new')
})

test('an empty index is verified once before reporting no sessions, and a failed verification never becomes empty success', async t => {
  let repaired = false, repairs = 0
  const current = fixture(t, { load: async () => page(repaired ? 'legacy' : null), reconcile: async () => { repairs++; repaired = true } })
  const result = await current.value.list(params)
  assert.equal(result.sessions[0].session_id, 'legacy')
  assert.equal(repairs, 1)
  await current.value.list(params)
  assert.equal(repairs, 1)
  const failed = fixture(t, { load: async () => page(null), reconcile: async () => { throw new Error('repair failed') } })
  await assert.rejects(failed.value.list(params), /repair failed/)
  await assert.rejects(failed.value.list(params), /repair failed/)
})

test('watch changes invalidate in-flight cache writes; close releases all watchers', async t => {
  const listeners = [], closed = []
  let finish, loads = 0
  const current = fixture(t, { watchImpl(path, _options, callback) { listeners.push(callback); return { on() {}, close() { closed.push(path) } } }, load: async () => ++loads === 1 ? new Promise(resolve => { finish = resolve }) : page('new') })
  const first = current.value.list(params)
  await settle()
  listeners[1]('change', 'rollout.jsonl')
  finish(page('old'))
  await first
  assert.equal((await current.value.list(params)).sessions[0].session_id, 'new')
  current.value.close()
  assert.equal(closed.length, 3)
})

test('list and directory pages use one fast native request, preserving every returned cursor and store isolation', async t => {
  const calls = []
  const make = root => createCodexSessionAdapter({ dataRoot: root, resolveLaunch: async () => ({ executable: '/bin/codex' }), watchImpl() { throw new Error('no watcher') }, createClient: () => ({ started: Promise.resolve(), notify() {}, close() {}, async request(method, input) {
    if (method === 'initialize') return {}
    calls.push(input)
    return { data: Array.from({ length: 100 }, (_, i) => ({ id: 's' + i, cwd: '/project', createdAt: 1, updatedAt: 2 })), nextCursor: 'native-next' }
  } }) })
  const adapter = make('/store-one'), other = make('/store-two')
  t.after(() => { adapter.close(); other.close() })
  const input = { workspace: '', query: '', ...params }
  const [sessions, directories] = await Promise.all([adapter.list(input), adapter.workspaces(input)])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].useStateDbOnly, true)
  assert.equal(sessions.sessions.length, 100)
  assert.equal(directories.workspaces[0].observed_count, 100)
  assert.equal(sessions.next_cursor, 'native-next')
  assert.equal(directories.next_cursor, 'native-next')
  await other.list(input)
  assert.equal(calls.length, 2)
})

test('a blocked background repair uses its own client and cannot hold a foreground workspace read', async t => {
  let repairing, release
  const started = new Promise(resolve => { repairing = resolve })
  const blocked = new Promise(resolve => { release = resolve })
  let timer
  const timeout = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('background repair did not start')), 4500) })
  const clients = []
  const adapter = createCodexSessionAdapter({ dataRoot: '/isolated-repair', resolveLaunch: async () => ({ executable: '/bin/codex' }), watchImpl() { throw new Error('no watcher') }, createClient() {
    const number = clients.length
    clients.push(number)
    return { started: Promise.resolve(), notify() {}, close() {}, async request(method, input) {
      if (method === 'initialize') return {}
      if (input.useStateDbOnly === false && !input.archived) { repairing(); await blocked }
      return { data: [{ id: 'native', cwd: input.cwd ?? '/workspace' }], nextCursor: null }
    } }
  } })
  t.after(() => { clearTimeout(timer); release(); adapter.close() })
  await adapter.list({ ...params, workspace: '', query: '' })
  await Promise.race([started, timeout])
  clearTimeout(timer)
  assert.equal(clients.length, 2)
  const result = await adapter.list({ ...params, workspace: '/another-workspace', query: '' })
  assert.equal(result.sessions[0].workspace, '/another-workspace')
  release()
})
