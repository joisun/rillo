import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { useState } from 'react'

import { createDashboardApi, DashboardApiError, type DashboardApi } from '@/lib/api/dashboard-api'
import type { BrowserSession, SessionFilters, SessionMessagesPage, SessionTimeline } from '@/lib/api/types'
import { SessionDetail } from './session-detail'
import { SessionDensity } from './session-density'
import { SessionsView } from './sessions-view'
import { SessionRelations } from './session-relations'
import { AutoPager } from './session-auto-pager'
import { SessionResumeButton } from './session-resume-button'

const session: BrowserSession = { provider: 'codex', store_id: 'store', session_id: 'parent', title: '父会话', preview: '计划', workspace: '/workspace/project', branch: 'main', created_at: '2026-10-23T08:00:00Z', updated_at: '2026-10-23T09:00:00Z', last_active_at: '2026-10-23T09:00:00Z', state: 'idle', native_parent: null, forked_from: null }
const firstAt = '2026-10-23T08:00:00.000Z'
const secondAt = '2026-10-23T09:00:00.000Z'

test('automatic pagination rechecks visibility after each loaded page instead of reusing an old intersection', async () => {
  const callbacks: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = []
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof callbacks[number]) { callbacks.push(callback) }
    observe() {}
    disconnect() {}
  })
  let finish: () => void = () => {}
  const onMore = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const current = render(<AutoPager enabled loading={false} onMore={onMore} />)
  await act(async () => callbacks.at(-1)!([{ isIntersecting: true }]))
  expect(onMore).toHaveBeenCalledTimes(1)
  current.rerender(<AutoPager enabled loading onMore={onMore} />)
  await act(async () => finish())
  current.rerender(<AutoPager enabled loading={false} onMore={onMore} />)
  await act(async () => callbacks.at(-1)!([{ isIntersecting: false }]))
  expect(onMore).toHaveBeenCalledTimes(1)
  await act(async () => callbacks.at(-1)!([{ isIntersecting: true }]))
  expect(onMore).toHaveBeenCalledTimes(2)
  await act(async () => finish())
})
function messagePage(text: string, at = firstAt): SessionMessagesPage {
  return { session, messages: [{ id: text, turn_id: 'turn', role: 'assistant', text, truncated: false, at, time_precision: 'turn' }], seek: { at, precision: 'turn', turn_id: 'turn', item_id: text }, match: null, next_cursor: null, truncated: false }
}
function timelinePage(filters: SessionFilters = {}): SessionTimeline {
  return { session, from: filters.from ?? firstAt, to: filters.to ?? secondAt, segments: [{ turn_id: 'turn', start: firstAt, end: secondAt, status: 'completed' }], anchors: [], next_cursor: null, coverage: 'complete', unplaced_turns: 0,
    bounds: { start_at: session.created_at, end_at: secondAt, end_state: 'known', indexed_from: firstAt }, points_coverage: 'complete',
    points: [{ item_id: 'first', turn_id: 'turn', role: 'user', at: firstAt }, { item_id: 'last', turn_id: 'turn', role: 'assistant', at: secondAt }] }
}
function fixture() {
  const api = { ...createDashboardApi(), sessionProviders: vi.fn(async () => ({ providers: [{ id: 'codex', name: 'Codex', store_id: 'store', capabilities: { full_text_search: true, search_experimental: false, message_location: true, resume: true } }] })),
    sessionWorkspaces: vi.fn(async () => ({ workspaces: [], next_cursor: null })),
    sessions: vi.fn<DashboardApi['sessions']>(async () => ({ sessions: [session], relations: [], next_cursor: null, search_scope: null, scanned_count: 1 })),
    sessionChildren: vi.fn<DashboardApi['sessionChildren']>(async () => ({ sessions: [], relations: [], next_cursor: null, search_scope: null, scanned_count: 0 })),
    sessionTimeline: vi.fn(async (_ref, filters: SessionFilters) => timelinePage(filters)),
    sessionMessages: vi.fn<DashboardApi['sessionMessages']>(async (_ref, filters: SessionFilters) => messagePage('正文', filters.at)),
    sessionRelations: vi.fn(async () => ({ relations: [] })),
    readSession: vi.fn(async () => ({ session })), resumeSession: vi.fn<DashboardApi['resumeSession']>(),
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
  function wrap(children: React.ReactNode) { return <QueryClientProvider client={client}>{children}</QueryClientProvider> }
  return { api, client, wrap }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

test('active sessions can focus their terminal and repeated clicks wait for the current request', async () => {
  const { api, wrap } = fixture()
  let finish: (result: Awaited<ReturnType<DashboardApi['resumeSession']>>) => void = () => {}
  api.resumeSession.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  render(wrap(<SessionResumeButton api={api} session={{ ...session, state: 'active' }} />))
  const button = screen.getByRole('button', { name: '在终端继续：父会话' })
  expect(button).toBeEnabled()
  await userEvent.click(button)
  await userEvent.click(button)
  expect(api.resumeSession).toHaveBeenCalledTimes(1)
  await act(async () => finish({ ok: true, terminal_label: 'Otty', action: 'focused' }))
  expect(await screen.findByText('已切换到 Otty 会话')).toHaveAttribute('role', 'status')
})

test.each([
  ['new_tab', '已在 Ghostty 新建标签页'],
  ['new_window', '已在 Ghostty 新建窗口'],
] as const)('terminal resume reports %s without changing the selected conversation', async (action, feedback) => {
  const { api, wrap } = fixture()
  api.resumeSession.mockResolvedValue({ ok: true, terminal_label: 'Ghostty', action })
  render(wrap(<SessionResumeButton api={api} session={session} />))
  await userEvent.click(screen.getByRole('button', { name: '在终端继续：父会话' }))
  expect(await screen.findByRole('status')).toHaveTextContent(feedback)
})

test('unavailable sessions keep terminal resume disabled', () => {
  const { api, wrap } = fixture()
  render(wrap(<SessionResumeButton api={api} session={{ ...session, state: 'unavailable' }} />))
  expect(screen.getByRole('button', { name: '在终端继续：父会话' })).toBeDisabled()
  expect(api.resumeSession).not.toHaveBeenCalled()
})

test('mouse hover selects the nearest real message without holding, and leaving cancels a pending selection', async () => {
  vi.useFakeTimers()
  const onSeek = vi.fn()
  render(<SessionDensity title="悬停会话" intervals={[]} from={0} to={1000} count={10} complete points={[
    { item_id: 'first', turn_id: 'a', role: 'user', at: new Date(100).toISOString() },
    { item_id: 'last', turn_id: 'b', role: 'assistant', at: new Date(900).toISOString() },
  ]} onSeek={onSeek} />)
  const slider = screen.getByRole('slider')
  slider.getBoundingClientRect = () => ({ left: 0, width: 100 } as DOMRect)
  fireEvent.pointerMove(slider, { pointerType: 'mouse', clientX: 15 })
  expect(onSeek).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTime(120))
  expect(onSeek).toHaveBeenLastCalledWith(new Date(100).toISOString(), 'first')
  fireEvent.pointerMove(slider, { pointerType: 'mouse', clientX: 85 })
  fireEvent.pointerLeave(slider)
  await act(async () => vi.advanceTimersByTime(200))
  expect(onSeek).toHaveBeenCalledTimes(1)
  fireEvent.keyDown(slider, { key: 'End' })
  expect(onSeek).toHaveBeenLastCalledWith(new Date(900).toISOString(), 'last')
})

test('continuous hover samples the newest target each frame without waiting for the mouse to stop or repeating one message', async () => {
  vi.useFakeTimers()
  const onSeek = vi.fn()
  render(<SessionDensity title="持续移动" intervals={[]} from={0} to={1000} count={10} complete points={[
    { item_id: 'first', turn_id: 'a', role: 'user', at: new Date(100).toISOString() },
    { item_id: 'middle', turn_id: 'b', role: 'assistant', at: new Date(500).toISOString() },
    { item_id: 'last', turn_id: 'c', role: 'assistant', at: new Date(900).toISOString() },
  ]} onSeek={onSeek} />)
  const slider = screen.getByRole('slider')
  slider.getBoundingClientRect = () => ({ left: 0, width: 100 } as DOMRect)
  fireEvent.pointerMove(slider, { pointerType: 'mouse', clientX: 5 })
  await act(async () => vi.advanceTimersByTime(8))
  fireEvent.pointerMove(slider, { pointerType: 'mouse', clientX: 50 })
  await act(async () => vi.advanceTimersByTime(16))
  expect(onSeek).toHaveBeenLastCalledWith(new Date(500).toISOString(), 'middle')
  fireEvent.pointerMove(slider, { pointerType: 'mouse', clientX: 52 })
  await act(async () => vi.advanceTimersByTime(16))
  expect(onSeek).toHaveBeenCalledTimes(1)
  fireEvent.pointerMove(slider, { pointerType: 'mouse', clientX: 90 })
  await act(async () => vi.advanceTimersByTime(16))
  expect(onSeek).toHaveBeenLastCalledWith(new Date(900).toISOString(), 'last')
})

test('seeking a loaded message keeps its page and DOM without another API request', async () => {
  const { api, wrap } = fixture()
  const first = messagePage('已读取第一条', firstAt).messages[0]
  const last = { ...messagePage('已读取最后一条', secondAt).messages[0], id: 'last' }
  api.sessionMessages.mockResolvedValue({ ...messagePage(''), messages: [first, last], seek: null })
  const detail = (at: string | null, itemId?: string) => wrap(<SessionDetail api={api} session={session} at={at} itemId={itemId} query="" onBack={vi.fn()} onReadSession={vi.fn()} onLoadTimeline={vi.fn()} />)
  const current = render(detail(null))
  const firstElement = await screen.findByText('已读取第一条')
  const body = screen.getByLabelText('会话消息')
  const calls = api.sessionMessages.mock.calls.length
  current.rerender(detail(secondAt, last.id))
  expect(body.querySelector('[data-match="true"]')).toHaveAttribute('data-item-id', last.id)
  current.rerender(detail(firstAt, first.id))
  expect(body.querySelector('[data-match="true"]')).toHaveAttribute('data-item-id', first.id)
  expect(screen.getByText('已读取第一条')).toBe(firstElement)
  expect(api.sessionMessages).toHaveBeenCalledTimes(calls)
})

test('a slow page is not starved by pointer movement and can satisfy the latest target without a second lookup', async () => {
  const { api, wrap } = fixture()
  const middleAt = '2026-10-23T08:30:00.000Z'
  let finish: (page: SessionMessagesPage) => void = () => {}
  let signal: AbortSignal | undefined
  api.sessionMessages.mockImplementationOnce(async () => messagePage('初始正文', firstAt))
  api.sessionMessages.mockImplementation((_session, _filters, currentSignal) => { signal = currentSignal; return new Promise(resolve => { finish = resolve }) })
  const detail = (at: string, id: string) => wrap(<SessionDetail api={api} session={session} at={at} itemId={id} query="" onBack={vi.fn()} onReadSession={vi.fn()} onLoadTimeline={vi.fn()} />)
  const current = render(detail(firstAt, '初始正文'))
  await screen.findByText('初始正文')
  current.rerender(detail(middleAt, 'middle'))
  await waitFor(() => expect(api.sessionMessages).toHaveBeenCalledTimes(2))
  for (let i = 0; i < 20; i++) current.rerender(detail(new Date(Date.parse(secondAt) + i * 1000).toISOString(), 'last'))
  const latestAt = new Date(Date.parse(secondAt) + 19_000).toISOString()
  expect(api.sessionMessages).toHaveBeenCalledTimes(2)
  expect(signal?.aborted).toBe(false)
  await act(async () => finish({ ...messagePage('中间正文', middleAt), messages: [
    { ...messagePage('中间正文', middleAt).messages[0], id: 'middle' },
    { ...messagePage('最新目标', latestAt).messages[0], id: 'last' },
  ] }))
  await screen.findByText('最新目标')
  expect(document.querySelector('[data-match="true"]')).toHaveAttribute('data-item-id', 'last')
  expect(api.sessionMessages).toHaveBeenCalledTimes(2)
})

test('hover scrolling eases to a loaded message within 100ms and manual input cancels it', async () => {
  const { api, wrap } = fixture()
  api.sessionMessages.mockResolvedValue({ ...messagePage(''), seek: null, messages: [messagePage('first', firstAt).messages[0], messagePage('last', secondAt).messages[0]] })
  const detail = (at: string | null) => wrap(<SessionDetail api={api} session={session} at={at} query="" onBack={vi.fn()} onReadSession={vi.fn()} onLoadTimeline={vi.fn()} />)
  const current = render(detail(null))
  await screen.findByText('last')
  const body = screen.getByLabelText('会话消息')
  Object.defineProperty(body, 'clientHeight', { configurable: true, value: 200 })
  Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 2000 })
  body.getBoundingClientRect = () => ({ top: 0 } as DOMRect)
  screen.getByText('last').closest('.session-message')!.getBoundingClientRect = () => ({ top: 1000 - body.scrollTop, height: 100 } as DOMRect)
  screen.getByText('first').closest('.session-message')!.getBoundingClientRect = () => ({ top: 0 - body.scrollTop, height: 100 } as DOMRect)
  body.scrollTop = 0
  const frames: FrameRequestCallback[] = [], canceled: number[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => canceled.push(id))
  const now = vi.spyOn(performance, 'now').mockReturnValue(0)
  current.rerender(detail(secondAt))
  act(() => frames[0](25))
  expect(body.scrollTop).toBeGreaterThan(0)
  expect(body.scrollTop).toBeLessThan(950)
  act(() => frames[1](100))
  expect(body.scrollTop).toBe(950)
  current.rerender(detail(firstAt))
  fireEvent.wheel(body)
  expect(canceled).toContain(3)
  now.mockRestore()
})

test('cached children reopen immediately and a completed empty child query becomes an explicit leaf', async () => {
  window.history.replaceState(null, '', '/?view=sessions&sessions=activity')
  const { api, wrap } = fixture()
  const child = { ...session, session_id: 'child', title: '叶子会话', native_parent: session }
  api.sessionChildren.mockImplementation(async (ref) => ({ sessions: ref.session_id === 'parent' ? [child] : [], relations: [], next_cursor: null, search_scope: null, scanned_count: 1 }))
  render(wrap(<SessionsView api={api} />))
  await userEvent.click(await screen.findByRole('button', { name: '展开 父会话' }, { timeout: 5000 }))
  expect(await screen.findByRole('button', { name: '叶子会话' })).toBeInTheDocument()
  await waitFor(() => expect(api.sessionChildren).toHaveBeenCalledWith(expect.objectContaining({ session_id: 'child' }), expect.anything(), expect.any(AbortSignal)))
  expect(screen.queryByRole('button', { name: '展开 叶子会话' })).not.toBeInTheDocument()
  expect(screen.queryByText('无子会话')).not.toBeInTheDocument()
  const requests = api.sessionChildren.mock.calls.length
  await userEvent.click(screen.getByRole('button', { name: '折叠 父会话' }))
  await userEvent.click(screen.getByRole('button', { name: '展开 父会话' }))
  expect(screen.getByRole('button', { name: '叶子会话' })).toBeInTheDocument()
  expect(api.sessionChildren).toHaveBeenCalledTimes(requests)
  expect(screen.queryByText(/正在读取.*子会话/)).not.toBeInTheDocument()
})

test('pointer capture keeps dragging outside row, release preserves selection and keyboard/touch can seek', () => {
  class TestPointerEvent extends MouseEvent {
    pointerId: number
    pointerType: string
    constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 1; this.pointerType = init.pointerType ?? 'mouse' }
  }
  vi.stubGlobal('PointerEvent', TestPointerEvent)
  const onSeek = vi.fn()
  function Harness() {
    const [at, setAt] = useState<string | null>(null)
    return <SessionDensity title="测试会话" intervals={[]} from={0} to={1000} count={10} selectedAt={at} onSeek={(time) => { setAt(time); onSeek(time) }} />
  }
  render(<Harness />)
  const slider = screen.getByRole('slider')
  slider.getBoundingClientRect = () => ({ left: 100, width: 100 } as DOMRect)
  slider.setPointerCapture = vi.fn()
  slider.releasePointerCapture = vi.fn()
  fireEvent.pointerMove(slider, { pointerId: 1, clientX: 150 })
  expect(onSeek).not.toHaveBeenCalled()
  fireEvent.pointerDown(slider, { pointerId: 1, button: 0, clientX: 150 })
  expect(slider.setPointerCapture).toHaveBeenCalledWith(1)
  slider.getBoundingClientRect = () => ({ left: 100, width: 20 } as DOMRect)
  fireEvent.pointerMove(slider, { pointerId: 1, clientX: 175 })
  expect(onSeek).toHaveBeenLastCalledWith(new Date(750).toISOString())
  fireEvent.pointerLeave(slider, { pointerId: 1, clientX: 300 })
  fireEvent.pointerMove(slider, { pointerId: 1, clientX: 300 })
  expect(onSeek).toHaveBeenLastCalledWith(new Date(999).toISOString())
  fireEvent.pointerUp(slider, { pointerId: 1, clientX: 300 })
  expect(slider.releasePointerCapture).toHaveBeenCalledWith(1)
  expect(slider).toHaveAttribute('aria-valuenow', '999')
  fireEvent.keyDown(slider, { key: 'Home' })
  expect(onSeek).toHaveBeenLastCalledWith(new Date(0).toISOString())
  fireEvent.keyDown(slider, { key: 'ArrowRight' })
  expect(onSeek).toHaveBeenLastCalledWith(new Date(999).toISOString())
  slider.getBoundingClientRect = () => ({ left: 100, width: 100 } as DOMRect)
  fireEvent.pointerDown(slider, { pointerId: 2, pointerType: 'touch', button: 0, clientX: 125 })
  expect(onSeek).toHaveBeenLastCalledWith(new Date(250).toISOString())
})

test('partial indexing stays unknown until final page; visible children are discovered and fork uses read instead of nesting', async () => {
  window.history.replaceState(null, '', '/?view=sessions&sessions=activity')
  const { api, wrap } = fixture()
  const fork = { ...session, session_id: 'fork', title: '派生会话', forked_from: session }
  api.sessions.mockResolvedValue({ sessions: [session, fork], relations: [], next_cursor: null, search_scope: null, scanned_count: 2 })
  let finish: (page: SessionTimeline) => void = () => {}
  api.sessionTimeline.mockImplementation(async (ref, filters) => {
    if (ref.session_id === 'fork') return { ...timelinePage(filters), session: fork }
    if (filters.cursor) return new Promise((resolve) => { finish = resolve })
    return { ...timelinePage(filters), segments: [], coverage: 'partial', points_coverage: 'partial', next_cursor: 'next' }
  })
  const child = { ...session, session_id: 'child', title: '原生子会话', native_parent: session }
  api.sessionChildren.mockResolvedValue({ sessions: [child], relations: [], next_cursor: null, search_scope: null, scanned_count: 1 })
  render(wrap(<SessionsView api={api} />))
  await waitFor(() => expect(api.sessionTimeline).toHaveBeenCalledWith(expect.objectContaining({ session_id: 'parent' }), expect.objectContaining({ cursor: 'next' }), expect.any(AbortSignal)))
  expect(document.querySelector('.session-tree__index-status[aria-busy="true"]')).toBeInTheDocument()
  expect(api.sessionChildren).not.toHaveBeenCalledWith(expect.objectContaining({ session_id: 'child' }), expect.anything(), expect.anything())
  await act(async () => finish(timelinePage()))
  await waitFor(() => expect(document.querySelector('.session-tree__index-status[aria-busy="true"]')).not.toBeInTheDocument())
  await userEvent.click(screen.getByRole('button', { name: '展开 父会话' }))
  expect(await screen.findByRole('button', { name: '原生子会话' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '查看 fork 来源' }))
  await waitFor(() => expect(api.readSession).toHaveBeenCalledWith(expect.objectContaining({ session_id: 'parent' }), expect.any(AbortSignal)))
  expect(api.resumeSession).not.toHaveBeenCalled()
})

test('at changes preserve detail DOM, finish the current request before the latest target, pause on manual scroll and keep search exclusive', async () => {
  const { api, wrap } = fixture()
  const onReadSession = vi.fn(), onBack = vi.fn()
  const detail = (at: string | null, query = '', followRequest = 0) => wrap(<SessionDetail api={api} session={session} at={at} query={query} followRequest={followRequest} onReadSession={onReadSession} onBack={onBack} onLoadTimeline={vi.fn()} />)
  const { rerender } = render(detail(firstAt, 'search'))
  expect(await screen.findByText('正文')).toBeInTheDocument()
  const region = screen.getByRole('region', { name: '会话预览' })
  const initialCalls = api.sessionMessages.mock.calls.length
  let stale: (page: SessionMessagesPage) => void = () => {}
  let obsoleteSignal: AbortSignal | undefined
  api.sessionMessages.mockImplementationOnce((_ref, _filters, signal) => { obsoleteSignal = signal; return new Promise((resolve) => { stale = resolve }) })
  rerender(detail(secondAt))
  await waitFor(() => expect(obsoleteSignal).toBeDefined())
  expect(screen.getByRole('region', { name: '会话预览' })).toBe(region)
  expect(screen.getByText('正文')).toBeInTheDocument()
  fireEvent.scroll(screen.getByLabelText('会话消息'))
  expect(screen.queryByRole('button', { name: '恢复跟随' })).not.toBeInTheDocument()
  for (let index = 0; index < 20; index++) rerender(detail(new Date(Date.parse(secondAt) + index * 1000).toISOString()))
  expect(api.sessionMessages.mock.calls.length).toBeLessThanOrEqual(initialCalls + 2)
  expect(obsoleteSignal?.aborted).toBe(false)
  await act(async () => stale(messagePage('过期正文', secondAt)))
  await waitFor(() => expect(document.querySelector('[data-match="true"]')).toHaveAttribute('data-at', new Date(Date.parse(secondAt) + 19_000).toISOString()))
  await waitFor(() => expect(screen.queryByText('过期正文')).not.toBeInTheDocument())
  const beforePause = api.sessionMessages.mock.calls.length
  fireEvent.wheel(screen.getByLabelText('会话消息'))
  rerender(detail('2026-10-23T10:00:00.000Z'))
  await new Promise((resolve) => setTimeout(resolve, 200))
  expect(api.sessionMessages).toHaveBeenCalledTimes(beforePause)
  rerender(detail('2026-10-23T10:00:00.000Z', '', 1))
  await waitFor(() => expect(api.sessionMessages).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ at: '2026-10-23T10:00:00.000Z', query: '' }), expect.any(AbortSignal)))
  rerender(detail(null, 'needle'))
  await waitFor(() => expect(api.sessionMessages).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ query: 'needle' }), expect.any(AbortSignal)))
  const filters = api.sessionMessages.mock.calls.at(-1)?.[1]
  expect(filters).not.toHaveProperty('at')
})

test('an incomplete time index automatically requests metadata continuation without fabricating a match', async () => {
  const { api, wrap } = fixture()
  api.sessionMessages.mockRejectedValue(new DashboardApiError('index incomplete', { status: 409, code: 'SESSION_TIMELINE_INCOMPLETE' }))
  const onLoadTimeline = vi.fn()
  render(wrap(<SessionDetail api={api} session={session} query="" at={firstAt} onReadSession={vi.fn()} onBack={vi.fn()} onLoadTimeline={onLoadTimeline} />))
  await waitFor(() => expect(onLoadTimeline).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('button', { name: /继续加载/ })).not.toBeInTheDocument()
  expect(document.querySelector('[data-match]')).not.toBeInTheDocument()
})

test('parent and child have independent start/end domains and workspace headings do not mix their activity', async () => {
  window.history.replaceState(null, '', '/?view=sessions&sessions=activity')
  const { api, wrap } = fixture()
  const child = { ...session, session_id: 'child', title: '子会话', created_at: '2026-10-22T08:00:00Z', native_parent: session }
  api.sessionChildren.mockResolvedValue({ sessions: [child], relations: [], next_cursor: null, search_scope: null, scanned_count: 1 })
  api.sessionTimeline.mockImplementation(async (ref, filters) => ({ ...timelinePage(filters), session: ref.session_id === 'child' ? child : session,
    bounds: { start_at: ref.session_id === 'child' ? child.created_at : session.created_at, end_at: ref.session_id === 'child' ? '2026-10-22T08:00:00Z' : firstAt, end_state: 'known', indexed_from: null },
    points: [{ item_id: ref.session_id, turn_id: ref.session_id, role: 'user', at: ref.session_id === 'child' ? '2026-10-22T08:00:00Z' : firstAt }], points_coverage: 'complete', untimed_messages: ref.session_id === 'child' ? 1 : 0,
    unplaced_turns: ref.session_id === 'child' ? 1 : 0,
    segments: [{ turn_id: ref.session_id, status: 'completed', start: ref.session_id === 'child' ? '2026-10-22T08:00:00Z' : firstAt, end: ref.session_id === 'child' ? '2026-10-22T09:00:00Z' : secondAt }],
  }))
  render(wrap(<SessionsView api={api} />))
  await userEvent.click(await screen.findByRole('button', { name: '展开 父会话' }))
  const childSlider = await screen.findByRole('slider', { name: '定位 子会话 的消息' })
  const ticks = (element: Element) => Number(element.getAttribute('data-second-cells') ?? 0)
  await waitFor(() => expect(ticks(childSlider)).toBe(1))
  expect(ticks(screen.getByRole('slider', { name: '定位 父会话 的消息' }))).toBe(1)
  expect(childSlider).toHaveAttribute('data-second-cells', '1')
  expect(ticks(document.querySelector('.session-tree__group')!)).toBe(0)
  expect(childSlider).toHaveAttribute('aria-valuemin', String(Date.parse(child.created_at)))
  expect(childSlider).toHaveAttribute('aria-valuemax', String(Date.parse(child.created_at)))
  expect(api.sessionTimeline.mock.calls[0][1]).not.toHaveProperty('from')
})

test('an out-of-page parent is read before its child can appear in the tree', async () => {
  window.history.replaceState(null, '', '/?view=sessions')
  const { api, wrap } = fixture()
  const parent = { ...session, session_id: 'unloaded-parent', title: '已读取的主会话' }
  const child = { ...session, title: '子项', native_parent: parent }
  api.sessions.mockResolvedValue({ sessions: [child], relations: [], next_cursor: null, search_scope: null, scanned_count: 1 })
  api.readSession.mockResolvedValue({ session: parent })
  render(wrap(<SessionsView api={api} />))
  await waitFor(() => expect(api.readSession).toHaveBeenCalledWith(expect.objectContaining({ session_id: 'unloaded-parent' }), expect.any(AbortSignal)))
  expect(await screen.findByRole('button', { name: '已读取的主会话' })).toBeVisible()
  expect(screen.queryByRole('button', { name: '子项' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '展开 已读取的主会话' }))
  expect(await screen.findByRole('button', { name: '子项' })).toBeVisible()
})

test('visible timelines automatically continue beyond three pages and stop at the native end', async () => {
  window.history.replaceState(null, '', '/?view=sessions&sessions=activity')
  const { api, wrap } = fixture()
  api.sessionTimeline.mockImplementation(async (_ref, filters) => {
    const page = Number(filters.cursor ?? 0)
    return { ...timelinePage(filters), points_coverage: page < 4 ? 'partial' : 'complete', next_cursor: page < 4 ? String(page + 1) : null }
  })
  render(wrap(<SessionsView api={api} />))
  await waitFor(() => expect(api.sessionTimeline).toHaveBeenCalledTimes(5))
  expect(api.sessionTimeline).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ cursor: '4' }), expect.any(AbortSignal))
  expect(screen.queryByRole('button', { name: /继续加载|继续读取/ })).not.toBeInTheDocument()
})

test('registration selects a configured source and only asks for the child native ID', async () => {
  const { api, wrap } = fixture()
  const capabilities = { full_text_search: true, search_experimental: false, message_location: true, resume: true }
  api.sessionProviders.mockResolvedValue({ providers: [{ id: 'codex', name: 'Codex', store_id: 'store', capabilities }, { id: 'codex', name: 'Codex', store_id: 'second-store', capabilities }] })
  api.linkSessions = vi.fn<DashboardApi['linkSessions']>(async (input) => ({ relation: { id: 'registered', kind: 'delegation', origin: 'registered', parent: input.parent, child: input.child, source: input.source ?? '', created_at: null }, created: true }))
  render(wrap(<SessionRelations api={api} session={session} onReadSession={vi.fn()} />))
  await userEvent.click(screen.getByText('会话关系'))
  const source = await screen.findByRole('button', { name: /子会话来源/ })
  await userEvent.click(source)
  await userEvent.click(await screen.findByRole('option', { name: 'Codex · 来源 2' }))
  expect(screen.queryByRole('textbox', { name: /provider|store_id/ })).not.toBeInTheDocument()
  await userEvent.type(screen.getByRole('textbox', { name: '子会话 Session ID' }), 'child-thread')
  await userEvent.click(screen.getByRole('button', { name: '登记子会话' }))
  await waitFor(() => expect(api.linkSessions).toHaveBeenCalledWith({ parent: { provider: 'codex', store_id: 'store', session_id: 'parent' }, child: { provider: 'codex', store_id: 'second-store', session_id: 'child-thread' }, source: 'session-browser' }))
})

test('offscreen timelines do not queue native reads until their row approaches the viewport', async () => {
  window.history.replaceState(null, '', '/?view=sessions&sessions=activity')
  const observers: Array<{ callback: (entries: Array<{ isIntersecting: boolean }>) => void; target?: Element }> = []
  vi.stubGlobal('IntersectionObserver', class {
    record: typeof observers[number]
    constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { this.record = { callback }; observers.push(this.record) }
    observe(element: Element) { this.record.target = element }
    disconnect() {}
  })
  const { api, wrap } = fixture()
  api.sessions.mockResolvedValue({ sessions: [session, { ...session, session_id: 'far', title: '屏幕外会话' }], relations: [], next_cursor: null, search_scope: null, scanned_count: 2 })
  render(wrap(<SessionsView api={api} />))
  await screen.findByRole('button', { name: '屏幕外会话' })
  expect(api.sessionTimeline).not.toHaveBeenCalled()
  await act(async () => observers.find(record => record.target?.classList.contains('session-tree__index-status'))!.callback([{ isIntersecting: true }]))
  await waitFor(() => expect(api.sessionTimeline).toHaveBeenCalledTimes(1))
  expect(api.sessionTimeline).toHaveBeenCalledWith(expect.objectContaining({ session_id: 'parent' }), expect.anything(), expect.any(AbortSignal))
})

test('normal reading opens recent content and automatically keeps its anchor when older messages arrive', async () => {
  let olderObserver: ((entries: Array<{ isIntersecting: boolean }>) => void) | undefined
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof olderObserver) { olderObserver = callback }
    observe() {}
    disconnect() {}
  })
  const { api, wrap } = fixture()
  let finishRecent: (value: SessionMessagesPage) => void = () => {}
  let finishOlder: (value: SessionMessagesPage) => void = () => {}
  api.sessionMessages.mockImplementation((_ref, filters) => new Promise(resolve => { if (filters.cursor) finishOlder = resolve; else finishRecent = resolve }))
  render(wrap(<SessionDetail api={api} session={session} query="" onReadSession={vi.fn()} onBack={vi.fn()} onLoadTimeline={vi.fn()} />))
  const body = screen.getByLabelText('会话消息')
  let height = 600
  Object.defineProperty(body, 'scrollHeight', { configurable: true, get: () => height })
  await waitFor(() => expect(api.sessionMessages).toHaveBeenCalledTimes(1))
  await act(async () => finishRecent({ ...messagePage('最近内容'), next_cursor: 'older' }))
  await waitFor(() => expect(body.scrollTop).toBe(600))
  body.scrollTop = 0
  const anchor = screen.getByText('最近内容').closest('.session-message')!
  let position = 100
  anchor.getBoundingClientRect = () => ({ top: position - body.scrollTop, bottom: position + 100 - body.scrollTop } as DOMRect)
  await act(async () => olderObserver?.([{ isIntersecting: true }]))
  await waitFor(() => expect(api.sessionMessages).toHaveBeenCalledTimes(2))
  height = 900
  position = 800
  await act(async () => finishOlder(messagePage('更早内容')))
  await waitFor(() => expect(body.scrollTop).toBe(700))
})

test('the sheet opens on selection, collapses without losing its reader, and opens again without a second message read', async () => {
  window.history.replaceState(null, '', '/?view=sessions')
  const { api, wrap } = fixture()
  render(wrap(<SessionsView api={api} />))
  await screen.findByRole('button', { name: '父会话' })
  expect(screen.queryByRole('dialog', { name: '会话面板' })).not.toBeInTheDocument()
  expect(api.sessionMessages).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: '父会话' }))
  expect(await screen.findByText('正文')).toBeInTheDocument()
  const reader = document.querySelector('.session-detail__conversation')
  await userEvent.click(screen.getByRole('button', { name: '收起会话面板' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '会话面板' })).not.toBeInTheDocument())
  expect(document.querySelector('.session-detail__conversation')).toBe(reader)
  await userEvent.click(screen.getByRole('button', { name: '展开会话面板' }))
  await screen.findByRole('dialog', { name: '会话面板' })
  expect(document.querySelector('.session-detail__conversation')).toBe(reader)
  expect(api.sessionMessages).toHaveBeenCalledTimes(1)
})

test('recent messages also seeks the latest item and explicitly resumes paused reading', async () => {
  window.history.replaceState(null, '', '/?view=sessions&sessions=activity')
  const { api, wrap } = fixture()
  api.sessionTimeline.mockImplementation(async (_ref, filters) => ({ ...timelinePage(filters), points_coverage: 'complete', points: [
    { item_id: 'first', turn_id: 'turn', role: 'user', at: firstAt },
    { item_id: 'latest', turn_id: 'turn', role: 'assistant', at: secondAt },
  ] }))
  render(wrap(<SessionsView api={api} />))
  const slider = await screen.findByRole('slider', { name: '定位 父会话 的消息' })
  await waitFor(() => expect(slider).toHaveAttribute('data-second-cells', '2'))
  fireEvent.keyDown(slider, { key: 'Home' })
  await screen.findByText('正文')
  fireEvent.wheel(screen.getByLabelText('会话消息'))
  expect(screen.queryByRole('button', { name: '恢复跟随' })).not.toBeInTheDocument()
  const freshAt = '2026-10-23T10:00:00.000Z'
  api.sessionTimeline.mockResolvedValueOnce({ ...timelinePage(), bounds: { start_at: session.created_at, end_at: freshAt, end_state: 'known', indexed_from: firstAt }, points: [
    { item_id: 'first', turn_id: 'turn', role: 'user', at: firstAt }, { item_id: 'new-latest', turn_id: 'turn', role: 'assistant', at: freshAt },
  ] })
  await userEvent.click(screen.getByRole('button', { name: '最近消息' }))
  await waitFor(() => expect(api.sessionMessages).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ at: freshAt, item_id: 'new-latest' }), expect.any(AbortSignal)))
  expect(screen.queryByText(/跟随时间轴/)).not.toBeInTheDocument()
})

test('unread history never seeks to a fabricated nearby message, and equal-time messages retain their own IDs', async () => {
  vi.useFakeTimers()
  const onSeek = vi.fn()
  const at = new Date(900).toISOString()
  render(<SessionDensity title="部分会话" intervals={[]} from={0} to={1000} count={16} indexedFrom={600} points={[
    { item_id: 'a', turn_id: 't', role: 'user', at }, { item_id: 'b', turn_id: 't', role: 'assistant', at },
  ]} onSeek={onSeek} />)
  const slider = screen.getByRole('slider')
  slider.getBoundingClientRect = () => ({ left: 0, width: 100 } as DOMRect)
  fireEvent.pointerMove(slider, { pointerType: 'mouse', clientX: 10 })
  await act(async () => vi.advanceTimersByTime(200))
  expect(onSeek).not.toHaveBeenCalled()
  expect(slider).not.toHaveAttribute('aria-valuetext', expect.stringContaining('0 条消息'))
  expect(screen.queryByText(/尚未读取/)).not.toBeInTheDocument()
  fireEvent.keyDown(slider, { key: 'Home' })
  expect(onSeek).toHaveBeenLastCalledWith(at, 'a')
  fireEvent.keyDown(slider, { key: 'ArrowRight' })
  expect(onSeek).toHaveBeenLastCalledWith(at, 'b')
})

test('reading scroll reports the visible message without making another native request', async () => {
  const { api, wrap } = fixture()
  const onReadingPosition = vi.fn()
  const times = [firstAt, secondAt, '2026-10-23T10:00:00.000Z']
  api.sessionMessages.mockResolvedValue({ ...messagePage('first'), messages: times.map((at, index) => ({ id: 'reading-' + index, turn_id: 'turn', role: 'assistant', text: '阅读消息 ' + index, at, time_precision: 'message', truncated: false })) })
  render(wrap(<SessionDetail api={api} session={session} query="" onBack={vi.fn()} onReadSession={vi.fn()} onLoadTimeline={vi.fn()} onReadingPosition={onReadingPosition} />))
  await screen.findByText('阅读消息 2')
  const body = screen.getByLabelText('会话消息')
  Object.defineProperty(body, 'clientHeight', { configurable: true, value: 100 })
  Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 600 })
  body.getBoundingClientRect = () => ({ top: 0 } as DOMRect)
  document.querySelectorAll('.session-message').forEach((element, index) => {
    element.getBoundingClientRect = () => ({ top: index * 200 - body.scrollTop, bottom: (index + 1) * 200 - body.scrollTop } as DOMRect)
  })
  body.scrollTop = 0
  fireEvent.scroll(body)
  await waitFor(() => expect(onReadingPosition).toHaveBeenLastCalledWith(times[0], 'reading-0'))
  body.scrollTop = 230
  fireEvent.scroll(body)
  await waitFor(() => expect(onReadingPosition).toHaveBeenLastCalledWith(times[1], 'reading-1'))
  expect(api.sessionMessages).toHaveBeenCalledTimes(1)
})

test('the cursor and tooltip follow reading while focused and leave a hover preview without seeking again', async () => {
  vi.useFakeTimers()
  const onSeek = vi.fn()
  const density = (reading: number) => <SessionDensity title="阅读同步" intervals={[]} from={0} to={1000} count={10} complete points={[
    { item_id: 'early', turn_id: 't', role: 'user', at: new Date(100).toISOString() },
    { item_id: 'late', turn_id: 't', role: 'assistant', at: new Date(900).toISOString() },
  ]} selectedAt={new Date(900).toISOString()} selectedItemId="late" readingAt={new Date(reading).toISOString()} onSeek={onSeek} />
  const { rerender } = render(density(900))
  const slider = screen.getByRole('slider')
  slider.getBoundingClientRect = () => ({ left: 0, width: 100 } as DOMRect)
  fireEvent.focus(slider)
  fireEvent.keyDown(slider, { key: 'End' })
  expect(onSeek).toHaveBeenLastCalledWith(new Date(900).toISOString(), 'late')
  onSeek.mockClear()
  rerender(density(400))
  expect(slider).toHaveAttribute('aria-valuenow', '400')
  expect(slider.querySelector('.session-density__cursor')).toHaveStyle({ left: '40%' })
  expect(slider.querySelector('.session-density__reading')).toHaveStyle({ left: '40%' })
  fireEvent.pointerMove(slider, { pointerType: 'mouse', clientX: 80 })
  expect(slider).toHaveAttribute('aria-valuenow', '800')
  expect(slider.querySelector('.session-density__reading')).toHaveStyle({ left: '40%' })
  fireEvent.pointerLeave(slider)
  await act(async () => vi.advanceTimersByTime(200))
  expect(slider).toHaveAttribute('aria-valuenow', '400')
  expect(slider.querySelector('.session-density__cursor')).toHaveStyle({ left: '40%' })
  expect(onSeek).not.toHaveBeenCalled()
})

test('reduced motion positions the message immediately without scheduling animation frames', async () => {
  const { api, wrap } = fixture()
  const scroll = vi.spyOn(Element.prototype, 'scrollTo')
  const detail = (at: string) => wrap(<SessionDetail api={api} session={session} query="" at={at} onBack={vi.fn()} onReadSession={vi.fn()} onLoadTimeline={vi.fn()} />)
  const { rerender } = render(detail(firstAt))
  await screen.findByText('正文')
  const body = screen.getByLabelText('会话消息')
  Object.defineProperty(body, 'clientHeight', { configurable: true, value: 200 })
  Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 2000 })
  body.getBoundingClientRect = () => ({ top: 0 } as DOMRect)
  screen.getByText('正文').closest('.session-message')!.getBoundingClientRect = () => ({ top: 1000 - body.scrollTop, height: 100 } as DOMRect)
  body.scrollTop = 0
  const original = window.matchMedia
  vi.stubGlobal('matchMedia', (query: string) => ({ ...original(query), matches: query === '(prefers-reduced-motion: reduce)' }))
  const frame = vi.spyOn(window, 'requestAnimationFrame')
  rerender(detail(secondAt))
  await waitFor(() => expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'instant', top: 950 })))
  expect(frame).not.toHaveBeenCalled()
  frame.mockRestore()
  scroll.mockRestore()
})

test('every Tree item has exactly title, subtitle and timeline rows without a view switch', async () => {
  window.history.replaceState(null, '', '/?view=sessions')
  const { api, wrap } = fixture()
  render(wrap(<SessionsView api={api} />))
  await screen.findByRole('button', { name: '父会话' })
  expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  const row = document.querySelector('.session-tree__row')!
  expect([...row.children].map(child => child.className)).toEqual(['session-tree__title-row', 'session-tree__workspace-row', 'session-tree__heat'])
  expect(row.querySelector('.session-tree__meta')).toBeNull()
})

test('registered and native children appear only below their main session', async () => {
  window.history.replaceState(null, '', '/?view=sessions')
  const { api, wrap } = fixture()
  const native = { ...session, session_id: 'native', title: '校验服务端权限', native_parent: session, is_subagent: true }
  const registered = { ...session, session_id: 'registered', title: '协作子项' }
  const relation = { id: 'delegation', kind: 'delegation' as const, origin: 'registered' as const, parent: session, child: registered, source: 'test', created_at: null }
  api.sessions.mockResolvedValue({ sessions: [session, registered], relations: [relation], next_cursor: null, search_scope: null, scanned_count: 2 })
  api.sessionChildren.mockImplementation(async ref => ({ sessions: ref.session_id === 'parent' ? [native, registered] : [], relations: [relation], next_cursor: null, search_scope: null, scanned_count: 2 }))
  render(wrap(<SessionsView api={api} />))
  const expand = await screen.findByRole('button', { name: '展开 父会话' })
  expect(document.querySelectorAll('.session-tree__workspace > .session-tree__branch')).toHaveLength(1)
  expect(screen.queryByRole('button', { name: '协作子项' })).not.toBeInTheDocument()
  await userEvent.click(expand)
  expect(await screen.findByRole('button', { name: '校验服务端权限' })).toBeVisible()
  expect(screen.getByRole('button', { name: '协作子项' })).toBeVisible()
  expect(document.querySelectorAll('.session-tree__workspace > .session-tree__branch')).toHaveLength(1)
})

test('fork menus navigate by full provider/store/session identity and dismiss with Escape', async () => {
  window.history.replaceState(null, '', '/?view=sessions&sessions=list')
  const { api, wrap } = fixture()
  const fork = { ...session, session_id: 'fork', title: '替代方案', forked_from: session }
  api.sessions.mockResolvedValue({ sessions: [session, fork], relations: [], next_cursor: null, search_scope: null, scanned_count: 2 })
  render(wrap(<SessionsView api={api} />))
  const trigger = await screen.findByRole('button', { name: '查看派生 Fork：父会话' })
  await userEvent.click(trigger)
  const dialog = await screen.findByRole('dialog', { name: '父会话的派生 Fork' })
  expect(within(dialog).getByRole('button', { name: /替代方案/ })).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '父会话的派生 Fork' })).not.toBeInTheDocument())
  await waitFor(() => expect(trigger).toHaveFocus())
  await userEvent.click(trigger)
  await userEvent.click(within(await screen.findByRole('dialog', { name: '父会话的派生 Fork' })).getByRole('button', { name: /替代方案/ }))
  await waitFor(() => expect(api.readSession).toHaveBeenCalledWith(expect.objectContaining({ provider: 'codex', store_id: 'store', session_id: 'fork' }), expect.any(AbortSignal)))
  expect(screen.queryByRole('dialog', { name: '父会话的派生 Fork' })).not.toBeInTheDocument()
})

test('status precedes titles, branch shares the workspace row and accurate time bounds appear only in the reader subtitle', async () => {
  window.history.replaceState(null, '', '/?view=sessions&sessions=activity')
  const { api, wrap } = fixture()
  render(wrap(<SessionsView api={api} />))
  await userEvent.click(await screen.findByRole('button', { name: '父会话' }))
  await waitFor(() => expect(document.querySelector('.session-detail__subtitle')).toHaveTextContent('–'))
  expect(document.querySelector('.session-detail__subtitle time:first-child')).toHaveAttribute('datetime', session.created_at!)
  expect(document.querySelector('.session-detail__subtitle time:last-child')).toHaveAttribute('datetime', secondAt)
  expect(document.querySelector('.session-tree__row time')).toBeNull()
  expect(document.querySelector('.session-tree__title-row .session-origin')).toBeNull()
  expect(document.querySelector('.session-tree__workspace-row .session-origin__branch')).toHaveTextContent('main')
  expect(document.querySelector('.session-detail__title h2')).toHaveTextContent('父会话')
  expect(api.sessionTimeline.mock.calls.filter(([ref]) => ref.session_id === 'parent')).toHaveLength(1)
})


test('unavailable ancestors never cause an orphaned subagent to appear as a main session', async () => {
  const { api, wrap } = fixture()
  const child = { ...session, title: '孤立子会话', native_parent: { provider: 'codex', store_id: 'store', session_id: 'missing-main' }, is_subagent: true }
  api.sessions.mockResolvedValue({ sessions: [child], relations: [], next_cursor: null, search_scope: null, scanned_count: 1 })
  api.readSession.mockRejectedValue(new DashboardApiError('会话已删除', { code: 'SESSION_BROWSER_SESSION_NOT_FOUND', status: 404 }))
  render(wrap(<SessionsView api={api} />))
  expect(await screen.findByText('父会话暂不可读取')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '孤立子会话' })).not.toBeInTheDocument()
  expect(document.querySelectorAll('.session-tree__workspace > .session-tree__branch')).toHaveLength(0)
})
