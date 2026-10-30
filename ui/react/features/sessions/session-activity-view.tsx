import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Folder } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import type { DashboardApi } from '@/lib/api/dashboard-api'
import type { BrowserSession, SessionActivityPage, SessionPage, SessionRef, SessionRelation, SessionTimeline } from '@/lib/api/types'
import { queryKeys } from '@/lib/query/keys'
import { SessionActivity } from './session-activity'
import { AutoPager } from './session-auto-pager'
import { SessionOrigin } from './session-origin'
import { SessionDensity } from './session-density'
import { SessionResumeButton } from './session-resume-button'
import { SessionPinButton } from './session-pins'
import { sessionKey } from './session-format'
import { projectSessionTree, sessionMessageRange, type SessionTreeNode } from './session-projection'
import { sessionReadRequests, type TimelineLoadRequest } from './session-timeline-queue'
import { SessionChildrenSource, useNearViewport } from './session-children'
import { SessionFamilyBadges } from './session-family-badges'
import type { SessionRelationIndex } from './session-projection'
import { compareSessions, sessionStatusGroup, sessionWithStatus, type SessionStatusGroup } from './session-status'

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
    queryFn: ({ pageParam, signal }) => sessionReadRequests.run(() => api.sessionTimeline(session, { cursor: pageParam }, signal), signal, eager ? 'foreground' : 'background'),
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
  return <span ref={anchor} className="session-tree__index-status" aria-busy={timeline.isFetching || undefined}>{timeline.isError ? <span className="session-source-error" role="img" aria-label="时间线暂不可用" title={timeline.error.message}>!</span> : null}</span>
}

export function SessionActivityView({ api, sessions, relations, relationIndex, knownSessions, onChildren, canResume = true, ancestorState = 'complete', activity, statuses, statusSort, selection, at, itemId, readingPosition, onSelect, onSeek, onReadSession, timelineRequest, hasMore = false, loadingMore = false, onMore = () => {}, pinnedOnly = false, pinnedKeys }: {
  pinnedOnly?: boolean; pinnedKeys?: Set<string>
  api: DashboardApi; canResume?: boolean; sessions: BrowserSession[]; relations: SessionRelation[]; ancestorState?: 'pending' | 'unavailable' | 'complete'; relationIndex: SessionRelationIndex; knownSessions: Map<string, BrowserSession>; onChildren: (key: string, pages: SessionPage[]) => void; activity?: SessionActivityPage; statuses: Map<string, BrowserSession>; statusSort: SessionStatusGroup | null; timelineRequest: TimelineLoadRequest | null
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
  const [timelinePages, setTimelinePages] = useState<Record<string, SessionTimeline[]>>({})
  const rememberTimeline = useCallback((key: string, pages: SessionTimeline[]) => setTimelinePages(current => current[key] === pages ? current : { ...current, [key]: pages }), [])
  const allSessions = sessions
  const allRelations = relations
  const roots = useMemo(() => {
    const nodes = projectSessionTree(allSessions.map(session => sessionWithStatus(session, activity, statuses)), allRelations)
    function promote(node: SessionTreeNode): boolean {
      const childMatches = node.children.map(promote).some(Boolean)
      node.children.sort(compareNodes)
      matches.set(node.key, childMatches || Boolean(node.session && sessionStatusGroup(node.session) === statusSort))
      return matches.get(node.key)!
    }
    const matches = new Map<string, boolean>()
    function compareNodes(left: SessionTreeNode, right: SessionTreeNode): number {
      const priority = Number(matches.get(right.key)) - Number(matches.get(left.key))
      return priority || (left.session && right.session ? compareSessions(left.session, right.session, statusSort) : 0)
    }
    nodes.forEach(promote)
    function containsPin(node: SessionTreeNode): boolean { return Boolean(pinnedKeys?.has(node.key)) || node.children.some(containsPin) }
    return nodes.filter(node => !pinnedOnly || containsPin(node)).sort(compareNodes)
  }, [allSessions, allRelations, activity?.available, activity?.store_id, statuses, statusSort, pinnedOnly, pinnedKeys])
  const ranges = useMemo(() => new Map(allSessions.map(session => [sessionKey(session), sessionMessageRange(session, timelinePages[sessionKey(session)] ?? [])])), [allSessions, timelinePages])
  const visibleKeys = new Set<string>()
  const groups = new Map<string, SessionTreeNode[]>()
  for (const root of roots) {
    const path = root.session?.workspace ?? ''
    groups.set(path, [...(groups.get(path) ?? []), root])
  }
  const selectedKey = selection ? sessionKey(selection) : null
  function selectionPath(nodes: SessionTreeNode[]): string[] | null {
    for (const node of nodes) {
      if (node.key === selectedKey) return []
      const path = selectionPath(node.children)
      if (path) return [node.key, ...path]
    }
    return null
  }
  const ancestorKey = JSON.stringify(selectionPath(roots) ?? [])
  useEffect(() => {
    const ancestors: string[] = JSON.parse(ancestorKey)
    if (!ancestors.length) return
    setExpanded(current => ancestors.every(key => current.has(key)) ? current : new Set([...current, ...ancestors]))
  }, [ancestorKey])
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
      const page = await sessionReadRequests.run(() => api.sessionTimeline(session, {}, controller.signal), controller.signal)
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
  function renderNode(node: SessionTreeNode, depth: number) {
    const session = node.session
    if (!session) return null
    visibleKeys.add(node.key)
    const children = node.children.filter(child => child.session)
    const isExpanded = expanded.has(node.key)
    const range = ranges.get(node.key) ?? null
    const pages = timelinePages[node.key] ?? []
    const last = pages.at(-1)
    let unavailable = ''
    if (session.state === 'unavailable') unavailable = '会话暂不可用'
    else if (last?.points_coverage === 'unsupported') unavailable = '此来源没有独立消息时间'
    else if (last?.bounds?.end_state === 'unknown') unavailable = '末条消息时间未知'
    else if (last?.bounds?.end_state === 'empty') unavailable = '会话尚无消息'
    return <div className="session-tree__branch" key={node.key}>
      {depth > 0 ? <span className="session-tree__connector" aria-hidden="true" style={{ left: 9 + (depth - 1) * 18 }} /> : null}
      <div className="session-tree__row" data-selected={node.key === selectedKey || undefined} data-depth={depth} style={{ marginInlineStart: depth * 18 }}>
        <div className="session-tree__title-row">
          <span className="session-tree__toggle-slot">{children.length ? <button className="session-tree__toggle" type="button" aria-label={(isExpanded ? '折叠 ' : '展开 ') + session.title} aria-expanded={isExpanded} onClick={() => toggle(node.key)}>{isExpanded ? <ChevronDown /> : <ChevronRight />}</button> : null}</span>
          <SessionActivity session={session} />
          <button type="button" className="session-tree__title" title={session.title} aria-pressed={node.key === selectedKey} onClick={() => onSelect(session)}>{session.title}</button>
          <SessionFamilyBadges session={session} index={relationIndex} knownSessions={knownSessions} onReadSession={onReadSession} />
          {node.conflict ? <span className="session-source-error" role="img" aria-label="关系冲突" title="关系冲突，未推断父级">!</span> : null}
          <span className="session-tree__sources">{session.state !== 'unavailable' ? <>
            <SessionChildrenSource api={api} session={session} expanded={isExpanded} onData={onChildren} />
            <TimelineSource api={api} session={session} onData={rememberTimeline} eager={node.key === selectedKey || Boolean(timelineRequest && sessionKey(timelineRequest.session) === node.key)} continueSequence={timelineRequest && sessionKey(timelineRequest.session) === node.key ? timelineRequest.sequence : 0} />
          </> : null}</span>
          <SessionPinButton api={api} session={session} />
          {canResume ? <SessionResumeButton api={api} session={session} /> : null}
        </div>
        <div className="session-tree__workspace-row">
          {session.workspace ? <SessionOrigin workspace={session.workspace} branch={null} /> : null}
          {session.branch ? <span className="session-tree__branch-meta"><SessionOrigin workspace={null} branch={session.branch} /></span> : null}
        </div>
        <div className="session-tree__heat">
          {range ? <div className="session-plot" data-from={range.start} data-to={range.end}>
            <SessionDensity title={session.title} intervals={[]} points={range.points} from={range.start} to={range.end + 1} count={64}
              readingAt={node.key === selectedKey && readingPosition?.key === node.key ? readingPosition.at : null}
              selectedAt={node.key === selectedKey ? at : null} selectedItemId={node.key === selectedKey ? itemId : undefined} onSeek={(time, messageId) => onSeek(session, time, true, messageId)}
              complete={range.complete} indexedFrom={range.indexedFrom} />
          </div> : <div className="session-plot session-plot--empty" role="img" aria-label={unavailable || '时间轴读取中'} />}
        </div>
      </div>
      {isExpanded ? children.map(child => renderNode(child, depth + 1)) : null}
    </div>
  }
  return <section className="session-activity-view" aria-label="活跃时间轴">
    <header className="session-activity-view__toolbar"><Button size="xs" variant="quiet" isPending={focusingLatest} onPress={() => void focusLatest()}>最近消息</Button></header>
    {latestError ? <p className="session-error" role="alert">{latestError}</p> : null}
    <div className="session-activity-view__scroll">
      {[...groups.entries()].map(([path, nodes]) => <div key={path} className="session-tree__workspace">
        <div className="session-tree__group"><Folder /><span className="session-path" title={path}><bdi dir="ltr">{path || '目录未知 / 父会话未载入'}</bdi></span><small>{nodes.length}</small></div>
        {nodes.map(node => renderNode(node, 0))}
      </div>)}
      {roots.length === 0 ? (hasMore || loadingMore || ancestorState === 'pending'
        ? <div className="session-state" aria-busy="true"><span className="session-spinner" aria-label="读取主会话" /></div>
        : <p className="session-state">{ancestorState === 'unavailable' ? '父会话暂不可读取' : pinnedOnly ? '当前范围没有已标记会话' : '当前范围没有可展示的主会话'}</p>) : null}
      {timelineRequest && !visibleKeys.has(sessionKey(timelineRequest.session)) ? <TimelineSource api={api} session={timelineRequest.session} onData={rememberTimeline} continueSequence={timelineRequest.sequence} eager /> : null}
      <AutoPager enabled={hasMore} loading={loadingMore} onMore={onMore} />
    </div>
  </section>
}
