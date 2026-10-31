import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { Button } from '@/components/ui/button'
import { DashboardApiError, type DashboardApi } from '@/lib/api/dashboard-api'
import type { BrowserSession, SessionMessagesPage, SessionRef, SessionRelation, SessionTimeline } from '@/lib/api/types'
import { queryKeys } from '@/lib/query/keys'
import { Highlight } from './session-format'
import { SessionDensity } from './session-density'
import { sessionMessageRange } from './session-projection'
import { AutoPager } from './session-auto-pager'
import { SessionRelations } from './session-relations'
import { SessionResumeButton } from './session-resume-button'
import { SessionPinButton } from './session-pins'
import { SessionActivity } from './session-activity'
import { sessionReadRequests } from './session-timeline-queue'

const SEEK_SCROLL_MS = 100

export function SessionDetail({ api, session, knownSessions, knownRelations, query, onBack, canResume = true, at = null, itemId, followRequest = 0, onReadingPosition, onReadSession, onLoadTimeline, onSeek, active = true }: {
  api: DashboardApi
  canResume?: boolean
  active?: boolean
  onSeek?: (at: string, itemId?: string) => void
  session: BrowserSession
  knownSessions?: Map<string, BrowserSession>
  knownRelations?: SessionRelation[]
  query: string
  onBack: () => void
  at?: string | null
  itemId?: string
  followRequest?: number
  onReadSession: (ref: SessionRef) => void
  onLoadTimeline: () => void
  onReadingPosition?: (at: string, itemId: string) => void
}) {
  const client = useQueryClient()
  const [readingAt, setReadingAt] = useState<string | null>(null)
  const [viewport, setViewport] = useState<{ from: string; to: string } | null>(null)
  const timeline = useInfiniteQuery({
    queryKey: queryKeys.sessionTimeline(session, 'session', session.updated_at ?? ''),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => sessionReadRequests.run(() => api.sessionTimeline(session, { cursor: pageParam }, signal), signal),
    getNextPageParam: (page: SessionTimeline) => page.next_cursor ?? undefined,
    enabled: active, retry: false, staleTime: 60_000, gcTime: 300_000, refetchOnWindowFocus: false,
  })
  const timelinePages = timeline.data?.pages ?? []
  const range = useMemo(() => sessionMessageRange(session, timeline.data?.pages ?? []), [timeline.data, session.provider, session.store_id, session.session_id, session.created_at])
  useEffect(() => {
    if (active && timeline.hasNextPage && !timeline.isFetching && !timeline.isError) void timeline.fetchNextPage()
  }, [active, timeline.hasNextPage, timeline.isFetching, timeline.isError, timeline.fetchNextPage, timeline.data?.pages.length])
  useEffect(() => {
    if (!timeline.dataUpdatedAt || timeline.isFetching) return
    void client.invalidateQueries({ queryKey: ['dashboard', 'session-browser', session.provider, session.store_id, session.session_id, 'messages'], predicate: query => query.state.error !== null })
  }, [timeline.dataUpdatedAt, timeline.isFetching, client, session.provider, session.store_id, session.session_id])
  const syncedTime = useRef('')
  const repairedPosition = useRef('')
  const [locateMatch, setLocateMatch] = useState(Boolean(query))
  const [copyStatus, setCopyStatus] = useState('')
  const matchedMessage = useRef<HTMLDivElement>(null)
  const conversation = useRef<HTMLDivElement>(null)
  const scrollFrame = useRef<number | null>(null)
  const seekFrame = useRef<number | null>(null)
  const readingCallback = useRef(onReadingPosition)
  readingCallback.current = onReadingPosition
  const openedRecent = useRef(false)
  const olderPosition = useRef<{ message: HTMLElement; top: number } | null>(null)
  const [following, setFollowing] = useState(true)
  const pausedAt = useRef<string | null>(null)
  const pausedItem = useRef<string | undefined>(undefined)
  const [position, setPosition] = useState({ at, itemId })
  const seekAt = at ? (following ? at : pausedAt.current) : null
  const seekItem = at ? (following ? itemId : pausedItem.current) : undefined
  const requestAt = at ? position.at : null
  const requestItem = at ? position.itemId : undefined
  const search = !at && locateMatch ? query : ''
  useEffect(() => { setLocateMatch(Boolean(query)); setFollowing(true) }, [query, followRequest])
  const history = useInfiniteQuery({
    queryKey: queryKeys.sessionMessages(session.provider, session.store_id, session.session_id, search, requestAt ?? '', requestItem ?? ''),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => api.sessionMessages(session, { cursor: pageParam, query: search, ...(requestAt ? { at: requestAt, ...(requestItem ? { item_id: requestItem } : {}) } : {}), limit: 5 }, signal),
    getNextPageParam: (page: SessionMessagesPage) => page.next_cursor ?? undefined,
    gcTime: 0,
    retry: false,
    placeholderData: (previous) => previous,
  })
  const pages = history.data?.pages ?? []
  const current = pages[0]?.session ?? session
  const match = pages[0]?.match
  const seek = pages[0]?.seek
  useEffect(() => {
    if (requestAt !== seekAt || requestItem !== seekItem || !(history.error instanceof DashboardApiError) || history.error.code !== 'SESSION_TIMELINE_INCOMPLETE') return
    const key = `${seekAt}:${seekItem}`
    if (repairedPosition.current === key) return
    repairedPosition.current = key
    onLoadTimeline()
  }, [history.error, seekAt, seekItem, requestAt, requestItem, onLoadTimeline])
  useEffect(() => {
    if (!following || requestAt !== seekAt || history.isPlaceholderData || !seekItem || seek?.item_id !== seekItem || !seek.at || seek.at === seekAt) return
    const value = seekItem + ':' + seek.at
    if (syncedTime.current === value) return
    syncedTime.current = value
    void client.invalidateQueries({ queryKey: ['dashboard', 'session-browser', session.provider, session.store_id, session.session_id, 'timeline'] })
  }, [client, following, requestAt, history.isPlaceholderData, seekItem, seek?.item_id, seek?.at, seekAt, session.provider, session.store_id, session.session_id])
  const messages = [...new Map(pages.toReversed().flatMap((page) => page.messages)
    .map((message) => [`${message.turn_id}:${message.id}`, message])).values()]
  const localTarget = seekAt ? messages.find(message => message.at === seekAt && (!seekItem || message.id === seekItem)) : null
  const requestedTarget = requestAt === seekAt && requestItem === seekItem && !history.isPlaceholderData ? seek : null
  const localMatch = localTarget ? { item_id: localTarget.id, turn_id: localTarget.turn_id } : null
  const located = seekAt ? localMatch ?? requestedTarget : match
  useEffect(() => {
    if (!following || !seekAt || localTarget || history.isFetching || requestAt === seekAt && requestItem === seekItem) return
    // Finish the current page, then read the latest missing target. Moving the
    // pointer must not repeatedly cancel a page before it can become useful.
    setPosition({ at: seekAt, itemId: seekItem })
  }, [following, seekAt, seekItem, Boolean(localTarget), history.isFetching, requestAt, requestItem])

  const reportReadingPosition = useCallback(() => {
    scrollFrame.current = null
    const body = conversation.current
    if (!body || body.clientHeight === 0) return
    const elements = [...body.querySelectorAll<HTMLElement>('.session-message[data-at]')]
    if (!elements.length) return
    const center = body.getBoundingClientRect().top + body.clientHeight / 2
    const distance = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect()
      return Math.max(rect.top - center, center - rect.bottom, 0)
    }
    let visible = elements.reduce((best, element) => distance(element) < distance(best) ? element : best)
    if (body.scrollTop <= 1) visible = elements[0]
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 1) visible = elements.at(-1)!
    if (visible.dataset.at && visible.dataset.itemId) {
      const at = visible.dataset.at
      setReadingAt(current => current === at ? current : at)
      readingCallback.current?.(at, visible.dataset.itemId)
    }
    const rect = body.getBoundingClientRect()
    const inView = elements.filter(element => { const box = element.getBoundingClientRect(); return box.bottom >= rect.top && box.top <= rect.bottom })
    const from = inView[0]?.dataset.at, to = inView.at(-1)?.dataset.at
    if (from && to) setViewport(current => current?.from === from && current.to === to ? current : { from, to })
  }, [])

  function onScroll() {
    if (scrollFrame.current === null) scrollFrame.current = requestAnimationFrame(reportReadingPosition)
  }
  useEffect(() => () => { if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current) }, [])

  useLayoutEffect(() => {
    const body = conversation.current, message = matchedMessage.current
    if (!located || !following || history.isPlaceholderData && !localTarget || !body || !message) return
    const rect = message.getBoundingClientRect()
    const offset = body.scrollTop + rect.top - body.getBoundingClientRect().top - (body.clientHeight - Math.min(rect.height, body.clientHeight)) / 2
    const top = Math.max(0, Math.min(body.scrollHeight - body.clientHeight, offset))
    if (Math.abs(body.scrollTop - top) < 1 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      body.scrollTo({ top, behavior: 'instant' })
      reportReadingPosition()
      return
    }
    const origin = body.scrollTop, started = performance.now()
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / SEEK_SCROLL_MS)
      body.scrollTo({ top: origin + (top - origin) * (1 - (1 - progress) ** 3), behavior: 'instant' })
      if (progress < 1) seekFrame.current = requestAnimationFrame(step)
      else { seekFrame.current = null; reportReadingPosition() }
    }
    seekFrame.current = requestAnimationFrame(step)
    return () => { if (seekFrame.current !== null) { cancelAnimationFrame(seekFrame.current); seekFrame.current = null } }
  }, [located?.item_id, located?.turn_id, seekAt, following, history.isPlaceholderData, followRequest])

  useLayoutEffect(() => {
    const body = conversation.current
    if (!body || history.isPlaceholderData || history.isFetchingNextPage) return
    if (olderPosition.current) {
      const { message, top } = olderPosition.current
      if (message.isConnected) body.scrollTop += message.getBoundingClientRect().top - top
      olderPosition.current = null
    } else if (!at && !search && !openedRecent.current && messages.length) {
      body.scrollTop = body.scrollHeight
      openedRecent.current = true
    }
    reportReadingPosition()
  }, [history.data, history.isFetchingNextPage, history.isPlaceholderData, at, search, messages.length])

  function loadOlder() {
    if (seekFrame.current !== null) { cancelAnimationFrame(seekFrame.current); seekFrame.current = null }
    const body = conversation.current
    if (body) {
      const top = body.getBoundingClientRect().top
      const message = [...body.querySelectorAll<HTMLElement>('.session-message')].find((element) => element.getBoundingClientRect().bottom > top)
      if (message) olderPosition.current = { message, top: message.getBoundingClientRect().top }
    }
    return history.fetchNextPage()
  }

  function pauseFollowing() {
    if (seekFrame.current !== null) { cancelAnimationFrame(seekFrame.current); seekFrame.current = null }
    if (!at || !following) return
    pausedAt.current = seekAt
    pausedItem.current = seekItem
    const body = conversation.current
    if (body) body.scrollTo({ top: body.scrollTop, behavior: 'instant' })
    setFollowing(false)
  }

  useEffect(() => {
    if (!copyStatus) return
    const timeout = window.setTimeout(() => setCopyStatus(''), 1600)
    return () => window.clearTimeout(timeout)
  }, [copyStatus])

  async function copyId() {
    try {
      await navigator.clipboard.writeText(session.session_id)
      setCopyStatus('已复制')
    } catch {
      setCopyStatus('复制失败')
    }
  }

  return (
    <section className="session-detail" aria-label="会话预览">
      <header className="session-detail__header">
        <div className="session-detail__heading">
          <div className="session-detail__identity"><div className="session-detail__title"><SessionActivity session={session} /><h2 title={current.title}>{current.title}</h2></div><SessionTimeRange pages={timelinePages} /></div>
          <div className="session-detail__tools">
            <SessionPinButton api={api} session={current} />
            {canResume ? <SessionResumeButton api={api} session={{ ...current, state: session.state }} /> : null}
            <span title={copyStatus || session.session_id}><Button size="xs" variant="quiet" isIconOnly aria-label="复制 Session ID" onClick={() => void copyId()}>{copyStatus === '已复制' ? <Check /> : <Copy />}</Button></span>
            <SessionRelations api={api} session={current} knownSessions={knownSessions} knownRelations={knownRelations} onReadSession={onReadSession} />
          <Button className="session-detail__close" size="xs" variant="quiet" isIconOnly aria-label="关闭对话" onClick={onBack}><X /></Button>
          </div>
        </div>
        {copyStatus ? <span className="sr-only" role="status">{copyStatus}</span> : null}
      </header>
      <div className="session-detail__body">
      <div ref={conversation} className="session-detail__conversation" tabIndex={0} aria-label="会话消息" onScroll={onScroll} onWheel={pauseFollowing} onTouchMove={pauseFollowing} onPointerDown={pauseFollowing} onKeyDown={(event) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) pauseFollowing() }}>
        {search ? (
          <div className="session-match-notice">
            <span>{match ? '已定位首处正文命中' : history.isPending ? '正在定位正文…' : '未找到可定位的正文，显示最近对话'}</span>
            <Button size="xs" variant="quiet" onClick={() => setLocateMatch(false)}>查看最近对话</Button>
          </div>
        ) : null}
        <AutoPager enabled={Boolean(history.hasNextPage) && !history.isError && !history.isPlaceholderData} loading={history.isFetching} onMore={loadOlder} />
        {history.isPending ? <span className="session-spinner" role="status" aria-label="读取会话" /> : null}
        {history.isError && !(history.error instanceof DashboardApiError && history.error.code === 'SESSION_TIMELINE_INCOMPLETE') ? <div className="session-state session-error" role="alert">{history.error.message}</div> : null}
        {pages.some((page) => page.truncated) ? <p className="session-notice">本页内容较多，部分消息未展示。</p> : null}
        {!history.isPending && !history.isError && !history.hasNextPage && messages.length === 0 ? <div className="session-state">{seek?.state === 'before_start' ? '此时间之前还没有消息。' : '暂无可展示的文字消息。'}</div> : null}
        {messages.map((message) => (
          <div className="session-message" data-at={message.at ?? undefined} data-item-id={message.id} data-match={(message.id === located?.item_id && message.turn_id === located?.turn_id) || undefined} key={`${message.turn_id}:${message.id}`} ref={message.id === located?.item_id && message.turn_id === located?.turn_id ? matchedMessage : undefined}>
            <span className="session-message__role">{message.role === 'user' ? '你' : session.provider}<time dateTime={message.at ?? undefined}>{message.at ? new Date(message.at).toLocaleString('zh-CN') : '时间未知'}{message.time_precision === 'turn' ? ' · 轮次级' : ''}</time></span>
            <Message from={message.role}>
              <MessageContent>
                {message.id === match?.item_id ? <div className="session-message__match"><Highlight text={message.text} query={search} /></div>
                  : <MessageResponse mode="static">{message.text}</MessageResponse>}
              </MessageContent>
            </Message>
            {message.truncated ? <p className="session-notice">这条消息仅展示节选。</p> : null}
          </div>
        ))}
      </div>
      <aside className="session-minimap" aria-label="会话时间地图">
        <div className="session-minimap__track" aria-busy={timeline.isFetching || undefined}>
          {range ? <SessionDensity title={current.title} intervals={[]} points={range.points} from={range.start} to={range.end + 1} count={64} complete={range.complete} indexedFrom={range.indexedFrom} selectedAt={at} selectedItemId={itemId} readingAt={readingAt} viewport={viewport} onSeek={active ? onSeek : undefined} />
            : <span className="session-minimap__state" role="status" title={timeline.isError ? '时间轴不可用' : timeline.isPending || timeline.isFetching ? '读取时间轴…' : '暂无时间点'}><span aria-hidden="true">{timeline.isError ? '!' : timeline.isPending || timeline.isFetching ? '…' : '—'}</span><span className="sr-only">{timeline.isError ? '时间轴不可用' : timeline.isPending || timeline.isFetching ? '读取时间轴…' : '暂无时间点'}</span></span>}
        </div>
      </aside>
      </div>
    </section>
  )
}

function SessionTimeRange({ pages }: { pages: SessionTimeline[] }) {
  const bounds = pages.find(page => page.bounds?.end_state === 'known')?.bounds
  const format = (at: string) => new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return <div className="session-detail__subtitle">
    {bounds?.start_at && bounds.end_at ? <><time dateTime={bounds.start_at} title="会话开始">{format(bounds.start_at)}</time><span>–</span><time dateTime={bounds.end_at} title="最后一条消息">{format(bounds.end_at)}</time></> : null}
    <span className="session-timeline-legend" aria-label="时间轴消息颜色"><span data-role="user">用户</span><span data-role="assistant">Agent</span></span>
  </div>
}
