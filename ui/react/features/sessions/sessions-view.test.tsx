import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { createDashboardApi, DashboardApiError } from '@/lib/api/dashboard-api'
import type { BrowserSession, SessionMessagesPage, SessionPage } from '@/lib/api/types'
import { queryKeys } from '@/lib/query/keys'
import { SessionsView } from './sessions-view'

afterEach(() => vi.unstubAllGlobals())

beforeEach(() => { window.history.replaceState(null, '', '/?view=sessions&sessions=list') })

const session: BrowserSession = {
  provider: 'codex', store_id: 'local-store', session_id: 'session-1',
  title: 'Unrelated session title', preview: 'First prompt', workspace: '/workspace/project',
  branch: 'main', created_at: '2026-10-22T08:00:00Z', updated_at: '2026-10-23T08:00:00Z',
  last_active_at: '2026-10-23T08:00:00Z', state: 'idle', native_parent: null, forked_from: null,
}

function fixture() {
  const api = {
    ...createDashboardApi(),
    sessionProviders: vi.fn(async () => ({ providers: [{
      id: 'codex', name: 'Codex', store_id: 'local-store',
      capabilities: { full_text_search: true, search_experimental: true, message_location: true, resume: true, live_presence: true },
    }] })),
    sessionActivity: vi.fn(async () => ({ store_id: 'local-store', available: true, open_session_ids: ['session-1'], checked_at: '2026-10-23T08:00:00Z' })),
    sessionWorkspaces: vi.fn(async () => ({ workspaces: [{ path: '/workspace/project', observed_count: 1, last_active_at: session.last_active_at }], next_cursor: null })),
    sessions: vi.fn(async (_provider: string, filters: { query?: string } = {}): Promise<SessionPage> => ({
      sessions: [{ ...session, snippet: filters.query ? 'A needle deep in the conversation' : null }],
      next_cursor: null, search_scope: filters.query ? 'messages' : null, scanned_count: 1, relations: [],
    })),
    sessionMessages: vi.fn(async (): Promise<SessionMessagesPage> => ({
      session, messages: [{ id: 'message-1', turn_id: 'turn-1', role: 'assistant' as const, text: 'A needle deep in the conversation', truncated: false, at: null, time_precision: 'unknown' }],
      match: null, next_cursor: null, truncated: false,
    })),
    sessionRelations: vi.fn(async () => ({ relations: [] })),
    resumeSession: vi.fn(async () => ({ ok: true as const, terminal_label: 'Otty' })),
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  function mount() { render(<QueryClientProvider client={client}><SessionsView api={api} /></QueryClientProvider>) }
  return { api, mount, client }
}

test('workspace selection requests the exact directory and preview does not launch a terminal', async () => {
  const { api, mount } = fixture()
  mount()
  await userEvent.click(await screen.findByRole('button', { name: /project.*workspace\/project/ }, { timeout: 5000 }))
  await waitFor(() => expect(api.sessions).toHaveBeenLastCalledWith('codex', expect.objectContaining({ workspace: '/workspace/project' })))
  await userEvent.click(await screen.findByRole('button', { name: '查看会话：Unrelated session title' }))
  expect(await screen.findByText('A needle deep in the conversation')).toBeInTheDocument()
  expect(api.resumeSession).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: '在终端继续：Unrelated session title' }))
  await waitFor(() => expect(api.resumeSession).toHaveBeenCalledWith(expect.objectContaining({ provider: 'codex', store_id: 'local-store', session_id: 'session-1' })))
  expect(await screen.findByRole('status')).toHaveTextContent('已在 Otty 打开')
})

test('Cards opens from its URL, shares native metadata, and reads a conversation only after selection', async () => {
  window.history.replaceState(null, '', '/?view=sessions&sessions=cards')
  const { api, mount } = fixture()
  mount()
  const cards = await screen.findByRole('region', { name: '会话卡片' })
  expect(screen.getByRole('tab', { name: 'Cards' })).toHaveAttribute('aria-selected', 'true')
  expect(await within(cards).findByRole('button', { name: '查看会话：Unrelated session title' })).toBeInTheDocument()
  expect(cards).toHaveTextContent('First prompt')
  expect(cards).toHaveTextContent('project')
  expect(cards).toHaveTextContent('main')
  expect(within(cards).getByRole('img', { name: '会话活跃' })).toBeInTheDocument()
  expect(api.sessionMessages).not.toHaveBeenCalled()
  await userEvent.click(within(cards).getByRole('button', { name: '查看会话：Unrelated session title' }))
  expect(await screen.findByText('A needle deep in the conversation')).toBeInTheDocument()
  expect(cards.querySelector('.session-card')).toHaveAttribute('data-selected', 'true')
  expect(api.resumeSession).not.toHaveBeenCalled()
  const preview = screen.getByRole('region', { name: '会话预览' })
  const requests = api.sessions.mock.calls.length
  await userEvent.click(screen.getByRole('tab', { name: 'List' }))
  expect(screen.getByRole('region', { name: '会话预览' })).toBe(preview)
  await userEvent.click(screen.getByRole('tab', { name: 'Cards' }))
  expect(screen.getByRole('region', { name: '会话预览' })).toBe(preview)
  expect(api.sessions).toHaveBeenCalledTimes(requests)
  expect(window.localStorage.getItem('tasks-recorder.sessions-view')).toBe('cards')
  expect(new URLSearchParams(window.location.search).get('sessions')).toBe('cards')
})

test('Cards terminal action does not open or select the conversation', async () => {
  window.history.replaceState(null, '', '/?view=sessions&sessions=cards')
  const { api, mount } = fixture()
  mount()
  const cards = await screen.findByRole('region', { name: '会话卡片' })
  await userEvent.click(await within(cards).findByRole('button', { name: '在终端继续：Unrelated session title' }))
  expect(await screen.findByRole('status')).toHaveTextContent('已在 Otty 打开')
  expect(api.resumeSession).toHaveBeenCalledWith(expect.objectContaining({ session_id: 'session-1', store_id: 'local-store' }))
  expect(api.sessionMessages).not.toHaveBeenCalled()
  expect(cards.querySelector('[data-selected]')).not.toBeInTheDocument()
})

test('Cards automatically continues the shared native cursor and deduplicates repeated sessions', async () => {
  window.history.replaceState(null, '', '/?view=sessions&sessions=cards')
  vi.stubGlobal('IntersectionObserver', class {
    callback: (entries: Array<{ isIntersecting: boolean }>) => void
    constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { this.callback = callback }
    observe() { this.callback([{ isIntersecting: true }]) }
    disconnect() {}
  })
  const { api, mount } = fixture()
  api.sessions.mockImplementation(async (_provider, filters: { query?: string; cursor?: string | null } = {}) => ({
    sessions: filters.cursor ? [session, { ...session, session_id: 'second', title: '下一页的会话' }] : [session],
    next_cursor: filters.cursor ? null : 'native-next', search_scope: null, scanned_count: 2, relations: [],
  }))
  mount()
  expect(await screen.findByRole('button', { name: '查看会话：下一页的会话' })).toBeInTheDocument()
  const cards = screen.getByRole('region', { name: '会话卡片' })
  expect(cards.querySelectorAll('.session-card')).toHaveLength(2)
  expect(api.sessions).toHaveBeenLastCalledWith('codex', expect.objectContaining({ cursor: 'native-next', limit: 100 }))
  expect(api.sessionMessages).not.toHaveBeenCalled()
})

test('typing opens body results in a listbox without replacing the timeline, selecting locates the match', async () => {
  const { api, mount } = fixture()
  Element.prototype.scrollTo = vi.fn()
  api.sessionMessages.mockResolvedValue({
    session, messages: [{ id: 'message-1', turn_id: 'turn-1', role: 'assistant', text: 'A needle deep in the conversation', truncated: false, at: null, time_precision: 'unknown' }],
    match: { item_id: 'message-1', turn_id: 'turn-1', snippet: 'needle', range: { start: 0, end: 6 } },
    next_cursor: null, truncated: false,
  })
  mount()
  await screen.findByRole('button', { name: '查看会话：Unrelated session title' })
  await userEvent.type(screen.getByRole('combobox', { name: '搜索会话正文' }), 'needle')
  await waitFor(() => expect(api.sessions).toHaveBeenLastCalledWith('codex', expect.objectContaining({ query: 'needle' })))
  const result = await screen.findByRole('option', { name: /Unrelated session title/ })
  expect(document.querySelector('.session-timeline .session-row')).toHaveTextContent('First prompt')
  expect(result.querySelector('mark')).toHaveTextContent('needle')
  await userEvent.click(result)
  expect(await screen.findByText('已定位首处正文命中')).toBeInTheDocument()
  expect(api.sessionMessages).toHaveBeenCalledWith(expect.objectContaining({ session_id: 'session-1' }), expect.objectContaining({ query: 'needle' }), expect.any(AbortSignal))
  expect(Element.prototype.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: expect.any(Number) }))
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  await userEvent.click(screen.getByRole('button', { name: '查看最近对话' }))
  await waitFor(() => expect(api.sessionMessages).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ query: '' }), expect.any(AbortSignal)))
})

test('an empty partial search automatically continues until a native match is found', async () => {
  vi.stubGlobal('IntersectionObserver', class {
    callback: (entries: Array<{ isIntersecting: boolean }>) => void
    constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { this.callback = callback }
    observe() { this.callback([{ isIntersecting: true }]) }
    disconnect() {}
  })
  const { api, mount } = fixture()
  api.sessions.mockImplementation(async (_provider, filters: { query?: string; cursor?: string | null } = {}) => ({
    sessions: filters.cursor ? [session] : [], next_cursor: filters.cursor ? null : 'next', search_scope: 'messages', scanned_count: 6, relations: [],
  }))
  mount()
  await waitFor(() => expect(screen.getByRole('combobox', { name: '搜索会话正文' })).toBeEnabled())
  const input = screen.getByRole('combobox', { name: '搜索会话正文' })
  await userEvent.type(input, 'needle')
  expect(screen.queryByRole('button', { name: '继续搜索' })).not.toBeInTheDocument()
  expect(await screen.findByRole('option', { name: /Unrelated session title/ })).toBeInTheDocument()
  expect(api.sessions).toHaveBeenLastCalledWith('codex', expect.objectContaining({ cursor: 'next' }))
})

test('a directory read error does not claim every directory has loaded', async () => {
  const { api, mount } = fixture()
  api.sessionWorkspaces.mockRejectedValue(new Error('Codex unavailable'))
  mount()
  expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法连接本机会话')
  expect(screen.getAllByRole('alert')).toHaveLength(1)
  expect(screen.queryByText('已载入全部目录')).not.toBeInTheDocument()
})

test('a failed conversation and its relations do not block the session browser', async () => {
  const { api, mount } = fixture()
  const error = new DashboardApiError('此会话暂时无法读取', { code: 'SESSION_BROWSER_UNAVAILABLE', status: 503 })
  api.sessionMessages.mockRejectedValue(error)
  api.sessionRelations.mockRejectedValue(error)
  mount()
  await userEvent.click(await screen.findByRole('button', { name: '查看会话：Unrelated session title' }))
  await waitFor(() => expect(api.sessionRelations).toHaveBeenCalled())
  await waitFor(() => expect(document.querySelector('.session-detail .session-state.session-error')).toHaveTextContent('此会话暂时无法读取'))
  expect(document.querySelector('.sessions-connection')).toBeNull()
  expect(screen.getByRole('combobox', { name: '搜索会话正文' })).toBeEnabled()
  await userEvent.click(screen.getByRole('button', { name: '在终端继续：Unrelated session title' }))
  await waitFor(() => expect(api.resumeSession).toHaveBeenCalledOnce())
})

test('a failed search shows its error instead of an endless spinner or reconnect overlay', async () => {
  const { api, mount } = fixture()
  api.sessions.mockImplementation(async (_provider, filters: { query?: string } = {}) => {
    if (filters.query) throw new DashboardApiError('正文搜索暂不可用', { code: 'SESSION_BROWSER_UNAVAILABLE', status: 503 })
    return { sessions: [session], next_cursor: null, search_scope: null, scanned_count: 1, relations: [] }
  })
  mount()
  await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled())
  await userEvent.type(screen.getByRole('combobox'), 'needle')
  expect(await screen.findByRole('alert')).toHaveTextContent('正文搜索暂不可用')
  expect(document.querySelector('.sessions-connection')).toBeNull()
  expect(screen.queryByLabelText('搜索中')).not.toBeInTheDocument()
})

test.each([
  { queryKey: queryKeys.sessionTimeline(session, 'session', '') },
  { queryKey: queryKeys.sessionChildren(session) },
  { queryKey: queryKeys.sessionActivity(session.provider, session.store_id) },
])('a failed background query stays local: $queryKey', async ({ queryKey }) => {
  const { mount, client } = fixture()
  mount()
  await screen.findByRole('button', { name: '查看会话：Unrelated session title' })
  const observer = new QueryObserver(client, { queryKey, retry: false, queryFn: async () => { throw new DashboardApiError('后台读取超时', { code: 'DASHBOARD_REQUEST_TIMEOUT', status: 504 }) } })
  const unsubscribe = observer.subscribe(() => {})
  try {
    await waitFor(() => expect(observer.getCurrentResult().isError).toBe(true))
    expect(document.querySelector('.sessions-connection')).toBeNull()
    expect(screen.getByRole('combobox')).toBeEnabled()
  } finally { unsubscribe() }
})

test('Active is removed when presence becomes unavailable and does not disable resume', async () => {
  const { api, mount, client } = fixture()
  mount()
  expect(await screen.findByRole('img', { name: '会话活跃' })).toBeInTheDocument()
  api.sessionActivity.mockResolvedValue({ store_id: 'local-store', available: false, open_session_ids: [], checked_at: '2026-10-23T08:00:05Z' })
  await client.invalidateQueries({ queryKey: ['dashboard', 'session-browser', 'codex', 'local-store', 'activity'] })
  await waitFor(() => expect(screen.queryByRole('img', { name: '会话活跃' })).not.toBeInTheDocument())
  await userEvent.click(screen.getByRole('button', { name: '查看会话：Unrelated session title' }))
  expect(await screen.findByRole('button', { name: '在终端继续：Unrelated session title' })).toBeEnabled()
})

test('screenshot annotations are removed and keyboard can choose a floating result', async () => {
  const { api, mount } = fixture()
  mount()
  expect(screen.queryByText('找到之前的讨论，继续手头的工作')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '显示归档会话' })).not.toBeInTheDocument()
  expect(screen.queryByText('按最近活跃时间排列')).not.toBeInTheDocument()
  expect(screen.queryByText('会话来自本机工具，无需创建 Task')).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('combobox', { name: '搜索会话正文' })).toBeEnabled())
  const input = screen.getByRole('combobox', { name: '搜索会话正文' })
  await userEvent.type(input, 'needle')
  await screen.findByRole('option', { name: /Unrelated session title/ })
  await userEvent.keyboard('{ArrowDown}{Enter}')
  await waitFor(() => expect(api.sessionMessages).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ query: 'needle' }), expect.any(AbortSignal)))
})

test('floating result badges follow live activity changes despite collection caching', async () => {
  const { api, mount, client } = fixture()
  api.sessionActivity.mockResolvedValue({ store_id: 'local-store', available: true, open_session_ids: [], checked_at: '2026-10-23T08:00:00Z' })
  mount()
  await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled())
  await userEvent.type(screen.getByRole('combobox'), 'needle')
  const option = await screen.findByRole('option', { name: /Unrelated session title/ })
  expect(option.querySelector('.session-origin')).toHaveTextContent('projectmain')
  expect(within(option).queryByRole('img', { name: '会话活跃' })).not.toBeInTheDocument()
  api.sessionActivity.mockResolvedValue({ store_id: 'local-store', available: true, open_session_ids: ['session-1'], checked_at: '2026-10-23T08:00:05Z' })
  await client.invalidateQueries({ queryKey: ['dashboard', 'session-browser', 'codex', 'local-store', 'activity'] })
  expect(await within(option).findByRole('img', { name: '会话活跃' })).toBeInTheDocument()
  api.sessionActivity.mockRejectedValue(new Error('probe unavailable'))
  await client.invalidateQueries({ queryKey: ['dashboard', 'session-browser', 'codex', 'local-store', 'activity'] })
  await waitFor(() => expect(within(option).queryByRole('img', { name: '会话活跃' })).not.toBeInTheDocument())
})
