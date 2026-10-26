import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import test from 'node:test'

import { createSessionBrowser } from '../server/src/session-browser.mjs'
import { createCodexSessionAdapter } from '../server/src/runtime/adapters/codex-sessions.mjs'
import { createApiServer } from '../server/src/api-server.mjs'
import { createRevisionHub } from '../server/src/revision-hub.mjs'

const thread = (id = 'session-1', cwd = '/workspace/example') => ({
  id, cwd, name: 'Title without keyword', preview: 'First prompt', createdAt: 100, updatedAt: 200,
  recencyAt: 300, status: { type: 'notLoaded' }, gitInfo: { branch: 'main' },
})
const filters = { workspace: '', query: '', archived: false, cursor: null, limit: 2 }

test('timeline without a window requests the session lifetime, but a half-specified window is rejected', async () => {
  let received
  const browser = createSessionBrowser({ adapters: [{ id: 'codex', storeId: 'store', timeline: async (_id, filters) => { received = filters; return {} } }] })
  await browser.timeline('codex', 'thread', { store_id: 'store' })
  assert.equal(received.from, null)
  assert.equal(received.to, null)
  await assert.rejects(browser.timeline('codex', 'thread', { store_id: 'store', from: '2026-01-01T00:00:00Z' }), { code: 'SESSION_BROWSER_INPUT_INVALID' })
})

function nativeFixture(t, respond) {
  const calls = []
  const options = []
  let closes = 0
  const adapter = createCodexSessionAdapter({
    dataRoot: '/local/codex',
    resolveLaunch: async () => ({ executable: '/bin/codex' }),
    createClient(input) {
      options.push(input)
      return {
        started: Promise.resolve(), notify: () => {},
        request: async (method, params) => {
          calls.push({ method, params })
          return method === 'initialize' ? {} : respond(method, params)
        },
        close: () => { closes += 1 },
      }
    },
  })
  t.after(() => adapter.close())
  return { adapter, calls, options, get closes() { return closes } }
}

test('late failures from an old connection do not close a newly initialized client', async t => {
  const failures = []
  const closed = []
  let clients = 0
  const adapter = createCodexSessionAdapter({ dataRoot: '/connection-race', resolveLaunch: async () => ({ executable: '/bin/codex' }), createClient() {
    const number = ++clients
    return { started: Promise.resolve(), notify() {}, close() { closed.push(number) }, request: async method => {
      if (method === 'initialize') return {}
      if (number === 1) return new Promise((_resolve, reject) => failures.push(reject))
      return { data: [thread()], nextCursor: null }
    } }
  } })
  t.after(() => adapter.close())
  const first = adapter.list(filters).catch(error => error)
  const second = adapter.list({ ...filters, cursor: 'other' }).catch(error => error)
  while (failures.length < 2) await new Promise(resolve => setImmediate(resolve))
  failures[0](new Error('old connection closed'))
  await first
  await adapter.list(filters)
  assert.equal(clients, 2)
  failures[1](new Error('late old failure'))
  await second
  await adapter.list(filters)
  assert.equal(clients, 2)
  assert.ok(!closed.includes(2))
})

test('Codex list uses native workspace/recency and a stable local source identity', async (t) => {
  const current = nativeFixture(t, () => ({ data: [thread()], nextCursor: 'next' }))
  const result = await current.adapter.list({ ...filters, workspace: '/workspace/example' })
  assert.equal(result.sessions[0].last_active_at, '1970-01-01T00:05:00.000Z')
  assert.equal(result.sessions[0].branch, 'main')
  assert.equal(result.sessions[0].store_id, current.adapter.storeId)
  assert.equal(result.next_cursor, 'next')
  assert.equal(current.calls[1].method, 'thread/list')
  assert.equal(current.calls[1].params.cwd, '/workspace/example')
  assert.equal(current.calls[1].params.sortKey, 'recency_at')
  assert.equal(current.calls[0].params.capabilities.experimentalApi, true)
  assert.deepEqual(current.options[0].env, { CODEX_HOME: '/local/codex' })
  assert.deepEqual(current.adapter.resumeOptions, { codexHome: '/local/codex' })
  const other = createCodexSessionAdapter({ dataRoot: '/other/codex' })
  t.after(() => other.close())
  assert.notEqual(current.adapter.storeId, other.storeId)
})

test('body search continues native pages for workspace filtering without dropping matching rows', async (t) => {
  const current = nativeFixture(t, (method, params) => {
    assert.equal(method, 'thread/search')
    assert.equal(params.searchTerm, 'deep phrase')
    assert.equal('cwd' in params, false)
    if (!params.cursor) return { data: [{ thread: thread('outside', '/other'), snippet: 'deep phrase' }], nextCursor: 'page-2' }
    return { data: ['one', 'two'].map((id) => ({ thread: thread(id), snippet: 'deep phrase in body' })), nextCursor: 'page-3' }
  })
  const result = await current.adapter.list({ ...filters, workspace: '/workspace/example', query: 'deep phrase' })
  assert.deepEqual(result.sessions.map((row) => row.session_id), ['one', 'two'])
  assert.equal(result.search_scope, 'messages')
  assert.equal(result.next_cursor, 'page-3')
  assert.equal(result.scanned_count, 3)
  assert.match(result.sessions[0].snippet, /deep phrase/)
})

test('bounded workspace searches retain a continuation cursor after empty pages', async (t) => {
  let page = 0
  const current = nativeFixture(t, () => ({ data: [{ thread: thread('outside', '/other') }], nextCursor: String(++page) }))
  const result = await current.adapter.list({ ...filters, workspace: '/workspace/example', query: 'keyword' })
  assert.equal(page, 3)
  assert.deepEqual(result.sessions, [])
  assert.equal(result.next_cursor, '3')
})

test('search rejects unsupported native methods explicitly and never falls back to title filtering', async (t) => {
  const current = nativeFixture(t, () => { throw Object.assign(new Error('missing'), { code: 'RUNTIME_PROTOCOL_METHOD_UNAVAILABLE' }) })
  await assert.rejects(current.adapter.list({ ...filters, query: 'keyword' }), { code: 'SESSION_BROWSER_UNSUPPORTED', statusCode: 501 })
  assert.deepEqual(current.calls.map((call) => call.method), ['initialize', 'thread/search'])
})

test('repeated cursors fail instead of creating endless paging', async (t) => {
  const current = nativeFixture(t, () => ({ data: [], nextCursor: 'same' }))
  await assert.rejects(current.adapter.list({ ...filters, cursor: 'same' }), { code: 'SESSION_BROWSER_READ_FAILED' })
})

test('message lookup uses the native match anchor, hides tool/reasoning data and preserves long matches', async (t) => {
  const current = nativeFixture(t, (method, params) => {
    if (method === 'thread/read') return { thread: thread() }
    if (method === 'thread/searchOccurrences') return { data: [{ itemId: 'answer', turnId: 'turn-1', snippet: 'needle', snippetMatchRange: { start: 0, end: 6 }, turnCursor: 'anchor' }], nextCursor: null }
    assert.equal(method, 'thread/turns/list')
    assert.equal(params.cursor, 'anchor')
    return { data: [{ id: 'turn-1', items: [
      { id: 'prompt', type: 'userMessage', content: [{ type: 'text', text: 'Question' }, { type: 'image', url: 'private-url' }] },
      { id: 'tool', type: 'commandExecution', aggregatedOutput: 'private output' },
      { id: 'reason', type: 'reasoning', text: 'private reasoning' },
      ...Array.from({ length: 20 }, (_, index) => ({ id: 'context-' + index, type: 'agentMessage', text: 'x'.repeat(16384) })),
      { id: 'answer', type: 'agentMessage', text: 'x'.repeat(30000) + 'needle' + 'y'.repeat(30000) },
    ] }], nextCursor: 'older' }
  })
  const result = await current.adapter.messages('session-1', { ...filters, query: 'needle' })
  assert.equal(result.match.item_id, 'answer')
  assert.equal(result.next_cursor, 'older')
  assert.equal(result.truncated, true)
  assert.equal(result.messages.some((item) => ['tool', 'reason'].includes(item.id)), false)
  assert.equal(result.messages[0].text, 'Question')
  assert.match(result.messages.find((item) => item.id === 'answer').text, /needle/)
  assert.equal(result.messages.find((item) => item.id === 'answer').truncated, true)
  assert.ok(result.messages.reduce((sum, item) => sum + item.text.length, 0) <= 256 * 1024)
})

function browserFixture() {
  const launches = []
  let state = 'idle'
  let reads = 0
  const adapter = {
    id: 'codex', name: 'Codex', runtimeId: 'codex', storeId: 'local-store',
    resumeOptions: { codexHome: '/local/codex' },
    capabilities: { full_text_search: true },
    activity: async () => ({ store_id: 'local-store', available: true, open_session_ids: ['session-1'], checked_at: '2026-10-23T08:00:00Z' }),
    list: async (input) => ({ sessions: [], next_cursor: null, input }),
    workspaces: async () => ({ workspaces: [], next_cursor: null }),
    messages: async () => ({ messages: [] }),
    readSession: async () => { reads += 1; return { session_id: 'session-1', workspace: '/trusted/workspace', title: 'Native title', state } },
  }
  const browser = createSessionBrowser({
    adapters: [adapter],
    settings: { get: async () => ({ settings: { resume_terminal: 'otty' } }) },
    terminalLauncher: { launch: async (input) => { launches.push(input); return { terminal_label: 'Otty' } } },
  })
  return { browser, launches, get reads() { return reads }, setState(value) { state = value } }
}

test('resume works without Task/Run data and re-reads native facts before launching', async () => {
  const current = browserFixture()
  assert.deepEqual(await current.browser.resume('codex', 'session-1', {
    store_id: 'local-store', workspace: '/untrusted', command: 'do-not-run',
  }), { ok: true, terminal_label: 'Otty' })
  assert.equal(current.reads, 1)
  assert.deepEqual(current.launches, [{ runtimeId: 'codex', terminal: 'otty', sessionId: 'session-1', workspace: '/trusted/workspace', title: 'Native title', codexHome: '/local/codex' }])
  current.setState('active')
  await assert.rejects(current.browser.resume('codex', 'session-1', { store_id: 'local-store' }), { code: 'SESSION_BROWSER_SESSION_ACTIVE' })
  assert.equal(current.launches.length, 1)
})

test('invalid identity, provider and search parameters fail before native access', () => {
  const { browser } = browserFixture()
  assert.throws(() => browser.messages('codex', 'session-1', { store_id: 'other-store' }), { code: 'SESSION_BROWSER_REFERENCE_INVALID' })
  assert.throws(() => browser.messages('codex', '../session', { store_id: 'local-store' }), { code: 'SESSION_BROWSER_REFERENCE_INVALID' })
  assert.throws(() => browser.list('claude', {}), { code: 'SESSION_BROWSER_PROVIDER_NOT_FOUND' })
  for (const input of [{ limit: 0 }, { limit: 101 }, { archived: 'yes' }, { workspace: 'relative' }, { query: 'x'.repeat(257) }]) {
    assert.throws(() => browser.list('codex', input), { code: 'SESSION_BROWSER_INPUT_INVALID' })
  }
})

test('HTTP session routes retain loopback/origin protection and reject browser launch overrides', async (t) => {
  const current = browserFixture()
  const hub = createRevisionHub({ instanceId: 'session-api-test', keepaliveMs: 60000 })
  const api = createApiServer({ service: {}, store: {}, hub, host: '127.0.0.1', port: 0, dashboardHtml: '<!doctype html>', sessionBrowser: current.browser })
  const { url } = await api.listen()
  t.after(async () => { await api.close(); hub.close() })
  const response = await fetch(url + '/api/v1/session-browser/providers')
  assert.equal(response.status, 200)
  assert.equal((await response.json()).providers[0].id, 'codex')
  const activity = await fetch(url + '/api/v1/session-browser/codex/activity')
  assert.equal(activity.status, 200)
  assert.deepEqual((await activity.json()).open_session_ids, ['session-1'])
  const path = url + '/api/v1/session-browser/codex/sessions/session-1/resume'
  const foreign = await fetch(path, { method: 'POST', headers: { Origin: 'http://foreign.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ store_id: 'local-store' }) })
  assert.equal(foreign.status, 403)
  const override = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ store_id: 'local-store', workspace: '/browser' }) })
  assert.equal(override.status, 400)
  assert.equal(current.launches.length, 0)
  const valid = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ store_id: 'local-store' }) })
  assert.equal(valid.status, 200)
  assert.equal(current.launches.length, 1)
  const hostStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(url + '/api/v1/session-browser/providers', { headers: { Host: 'foreign.example' } }, (response) => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
    })
    request.on('error', reject)
    request.end()
  })
  assert.equal(hostStatus, 403)
})
