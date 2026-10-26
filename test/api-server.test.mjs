import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import test from 'node:test'

import { createApiServer } from '../server/src/api-server.mjs'
import { createRevisionHub } from '../server/src/revision-hub.mjs'

async function fixture(apiOverrides = {}) {
  const hub = createRevisionHub({ instanceId: 'server-test', keepaliveMs: 60_000 })
  const api = createApiServer({
    hub, host: '127.0.0.1', port: 0,
    dashboardHtml: '<!doctype html><title>Tasks Recorder</title>',
    ...apiOverrides,
  })
  const address = await api.listen()
  return {
    hub, api, url: address.url,
    async cleanup() { hub.close(); await api.close() },
  }
}

const sseReaderStates = new WeakMap()

test('Run file open requires same-origin JSON and forwards only run ID and recorded path', async () => {
  const calls = []
  const current = await fixture({
    runService: { openFile: async (id, path) => { calls.push({ id, path }); return { opened: true, path } } },
  })
  try {
    const url = `${current.url}/api/v1/runs/run%20one/files/open`
    const body = JSON.stringify({ path: 'report #1.md' })
    const result = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    assert.equal(result.status, 200)
    assert.deepEqual(await result.json(), { opened: true, path: 'report #1.md' })
    assert.deepEqual(calls, [{ id: 'run one', path: 'report #1.md' }])
    const wrongOrigin = await fetch(url, { method: 'POST', headers: {
      'Content-Type': 'application/json', Origin: 'https://example.invalid',
    }, body })
    assert.equal(wrongOrigin.status, 403)
    const form = await fetch(url, { method: 'POST', body })
    assert.equal(form.status, 415)
    const extra = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'report #1.md', command: 'unexpected' }),
    })
    assert.equal(extra.status, 400)
    assert.equal(calls.length, 1)
  } finally {
    await current.cleanup()
  }
})

test('Run file open preserves actionable file errors', async () => {
  const current = await fixture({
    runService: { openFile: async () => {
      throw Object.assign(new Error('文件已不存在'), { code: 'RUN_FILE_NOT_FOUND', statusCode: 404 })
    } },
  })
  try {
    const result = await fetch(`${current.url}/api/v1/runs/run-one/files/open`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'missing.md' }),
    })
    assert.equal(result.status, 404)
    assert.equal((await result.json()).error.message, '文件已不存在')
  } finally {
    await current.cleanup()
  }
})

async function readSseEvent(reader) {
  let state = sseReaderStates.get(reader)
  if (!state) {
    state = { source: '', decoder: new TextDecoder() }
    sseReaderStates.set(reader, state)
  }
  while (!state.source.includes('\n\n')) {
    const { value, done } = await reader.read()
    if (done) throw new Error('SSE stream ended before an event arrived')
    state.source += state.decoder.decode(value, { stream: true })
  }
  const boundary = state.source.indexOf('\n\n') + 2
  const event = state.source.slice(0, boundary)
  state.source = state.source.slice(boundary)
  return event
}

test('SSE test reader preserves a second event received in the same network chunk', async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('retry: 1000\n\nevent: ready\ndata: {"revision":0}\n\n'))
      controller.close()
    },
  })
  const reader = stream.getReader()

  assert.equal(await readSseEvent(reader), 'retry: 1000\n\n')
  assert.equal(await readSseEvent(reader), 'event: ready\ndata: {"revision":0}\n\n')
})

async function rawRequest(url, headers) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { headers }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({
        status: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }))
    })
    request.on('error', reject)
    request.end()
  })
}

test('all retired Task routes return 410 without reading bodies or publishing revisions', async () => {
  const current = await fixture({
    service: new Proxy({}, { get: () => assert.fail('Task service must never be accessed') }),
    journalService: new Proxy({}, { get: () => assert.fail('Journal must never be accessed') }),
    store: new Proxy({}, { get: () => assert.fail('Task store must never be accessed') }),
  })
  try {
    const routes = [
      ['GET', '/tasks'], ['PUT', '/tasks/task-a'], ['GET', '/tasks/task-a'],
      ['POST', '/tasks/task-a/complete'], ['POST', '/tasks/task-a/resume'],
      ['POST', '/tasks/task-a/archive'], ['POST', '/tasks/task-a/delete'], ['POST', '/tasks/task-a/restore'],
      ['PATCH', '/tasks/task-a/status'], ['POST', '/tasks/sync-tree'], ['POST', '/tasks/mutate'],
      ['POST', '/tasks/sync-structure'], ['GET', '/tasks/task-a/events'],
      ['POST', '/context'], ['GET', '/snapshot'], ['POST', '/heartbeat'], ['POST', '/render'], ['GET', '/check'],
      ['POST', '/events'], ['POST', '/import/executions'], ['GET', '/executions'],
      ['PATCH', '/executions/execution/task'], ['PATCH', '/executions/tasks'], ['PATCH', '/executions/execution/classification'],
      ['POST', '/work/context'], ['POST', '/work/focus'], ['POST', '/work/intents'], ['POST', '/work/checkpoint'],
      ['PATCH', '/segments/segment/attribution'], ['PATCH', '/source-sessions/session/project'],
      ['GET', '/sessions/session/context'],
      ...['session-start', 'turn-start', 'tool-use', 'subagent-start', 'subagent-stop', 'session-end']
        .map(action => ['POST', `/lifecycle/${action}`]),
    ]
    for (const [method, path] of routes) {
      const response = await fetch(`${current.url}/api/v1${path}`, { method })
      assert.equal(response.status, 410, `${method} ${path}`)
      assert.equal((await response.json()).error.code, 'TASKS_RETIRED')
    }
    const oldClient = await fetch(`${current.url}/api/v1/tasks`, { headers: { 'X-Tasks-Recorder-API-Version': '4' } })
    assert.equal(oldClient.status, 410)
    assert.equal(current.hub.current().revision, 0)
  } finally { await current.cleanup() }
})

test('local Sessions routes retain Host and Origin protection without CORS', async () => {
  const current = await fixture()
  try {
    const wrongOrigin = await fetch(`${current.url}/api/v1/meta`, { headers: { Origin: 'https://attacker.example' } })
    assert.equal(wrongOrigin.status, 403)
    assert.equal((await wrongOrigin.json()).error.code, 'ORIGIN_REJECTED')
    const meta = await fetch(`${current.url}/api/v1/meta`)
    assert.equal(meta.status, 200)
    assert.equal(meta.headers.get('access-control-allow-origin'), null)
    const wrongHost = await rawRequest(`${current.url}/health/live`, { Host: 'attacker.example' })
    assert.equal(wrongHost.status, 403)
    assert.equal(wrongHost.body.error.code, 'HOST_REJECTED')
  } finally { await current.cleanup() }
})

test('Session endpoints forward exact provider/session identity and all frozen query fields', async () => {
  const calls = []
  const browser = {
    providers: async () => ({ providers: [{ id: 'codex', store_id: 'store-one' }] }),
    relations: async input => { calls.push(['relations', input]); return { relations: [] } },
  }
  for (const operation of ['list', 'workspaces', 'activity', 'read', 'children', 'timeline', 'messages', 'resume']) {
    browser[operation] = async (...args) => { calls.push([operation, ...args]); return { operation } }
  }
  const current = await fixture({ sessionBrowser: browser })
  try {
    const base = `${current.url}/api/v1/session-browser`
    assert.equal((await fetch(`${base}/providers`).then(response => response.json())).providers[0].store_id, 'store-one')
    const query = 'store_id=store-one&cursor=opaque&from=2026-10-24T00%3A00%3A00Z&to=2026-10-24T01%3A00%3A00Z&at=2026-10-24T00%3A30%3A00Z&query=report'
    const expectedQuery = Object.fromEntries(new URLSearchParams(query))
    for (const operation of ['read', 'children', 'timeline', 'messages']) {
      const result = await fetch(`${base}/codex/sessions/thread%3Aone/${operation}?${query}`)
      assert.equal(result.status, 200)
      assert.deepEqual(calls.at(-1), [operation, 'codex', 'thread:one', expectedQuery])
    }
    for (const [path, operation] of [['workspaces', 'workspaces'], ['sessions', 'list']]) {
      assert.equal((await fetch(`${base}/codex/${path}?store_id=store-one`)).status, 200)
      assert.deepEqual(calls.at(-1), [operation, 'codex', { store_id: 'store-one' }])
    }
    await fetch(`${base}/codex/activity`)
    assert.deepEqual(calls.at(-1), ['activity', 'codex'])
    const relations = new URLSearchParams({ provider: 'codex', store_id: 'store-one', session_id: 'thread:one' })
    await fetch(`${base}/relations?${relations}`)
    assert.deepEqual(calls.at(-1), ['relations', Object.fromEntries(relations)])
    const resume = await fetch(`${base}/codex/sessions/thread%3Aone/resume`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ store_id: 'store-one' }),
    })
    assert.equal(resume.status, 200)
    assert.deepEqual(calls.at(-1), ['resume', 'codex', 'thread:one', { store_id: 'store-one' }])
    const extra = await fetch(`${base}/codex/sessions/thread%3Aone/resume`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ store_id: 'store-one', workspace: '/untrusted' }),
    })
    assert.equal(extra.status, 400)
  } finally { await current.cleanup() }
})

test('relation mutations publish SSE only on actual changes and reject untyped bodies', async () => {
  const parent = { provider: 'codex', store_id: 'store', session_id: 'parent' }
  const child = { ...parent, session_id: 'child' }
  const calls = []
  let exists = false
  const current = await fixture({ sessionBrowser: {
    link: async input => { calls.push(['link', input]); const created = !exists; exists = true; return { relation: input, created } },
    unlink: async input => { calls.push(['unlink', input]); const removed = exists; exists = false; return { removed } },
  } })
  let reader
  try {
    reader = (await fetch(`${current.url}/api/v1/events`)).body.getReader()
    await readSseEvent(reader)
    await readSseEvent(reader)
    const url = `${current.url}/api/v1/session-browser/links`
    const send = (method, input) => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 415)
    assert.equal((await send('POST', { parent, child, task_id: 'retired' })).status, 400)
    assert.equal((await send('POST', { parent, child, source: 'otty' })).status, 200)
    assert.match(await readSseEvent(reader), /"revision":1/)
    await send('POST', { parent, child })
    assert.equal(current.hub.current().revision, 1)
    await send('DELETE', { parent, child })
    assert.match(await readSseEvent(reader), /"revision":2/)
    await send('DELETE', { parent, child })
    assert.equal(current.hub.current().revision, 2)
    assert.deepEqual(calls[0], ['link', { parent, child, source: 'otty' }])
    assert.deepEqual(calls[2], ['unlink', { parent, child }])
  } finally { await reader?.cancel(); await current.cleanup() }
})

test('API v5 health and status need no Task store and mismatch errors are explicit', async () => {
  const current = await fixture({
    sessionBrowser: { check: () => ({ integrityCheck: 'ok', foreignKeyViolations: [] }) },
    serviceStatus: async () => ({ ready: true, scheduler: { degraded: true } }),
  })
  try {
    assert.equal((await fetch(`${current.url}/health/live`)).status, 200)
    assert.equal((await fetch(`${current.url}/health/ready`)).status, 200)
    assert.equal((await fetch(`${current.url}/api/v1/meta`).then(response => response.json())).api_version, 5)
    const status = await fetch(`${current.url}/api/v1/status`).then(response => response.json())
    assert.equal(status.scheduler.degraded, true)
    const mismatch = await fetch(`${current.url}/api/v1/runtimes`, { headers: { 'X-Tasks-Recorder-API-Version': '4' } })
    assert.equal(mismatch.status, 409)
    assert.equal((await mismatch.json()).error.code, 'API_VERSION_MISMATCH')
    const html = await fetch(current.url)
    assert.match(await html.text(), /Tasks Recorder/)
    assert.equal((await fetch(`${current.url}/favicon.ico`)).status, 204)
  } finally { await current.cleanup() }
})

test('settings keep typed read/update operations while Task resume stays retired', async () => {
  const calls = []
  const current = await fixture({ dashboardSettings: {
    get: async () => ({ settings: { resume_terminal: 'otty' }, terminal_options: [] }),
    update: async input => { calls.push(input); return { settings: input } },
  } })
  try {
    assert.equal((await fetch(`${current.url}/api/v1/settings`).then(response => response.json())).settings.resume_terminal, 'otty')
    const response = await fetch(`${current.url}/api/v1/settings`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resume_terminal: 'terminal' }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(calls, [{ resume_terminal: 'terminal' }])
    assert.equal((await fetch(`${current.url}/api/v1/tasks/task-a/resume`, { method: 'POST' })).status, 410)
  } finally { await current.cleanup() }
})
