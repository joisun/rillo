import { expect, test } from 'vitest'
import type { BrowserSession, SessionRef, SessionRelation, SessionTimeline } from '@/lib/api/types'
import { projectSessionTree, secondHeatCells, sessionMessageRange, timeAtPosition } from './session-projection'

function session(id: string, input: Partial<BrowserSession> = {}): BrowserSession {
  return { provider: 'codex', store_id: 'local', session_id: id, title: id, preview: '', workspace: '/project', branch: null,
    created_at: null, updated_at: null, last_active_at: null, native_parent: null, forked_from: null, state: 'idle', ...input }
}
function relation(parent: SessionRef, child: SessionRef, kind: SessionRelation['kind'] = 'delegation'): SessionRelation {
  return { id: `${parent.session_id}-${child.session_id}`, kind, origin: 'registered', parent, child, source: 'test', created_at: null }
}

test('forks stay roots, native and registered children nest, missing parents remain explicit', () => {
  const parent = session('parent')
  const native = session('native', { native_parent: parent })
  const child = session('child')
  const fork = session('fork', { forked_from: parent })
  const missing = session('missing', { native_parent: session('unavailable') })
  const roots = projectSessionTree([parent, native, child, fork, missing], [relation(parent, child), relation(parent, fork, 'fork')])
  expect(roots.map((node) => node.ref.session_id)).toEqual(['parent', 'fork', 'unavailable'])
  expect(roots[0].children.map((node) => node.ref.session_id)).toEqual(['child', 'native'])
  expect(roots[2].session).toBeNull()
  expect(roots[2].children[0].ref.session_id).toBe('missing')
})

test('conflicting parents are not guessed and cyclic relations cannot recurse forever', () => {
  const a = session('a'), b = session('b'), c = session('c')
  const conflict = projectSessionTree([a, b, c], [relation(a, c), relation(b, c)])
  expect(conflict.find((node) => node.ref.session_id === 'c')).toMatchObject({ conflict: true, relation: null })
  const cycle = projectSessionTree([a, b], [relation(a, b), relation(b, a)])
  expect(cycle).toHaveLength(1)
  expect(cycle[0].conflict).toBe(true)
  expect(cycle[0].children).toHaveLength(1)
})

test('each chart uses session creation and the final message, including that message in its last bin', () => {
  const row = session('a', { created_at: new Date(1000).toISOString(), updated_at: new Date(999999).toISOString() })
  const points: NonNullable<SessionTimeline['points']> = [
    { item_id: 'first', turn_id: 'a', role: 'user', at: new Date(1500).toISOString() },
    { item_id: 'last', turn_id: 'b', role: 'assistant', at: new Date(4500).toISOString() },
  ]
  const page: SessionTimeline = { session: row, from: row.created_at, to: points[1].at, points, points_coverage: 'complete', segments: [], anchors: [], next_cursor: null, coverage: 'complete', unplaced_turns: 0,
    bounds: { start_at: row.created_at, end_at: points[1].at, end_state: 'known', indexed_from: row.created_at } }
  const range = sessionMessageRange(row, [page])!
  expect(range.start).toBe(1000)
  expect(range.end).toBe(4500)
  const bins = secondHeatCells(points, range.start, range.end + 1)
  expect(bins.reduce((count, bin) => count + bin.count, 0)).toBe(2)
  expect(bins.at(-1)?.count).toBe(1)
  expect(sessionMessageRange(row, [{ ...page, bounds: { ...page.bounds!, end_at: null, end_state: 'unknown' } }])).toBeNull()
})

test('heat cells count actual one-second buckets and keep long idle gaps sparse', () => {
  const points = [1001, 1999, 2000, 2001, 90_000_000].map(at => ({ at: new Date(at).toISOString() }))
  expect(secondHeatCells(points, 1500, 90_000_001)).toEqual([
    { start: 1000, count: 1 }, { start: 2000, count: 2 }, { start: 90_000_000, count: 1 },
  ])
})

test('position clamps to the chart endpoints', () => {
  expect(timeAtPosition(-10, 0, 100, 1000, 2000)).toBe(1000)
  expect(timeAtPosition(250, 0, 100, 1000, 2000)).toBe(1999)
  expect(timeAtPosition(25, 0, 100, 1000, 2000)).toBe(1250)
})
