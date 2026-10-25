import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Folder, GitFork } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import type { DashboardApi } from '@/lib/api/dashboard-api'
import type { BrowserSession, SessionPage, SessionRef, SessionRelation, SessionTimeline } from '@/lib/api/types'
import { queryKeys } from '@/lib/query/keys'
import { SessionActivity } from './session-activity'
import { AutoPager } from './session-auto-pager'
import { SessionOrigin } from './session-origin'
import { SessionDensity } from './session-density'
import { SessionResumeButton } from './session-resume-button'
import { sessionKey, workspaceName } from './session-format'
import { projectSessionTree, sessionMessageRange, type SessionTreeNode } from './session-projection'
import { createTimelineRequestQueue, type TimelineLoadRequest } from './session-timeline-queue'

const timelineRequests = createTimelineRequestQueue()

function useNearViewport() {
  const anchor = useRef<HTMLSpanElement>(null)
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (!anchor.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setSeen(entry.isIntersecting), { rootMargin: '120px' })
    observer.observe(anchor.current)
    return () => observer.disconnect()
  }, [])
  return { anchor, seen }
}

function ChildrenSource({ api, session, onData, expanded }: { api: DashboardApi; session: BrowserSession; expanded: boolean; onData: (key: string, pages: SessionPage[]) => void }) {
  const client = useQueryClient()
  const { anchor, seen } = useNearViewport()
  const children = useInfiniteQuery({
    queryKey: queryKeys.sessionChildren(session), initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => timelineRequests.run(() => api.sessionChildren(session, { cursor: pageParam }, signal), signal, expanded ? 'foreground' : 'background'),
    getNextPageParam: (page) => page.next_cursor ?? undefined, retry: false, enabled: seen || expanded, staleTime: 60_000, gcTime: 300_000, refetchOnWindowFocus: false,
  })
  useEffect(() => { if (!seen && !expanded) void client.cancelQueries({ queryKey: queryKeys.sessionChildren(session), exact: true }) }, [seen, expanded, client, session])
  useLayoutEffect(() => { if (children.data) onData(sessionKey(session), children.data.pages) }, [children.data, session, onData])
  useEffect(() => { if ((seen || expanded) && children.hasNextPage && !children.isFetching && !children.isError) void children.fetchNextPage() }, [seen, expanded, children.hasNextPage, children.isFetching, children.isError, children.fetchNextPage])
  return <span ref={anchor} className="session-tree__loading" aria-busy={children.isFetching || undefined} />
}

function TimelineSource({ api, session, onData, continueSequence = 0, eager = false }: {
  api: DashboardApi; session: BrowserSession
  onData: (key: string, pages: SessionTimeline[]) => void
  continueSequence?: number
  eager?: boolean
}) {
  const client = useQueryClient()
  const handledSequence = useRef(0)
  const { anchor, seen } = useNearViewport()
  const timeline = useInfiniteQuery({
    queryKey: queryKeys.sessionTimeline(session, 'session', session.updated_at ?? ''), initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => timelineRequests.run(() => api.sessionTimeline(session, { cursor: pageParam }, signal), signal, eager ? 'foreground' : 'background'),
    getNextPageParam: (page) => page.next_cursor ?? undefined, enabled: seen || eager, retry: false, staleTime: 60_000, gcTime: 300_000, refetchOnWindowFocus: false,
  })
  useEffect(() => { if (!seen && !eager) void client.cancelQueries({ queryKey: queryKeys.sessionTimeline(session, 'session', session.updated_at ?? ''), exact: true }) }, [seen, eager, client, session])
  useLayoutEffect(() => { if (timeline.data) onData(sessionKey(session), timeline.data.pages) }, [timeline.data, session, onData])
  useEffect(() => {
    if (timeline.isFetching) return
    if (continueSequence > handledSequence.current) {
      handledSequence.current = continueSequence
      if (timeline.hasNextPage && !timeline.isError) void timeline.fetchNextPage()
      else void timeline.refetch()
      return
    }
    if ((seen || eager) && timeline.hasNextPage && !timeline.isFetching && !timeline.isError) void timeline.fetchNextPage()
  }, [seen, eager, timeline.hasNextPage, timeline.isFetching, timeline.isError, timeline.fetchNextPage, timeline.refetch, timeline.data?.pages.length, continueSequence])
  useEffect(() => {
    if (!timeline.dataUpdatedAt || timeline.isFetching) return
    void client.invalidateQueries({ queryKey: ['dashboard', 'session-browser', session.provider, session.store_id, session.session_id, 'messages'], predicate: (query) => query.state.error !== null })
  }, [timeline.dataUpdatedAt, timeline.isFetching, client, session.provider, session.store_id, session.session_id])
  return <span ref={anchor} className="session-tree__index-status" aria-busy={timeline.isFetching || undefined} />
}

export function SessionActivityView({ api, sessions, relations, openIds, presenceSource, selection, at, itemId, readingPosition, onSelect, onSeek, onReadSession, timelineRequest, hasMore = false, loadingMore = false, onMore = () => {} }: {
  api: DashboardApi; sessions: BrowserSession[]; relations: SessionRelation[]; openIds: Set<string>
  presenceSource: { provider: string; store_id: string }; timelineRequest: TimelineLoadRequest | null
  selection: BrowserSession | null; at: string | null; itemId?: string
  readingPosition?: { key: string; at: string; itemId: string } | null
  onSelect: (session: BrowserSession) => void
  onSeek: (session: BrowserSession, at: string, resumeFollowing?: boolean, itemId?: string) => void
  onReadSession: (ref: SessionRef) => void
  hasMore?: boolean; loadingMore?: boolean; onMore?: () => unknown
}) {
  const client = useQueryClient()
  const [expanded, setExpanded] = useState(new Set<string>())
  const [focusingLatest, setFocusingLatest] = useState(false)
  const [latestError, setLatestError] = useState('')
  const latestRequest = useRef<AbortController | null>(null)
  useEffect(() => () => latestRequest.current?.abort(), [])
  const [childPages, setChildPages] = useState<Record<string, SessionPage[]>>({})
  const [timelinePages, setTimelinePages] = useState<Record<string, SessionTimeline[]>>({})
  const rememberChildren = useCallback((key: string, pages: SessionPage[]) => setChildPages(current => current[key] === pages ? current : { ...current, [key]: pages }), [])
  const rememberTimeline = useCallback((key: string, pages: SessionTimeline[]) => setTimelinePages(current => current[key] === pages ? current : { ...current, [key]: pages }), [])
  const allSessions = useMemo(() => [...new Map([...sessions, ...Object.values(childPages).flatMap(pages => pages.flatMap(page => page.sessions))].map(session => [sessionKey(session), session])).values()], [sessions, childPages])
  const allRelations = useMemo(() => [...new Map([...relations, ...Object.values(childPages).flatMap(pages => pages.flatMap(page => page.relations))].map(relation => [relation.id, relation])).values()], [relations, childPages])
  const roots = useMemo(() => projectSessionTree(allSessions, allRelations), [allSessions, allRelations])
  const ranges = useMemo(() => new Map(allSessions.map(session => [sessionKey(session), sessionMessageRange(session, timelinePages[sessionKey(session)] ?? [])])), [allSessions, timelinePages])
  const visibleKeys = new Set<string>()
  const groups = new Map<string, SessionTreeNode[]>()
  for (const root of roots) {
    const path = root.session?.workspace ?? ''
    groups.set(path, [...(groups.get(path) ?? []), root])
  }
  const selectedKey = selection ? sessionKey(selection) : null
  function toggle(key: string) {
    setExpanded(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })
  }
  async function focusLatest() {
    const session = selection ?? sessions[0]
    if (!session) return
    latestRequest.current?.abort()
    const controller = new AbortController()
    latestRequest.current = controller
    setFocusingLatest(true)
    setLatestError('')
    try {
      const page = await timelineRequests.run(() => api.sessionTimeline(session, {}, controller.signal), controller.signal)
      if (controller.signal.aborted) return
      const pages = [page]
      client.setQueryData(queryKeys.sessionTimeline(session, 'session', session.updated_at ?? ''), { pages, pageParams: [null] })
      rememberTimeline(sessionKey(session), pages)
      const latest = page.bounds ? page.bounds.end_at : page.points?.toSorted((a, b) => a.at.localeCompare(b.at)).at(-1)?.at
      if (latest) onSeek(session, latest, true, page.points?.find(point => point.at === latest)?.item_id)
      else onSelect(session)
    } catch (error) {
      if (!controller.signal.aborted) setLatestError(error instanceof Error ? error.message : '无法读取最近消息')
    } finally {
      if (!controller.signal.aborted) setFocusingLatest(false)
    }
  }
  function formatTime(value: number) {
    return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  function renderNode(node: SessionTreeNode, depth: number) {
    visibleKeys.add(node.key)
    const session = node.session
    const isExpanded = expanded.has(node.key)
    const hasChildren = node.children.length > 0
    const pages = timelinePages[node.key] ?? []
    const last = pages.at(-1)
    const range = ranges.get(node.key) ?? null
    const fork = session?.forked_from ?? allRelations.find(relation => relation.kind === 'fork' && sessionKey(relation.child) === node.key)?.parent
    let emptyLabel = ''
    if (!session || session.state === 'unavailable') emptyLabel = '会话引用未载入或暂不可用'
    else if (last?.points_coverage === 'unsupported') emptyLabel = '此来源没有独立消息时间'
    else if (last?.bounds?.end_state === 'unknown') emptyLabel = '末条消息时间未知'
    else if (last?.bounds?.end_state === 'empty') emptyLabel = '会话尚无消息'
    else if (last && !session.created_at) emptyLabel = '会话开始时间未知'
    return <div className="session-tree__branch" key={node.key}>
      <div className="session-tree__row" data-selected={node.key === selectedKey || undefined}>
        <div className="session-tree__label" style={{ paddingInlineStart: 10 + depth * 16 }}>
          <span className="session-tree__toggle-slot">{hasChildren ? <button className="session-tree__toggle" type="button" aria-label={(isExpanded ? '折叠 ' : '展开 ') + (session?.title ?? node.ref.session_id)} aria-expanded={isExpanded} onClick={() => toggle(node.key)}>{isExpanded ? <ChevronDown /> : <ChevronRight />}</button> : null}</span>
          <div className="session-tree__identity">
            <div className="session-tree__title-row">
              {session ? <button type="button" className="session-tree__title" title={session.title} aria-pressed={node.key === selectedKey} onClick={() => onSelect(session)}>{session.title}</button>
                : <button type="button" className="session-tree__missing" title={node.key} onClick={() => onReadSession(node.ref)}>父会话未载入 · {node.ref.session_id}</button>}
              {session ? <SessionActivity state={session.state} isOpen={session.provider === presenceSource.provider && session.store_id === presenceSource.store_id && openIds.has(session.session_id)} /> : null}
              {range ? <span className="session-plot__bounds"><time dateTime={new Date(range.start).toISOString()} title={'会话开始：' + new Date(range.start).toLocaleString('zh-CN')}>{formatTime(range.start)}</time><span>–</span><time dateTime={new Date(range.end).toISOString()} title={'最后一条消息：' + new Date(range.end).toLocaleString('zh-CN')}>{formatTime(range.end)}</time></span> : null}
              {session ? <SessionResumeButton api={api} session={session} /> : null}
            </div>
            {session ? <SessionOrigin workspace={session.workspace} branch={session.branch} /> : null}
            <div className="session-tree__meta">
              {node.relation ? <span>{node.relation.origin === 'registered' ? '登记父子' : '原生 subagent'}</span> : null}
              {node.conflict ? <span className="session-error">关系冲突，未推断父级</span> : null}
              {fork ? <button type="button" className="session-tree__fork" aria-label="查看 fork 来源" onClick={() => onReadSession(fork)}><GitFork />fork 来源</button> : null}
              {session && session.state !== 'unavailable' ? <>
                <ChildrenSource api={api} session={session} expanded={isExpanded} onData={rememberChildren} />
                <TimelineSource api={api} session={session} onData={rememberTimeline} eager={Boolean(timelineRequest && sessionKey(timelineRequest.session) === node.key)} continueSequence={timelineRequest && sessionKey(timelineRequest.session) === node.key ? timelineRequest.sequence : 0} />
              </> : null}
            </div>
          </div>
        </div>
        <div className="session-tree__heat" style={{ paddingInlineStart: 37 + depth * 16 }}>
          {range ? <div className="session-plot" data-from={range.start} data-to={range.end}>
            <SessionDensity title={session?.title ?? '会话'} intervals={[]} points={range.points} from={range.start} to={range.end + 1} count={64}
              readingAt={node.key === selectedKey && readingPosition?.key === node.key ? readingPosition.at : null}
              selectedAt={node.key === selectedKey ? at : null} selectedItemId={node.key === selectedKey ? itemId : undefined} onSeek={session ? (time, messageId) => onSeek(session, time, true, messageId) : undefined}
              complete={range.complete} indexedFrom={range.indexedFrom} />
          </div> : <div className="session-plot session-plot--empty" role="status">{emptyLabel}</div>}
        </div>
      </div>
      {isExpanded ? node.children.map(child => renderNode(child, depth + 1)) : null}
    </div>
  }
  return <section className="session-activity-view" aria-label="活跃时间轴">
    <header className="session-activity-view__toolbar"><Button size="xs" variant="quiet" isPending={focusingLatest} onPress={() => void focusLatest()}>最近消息</Button></header>
    {latestError ? <p className="session-error" role="alert">{latestError}</p> : null}
    <div className="session-activity-view__scroll">
      {[...groups.entries()].map(([path, nodes]) => <div key={path} className="session-tree__workspace">
        <div className="session-tree__group"><Folder /><span title={path}>{path ? workspaceName(path) : '目录未知 / 父会话未载入'}</span><small>{nodes.length}</small></div>
        {nodes.map(node => renderNode(node, 0))}
      </div>)}
      {roots.length === 0 ? <p className="session-state">尚未载入会话</p> : null}
      {timelineRequest && !visibleKeys.has(sessionKey(timelineRequest.session)) ? <TimelineSource api={api} session={timelineRequest.session} onData={rememberTimeline} continueSequence={timelineRequest.sequence} eager /> : null}
      <AutoPager enabled={hasMore} loading={loadingMore} onMore={onMore} />
    </div>
  </section>
}
