import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { createDashboardApi, DashboardApiError } from '@/lib/api/dashboard-api'
import type { BrowserSession, SessionActivityPage, SessionFilters, SessionMessagesPage, SessionPage, SessionTimeline, SessionWorkspacePage } from '@/lib/api/types'
import { queryKeys } from '@/lib/query/keys'
import { SessionsView } from './sessions-view'

afterEach(() => vi.unstubAllGlobals())

beforeEach(() => { window.localStorage.removeItem('tasks-recorder.sessions-group'); window.history.replaceState(null, '', '/?view=sessions&sessions=list') })

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
      capabilities: { full_text_search: true, search_experimental: true, message_location: true, resume: true, live_presence: true, branch_groups: true },
    }] })),
    sessionActivity: vi.fn(async (): Promise<SessionActivityPage> => ({ store_id: 'local-store', available: true, sessions: [session], checked_at: '2026-10-23T08:00:00Z' })),
    sessionWorkspaces: vi.fn(async (): Promise<SessionWorkspacePage> => ({ workspaces: [{ path: '/workspace/project', observed_count: 1, branch_names: ['main'], last_active_at: session.last_active_at }], next_cursor: null })),
    sessionBranches: vi.fn(async () => ({ branches: [{ name: 'feature/shared', observed_count: 2, workspace_paths: ['/workspace/api', '/workspace/web'], session_ids: ['session-1', 'session-2'], last_active_at: session.last_active_at }], next_cursor: null as string | null })),
    sessions: vi.fn(async (_provider: string, filters: SessionFilters = {}): Promise<SessionPage> => ({
      sessions: [{ ...session, snippet: filters.query ? 'A needle deep in the conversation' : null }],
      next_cursor: null, search_scope: filters.query ? 'messages' : null, scanned_count: 1, relations: [],
    })),
    sessionMessages: vi.fn(async (): Promise<SessionMessagesPage> => ({
      session, messages: [{ id: 'message-1', turn_id: 'turn-1', role: 'assistant' as const, text: 'A needle deep in the conversation', truncated: false, at: null, time_precision: 'unknown' }],
      match: null, next_cursor: null, truncated: false,
    })),
    sessionRelations: vi.fn(async () => ({ relations: [] })),
    sessionChildren: vi.fn(async (): Promise<SessionPage> => ({ sessions: [], relations: [], next_cursor: null, search_scope: null, scanned_count: 0 })),
    sessionTimeline: vi.fn(async (): Promise<SessionTimeline> => ({ session, segments: [], anchors: [], next_cursor: null, coverage: 'complete', unplaced_turns: 0, from: session.created_at, to: session.last_active_at })),
    resumeSession: vi.fn(async () => ({ ok: true as const, terminal_label: 'Otty' })),
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  function mount() { render(<QueryClientProvider client={client}><SessionsView api={api} /></QueryClientProvider>) }
  return { api, mount, client }
}

test('workspace selection requests the exact directory and preview does not launch a terminal', async () => {
  const { api, mount } = fixture()
  mount()
  await userEvent.click(await screen.findByRole('button', { name: /workspace\/project/ }, { timeout: 5000 }))
  await waitFor(() => expect(api.sessions).toHaveBeenLastCalledWith('codex', expect.objectContaining({ workspace: '/workspace/project' })))
  await userEvent.click(await screen.findByRole('button', { name: 'Unrelated session title' }))
  expect(await screen.findByText('A needle deep in the conversation')).toBeInTheDocument()
  expect(api.resumeSession).not.toHaveBeenCalled()
  await userEvent.click(within(screen.getByRole('region', { name: '会话预览' })).getByRole('button', { name: '在终端继续：Unrelated session title' }))
  await waitFor(() => expect(api.resumeSession).toHaveBeenCalledWith(expect.objectContaining({ provider: 'codex', store_id: 'local-store', session_id: 'session-1' })))
  expect(await screen.findByRole('status')).toHaveTextContent('已在 Otty 打开')
})

test('branch grouping selects matching sessions across projects and scopes Tree and body search', async () => {
  const { api, mount, client } = fixture()
  api.sessions.mockImplementation(async (_provider, filters: { branch?: string; query?: string } = {}) => ({
    sessions: filters.branch ? [
      { ...session, title: 'API work', branch: filters.branch, workspace: '/workspace/api' },
      { ...session, session_id: 'session-2', title: 'Web work', branch: filters.branch, workspace: '/workspace/web' },
    ] : [session], next_cursor: null, search_scope: filters.query ? 'messages' : null, scanned_count: 2, relations: [],
  }))
  mount()
  await userEvent.click(await screen.findByRole('button', { name: /workspace\/project/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Branch' }))
  api.sessionActivity.mockResolvedValue({ store_id: 'local-store', available: true, sessions: [{ ...session, state: 'active', branch: 'feature/shared', workspace: '/workspace/api' }], checked_at: session.last_active_at! })
  await client.invalidateQueries({ queryKey: queryKeys.sessionActivity('codex', 'local-store') })
  const sidebar = await screen.findByRole('complementary', { name: '分支分组' })
  await userEvent.click(await within(sidebar).findByRole('button', { name: /feature\/shared/ }))
  await waitFor(() => expect(api.sessions).toHaveBeenLastCalledWith('codex', expect.objectContaining({ branch: 'feature/shared', workspace: '' })))
  expect(document.querySelectorAll('.session-tree__row')).toHaveLength(2)
  expect(within(sidebar).getByRole('img', { name: '分支活跃' })).toBeInTheDocument()
  expect(document.querySelectorAll('.session-tree__row')).toHaveLength(2)
  expect(api.sessionMessages).not.toHaveBeenCalled()
  await userEvent.type(screen.getByRole('combobox', { name: '搜索会话正文' }), 'needle')
  await waitFor(() => expect(api.sessions).toHaveBeenLastCalledWith('codex', expect.objectContaining({ query: 'needle', branch: 'feature/shared', workspace: '' })))
  expect(window.localStorage.getItem('tasks-recorder.sessions-group')).toBe('branch')
  expect(new URLSearchParams(window.location.search).get('group')).toBe('branch')
  await userEvent.keyboard('{Escape}')
  await userEvent.click(screen.getByRole('button', { name: 'Workspace' }))
  expect(await screen.findByRole('complementary', { name: '项目目录' })).toBeInTheDocument()
  expect(document.querySelectorAll('.session-tree__row')).toHaveLength(2)
  expect(screen.getByRole('combobox', { name: '搜索会话正文' })).toHaveValue('needle')
})

test('workspace branch children preserve both filters and the reader when grouping changes', async () => {
  const { api, mount } = fixture()
  api.sessionBranches.mockResolvedValue({ branches: [{ name: 'main', observed_count: 1, workspace_paths: ['/workspace/project'], session_ids: ['session-1'], last_active_at: session.last_active_at }], next_cursor: null })
  mount()
  const children = await screen.findByRole('list', { name: '/workspace/project 分支' })
  await userEvent.click(within(children).getByRole('button', { name: 'main' }))
  await waitFor(() => expect(api.sessions).toHaveBeenLastCalledWith('codex', expect.objectContaining({ workspace: '/workspace/project', branch: 'main' })))
  await userEvent.click(await screen.findByRole('button', { name: 'Unrelated session title' }))
  const preview = screen.getByRole('region', { name: '会话预览' })
  await userEvent.click(screen.getByRole('button', { name: '折叠项目分支' }))
  expect(children).not.toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Branch' }))
  const directories = await screen.findByRole('list', { name: 'main 项目目录' })
  expect(within(directories).getByRole('button', { name: /\/workspace\/project/ })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('region', { name: '会话预览' })).toBe(preview)
  await userEvent.click(screen.getByRole('button', { name: 'Workspace' }))
  expect(screen.getByRole('list', { name: '/workspace/project 分支' })).toBeVisible()
  expect(within(screen.getByRole('list', { name: '/workspace/project 分支' })).getByRole('button', { name: 'main' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('region', { name: '会话预览' })).toBe(preview)
  await userEvent.click(within(screen.getByRole('complementary', { name: '项目目录' })).getByRole('button', { name: /^\/workspace\/project/ }))
  await waitFor(() => expect(api.sessions).toHaveBeenLastCalledWith('codex', expect.objectContaining({ workspace: '/workspace/project', branch: '' })))
})

test('workspace branches merge across catalog pages without inventing a branch for unknown metadata', async () => {
  const { api, mount } = fixture()
  api.sessionWorkspaces.mockImplementation(async (_provider?: string, filters: SessionFilters = {}) => ({
    workspaces: filters.cursor ? [
      { path: '/workspace/project', branch_names: ['main', 'feature/shared'], observed_count: 2, last_active_at: session.last_active_at },
      { path: '/workspace/unknown', branch_names: [], observed_count: 1, last_active_at: session.last_active_at },
    ] : [{ path: '/workspace/project', branch_names: ['main'], observed_count: 1, last_active_at: session.last_active_at }],
    next_cursor: filters.cursor ? null : 'later',
  }))
  mount()
  await userEvent.type(await screen.findByRole('textbox', { name: '筛选项目目录' }), 'project')
  const children = await screen.findByRole('list', { name: '/workspace/project 分支' })
  await within(children).findByRole('button', { name: 'feature/shared' })
  expect(within(children).getAllByRole('button')).toHaveLength(2)
  await userEvent.clear(screen.getByRole('textbox', { name: '筛选项目目录' }))
  const unknown = within(screen.getByRole('complementary', { name: '项目目录' })).getByRole('button', { name: /^\/workspace\/unknown/ })
  expect(within(unknown.closest('li')!).queryByRole('button', { name: '折叠项目分支' })).not.toBeInTheDocument()
  expect(screen.queryByRole('list', { name: '/workspace/unknown 分支' })).not.toBeInTheDocument()
})

test('a selected branch automatically continues empty native pages instead of declaring no sessions', async () => {
  const { api, mount } = fixture()
  api.sessions.mockImplementation(async (_provider, filters: SessionFilters = {}) => ({
    sessions: filters.branch && !filters.cursor ? [] : [session], next_cursor: filters.branch && !filters.cursor ? 'later' : null, search_scope: null, scanned_count: 1, relations: [],
  }))
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Branch' }))
  const sidebar = await screen.findByRole('complementary', { name: '分支分组' })
  await userEvent.click(await within(sidebar).findByRole('button', { name: /feature\/shared/ }))
  await waitFor(() => expect(api.sessions).toHaveBeenLastCalledWith('codex', expect.objectContaining({ branch: 'feature/shared', cursor: 'later' })))
  expect(await screen.findByRole('button', { name: 'Unrelated session title' })).toBeInTheDocument()
  expect(screen.queryByText('这里还没有会话')).not.toBeInTheDocument()
})

test('branch workspace children combine both filters and collapse without changing the selection', async () => {
  const { api, mount } = fixture()
  api.sessions.mockImplementation(async (_provider, filters: SessionFilters = {}) => {
    const sessions = [
      { ...session, title: 'API work', branch: 'feature/shared', workspace: '/workspace/api' },
      { ...session, session_id: 'session-2', title: 'Web work', branch: 'feature/shared', workspace: '/workspace/web' },
    ].filter(row => (!filters.branch || row.branch === filters.branch) && (!filters.workspace || row.workspace === filters.workspace))
    return { sessions, next_cursor: null, search_scope: filters.query ? 'messages' : null, scanned_count: sessions.length, relations: [] }
  })
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Branch' }))
  const projects = await screen.findByRole('list', { name: 'feature/shared 项目目录' })
  const apiDirectory = within(projects).getByRole('button', { name: /\/workspace\/api/ })
  await userEvent.click(apiDirectory)
  await waitFor(() => expect(api.sessions).toHaveBeenLastCalledWith('codex', expect.objectContaining({ branch: 'feature/shared', workspace: '/workspace/api' })))
  expect(apiDirectory).toHaveAttribute('aria-pressed', 'true')
  expect(document.querySelectorAll('.session-tree__row')).toHaveLength(1)
  await userEvent.type(screen.getByRole('combobox', { name: '搜索会话正文' }), 'needle')
  await waitFor(() => expect(api.sessions).toHaveBeenLastCalledWith('codex', expect.objectContaining({ query: 'needle', branch: 'feature/shared', workspace: '/workspace/api' })))
  await userEvent.keyboard('{Escape}')
  const calls = api.sessions.mock.calls.length
  await userEvent.click(screen.getByRole('button', { name: '折叠分支目录' }))
  expect(projects).not.toBeVisible()
  expect(api.sessions).toHaveBeenCalledTimes(calls)
  expect(apiDirectory).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(screen.getByRole('button', { name: '展开分支目录' }))
  expect(projects).toBeVisible()
  await userEvent.click(within(screen.getByRole('complementary', { name: '分支分组' })).getByRole('button', { name: /feature\/shared/ }))
  await waitFor(() => expect(api.sessions).toHaveBeenLastCalledWith('codex', expect.objectContaining({ branch: 'feature/shared', workspace: '' })))
  expect(document.querySelectorAll('.session-tree__row')).toHaveLength(2)
})

test('only Tree remains and obsolete view preferences do not create a second view', async () => {
  window.history.replaceState(null, '', '/?view=sessions&sessions=list')
  window.localStorage.setItem('tasks-recorder.sessions-view', 'list')
  const { mount } = fixture()
  mount()
  await screen.findByRole('button', { name: 'Unrelated session title' })
  expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  expect(document.querySelector('.session-timeline')).toBeNull()
  expect(window.localStorage.getItem('tasks-recorder.sessions-view')).toBeNull()
  expect(new URLSearchParams(window.location.search).has('sessions')).toBe(false)
})

test('the Tree terminal action does not select a conversation', async () => {
  const { api, mount } = fixture()
  mount()
  await userEvent.click(await screen.findByRole('button', { name: '在终端继续：Unrelated session title' }))
  expect(await screen.findByRole('status')).toHaveTextContent('已在 Otty 打开')
  expect(api.sessionMessages).not.toHaveBeenCalled()
})

test('Tree automatically continues the shared native cursor and deduplicates repeated sessions', async () => {
  vi.stubGlobal('IntersectionObserver', class {
    callback: (entries: Array<{ isIntersecting: boolean }>) => void
    constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { this.callback = callback }
    observe() { this.callback([{ isIntersecting: true }]) }
    disconnect() {}
  })
  const { api, mount } = fixture()
  api.sessions.mockImplementation(async (_provider, filters: SessionFilters = {}) => ({
    sessions: filters.cursor ? [session, { ...session, session_id: 'second', title: '下一页的会话' }] : [session],
    next_cursor: filters.cursor ? null : 'native-next', search_scope: null, scanned_count: 2, relations: [],
  }))
  mount()
  expect(await screen.findByRole('button', { name: '下一页的会话' })).toBeInTheDocument()
  expect(document.querySelectorAll('.session-tree__row')).toHaveLength(2)
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
  await screen.findByRole('button', { name: 'Unrelated session title' })
  await userEvent.type(screen.getByRole('combobox', { name: '搜索会话正文' }), 'needle')
  await waitFor(() => expect(api.sessions).toHaveBeenLastCalledWith('codex', expect.objectContaining({ query: 'needle' })))
  const result = await screen.findByRole('option', { name: /Unrelated session title/ })
  expect(document.querySelector('.session-tree__row')).toHaveTextContent('Unrelated session title')
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
    observe(element: Element) { this.callback([{ isIntersecting: element.matches('[data-auto-pager]') }]) }
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

test('branch catalog search merges repeated names and session IDs across native pages', async () => {
  const { api, mount } = fixture()
  api.sessionBranches.mockImplementation(async (_provider?: string, filters: SessionFilters = {}) => ({
    branches: [{ name: 'feature/shared', observed_count: filters.cursor ? 2 : 1, workspace_paths: filters.cursor ? ['/workspace/api', '/workspace/web'] : ['/workspace/api'], session_ids: filters.cursor ? ['session-1', 'session-2'] : ['session-1'], last_active_at: session.last_active_at }],
    next_cursor: filters.cursor ? null : 'catalog-tail',
  }))
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Branch' }))
  await userEvent.type(await screen.findByRole('textbox', { name: '筛选分支名称' }), 'shared')
  await waitFor(() => expect(api.sessionBranches).toHaveBeenLastCalledWith('codex', expect.objectContaining({ cursor: 'catalog-tail' })))
  const entry = await within(screen.getByRole('complementary', { name: '分支分组' })).findByRole('button', { name: /feature\/shared/ })
  expect(entry.querySelector('.session-directory__count')).toHaveTextContent('2')
  const children = within(entry.closest('li')!).getByRole('list', { name: 'feature/shared 项目目录' })
  expect([...children.querySelectorAll('.session-path')].map(element => element.textContent)).toEqual(['/workspace/api', '/workspace/web'])
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
  await userEvent.click(await screen.findByRole('button', { name: 'Unrelated session title' }))
  await waitFor(() => expect(api.sessionRelations).toHaveBeenCalled())
  await waitFor(() => expect(document.querySelector('.session-detail .session-state.session-error')).toHaveTextContent('此会话暂时无法读取'))
  expect(document.querySelector('.sessions-connection')).toBeNull()
  expect(screen.getByRole('combobox', { name: '搜索会话正文' })).toBeEnabled()
  await userEvent.click(within(screen.getByRole('region', { name: '会话预览' })).getByRole('button', { name: '在终端继续：Unrelated session title' }))
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
  await screen.findByRole('button', { name: 'Unrelated session title' })
  const observer = new QueryObserver(client, { queryKey, retry: false, queryFn: async () => { throw new DashboardApiError('后台读取超时', { code: 'DASHBOARD_REQUEST_TIMEOUT', status: 504 }) } })
  const unsubscribe = observer.subscribe(() => {})
  try {
    await waitFor(() => expect(observer.getCurrentResult().isError).toBe(true))
    expect(document.querySelector('.sessions-connection')).toBeNull()
    expect(screen.getByRole('combobox')).toBeEnabled()
  } finally { unsubscribe() }
})

test('native status is removed when the shared server becomes unavailable and history stays accessible', async () => {
  const { api, mount, client } = fixture()
  api.sessionActivity.mockResolvedValue({ store_id: 'local-store', available: true, sessions: [{ ...session, state: 'active' }], checked_at: session.last_active_at! })
  mount()
  expect(await screen.findByRole('img', { name: 'Working' })).toBeInTheDocument()
  api.sessionActivity.mockResolvedValue({ store_id: 'local-store', available: false, sessions: [], checked_at: '2026-10-23T08:00:05Z' })
  await client.invalidateQueries({ queryKey: ['dashboard', 'session-browser', 'codex', 'local-store', 'activity'] })
  await waitFor(() => expect(screen.queryByRole('img', { name: 'Working' })).not.toBeInTheDocument())
  await userEvent.click(screen.getByRole('button', { name: 'Unrelated session title' }))
  expect(await within(screen.getByRole('region', { name: '会话预览' })).findByRole('button', { name: '在终端继续：Unrelated session title' })).toBeEnabled()
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
  api.sessionActivity.mockResolvedValue({ store_id: 'local-store', available: true, sessions: [], checked_at: '2026-10-23T08:00:00Z' })
  mount()
  await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled())
  await userEvent.type(screen.getByRole('combobox'), 'needle')
  const option = await screen.findByRole('option', { name: /Unrelated session title/ })
  expect(option.querySelector('.session-origin')).toHaveTextContent('/workspace/projectmain')
  expect(within(option).queryByRole('img', { name: 'Working' })).not.toBeInTheDocument()
  api.sessionActivity.mockResolvedValue({ store_id: 'local-store', available: true, sessions: [{ ...session, state: 'active' }], checked_at: '2026-10-23T08:00:05Z' })
  await client.invalidateQueries({ queryKey: ['dashboard', 'session-browser', 'codex', 'local-store', 'activity'] })
  expect(await within(option).findByRole('img', { name: 'Working' })).toBeInTheDocument()
  api.sessionActivity.mockRejectedValue(new Error('probe unavailable'))
  await client.invalidateQueries({ queryKey: ['dashboard', 'session-browser', 'codex', 'local-store', 'activity'] })
  await waitFor(() => expect(within(option).queryByRole('img', { name: 'Working' })).not.toBeInTheDocument())
})

test('native status buttons promote matching sessions in Tree and toggle back to recency', async () => {
  const { api, mount } = fixture()
  const rows = [
    { ...session, session_id: 'old-needs', title: '需要审批的旧会话', state: 'active', active_flags: ['waitingOnApproval' as const], last_active_at: '2026-10-20T08:00:00Z' },
    { ...session, session_id: 'working', title: '正在执行', state: 'active', active_flags: [], last_active_at: '2026-10-21T08:00:00Z' },
    { ...session, session_id: 'ready', title: '等待指令', state: 'idle', last_active_at: '2026-10-22T08:00:00Z' },
    { ...session, session_id: 'inactive', title: '历史会话', state: 'notLoaded', last_active_at: '2026-10-23T08:00:00Z' },
  ]
  api.sessions.mockResolvedValue({ sessions: rows, next_cursor: null, search_scope: null, scanned_count: rows.length, relations: [] })
  api.sessionActivity.mockResolvedValue({ store_id: 'local-store', available: true, sessions: rows.slice(0, 3), checked_at: session.last_active_at! })
  mount()
  const controls = await screen.findByRole('group', { name: '会话状态排序' })
  const needs = await within(controls).findByRole('button', { name: 'Needs you 1' })
  const listTitles = () => [...document.querySelectorAll('.session-tree__title')].map(element => element.textContent)
  await waitFor(() => expect(listTitles()[0]).toBe('历史会话'))
  await userEvent.click(needs)
  expect(needs).toHaveAttribute('aria-pressed', 'true')
  expect(listTitles()[0]).toBe('需要审批的旧会话')
  expect(listTitles()).toHaveLength(4)
  expect(document.querySelector('.session-tree__title')).toHaveTextContent('需要审批的旧会话')
  await userEvent.click(within(controls).getByRole('button', { name: 'Working 1' }))
  expect(document.querySelector('.session-tree__title')).toHaveTextContent('正在执行')
  await userEvent.click(within(controls).getByRole('button', { name: 'Working 1' }))
  expect(document.querySelector('.session-tree__title')).toHaveTextContent('历史会话')
})
