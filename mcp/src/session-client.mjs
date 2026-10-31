import { RilloError } from './errors.mjs'

export const API_VERSION = 5

function localOrigin(value) {
  let url
  try { url = new URL(value) } catch {
    throw new RilloError('CONFIG_INVALID', 'Rillo service URL is invalid.')
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
    || url.username || url.password || !['', '/'].includes(url.pathname) || url.search || url.hash) {
    throw new RilloError('CONFIG_INVALID', 'Rillo service URL must be an http://127.0.0.1 origin.')
  }
  return url.origin
}

export function createSessionClient({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 35_000 }) {
  const origin = localOrigin(baseUrl)
  async function request(path, { method = 'GET', body, signal } = {}) {
    let response
    try {
      response = await fetchImpl(`${origin}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          'X-Rillo-API-Version': String(API_VERSION),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      })
    } catch {
      throw new RilloError('SERVICE_UNAVAILABLE', 'Rillo service is unavailable. Run `rillo status` or install the service.')
    }
    const result = await response.json().catch(() => {
      throw new RilloError('SERVICE_RESPONSE_INVALID', 'Rillo service returned invalid JSON.')
    })
    if (!response.ok) {
      throw new RilloError(result?.error?.code ?? 'SERVICE_REQUEST_FAILED', result?.error?.message ?? `HTTP ${response.status}`, result?.error?.details)
    }
    return result
  }

  async function compatibleRequest(path, options) {
    const meta = await request('/api/v1/meta', { signal: options?.signal })
    if (meta.api_version !== API_VERSION) {
      throw new RilloError('API_VERSION_MISMATCH', `Rillo API v${API_VERSION} is required (service reports ${meta.api_version ?? 'unknown'}). Update the client and service together.`)
    }
    return request(path, options)
  }

  function queryPath(path, input = {}) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined && value !== null) params.set(key, String(value))
    }
    return `${path}?${params}`
  }

  function sessionPath({ provider, session_id }, action) {
    return `/api/v1/session-browser/${encodeURIComponent(provider)}/sessions/${encodeURIComponent(session_id)}/${action}`
  }

  async function sessionMessages(input) {
    const { mode = 'page', count = 20, max_chars = 200_000, ...filters } = input
    const path = sessionPath(filters, 'messages')
    if (mode === 'page') return compatibleRequest(queryPath(path, filters))
    if (filters.query || filters.at || filters.limit !== undefined) {
      throw new RilloError('SESSION_BROWSER_INPUT_INVALID', 'head, tail and all cannot be combined with query, at or limit; use count instead.')
    }
    const scope = JSON.stringify([filters.provider, filters.store_id, filters.session_id, mode])
    let cursor = null
    let offset = 0
    if (filters.cursor) {
      try {
        if (!filters.cursor.startsWith('history:')) throw new Error()
        const saved = JSON.parse(Buffer.from(filters.cursor.slice(8), 'base64url').toString('utf8'))
        if (saved.scope !== scope || !(saved.cursor === null || typeof saved.cursor === 'string')
          || !Number.isSafeInteger(saved.offset) || saved.offset < 0 || saved.offset > 1000) throw new Error()
        cursor = saved.cursor
        offset = saved.offset
      } catch { throw new RilloError('SESSION_BROWSER_INPUT_INVALID', 'History cursor is invalid for this session and mode.') }
    }
    const continuation = (nativeCursor, position) => 'history:' + Buffer.from(JSON.stringify({ scope, cursor: nativeCursor, offset: position })).toString('base64url')
    const messages = []
    let characters = 0
    let truncated = false
    let session = null
    const visited = new Set()
    const deadline = Date.now() + 25_000
    for (let pageNumber = 0; pageNumber < 50; pageNumber += 1) {
      if (Date.now() >= deadline) return result(continuation(cursor, offset), true)
      if (visited.has(cursor)) throw new RilloError('SESSION_BROWSER_READ_FAILED', 'History pagination repeated a cursor.')
      visited.add(cursor)
      let page
      try {
        page = await compatibleRequest(queryPath(path, { store_id: filters.store_id, cursor, order: mode === 'tail' ? 'desc' : 'asc', limit: 100 }), { signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) })
      } catch (error) {
        if (Date.now() >= deadline) return result(continuation(cursor, offset), true)
        throw error
      }
      if (page.order !== (mode === 'tail' ? 'desc' : 'asc')) throw new RilloError('SESSION_BROWSER_UNSUPPORTED', 'Update the Rillo service before using head, tail or all history modes.')
      session = page.session
      truncated ||= page.truncated === true
      const rows = mode === 'tail' ? [...page.messages].reverse() : page.messages
      for (let index = offset; index < rows.length; index += 1) {
        const row = rows[index]
        const size = JSON.stringify(row).length
        if (characters + size > max_chars) return { ...result(continuation(cursor, index), true), ...(messages.length ? {} : { required_chars: size }) }
        messages.push(row)
        characters += size
        truncated ||= row.truncated === true
        if (mode !== 'all' && messages.length >= count) {
          const next = index + 1 < rows.length ? continuation(cursor, index + 1)
            : page.next_cursor ? continuation(page.next_cursor, 0) : null
          return result(next, false)
        }
      }
      cursor = page.next_cursor
      offset = 0
      if (!cursor) return result(null, false)
    }
    return result(continuation(cursor, offset), true)

    function result(next_cursor, limited) {
      return { session, mode, messages: mode === 'tail' ? [...messages].reverse() : messages,
        returned_count: messages.length, order: 'asc', next_cursor, has_more: next_cursor !== null,
        complete: next_cursor === null && !truncated && !limited, truncated: truncated || limited }
    }
  }

  return {
    controlSources: () => compatibleRequest('/api/v1/session-control/sources'),
    controlCapabilities: input => compatibleRequest(queryPath('/api/v1/session-control/capabilities', input)),
    sendSessionMessage: input => compatibleRequest('/api/v1/session-control/send', { method: 'POST', body: input }),
    interruptSession: input => compatibleRequest('/api/v1/session-control/interrupt', { method: 'POST', body: input }),
    compactSession: input => compatibleRequest('/api/v1/session-control/compact', { method: 'POST', body: input }),
    sessionDelivery: ({ request_id }) => compatibleRequest(`/api/v1/session-control/deliveries/${encodeURIComponent(request_id)}`),
    runtimes: () => compatibleRequest('/api/v1/runtimes'),
    listSchedules: () => compatibleRequest('/api/v1/schedules'),
    getSchedule: ({ schedule_id }) => compatibleRequest(`/api/v1/schedules/${encodeURIComponent(schedule_id)}`),
    createSchedule: (input) => compatibleRequest('/api/v1/schedules', { method: 'POST', body: input }),
    updateSchedule: ({ schedule_id, ...body }) => compatibleRequest(`/api/v1/schedules/${encodeURIComponent(schedule_id)}`, { method: 'PATCH', body }),
    deleteSchedule: ({ schedule_id, ...body }) => compatibleRequest(`/api/v1/schedules/${encodeURIComponent(schedule_id)}`, { method: 'DELETE', body }),
    pauseSchedule: ({ schedule_id, ...body }) => compatibleRequest(`/api/v1/schedules/${encodeURIComponent(schedule_id)}/pause`, { method: 'POST', body }),
    resumeSchedule: ({ schedule_id, ...body }) => compatibleRequest(`/api/v1/schedules/${encodeURIComponent(schedule_id)}/resume`, { method: 'POST', body }),
    runSchedule: ({ schedule_id, ...body }) => compatibleRequest(`/api/v1/schedules/${encodeURIComponent(schedule_id)}/run`, { method: 'POST', body }),
    async scheduleRuns({ schedule_id, limit = 20 }) {
      const result = await compatibleRequest(`/api/v1/schedules/${encodeURIComponent(schedule_id)}/runs`)
      return { ...result, runs: result.runs.slice(0, limit), truncated: result.runs.length > limit }
    },
    async readRun({ run_id, include_conversation = false }) {
      const path = `/api/v1/runs/${encodeURIComponent(run_id)}`
      const result = await compatibleRequest(path)
      if (!include_conversation) return result
      return { ...result, conversation: await compatibleRequest(`${path}/conversation`) }
    },
    listSessions: ({ provider, ...filters }) => compatibleRequest(queryPath(`/api/v1/session-browser/${encodeURIComponent(provider)}/sessions`, filters)),
    readSession: (ref) => compatibleRequest(queryPath(sessionPath(ref, 'read'), { store_id: ref.store_id })),
    sessionMessages,
    sessionChildren: ({ provider, session_id, ...filters }) => compatibleRequest(queryPath(sessionPath({ provider, session_id }, 'children'), filters)),
    sessionRelations: (ref) => compatibleRequest(queryPath('/api/v1/session-browser/relations', ref)),
    providers: () => compatibleRequest('/api/v1/session-browser/providers'),
    link: (input) => compatibleRequest('/api/v1/session-browser/links', { method: 'POST', body: input }),
    unlink: (input) => compatibleRequest('/api/v1/session-browser/links', { method: 'DELETE', body: input }),
    schedulerStatus: () => compatibleRequest('/api/v1/status'),
    schedulerReconcile: () => compatibleRequest('/api/v1/scheduler/reconcile', { method: 'POST', body: {} }),
  }
}
