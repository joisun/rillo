import { describe, expect, test, vi } from 'vitest'

import { createDashboardApi, DashboardApiError } from './dashboard-api'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('DashboardApi', () => {
  test('relation metadata and registration allow native runtime validation to finish', async () => {
    const timer = vi.spyOn(globalThis, 'setTimeout')
    const api = createDashboardApi({ fetchImpl: async () => jsonResponse({}) })
    const ref = { provider: 'codex', store_id: 'local', session_id: 'thread' }
    await api.sessionRelations(ref)
    await api.linkSessions({ parent: ref, child: { ...ref, session_id: 'child' } })
    expect(timer.mock.calls.map((call) => call[1])).toEqual([65_000, 65_000])
  })

  test('maps SessionRef, child pagination, timeline and seek to the frozen browser API', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    const api = createDashboardApi({ fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : null })
      return jsonResponse({})
    } })
    const parent = { provider: 'codex', store_id: 'store/a', session_id: 'thread/a' }
    const child = { ...parent, session_id: 'thread-b' }
    await api.readSession(parent)
    await api.sessionChildren(parent, { cursor: 'child:2' })
    await api.sessionTimeline(parent, { from: '2026-10-01T00:00:00Z', to: '2026-10-24T00:00:00Z', cursor: 'turn:15' })
    await api.sessionMessages(parent, { at: '2026-10-23T09:00:00Z', limit: 5 })
    await api.sessionRelations({ ...parent, title: 'must not enter query' } as typeof parent)
    await api.linkSessions({ parent, child, source: 'session-browser' })
    await api.unlinkSessions({ parent, child })
    const base = '/api/v1/session-browser/codex/sessions/thread%2Fa'
    expect(calls).toEqual([
      { url: base + '/read?store_id=store%2Fa', method: 'GET', body: null },
      { url: base + '/children?cursor=child%3A2&store_id=store%2Fa', method: 'GET', body: null },
      { url: base + '/timeline?from=2026-10-01T00%3A00%3A00Z&to=2026-10-24T00%3A00%3A00Z&cursor=turn%3A15&store_id=store%2Fa', method: 'GET', body: null },
      { url: base + '/messages?at=2026-10-23T09%3A00%3A00Z&limit=5&store_id=store%2Fa', method: 'GET', body: null },
      { url: '/api/v1/session-browser/relations?provider=codex&store_id=store%2Fa&session_id=thread%2Fa', method: 'GET', body: null },
      { url: '/api/v1/session-browser/links', method: 'POST', body: { parent, child, source: 'session-browser' } },
      { url: '/api/v1/session-browser/links', method: 'DELETE', body: { parent, child } },
    ])
  })

  test('propagates caller cancellation without misreporting timeout', async () => {
    const controller = new AbortController()
    const api = createDashboardApi({ fetchImpl: (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))) })
    const pending = api.sessionMessages({ provider: 'codex', store_id: 'local', session_id: 'thread' }, { at: '2026-10-23T09:00:00Z' }, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('maps Scheduled and Run contracts to exact taskd routes and bodies', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({
        url: String(url),
        method: init.method ?? 'GET',
        body: init.body === undefined ? null : JSON.parse(String(init.body)),
      })
      return jsonResponse({ ok: true, jobs: [], runs: [], run: null })
    })
    const api = createDashboardApi({ fetchImpl })
    const scheduleId = 'schedule/id ?'
    const runId = 'run/id ?'

    await api.schedules()
    await api.schedule(scheduleId)
    await api.scheduleRuns(scheduleId)
    await api.scheduledRun(runId)
    await api.runScheduleNow(scheduleId, 'request-1')
    await api.steerRun(runId, { expected_turn_revision: 2, text: 'Check rollback.' })
    await api.stopRun(runId, { expected_turn_revision: 2 })
    await api.cancelRun(runId)
    await api.scheduledRunConversation(runId)
    await api.scheduledRunLog(runId, { stream: 'stderr', tail: 4096 })
    await api.markScheduledRunReviewed(runId)
    await api.resumeScheduledRun(runId)
    await api.openRunFile(runId, 'reports/产出 #1.md')

    expect(calls).toEqual([
      { url: '/api/v1/schedules', method: 'GET', body: null },
      { url: '/api/v1/schedules/schedule%2Fid%20%3F', method: 'GET', body: null },
      { url: '/api/v1/schedules/schedule%2Fid%20%3F/runs', method: 'GET', body: null },
      { url: '/api/v1/scheduled-runs/run%2Fid%20%3F', method: 'GET', body: null },
      {
        url: '/api/v1/schedules/schedule%2Fid%20%3F/run', method: 'POST',
        body: { idempotency_key: 'request-1' },
      },
      {
        url: '/api/v1/runs/run%2Fid%20%3F/steer', method: 'POST',
        body: { expected_turn_revision: 2, text: 'Check rollback.' },
      },
      {
        url: '/api/v1/runs/run%2Fid%20%3F/stop', method: 'POST',
        body: { expected_turn_revision: 2 },
      },
      { url: '/api/v1/runs/run%2Fid%20%3F/cancel', method: 'POST', body: {} },
      { url: '/api/v1/runs/run%2Fid%20%3F/conversation', method: 'GET', body: null },
      {
        url: '/api/v1/scheduled-runs/run%2Fid%20%3F/log?stream=stderr&tail=4096',
        method: 'GET', body: null,
      },
      { url: '/api/v1/scheduled-runs/run%2Fid%20%3F/review', method: 'POST', body: {} },
      { url: '/api/v1/scheduled-runs/run%2Fid%20%3F/resume', method: 'POST', body: {} },
      { url: '/api/v1/runs/run%2Fid%20%3F/files/open', method: 'POST', body: { path: 'reports/产出 #1.md' } },
    ])
  })

  test.each([
    {
      name: 'non-JSON response',
      fetchImpl: async () => new Response('not json', { status: 502 }),
      code: 'DASHBOARD_INVALID_RESPONSE',
      status: 502,
    },
    {
      name: 'typed server error',
      fetchImpl: async () => jsonResponse({
        ok: false,
        error: { code: 'SESSION_ALREADY_LINKED', message: 'session already linked', details: { revision: 8 } },
      }, 409),
      code: 'SESSION_ALREADY_LINKED',
      status: 409,
    },
    {
      name: 'network failure',
      fetchImpl: async () => { throw new TypeError('offline') },
      code: 'DASHBOARD_CONNECTION_FAILED',
      status: 0,
    },
  ])('normalizes $name', async ({ fetchImpl, code, status }) => {
    const api = createDashboardApi({ fetchImpl })

    await expect(api.meta()).rejects.toMatchObject({
      name: 'DashboardApiError', code, status,
    })
  })

  test('normalizes request timeout', async () => {
    vi.useFakeTimers()
    const api = createDashboardApi({
      timeoutMs: 25,
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      }),
    })
    const pending = api.meta()
    const rejection = expect(pending).rejects.toMatchObject({
      code: 'DASHBOARD_REQUEST_TIMEOUT',
    })
    await vi.advanceTimersByTimeAsync(25)

    await rejection
    vi.useRealTimers()
  })
})
