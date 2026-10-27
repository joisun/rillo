import type {
  DashboardMeta,
  DashboardSettingsResponse,
  SessionFilters,
  SessionActivityPage,
  SessionMessagesPage,
  SessionPage,
  SessionProvider,
  SessionRef,
  BrowserSession,
  SessionRelation,
  SessionTimeline,
  SessionWorkspacePage,
  SessionBranchPage,
  RunControlResponse,
  RunConversationResponse,
  RunLogResponse,
  RunResponse,
  RunResumeResponse,
  TerminalResumeAction,
  RuntimeListResponse,
  RuntimeModelCatalogResponse,
  ScheduleListResponse,
  ScheduleMutationInput,
  ScheduleResponse,
  ScheduleRunsResponse,
} from './types'

const DEFAULT_TIMEOUT_MS = 5_000
const RUNTIME_TIMEOUT_MS = 65_000

export class DashboardApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(
    message: string,
    { status = 0, code = 'DASHBOARD_REQUEST_FAILED', details = null }: {
      status?: number
      code?: string
      details?: unknown
    } = {},
  ) {
    super(message)
    this.name = 'DashboardApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

interface ServerErrorPayload {
  ok?: boolean
  error?: {
    code?: string
    message?: string
    details?: unknown
  }
}

export interface DashboardApi {
  sessionActivity(provider: string): Promise<SessionActivityPage>
  sessionProviders(): Promise<{ providers: SessionProvider[] }>
  sessionWorkspaces(provider: string, filters: SessionFilters): Promise<SessionWorkspacePage>
  sessionBranches(provider: string, filters: SessionFilters): Promise<SessionBranchPage>
  sessions(provider: string, filters: SessionFilters, signal?: AbortSignal): Promise<SessionPage>
  readSession(session: SessionRef, signal?: AbortSignal): Promise<{ session: BrowserSession }>
  sessionChildren(session: SessionRef, filters: SessionFilters, signal?: AbortSignal): Promise<SessionPage>
  sessionTimeline(session: SessionRef, filters: SessionFilters, signal?: AbortSignal): Promise<SessionTimeline>
  sessionRelations(session: SessionRef): Promise<{ relations: SessionRelation[] }>
  linkSessions(input: { parent: SessionRef; child: SessionRef; source?: string }): Promise<{ relation: SessionRelation; created: boolean }>
  unlinkSessions(input: { parent: SessionRef; child: SessionRef }): Promise<{ removed: boolean }>
  sessionMessages(session: SessionRef, filters: SessionFilters, signal?: AbortSignal): Promise<SessionMessagesPage>
  resumeSession(session: SessionRef): Promise<{ ok: boolean; terminal_label: string; action?: TerminalResumeAction }>
  meta(): Promise<DashboardMeta>
  settings(): Promise<DashboardSettingsResponse>
  updateSettings(input: { resume_terminal: string }): Promise<DashboardSettingsResponse>
  runtimes(): Promise<RuntimeListResponse>
  runtimeModels(id: string): Promise<RuntimeModelCatalogResponse>
  schedules(): Promise<ScheduleListResponse>
  schedule(id: string): Promise<ScheduleResponse>
  createSchedule(input: ScheduleMutationInput): Promise<ScheduleResponse>
  updateSchedule(
    id: string,
    expectedEtag: string,
    patch: Partial<ScheduleMutationInput>,
  ): Promise<ScheduleResponse>
  pauseSchedule(id: string, expectedEtag: string): Promise<ScheduleResponse>
  resumeSchedule(id: string, expectedEtag: string): Promise<ScheduleResponse>
  deleteSchedule(id: string, expectedEtag: string): Promise<ScheduleResponse>
  runScheduleNow(id: string, idempotencyKey: string): Promise<Record<string, unknown>>
  scheduleRuns(id: string): Promise<ScheduleRunsResponse>
  scheduledRun(id: string): Promise<RunResponse>
  scheduledRunLog(
    id: string,
    options: { stream: 'stdout' | 'stderr'; tail: number },
  ): Promise<RunLogResponse>
  scheduledRunConversation(id: string): Promise<RunConversationResponse>
  markScheduledRunReviewed(id: string): Promise<RunResponse>
  resumeScheduledRun(id: string): Promise<RunResumeResponse>
  openRunFile(id: string, path: string): Promise<{ opened: boolean; path: string }>
  steerRun(
    id: string,
    input: { expected_turn_revision: number; text: string },
  ): Promise<RunControlResponse>
  stopRun(id: string, input: { expected_turn_revision: number }): Promise<RunControlResponse>
  cancelRun(id: string): Promise<RunResponse>
}

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function queryString(filters: object = {}) {
  const parameters = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') parameters.set(key, String(value))
  }
  const query = parameters.toString()
  return query ? `?${query}` : ''
}

function scheduleEtag(value: string) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('expectedEtag is required')
  }
  return value
}

export function createDashboardApi({
  baseUrl = '',
  fetchImpl = globalThis.fetch?.bind(globalThis),
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  baseUrl?: string
  fetchImpl?: FetchImplementation
  timeoutMs?: number
} = {}): DashboardApi {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required')

  async function request<T>(path: string, { method = 'GET', body, requestTimeoutMs = timeoutMs, signal }: {
    method?: string
    body?: unknown
    requestTimeoutMs?: number
    signal?: AbortSignal
  } = {}): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
        ...(method === 'GET' ? { cache: 'no-store' } : {}),
      })
    } catch (error) {
      if (signal?.aborted) throw error
      const timedOut = error instanceof DOMException
        ? error.name === 'AbortError'
        : (error as { name?: string } | null)?.name === 'AbortError'
      throw new DashboardApiError(timedOut ? '请求超时' : '无法连接 Tasks Recorder', {
        code: timedOut ? 'DASHBOARD_REQUEST_TIMEOUT' : 'DASHBOARD_CONNECTION_FAILED',
      })
    } finally {
      clearTimeout(timeout)
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new DashboardApiError(`服务返回了无效响应（HTTP ${response.status}）`, {
        status: response.status,
        code: 'DASHBOARD_INVALID_RESPONSE',
      })
    }

    const serverPayload = payload as ServerErrorPayload | null
    if (!response.ok || serverPayload?.ok === false) {
      const serverError = serverPayload?.error
      throw new DashboardApiError(
        serverError?.message ?? `请求失败（HTTP ${response.status}）`,
        {
          status: response.status,
          code: serverError?.code ?? 'DASHBOARD_REQUEST_FAILED',
          details: serverError?.details ?? null,
        },
      )
    }
    return payload as T
  }

  return {
    sessionActivity: (provider) => request(`/api/v1/session-browser/${encodeURIComponent(provider)}/activity`),
    sessionProviders: () => request('/api/v1/session-browser/providers'),
    sessionBranches: (provider, filters) => request(
      `/api/v1/session-browser/${encodeURIComponent(provider)}/branches${queryString(filters)}`,
      { requestTimeoutMs: RUNTIME_TIMEOUT_MS },
    ),
    sessionWorkspaces: (provider, filters) => request(
      `/api/v1/session-browser/${encodeURIComponent(provider)}/workspaces${queryString(filters)}`,
      { requestTimeoutMs: RUNTIME_TIMEOUT_MS },
    ),
    sessions: (provider, filters, signal) => request(
      `/api/v1/session-browser/${encodeURIComponent(provider)}/sessions${queryString(filters)}`,
      { requestTimeoutMs: RUNTIME_TIMEOUT_MS, signal },
    ),
    readSession: (session, signal) => request(
      `/api/v1/session-browser/${encodeURIComponent(session.provider)}/sessions/${encodeURIComponent(session.session_id)}/read${queryString({ store_id: session.store_id })}`,
      { requestTimeoutMs: RUNTIME_TIMEOUT_MS, signal },
    ),
    sessionChildren: (session, filters, signal) => request(
      `/api/v1/session-browser/${encodeURIComponent(session.provider)}/sessions/${encodeURIComponent(session.session_id)}/children${queryString({ ...filters, store_id: session.store_id })}`,
      { requestTimeoutMs: RUNTIME_TIMEOUT_MS, signal },
    ),
    sessionTimeline: (session, filters, signal) => request(
      `/api/v1/session-browser/${encodeURIComponent(session.provider)}/sessions/${encodeURIComponent(session.session_id)}/timeline${queryString({ ...filters, store_id: session.store_id })}`,
      { requestTimeoutMs: RUNTIME_TIMEOUT_MS, signal },
    ),
    sessionRelations: (session) => request(`/api/v1/session-browser/relations${queryString({ provider: session.provider, store_id: session.store_id, session_id: session.session_id })}`, { requestTimeoutMs: RUNTIME_TIMEOUT_MS }),
    linkSessions: (input) => request('/api/v1/session-browser/links', { method: 'POST', body: input, requestTimeoutMs: RUNTIME_TIMEOUT_MS }),
    unlinkSessions: (input) => request('/api/v1/session-browser/links', { method: 'DELETE', body: input }),
    sessionMessages: (session, filters, signal) => request(
      `/api/v1/session-browser/${encodeURIComponent(session.provider)}/sessions/${encodeURIComponent(session.session_id)}/messages${queryString({ ...filters, store_id: session.store_id })}`,
      { requestTimeoutMs: RUNTIME_TIMEOUT_MS, signal },
    ),
    resumeSession: (session) => request(
      `/api/v1/session-browser/${encodeURIComponent(session.provider)}/sessions/${encodeURIComponent(session.session_id)}/resume`,
      { method: 'POST', body: { store_id: session.store_id }, requestTimeoutMs: RUNTIME_TIMEOUT_MS },
    ),
    meta: () => request('/api/v1/meta'),
    settings: () => request('/api/v1/settings'),
    updateSettings: (input) => request('/api/v1/settings', { method: 'PATCH', body: input }),
    runtimes: () => request('/api/v1/runtimes', { requestTimeoutMs: RUNTIME_TIMEOUT_MS }),
    runtimeModels: (id) => request(`/api/v1/runtimes/${encodeURIComponent(id)}/models`, { requestTimeoutMs: RUNTIME_TIMEOUT_MS }),
    schedules: () => request('/api/v1/schedules'),
    schedule: (id) => request(`/api/v1/schedules/${encodeURIComponent(id)}`),
    createSchedule: (input) => request('/api/v1/schedules', { method: 'POST', body: input }),
    updateSchedule: (id, expectedEtag, patch) => request(
      `/api/v1/schedules/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: { expected_etag: scheduleEtag(expectedEtag), patch } },
    ),
    pauseSchedule: (id, expectedEtag) => request(
      `/api/v1/schedules/${encodeURIComponent(id)}/pause`,
      { method: 'POST', body: { expected_etag: scheduleEtag(expectedEtag) } },
    ),
    resumeSchedule: (id, expectedEtag) => request(
      `/api/v1/schedules/${encodeURIComponent(id)}/resume`,
      { method: 'POST', body: { expected_etag: scheduleEtag(expectedEtag) } },
    ),
    deleteSchedule: (id, expectedEtag) => request(
      `/api/v1/schedules/${encodeURIComponent(id)}`,
      { method: 'DELETE', body: { expected_etag: scheduleEtag(expectedEtag) } },
    ),
    runScheduleNow: (id, idempotencyKey) => request(
      `/api/v1/schedules/${encodeURIComponent(id)}/run`,
      { method: 'POST', body: { idempotency_key: idempotencyKey } },
    ),
    scheduleRuns: (id) => request(`/api/v1/schedules/${encodeURIComponent(id)}/runs`),
    scheduledRun: (id) => request(`/api/v1/scheduled-runs/${encodeURIComponent(id)}`),
    scheduledRunLog: (id, { stream, tail }) => request(
      `/api/v1/scheduled-runs/${encodeURIComponent(id)}/log${queryString({ stream, tail })}`,
    ),
    scheduledRunConversation: (id) => request(
      `/api/v1/runs/${encodeURIComponent(id)}/conversation`,
      { requestTimeoutMs: RUNTIME_TIMEOUT_MS },
    ),
    markScheduledRunReviewed: (id) => request(
      `/api/v1/scheduled-runs/${encodeURIComponent(id)}/review`,
      { method: 'POST', body: {} },
    ),
    resumeScheduledRun: (id) => request(
      `/api/v1/scheduled-runs/${encodeURIComponent(id)}/resume`,
      { method: 'POST', body: {} },
    ),
    openRunFile: (id, path) => request(
      `/api/v1/runs/${encodeURIComponent(id)}/files/open`,
      { method: 'POST', body: { path } },
    ),
    steerRun: (id, { expected_turn_revision, text }) => request(
      `/api/v1/runs/${encodeURIComponent(id)}/steer`,
      { method: 'POST', body: { expected_turn_revision, text } },
    ),
    stopRun: (id, { expected_turn_revision }) => request(
      `/api/v1/runs/${encodeURIComponent(id)}/stop`,
      { method: 'POST', body: { expected_turn_revision } },
    ),
    cancelRun: (id) => request(
      `/api/v1/runs/${encodeURIComponent(id)}/cancel`,
      { method: 'POST', body: {} },
    ),
  }
}
