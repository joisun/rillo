import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import test from 'node:test'
import { WebSocketServer } from 'ws'

import { createCodexSessionStatus } from '../server/src/runtime/codex-session-status.mjs'
import { createCodexSharedClient } from '../server/src/runtime/codex-shared-client.mjs'

function fixture(options = {}) {
  const calls = []
  let notification
  let now = 10000
  let failed = false
  let connections = 0
  const client = {
    started: Promise.resolve(), closed: false,
    notify(method) { calls.push({ method }) },
    onNotification(listener) { notification = listener },
    close() { this.closed = true },
    async request(method, params) {
      calls.push({ method, params })
      if (failed) throw new Error('unavailable')
      if (method === 'initialize') return {}
      if (method === 'thread/loaded/list') return { data: params.cursor ? ['ready'] : ['working', 'needs-you'], nextCursor: params.cursor ? null : 'next' }
      return { thread: { id: params.threadId, status: params.threadId === 'ready' ? { type: 'idle' } : { type: 'active', activeFlags: params.threadId === 'needs-you' ? ['waitingOnApproval'] : [] } } }
    },
  }
  const monitor = createCodexSessionStatus({ dataRoot: '/codex', clock: () => now, createClient: () => { connections++; client.closed = false; return client }, ...options })
  return { monitor, client, calls, advance: () => { now += 3001 }, fail: () => { failed = true }, change: () => notification({ method: 'thread/status/changed' }), connections: () => connections }
}

test('native status reads all loaded pages and preserves active flags without loading or resuming threads', async t => {
  const f = fixture(); t.after(() => f.monitor.close())
  const snapshot = await f.monitor.snapshot()
  assert.equal(snapshot.available, true)
  assert.deepEqual(snapshot.threads.map(thread => thread.id).sort(), ['needs-you', 'ready', 'working'])
  assert.deepEqual(snapshot.threads.find(thread => thread.id === 'needs-you').status.activeFlags, ['waitingOnApproval'])
  assert.equal(f.calls.filter(call => call.method === 'thread/read').every(call => call.params.includeTurns === false), true)
  assert.equal(f.calls.some(call => /resume|start|turn\//.test(call.method)), false)
})

test('concurrent reads and fresh snapshots share one scan; native events invalidate it immediately', async t => {
  let changes = 0
  const f = fixture({ onChange: () => changes++ }); t.after(() => f.monitor.close())
  const [one, two] = await Promise.all([f.monitor.snapshot(), f.monitor.snapshot()])
  assert.deepEqual(one, two)
  await f.monitor.snapshot()
  assert.equal(f.calls.filter(call => call.method === 'thread/loaded/list').length, 2)
  f.change()
  await f.monitor.snapshot()
  assert.equal(changes, 1)
  assert.equal(f.calls.filter(call => call.method === 'thread/loaded/list').length, 4)
  assert.equal(f.connections(), 1)
})

test('failed refresh removes stale status and reconnects without any process-based fallback', async t => {
  const f = fixture(); t.after(() => f.monitor.close())
  assert.equal((await f.monitor.snapshot()).available, true)
  f.advance(); f.fail()
  const failed = await f.monitor.snapshot()
  assert.equal(failed.available, false)
  assert.deepEqual(failed.threads, [])
  assert.equal(f.client.closed, true)
  f.advance(); await f.monitor.snapshot()
  assert.equal(f.connections(), 2)
})

test('native connection uses WebSocket over the existing Unix socket and never owns the server', async t => {
  const root = await mkdtemp('/tmp/tr-status-')
  await mkdir(join(root, 'app-server-control'))
  const server = createServer()
  const websocket = new WebSocketServer({ server })
  const methods = []
  websocket.on('connection', socket => socket.on('message', bytes => {
    const message = JSON.parse(bytes)
    methods.push(message.method)
    if (!Object.hasOwn(message, 'id')) return
    const result = message.method === 'thread/loaded/list' ? { data: ['native'], nextCursor: null }
      : message.method === 'thread/read' ? { thread: { id: 'native', status: { type: 'idle' } } } : {}
    socket.send(JSON.stringify({ id: message.id, result }))
  }))
  await new Promise(resolve => server.listen(join(root, 'app-server-control', 'app-server-control.sock'), resolve))
  const monitor = createCodexSessionStatus({ dataRoot: root })
  t.after(async () => {
    monitor.close()
    for (const socket of websocket.clients) socket.terminate()
    await new Promise(resolve => server.close(resolve))
    websocket.close()
    await rm(root, { recursive: true, force: true })
  })
  const snapshot = await monitor.snapshot()
  assert.equal(snapshot.available, true)
  assert.equal(snapshot.threads[0].status.type, 'idle')
  monitor.close()
  assert.equal(server.listening, true)
  assert.deepEqual(methods, ['initialize', 'initialized', 'thread/loaded/list', 'thread/read'])
  const client = createCodexSharedClient({ dataRoot: root })
  await client.started
  assert.throws(() => client.request('thread/resume'), /READ_ONLY/)
  client.close()
})

test('a missing shared server reports unavailable on every platform', async t => {
  const monitor = createCodexSessionStatus({ dataRoot: '/missing/rillo-codex' })
  t.after(() => monitor.close())
  assert.equal((await monitor.snapshot()).available, false)
})

test('repeated loaded-page cursors fail instead of looping or claiming Inactive', async t => {
  const f = fixture({ createClient: () => ({ started: Promise.resolve(), notify() {}, onNotification() {}, close() {}, request: async method => method === 'initialize' ? {} : { data: [], nextCursor: 'repeated' } }) })
  t.after(() => f.monitor.close())
  const snapshot = await f.monitor.snapshot()
  assert.equal(snapshot.available, false)
  assert.deepEqual(snapshot.threads, [])
})
