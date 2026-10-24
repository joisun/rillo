import type { BrowserSession, SessionRef, SessionRelation, SessionTimeline } from '@/lib/api/types'
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
  const parentRelations = relations.filter((relation) => relation.kind !== 'fork')
  for (const session of sessions) {
    if (!session.native_parent) continue
    parentRelations.push({ id: `native:${sessionKey(session)}`, parent: session.native_parent, child: session,
      kind: 'subagent', origin: 'native', created_at: null, source: 'native_parent' })
  }
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
  return [...nodes.values()].filter((node) => !parents.has(node.key))
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
