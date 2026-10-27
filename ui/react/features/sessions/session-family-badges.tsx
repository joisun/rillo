import { CornerUpLeft, GitFork, Network } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Popover } from '@/components/ui/popover'
import type { BrowserSession, SessionRef, SessionRelation } from '@/lib/api/types'
import { sessionKey } from './session-format'
import type { SessionRelationIndex } from './session-projection'

function relatedTitle(ref: SessionRef, knownSessions: Map<string, BrowserSession>) {
  return knownSessions.get(sessionKey(ref))?.title ?? ref.session_id.slice(0, 8)
}

function RelatedSessions({ session, relations, kind, knownSessions, onReadSession }: {
  session: BrowserSession; relations: SessionRelation[]; kind: 'children' | 'forks'
  knownSessions: Map<string, BrowserSession>; onReadSession: (ref: SessionRef) => void
}) {
  if (!relations.length) return null
  const label = kind === 'children' ? '子会话' : '派生 Fork'
  const Icon = kind === 'children' ? Network : GitFork
  return <Dialog>
    <Button className="session-family__count" size="xs" variant="quiet" aria-label={`查看${label}：${session.title}`}><Icon /><span title={`当前已发现的${label}，继续浏览会自动补充`}>{relations.length}</span></Button>
    <Popover className="session-family-popover" placement="bottom start" offset={5}>
      <DialogContent aria-label={`${session.title}的${label}`}>
        {({ close }) => <>
          <strong className="session-family-popover__heading">{label} <span>{relations.length}</span></strong>
          <ul>{relations.map(relation => {
            const target = relation.child
            const known = knownSessions.get(sessionKey(target))
            return <li key={sessionKey(target)}><button type="button" title={sessionKey(target)} onClick={() => { close(); onReadSession(target) }}><span>{relatedTitle(target, knownSessions)}</span><small>{known?.workspace ?? '点击读取会话'} · {relation.kind === 'fork' ? 'Fork' : relation.kind === 'subagent' ? 'Subagent' : '协作子会话'}</small></button></li>
          })}</ul>
        </>}
      </DialogContent>
    </Popover>
  </Dialog>
}

export function SessionFamilyBadges({ session, index, knownSessions, onReadSession }: {
  session: BrowserSession; index: SessionRelationIndex; knownSessions: Map<string, BrowserSession>
  onReadSession: (ref: SessionRef) => void
}) {
  const relations = index.get(sessionKey(session))
  if (!relations) return null
  return <span className="session-family">
    {relations.parents.map(relation => <button className="session-family__link" type="button" key={sessionKey(relation.parent)} aria-label={`查看父会话：${relatedTitle(relation.parent, knownSessions)}`} title={`${relation.kind === 'subagent' ? '原生 Subagent' : '已登记的协作子会话'} · ${sessionKey(relation.parent)}`} onClick={() => onReadSession(relation.parent)}><CornerUpLeft /><span>{relation.kind === 'subagent' ? 'Subagent' : '协作'}</span></button>)}
    {relations.forkSources.map(relation => {
      const timestamp = session.provider === 'codex' ? session.created_at : null
      const at = timestamp && Date.parse(timestamp) > 0 ? new Date(timestamp).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null
      const label = `forked from ${relatedTitle(relation.parent, knownSessions)}${at ? ` at ${at}` : ''}`
      return <button className="session-family__link session-family__link--fork" type="button" key={sessionKey(relation.parent)} aria-label="查看 fork 来源" title={`${label}${at ? '（原生 fork 会话创建时间）' : ''} · ${sessionKey(relation.parent)}`} onClick={() => onReadSession(relation.parent)}><GitFork /><span className="session-fork-prefix">forked from </span><span className="session-fork-origin">{relatedTitle(relation.parent, knownSessions)}</span>{at ? <time className="session-fork-time" dateTime={timestamp!}> at {at}</time> : null}</button>
    })}
    <RelatedSessions session={session} relations={relations.children} kind="children" knownSessions={knownSessions} onReadSession={onReadSession} />
    <RelatedSessions session={session} relations={relations.forks} kind="forks" knownSessions={knownSessions} onReadSession={onReadSession} />
  </span>
}
