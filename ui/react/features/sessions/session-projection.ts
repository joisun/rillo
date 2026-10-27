import type { BrowserSession, SessionPage, SessionRef, SessionRelation, SessionTimeline } from '@/lib/api/types'
import { sessionKey } from './session-format'

export type SessionTreeNode = {
  key: string
  ref: SessionRef
  session: BrowserSession | null
  relation: SessionRelation | null
  conflict: boolean
  children: SessionTreeNode[]
}

export function projectSessionTree(sessions: BrowserSession[], relations: SessionRelation[]) {
  const nodes = new Map<string, SessionTreeNode>(sessions.map((session) => [sessionKey(session), {
    key: sessionKey(session), ref: session, session, relation: null, conflict: false, children: [],
  }]))
  const candidates = new Map<string, Map<string, SessionRelation>>()
  const parentRelations = collectSessionRelations(sessions, relations).filter(relation => relation.kind !== 'fork')
  for (const relation of parentRelations) {
    const childKey = sessionKey(relation.child)
    if (!nodes.has(childKey)) continue
    const parents = candidates.get(childKey) ?? new Map<string, SessionRelation>()
    const parentKey = sessionKey(relation.parent)
    if (!parents.has(parentKey) || relation.origin === 'registered') parents.set(parentKey, relation)
    candidates.set(childKey, parents)
  }
  const parents = new Map<string, string>()
  for (const [childKey, choices] of candidates) {
    const child = nodes.get(childKey)!
    if (choices.size !== 1) { child.conflict = true; continue }
    const relation = [...choices.values()][0]
    const parentKey = sessionKey(relation.parent)
    const seen = new Set([childKey])
    let cursor: string | undefined = parentKey
    while (cursor && !seen.has(cursor)) { seen.add(cursor); cursor = parents.get(cursor) }
    if (cursor) { child.conflict = true; continue }
    parents.set(childKey, parentKey)
    child.relation = relation
    if (!nodes.has(parentKey)) nodes.set(parentKey, { key: parentKey, ref: relation.parent, session: null, relation: null, conflict: false, children: [] })
  }
  for (const [childKey, parentKey] of parents) nodes.get(parentKey)!.children.push(nodes.get(childKey)!)
  return [...nodes.values()].filter(node => node.session && !parents.has(node.key) && !isChildSession(node.session, parentRelations))
}

export function isChildSession(session: BrowserSession, relations: SessionRelation[]) {
  return Boolean(session.is_subagent || session.native_parent || relations.some(relation => relation.kind !== 'fork' && sessionKey(relation.child) === sessionKey(session)))
}

export function collectSessionRelations(sessions: BrowserSession[], relations: SessionRelation[]) {
  const edges = new Map<string, SessionRelation>()
  const native = sessions.flatMap(session => [
    session.native_parent ? { id: `native-parent:${sessionKey(session)}`, kind: 'subagent' as const, parent: session.native_parent, child: session, origin: 'native' as const, source: 'native_parent', created_at: session.created_at } : null,
    session.forked_from ? { id: `native-fork:${sessionKey(session)}`, kind: 'fork' as const, parent: session.forked_from, child: session, origin: 'native' as const, source: 'forked_from', created_at: session.created_at } : null,
  ]).filter((relation): relation is NonNullable<typeof relation> => Boolean(relation))
  for (const relation of [...relations, ...native]) {
    const key = JSON.stringify([relation.kind === 'fork' ? 'fork' : 'parent', sessionKey(relation.parent), sessionKey(relation.child)])
    if (!edges.has(key) || relation.origin === 'registered') edges.set(key, relation)
  }
  return [...edges.values()]
}

export function collectSessionFamily(roots: BrowserSession[], relations: SessionRelation[], childPages: Record<string, SessionPage[]>, ancestors: Record<string, BrowserSession> = {}) {
  const sessions = new Map(roots.map(session => [sessionKey(session), session]))
  const pending = [...sessions.keys()]
  const visited = new Set<string>()
  const edges: SessionRelation[] = []
  const parents = new Map<string, SessionRef[]>()
  const missing = new Map<string, SessionRef>()
  function addRelations(rows: SessionRelation[]) {
    edges.push(...rows)
    for (const relation of rows) {
      if (relation.kind === 'fork') continue
      const key = sessionKey(relation.child)
      parents.set(key, [...(parents.get(key) ?? []), relation.parent])
    }
  }
  addRelations(relations)
  function include(session: BrowserSession) {
    const key = sessionKey(session)
    if (!sessions.has(key)) sessions.set(key, session)
    if (!visited.has(key)) pending.push(key)
  }
  while (pending.length) {
    const key = pending.shift()!
    if (visited.has(key)) continue
    visited.add(key)
    for (const page of childPages[key] ?? []) {
      addRelations(page.relations)
      page.sessions.forEach(include)
    }
    const current = sessions.get(key)!
    const references = [...(parents.get(key) ?? []), ...(current.native_parent ? [current.native_parent] : [])]
    for (const parent of references) {
      const parentKey = sessionKey(parent)
      if (ancestors[parentKey]) include(ancestors[parentKey])
      if (!sessions.has(parentKey)) missing.set(parentKey, parent)
    }
  }
  const rows = [...sessions.values()]
  return { sessions: rows, relations: collectSessionRelations(rows, edges), missingParents: [...missing.values()].filter(ref => !sessions.has(sessionKey(ref))) }
}

export type SessionRelationSummary = { parents: SessionRelation[]; children: SessionRelation[]; forkSources: SessionRelation[]; forks: SessionRelation[] }
export type SessionRelationIndex = Map<string, SessionRelationSummary>

export function indexSessionRelations(relations: SessionRelation[]): SessionRelationIndex {
  const index: SessionRelationIndex = new Map()
  function entry(ref: SessionRef) {
    const key = sessionKey(ref)
    if (!index.has(key)) index.set(key, { parents: [], children: [], forkSources: [], forks: [] })
    return index.get(key)!
  }
  for (const relation of relations) {
    if (relation.kind === 'fork') {
      entry(relation.child).forkSources.push(relation)
      entry(relation.parent).forks.push(relation)
    } else {
      entry(relation.child).parents.push(relation)
      entry(relation.parent).children.push(relation)
    }
  }
  return index
}

export type Interval = { start: number; end: number }
export type MessagePoint = NonNullable<SessionTimeline['points']>[number]

export function sessionMessageRange(session: BrowserSession, pages: SessionTimeline[]) {
  const last = pages.at(-1)
  const bounds = pages.find(page => page.bounds?.end_state === 'known')?.bounds ?? last?.bounds
  const points = [...new Map(pages.toReversed().flatMap(page => page.points ?? []).map(point => [point.item_id, point])).values()]
  const start = Date.parse(bounds?.start_at ?? session.created_at ?? '')
  const end = Date.parse(bounds?.end_at ?? (bounds ? '' : points.toSorted((a, b) => a.at.localeCompare(b.at)).at(-1)?.at ?? ''))
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || !points.length) return null
  const complete = last?.points_coverage === 'complete' && pages.every(page => !page.untimed_messages)
  const indexed = Date.parse(last?.bounds?.indexed_from ?? points.toSorted((a, b) => a.at.localeCompare(b.at))[0].at)
  return { start, end, points, complete, indexedFrom: last?.points_coverage === 'partial' && Number.isFinite(indexed) ? Math.max(start, indexed) : null }
}

// Empty seconds stay implicit, so long idle sessions do not allocate millions of cells.
export function secondHeatCells(points: { at: string }[], from: number, to: number) {
  const cells = new Map<number, number>()
  for (const point of points) {
    const at = Date.parse(point.at)
    if (at >= from && at < to) {
      const second = Math.floor(at / 1000) * 1000
      cells.set(second, (cells.get(second) ?? 0) + 1)
    }
  }
  return [...cells].sort(([a], [b]) => a - b).map(([start, count]) => ({ start, count }))
}

export function nearestMessage(points: MessagePoint[], at: number) {
  let closest: MessagePoint | null = null
  let distance = Infinity
  for (const point of points) {
    const delta = Math.abs(Date.parse(point.at) - at)
    if (delta < distance || (delta === distance && point.at < (closest?.at ?? ''))) { closest = point; distance = delta }
  }
  return closest
}

export function timeAtPosition(x: number, left: number, width: number, from: number, to: number) {
  const fraction = width > 0 ? Math.max(0, Math.min(1, (x - left) / width)) : 0
  return Math.min(to - 1, Math.round(from + fraction * (to - from)))
}
