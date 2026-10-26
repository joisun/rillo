import { Search } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'

import type { DashboardApi } from '@/lib/api/dashboard-api'
import type { BrowserSession } from '@/lib/api/types'
import { SessionActivity } from './session-activity'
import { AutoPager } from './session-auto-pager'
import { activityDay, activityTime, sessionKey } from './session-format'
import { SessionOrigin } from './session-origin'
import { SessionResumeButton } from './session-resume-button'

export function SessionCardsView({ api, sessions, selection, openIds, active, pending, hasMore, loadingMore, onSelect, onMore }: {
  api: DashboardApi; sessions: BrowserSession[]; selection: BrowserSession | null
  openIds: Set<string>; active: boolean; pending: boolean; hasMore: boolean; loadingMore: boolean
  onSelect: (session: BrowserSession) => void
  onMore: () => unknown
}) {
  const scroll = useRef<HTMLElement>(null)
  const selectedCard = useRef<HTMLElement | null>(null)
  const handledSelection = useRef<string | null | undefined>(undefined)
  const selectedKey = selection ? sessionKey(selection) : null
  useLayoutEffect(() => {
    const container = scroll.current, card = selectedCard.current
    if (!active || !container?.clientHeight || selectedKey === handledSelection.current) return
    handledSelection.current = selectedKey
    if (!card?.isConnected) return
    const bounds = container.getBoundingClientRect(), rect = card.getBoundingClientRect()
    if (rect.top < bounds.top + 12) container.scrollTop += rect.top - bounds.top - 12
    else if (rect.bottom > bounds.bottom - 12) container.scrollTop += rect.bottom - bounds.bottom + 12
  }, [active, selectedKey])

  return <section ref={scroll} className="session-cards" aria-label="会话卡片" aria-busy={pending || loadingMore || undefined}>
    {pending ? <span className="session-spinner" role="status" aria-label="读取会话" /> : null}
    {!pending && !sessions.length ? <div className="session-state"><Search /><strong>这里还没有会话</strong></div> : null}
    <div className="session-cards__grid">
      {sessions.map(session => {
        const key = sessionKey(session)
        const selected = key === selectedKey
        const preview = session.preview.trim()
        const time = session.last_active_at
        return <article className="session-card" key={key} data-selected={selected || undefined} ref={selected ? selectedCard : undefined}>
          <button type="button" className="session-card__select" aria-label={`查看会话：${session.title}`} aria-pressed={selected} onClick={() => onSelect(session)}>
            <span className="session-card__meta">
              <time dateTime={time ?? undefined} title={time ? new Date(time).toLocaleString('zh-CN') : undefined}>{time ? `${activityDay(time)} · ${activityTime(time)}` : '时间未知'}</time>
              <SessionActivity state={session.state} isOpen={openIds.has(session.session_id)} />
            </span>
            <strong className="session-card__title" title={session.title}>{session.title}</strong>
            <span className="session-card__preview">{preview !== session.title ? preview : ''}</span>
            <SessionOrigin workspace={session.workspace} branch={session.branch} />
          </button>
          <SessionResumeButton api={api} session={session} />
        </article>
      })}
    </div>
    <AutoPager enabled={active && hasMore} loading={loadingMore} onMore={onMore} />
  </section>
}
