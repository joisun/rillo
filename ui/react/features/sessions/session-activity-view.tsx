import { m } from 'motion/react'
import { transition } from '@/lib/motion'
import { ChevronDown, ChevronRight, Folder } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import type { DashboardApi } from '@/lib/api/dashboard-api'
import type { BrowserSession, SessionActivityPage, SessionPage, SessionRef, SessionRelation } from '@/lib/api/types'
import { SessionActivity } from './session-activity'
import { AutoPager } from './session-auto-pager'
import { SessionOrigin } from './session-origin'
import { SessionResumeButton } from './session-resume-button'
import { SessionPinButton } from './session-pins'
import { sessionKey } from './session-format'
import { projectSessionTree, type SessionTreeNode } from './session-projection'
import { SessionChildrenSource } from './session-children'
import { SessionFamilyBadges } from './session-family-badges'
import type { SessionRelationIndex } from './session-projection'
import { compareSessions, sessionStatusGroup, sessionWithStatus, type SessionStatusGroup } from './session-status'

export function SessionActivityView({ api, sessions, relations, relationIndex, knownSessions, onChildren, canResume = true, ancestorState = 'complete', activity, statuses, statusSort, selection, onSelect, onLatest, onReadSession, hasMore = false, loadingMore = false, onMore = () => {}, pinnedOnly = false, pinnedKeys }: {
  pinnedOnly?: boolean; pinnedKeys?: Set<string>
  api: DashboardApi; canResume?: boolean; sessions: BrowserSession[]; relations: SessionRelation[]; ancestorState?: 'pending' | 'unavailable' | 'complete'; relationIndex: SessionRelationIndex; knownSessions: Map<string, BrowserSession>; onChildren: (key: string, pages: SessionPage[]) => void; activity?: SessionActivityPage; statuses: Map<string, BrowserSession>; statusSort: SessionStatusGroup | null
  selection: BrowserSession | null
  onLatest: (session: BrowserSession) => void
  onSelect: (session: BrowserSession) => void
  onReadSession: (ref: SessionRef) => void
  hasMore?: boolean; loadingMore?: boolean; onMore?: () => unknown
}) {
  const [expanded, setExpanded] = useState(new Set<string>())
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
  function renderNode(node: SessionTreeNode, depth: number, lastSibling = false) {
    const session = node.session
    if (!session) return null
    const children = node.children.filter(child => child.session)
    const isExpanded = expanded.has(node.key)
    return <m.div layout="position" transition={transition.standard} className="session-tree__branch" key={node.key}>
      {depth > 0 ? <span className="session-tree__connector" data-last={lastSibling || undefined} aria-hidden="true" style={{ left: 9 + (depth - 1) * 18 }} /> : null}
      <div className="session-tree__row" data-selected={node.key === selectedKey || undefined} data-depth={depth} style={{ marginInlineStart: depth * 18 }}>
        <div className="session-tree__title-row">
          <span className="session-tree__toggle-slot">{children.length ? <button className="session-tree__toggle" type="button" aria-label={(isExpanded ? '折叠 ' : '展开 ') + session.title} aria-expanded={isExpanded} onClick={() => toggle(node.key)}>{isExpanded ? <ChevronDown /> : <ChevronRight />}</button> : null}</span>
          <SessionActivity session={session} />
          <button type="button" className="session-tree__title" title={session.title} aria-pressed={node.key === selectedKey} onClick={() => onSelect(session)}>{session.title}</button>
          <SessionFamilyBadges session={session} index={relationIndex} knownSessions={knownSessions} onReadSession={onReadSession} />
          {node.conflict ? <span className="session-source-error" role="img" aria-label="关系冲突" title="关系冲突，未推断父级">!</span> : null}
          <span className="session-tree__sources">{session.state !== 'unavailable' ? <SessionChildrenSource api={api} session={session} expanded={isExpanded} onData={onChildren} /> : null}</span>
          <SessionPinButton api={api} session={session} />
          {canResume ? <SessionResumeButton api={api} session={session} /> : null}
        </div>
        <div className="session-tree__workspace-row">
          {session.branch ? <span className="session-tree__branch-meta"><SessionOrigin workspace={null} branch={session.branch} /></span> : null}
          {session.workspace ? <SessionOrigin workspace={session.workspace} branch={null} /> : null}
        </div>

      </div>
      {isExpanded ? <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={transition.fast}>{children.map((child, index) => renderNode(child, depth + 1, index === children.length - 1))}</m.div> : null}
    </m.div>
  }
  return <section className="session-activity-view" aria-label="会话列表">
    <header className="session-activity-view__toolbar"><Button size="xs" variant="quiet" disabled={!selection && !sessions.length} onClick={() => { const session = selection ?? sessions[0]; if (session) onLatest(session) }}>最近消息</Button></header>
    <div className="session-activity-view__scroll">
      {[...groups.entries()].map(([path, nodes]) => <div key={path} className="session-tree__workspace">
        <div className="session-tree__group"><Folder /><span className="session-path" title={path}><bdi dir="ltr">{path || '目录未知 / 父会话未载入'}</bdi></span><small>{nodes.length}</small></div>
        {nodes.map(node => renderNode(node, 0))}
      </div>)}
      {roots.length === 0 ? (hasMore || loadingMore || ancestorState === 'pending'
        ? <div className="session-state" aria-busy="true"><span className="session-spinner" aria-label="读取主会话" /></div>
        : <p className="session-state">{ancestorState === 'unavailable' ? '父会话暂不可读取' : pinnedOnly ? '当前范围没有已标记会话' : '当前范围没有可展示的主会话'}</p>) : null}
      <AutoPager enabled={hasMore} loading={loadingMore} onMore={onMore} />
    </div>
  </section>
}
