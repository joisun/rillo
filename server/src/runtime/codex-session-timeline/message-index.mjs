import { sessionBrowserError } from '../../session-reference.mjs'
import { messageTimestamp } from '../codex-message-timing.mjs'

const PAGE_SIZE = 100
const PAGE_BUDGET = 3

function visible(entry) { return ['userMessage', 'agentMessage'].includes(entry.item?.type) }
function owned(metadata, point) { return !metadata.forked_from || !metadata.created_at || point.at >= metadata.created_at }
function reusable(value) { return value?.complete && value.scanCursor === null && value.indexedFrom && value.headDone }

export function createCodexMessageIndex({ request, clock = Date.now, hydrateEntries = async (_metadata, entries) => entries, historyRevision = async () => null }) {
  const indexes = new Map()
  let snapshotSequence = 0
  function index(metadata) {
    let value = indexes.get(metadata.session_id)
    if (!value || value.expires < clock() || value.updated !== metadata.updated_at) {
      const previous = value && value.expires >= clock() ? value : null
      const anchors = previous?.anchors ?? new Map()
      value = { updated: metadata.updated_at, expires: clock() + 300_000, pages: new Map(), points: new Map(), anchors, untimed: new Set(), complete: false, headCursor: null, headDone: false, latest: null, scanCursor: null, indexedFrom: null, previous: reusable(previous) ? previous : null, revision: null, snapshot: null }
      indexes.set(metadata.session_id, value)
      if (indexes.size > 50) indexes.delete(indexes.keys().next().value)
    }
    value.expires = clock() + 300_000
    return value
  }

  function observeHead(current, cursor, value) {
    if (current.headDone || cursor !== current.headCursor) return
    if (value.firstMessage) { current.latest = value.firstMessage; current.headDone = true }
    else { current.headCursor = value.next; current.headDone = value.next === null }
  }

  function bounds(metadata) {
    const current = index(metadata)
    return { start_at: metadata.created_at, end_at: current.latest?.at ?? null,
      end_state: !current.headDone ? 'pending' : current.latest ? current.latest.at ? 'known' : 'unknown' : 'empty', indexed_from: current.indexedFrom }
  }

  async function page(metadata, cursor, includeBody = false, refresh = false) {
    const current = index(metadata)
    const key = cursor ?? ''
    if (!includeBody && !refresh && current.pages.has(key)) {
      const value = current.pages.get(key)
      observeHead(current, cursor, value)
      return value
    }
    const result = await request('thread/items/list', { threadId: metadata.session_id, cursor, limit: PAGE_SIZE, sortDirection: 'desc' })
    if (!Array.isArray(result?.data) || (result.nextCursor != null && typeof result.nextCursor !== 'string') || (result.nextCursor != null && result.nextCursor === cursor)) {
      throw sessionBrowserError('SESSION_BROWSER_READ_FAILED', 'Codex 返回了无效的消息时间分页', 502)
    }
    const entries = await hydrateEntries(metadata, result.data)
    const points = []
    let earliest = null
    let firstMessage = null
    for (const entry of entries) {
      const at = messageTimestamp(entry)
      if (at && (!earliest || at < earliest)) earliest = at
      if (!visible(entry) || typeof entry.item.id !== 'string' || typeof entry.turnId !== 'string') continue
      if (!at) { current.untimed.add(entry.item.id); firstMessage ??= { at: null, item_id: entry.item.id }; continue }
      const point = { item_id: entry.item.id, turn_id: entry.turnId, role: entry.item.type === 'userMessage' ? 'user' : 'assistant', at, cursor }
      if (!owned(metadata, point)) continue
      firstMessage ??= { at, item_id: entry.item.id }
      current.untimed.delete(point.item_id)
      current.points.set(point.item_id, point)
      current.anchors.set(point.item_id, point)
      points.push(point)
    }
    if (current.points.size > 50_000 || current.anchors.size > 50_000 || current.pages.size >= 1024) throw sessionBrowserError('SESSION_TIMELINE_LIMIT', '本次会话消息索引超过上限', 409)
    const next = result.nextCursor ?? null
    if (next === null) current.complete = true
    const value = { points, earliest, next, firstMessage }
    current.pages.set(key, value)
    if (cursor === null) { current.headCursor = null; current.headDone = false; current.latest = null }
    observeHead(current, cursor, value)
    return includeBody ? { ...value, entries } : value
  }

  async function timeline(metadata, { from, to, cursor = null }) {
    const current = index(metadata)
    if (cursor?.startsWith('cached:')) return snapshotPage(current, from, to, cursor)
    const previous = cursor === null ? current.previous ?? (reusable(current) ? { ...current, points: new Map(current.points), untimed: new Set(current.untimed) } : null) : null
    let revision = null
    if (previous?.revision) revision = await historyRevision(metadata, previous.revision)
    if (previous) {
      current.previous = null
      current.points.clear(); current.pages.clear(); current.untimed.clear()
      current.complete = false; current.indexedFrom = null; current.scanCursor = null; current.snapshot = null
    }
    const points = []
    let next = cursor
    let indexedFrom = null
    try {
      for (let count = 0; count < PAGE_BUDGET; count += 1) {
        const batch = await page(metadata, next, false, next === null)
        if (batch.earliest && (!indexedFrom || batch.earliest < indexedFrom)) indexedFrom = batch.earliest
        if (next === current.scanCursor) {
          if (batch.earliest && (!current.indexedFrom || batch.earliest < current.indexedFrom)) current.indexedFrom = batch.earliest
          current.scanCursor = batch.next
        }
        points.push(...batch.points.filter((point) => point.at >= from && point.at < to).map(({ cursor: _, ...point }) => point))
        next = batch.next
        const oldLatest = previous?.latest?.item_id ? previous.points.get(previous.latest.item_id) : null
        const overlap = oldLatest ? current.points.get(oldLatest.item_id) : null
        if (revision?.preserves && oldLatest && overlap && !previous.untimed.size && overlap.at === oldLatest.at && overlap.turn_id === oldLatest.turn_id && overlap.role === oldLatest.role) {
          current.points = new Map([...previous.points, ...current.points])
          if (current.points.size > 50_000) throw sessionBrowserError('SESSION_TIMELINE_LIMIT', '本次会话消息索引超过上限', 409)
          current.complete = true
          current.scanCursor = null
          current.indexedFrom = previous.indexedFrom
          current.revision = revision
          current.snapshot = { token: String(++snapshotSequence), points: [...current.points.values()].sort((a, b) => b.at.localeCompare(a.at) || a.item_id.localeCompare(b.item_id)) }
          return snapshotPage(current, from, to)
        }
        if (next === null || (batch.earliest && batch.earliest < from)) { next = null; break }
      }
    } catch (error) {
      if (error.code !== 'SESSION_BROWSER_UNSUPPORTED') throw error
      return { points: [], next_cursor: null, points_coverage: 'unsupported', untimed_messages: 0 }
    }
    if (reusable(current)) current.revision = revision ?? await historyRevision(metadata)
    return { points: [...new Map(points.map((point) => [point.item_id, point])).values()], next_cursor: next, points_coverage: next ? 'partial' : 'complete', untimed_messages: current.untimed.size, indexed_from: indexedFrom }
  }

  function snapshotPage(current, from, to, cursor = null) {
    const parts = cursor?.split(':')
    const offset = parts ? Number(parts[2]) : 0
    if (!current.snapshot || parts && (parts[1] !== current.snapshot.token || parts.length !== 3 || !Number.isSafeInteger(offset) || offset < 0)) {
      throw sessionBrowserError('SESSION_TIMELINE_INCOMPLETE', '会话时间线已更新，请重新读取', 409)
    }
    const all = current.snapshot.points.filter(point => point.at >= from && point.at < to)
    const points = all.slice(offset, offset + PAGE_SIZE * PAGE_BUDGET).map(({ cursor: _, ...point }) => point)
    const next = offset + points.length
    return { points, next_cursor: next < all.length ? `cached:${current.snapshot.token}:${next}` : null,
      points_coverage: next < all.length ? 'partial' : 'complete', untimed_messages: current.untimed.size, indexed_from: points.at(-1)?.at ?? null }
  }

  async function locate(metadata, at, itemId) {
    if (metadata.forked_from && metadata.created_at && at < metadata.created_at) return { point: null, state: 'before_start' }
    const current = index(metadata)
    let next = null
    let covered = false
    for (let count = 0; count < PAGE_BUDGET; count += 1) {
      const batch = await page(metadata, next)
      next = batch.next
      if (next === null || (batch.earliest && batch.earliest <= at)) { covered = true; break }
    }
    if (!itemId && !covered && !(current.indexedFrom && at >= current.indexedFrom)) throw sessionBrowserError('SESSION_TIMELINE_INCOMPLETE', '此消息时间尚未读取完整', 409)
    const points = [...current.points.values()].sort((a, b) => b.at.localeCompare(a.at) || a.item_id.localeCompare(b.item_id))
    const point = itemId ? points.find(entry => entry.item_id === itemId) ?? current.anchors.get(itemId) : points.find((entry) => entry.at <= at)
    if (point) return { point, state: 'ready' }
    if (!current.complete && next !== null) throw sessionBrowserError('SESSION_TIMELINE_INCOMPLETE', '此消息时间尚未读取完整，请继续加载时间线', 409)
    if (itemId) throw sessionBrowserError('SESSION_BROWSER_READ_FAILED', '所选消息已变化，请刷新后重新定位', 409)
    return { point: null, state: points.length && !current.untimed.size ? 'before_start' : 'unavailable' }
  }

  return {
    timeline,
    bounds,
    async read(metadata, { cursor = null, at = null, itemId = null } = {}) {
      let target = null
      if (at && !cursor) {
        const location = await locate(metadata, at, itemId)
        target = location.point
        if (!target) return { entries: [], target: null, next: null, state: location.state }
        cursor = target.cursor
      }
      let batch = await page(metadata, cursor, true)
      if (target && !batch.entries.some(entry => entry.item?.id === target.item_id)) {
        // A growing native page can shift an older cursor. Pin the selected item
        // by its native turn and item IDs; never silently select its neighbour.
        const result = await request('thread/items/read', { threadId: metadata.session_id, turnId: target.turn_id, itemIds: [target.item_id] })
        const entries = await hydrateEntries(metadata, result?.data ?? [])
        const entry = entries.find(entry => visible(entry) && entry.item.id === target.item_id && entry.turnId === target.turn_id)
        if (!entry || !messageTimestamp(entry)) throw sessionBrowserError('SESSION_BROWSER_READ_FAILED', '所选消息暂不可用', 409)
        batch = { ...batch, entries: [entry, ...batch.entries].sort((a, b) => (messageTimestamp(b) ?? '').localeCompare(messageTimestamp(a) ?? '')) }
        target = { ...target, at: messageTimestamp(entry) }
      } else if (target) target = index(metadata).points.get(target.item_id) ?? target
      for (let count = 1; !target && !batch.entries.some(visible) && batch.next && count < PAGE_BUDGET; count += 1) batch = await page(metadata, batch.next, true)
      return { entries: batch.entries, target, next: batch.next, state: 'ready' }
    },
    clear() { indexes.clear() },
  }
}
