import { sessionBrowserError } from '../session-reference.mjs'
import { createCodexMessageIndex } from './codex-session-timeline/message-index.mjs'
import { messageTimestamp } from './codex-message-timing.mjs'

export function codexTimestamp(value, unit = 1000) {
  if (!Number.isFinite(value)) return null
  const result = new Date(value * unit)
  return Number.isNaN(result.valueOf()) ? null : result.toISOString()
}

function turnTime(turn) {
  const start = codexTimestamp(turn.startedAt)
  let end = codexTimestamp(turn.completedAt)
  if (!end && start && turn.status !== 'inProgress' && Number.isFinite(turn.durationMs) && turn.durationMs >= 0) {
    end = codexTimestamp(Date.parse(start) + turn.durationMs, 1)
  }
  return { start, end }
}

export function createCodexSessionTimeline({ request, readSession, clock = Date.now, hydrateEntries, historyRevision }) {
  const indexes = new Map()
  const messageIndex = createCodexMessageIndex({ request, clock, hydrateEntries, historyRevision })
  function index(metadata) {
    let current = indexes.get(metadata.session_id)
    if (!current || current.expires < clock()) {
      current = { updated: metadata.updated_at, expires: clock() + 300_000, turns: new Map(), pages: new Map(), complete: false, coveredFrom: Infinity }
      indexes.delete(metadata.session_id)
      indexes.set(metadata.session_id, current)
      if (indexes.size > 50) indexes.delete(indexes.keys().next().value)
    } else if (current.updated !== metadata.updated_at) {
      // Appending a turn must not discard already indexed historical seek positions.
      current.updated = metadata.updated_at
      current.pages.delete('')
    }
    return current
  }

  async function page(sessionId, current, cursor) {
    const key = cursor ?? ''
    if (current.pages.has(key)) return current.pages.get(key)
    const result = await request('thread/turns/list', {
      threadId: sessionId, cursor, limit: 5, sortDirection: 'desc', itemsView: 'notLoaded',
    })
    if (!Array.isArray(result?.data) || (result.nextCursor != null && typeof result.nextCursor !== 'string')
      || (result.nextCursor != null && result.nextCursor === cursor)) {
      throw sessionBrowserError('SESSION_BROWSER_READ_FAILED', 'Codex 返回了无效的时间分页', 502)
    }
    const next = result.nextCursor ?? null
    const rows = result.data.map((turn) => ({ ...turn, ...turnTime(turn), cursor: cursor ?? null }))
    for (const turn of rows) current.turns.set(turn.id, turn)
    if (current.turns.size > 5000) throw sessionBrowserError('SESSION_TIMELINE_LIMIT', '本次会话时间索引超过上限，请缩小范围', 409)
    const value = { rows, next }
    current.pages.set(key, value)
    if (next === null) current.complete = true
    return value
  }

  function owned(metadata, turn) {
    return !metadata.forked_from || !turn.start || !metadata.created_at || turn.start >= metadata.created_at
  }

  async function turnTimeline(sessionId, { from, to, cursor = null }, metadata) {
    const current = index(metadata)
    const segments = []
    const anchors = []
    const seen = new Set()
    let next = cursor
    let complete = false
    let unplaced = 0
    try {
      for (let count = 0; count < 3; count += 1) {
        const batch = await page(sessionId, current, next)
        for (const turn of batch.rows) {
          if (seen.has(turn.id) || !owned(metadata, turn)) continue
          seen.add(turn.id)
          if (!turn.start || !turn.end || turn.end < turn.start || turn.status === 'inProgress') {
            unplaced += 1
          } else if (turn.start < to && turn.end >= from) {
            segments.push({ turn_id: turn.id, start: turn.start < from ? from : turn.start, end: turn.end > to ? to : turn.end, status: turn.status })
          }
          if (turn.start && turn.start < to && (!turn.end || turn.end >= from)) anchors.push({ turn_id: turn.id, at: turn.start, cursor: turn.cursor })
        }
        next = batch.next
        const earliest = batch.rows.filter((turn) => turn.start).map((turn) => turn.start).sort()[0]
        if (next === null || (earliest && earliest < from)) {
          complete = true
          current.coveredFrom = Math.min(current.coveredFrom, Date.parse(from))
          next = null
          break
        }
      }
    } catch (error) {
      if (error.code !== 'SESSION_BROWSER_UNSUPPORTED') throw error
      return { session: metadata, segments: [], anchors: [], next_cursor: null, coverage: 'unsupported', from, to, unplaced_turns: 0 }
    }
    return { session: metadata, segments, anchors, next_cursor: next, coverage: complete ? 'complete' : 'partial', from, to, unplaced_turns: unplaced }
  }

  async function locate(metadata, at) {
    const current = index(metadata)
    const time = Date.parse(at)
    if (metadata.created_at && metadata.forked_from && at < metadata.created_at) {
      return { cursor: null, turn: null, state: 'before_start' }
    }
    if (!current.pages.has('')) await page(metadata.session_id, current, null)
    let candidates = [...current.turns.values()].filter((turn) => turn.start && owned(metadata, turn))
    let next = null
    for (let count = 0; count < 3; count += 1) {
      const earliest = candidates.reduce((minimum, turn) => Math.min(minimum, Date.parse(turn.start)), Infinity)
      if (current.complete || current.coveredFrom <= time || earliest <= time) break
      const batch = await page(metadata.session_id, current, next)
      next = batch.next
      candidates = [...current.turns.values()].filter((turn) => turn.start && owned(metadata, turn))
      if (next === null) break
    }
    candidates.sort((a, b) => b.start.localeCompare(a.start))
    const found = candidates.find((turn) => turn.start <= at)
    const earliest = candidates.at(-1)
    if (!found && !current.complete && current.coveredFrom > time
      && (!earliest || earliest.start > at)) {
      throw sessionBrowserError('SESSION_TIMELINE_INCOMPLETE', '该时间段尚未读取完整，请继续加载活跃时间轴', 409)
    }
    return { cursor: found?.cursor ?? null, turn: found ?? null, state: found ? 'ready' : candidates.length ? 'before_start' : 'unavailable' }
  }

  async function itemTimes(sessionId, turnId, at) {
    try {
      const result = await request('thread/items/list', { threadId: sessionId, turnId, limit: 100, sortDirection: 'asc' })
      if (!Array.isArray(result?.data)) return null
      const rows = result.data.filter((entry) => ['userMessage', 'agentMessage'].includes(entry.item?.type))
        .map((entry) => ({ id: entry.item.id, at: messageTimestamp(entry) }))
      const timed = rows.filter((entry) => entry.at).sort((a, b) => a.at.localeCompare(b.at))
      const selected = timed.filter((entry) => entry.at <= at).at(-1)
      // A partial producer page cannot prove the last preceding message.
      const exact = !result.nextCursor || timed.some((entry) => entry.at > at)
      return { rows, selected: exact ? selected ?? null : null }
    } catch (error) {
      if (error.code !== 'SESSION_BROWSER_UNSUPPORTED') throw error
      return null
    }
  }

  async function timeline(sessionId, { from = null, to = null, cursor = null }) {
    const metadata = await readSession(sessionId)
    const wholeSession = !from && !to
    const queryFrom = from ?? metadata.created_at ?? '0001-01-01T00:00:00.000Z'
    const queryTo = to ?? '9999-12-31T23:59:59.999Z'
    let positions = { turn: wholeSession ? false : cursor, message: null, message_unsupported: false }
    if (cursor?.startsWith('density:')) {
      try {
        positions = JSON.parse(Buffer.from(cursor.slice(8), 'base64url').toString('utf8'))
        if (!['turn', 'message'].every((key) => positions[key] === false || positions[key] === null || typeof positions[key] === 'string')) throw new Error('cursor')
      } catch { throw sessionBrowserError('SESSION_BROWSER_INPUT_INVALID', '会话时间分页位置无效') }
    }
    if (wholeSession) positions.turn = false
    const [turns, messages] = await Promise.all([
      positions.turn === false ? { segments: [], anchors: [], coverage: 'complete', next_cursor: null, unplaced_turns: 0 }
        : turnTimeline(sessionId, { from: queryFrom, to: queryTo, cursor: positions.turn }, metadata),
      positions.message === false ? { points: [], points_coverage: positions.message_unsupported ? 'unsupported' : 'complete', next_cursor: null, untimed_messages: 0 }
        : messageIndex.timeline(metadata, { from: queryFrom, to: queryTo, cursor: positions.message }),
    ])
    const coverage = [...(wholeSession ? [] : [turns.coverage]), messages.points_coverage].filter((value) => value !== 'unsupported')
    const next = { turn: turns.next_cursor ?? false, message: messages.next_cursor ?? false, message_unsupported: messages.points_coverage === 'unsupported' }
    const messageBounds = { ...messageIndex.bounds(metadata), indexed_from: messages.indexed_from ?? null }
    return { ...turns, session: metadata, from: wholeSession ? messageBounds.start_at : from, to: wholeSession ? messageBounds.end_at : to,
      bounds: messageBounds, scope: wholeSession ? 'session' : 'window', points: messages.points, points_coverage: messages.points_coverage, untimed_messages: messages.untimed_messages,
      coverage: coverage.includes('partial') ? 'partial' : coverage.length ? 'complete' : 'unsupported',
      next_cursor: next.turn !== false || next.message !== false ? 'density:' + Buffer.from(JSON.stringify(next)).toString('base64url') : null }
  }

  return { timeline, locate, itemTimes, messagePage: messageIndex.read, clear() { indexes.clear(); messageIndex.clear() } }
}
