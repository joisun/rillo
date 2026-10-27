import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { sessionBrowserError } from '../../session-reference.mjs'
import { createCodexAppServerClient } from '../codex-app-server-client.mjs'
import { createCodexSessionStatus } from '../codex-session-status.mjs'
import { codexTimestamp, createCodexSessionTimeline } from '../codex-session-timeline.mjs'
import { messageTimestamp } from '../codex-message-timing.mjs'
import { createCodexRolloutTiming } from '../codex-rollout-timing.mjs'
import { createSessionMetadata } from './codex-sessions/metadata.mjs'
import { createCodexRolloutHistory } from '../codex-rollout-history.mjs'

const SOURCES = ['cli', 'vscode', 'appServer', 'exec']
const MESSAGE_LIMIT = 16 * 1024
const SEARCH_PAGE_BUDGET = 3
const IDLE_MS = 45_000

function timestamp(value) {
  if (!Number.isFinite(value)) return null
  const date = new Date(value * 1000)
  return Number.isNaN(date.valueOf()) ? null : date.toISOString()
}

function bounded(value, maximum) {
  return typeof value === 'string' ? value.slice(0, maximum) : ''
}

function nativePage(response) {
  if (!Array.isArray(response?.data)
    || (response.nextCursor != null && typeof response.nextCursor !== 'string')) {
    throw sessionBrowserError('SESSION_BROWSER_READ_FAILED', 'Codex returned an invalid page', 502)
  }
  return { data: response.data, cursor: response.nextCursor ?? null }
}

export function createCodexSessionAdapter({
  resolveLaunch,
  createClient = createCodexAppServerClient,
  dataRoot = process.env.CODEX_HOME ?? join(homedir(), '.codex'),
  onChange,
  clock,
  watchImpl,
  createStatusClient,
} = {}) {
  const root = resolve(dataRoot)
  const storeId = createHash('sha256').update(root).digest('hex').slice(0, 20)
  const status = createCodexSessionStatus({ dataRoot: root, createClient: createStatusClient, onChange, clock })
  let connection = null
  let idleTimer = null
  let activeRequests = 0
  let closed = false
  let repairClient = null
  const metadataPages = createSessionMetadata({ load: listPage, reconcile, dataRoot: root, onChange, clock, watchImpl })
  const rolloutPaths = new WeakMap()
  const rolloutTiming = createCodexRolloutTiming({ dataRoot: root, resolvePath: metadata => rolloutPaths.get(metadata) })
  const historyRevision = createCodexRolloutHistory({ dataRoot: root, resolvePath: metadata => rolloutPaths.get(metadata) })
  const timeIndex = createCodexSessionTimeline({ request, readSession, hydrateEntries: rolloutTiming.hydrate, historyRevision })

  function closeConnection(expected = connection) {
    if (connection !== expected) return
    const previous = connection
    connection = null
    clearTimeout(idleTimer)
    idleTimer = null
    previous?.then((client) => client.close()).catch(() => {})
  }

  async function connected() {
    if (closed) throw sessionBrowserError('SESSION_BROWSER_UNAVAILABLE', 'Session browser is closed', 503)
    if (!connection) {
      connection = (async () => {
        const launch = await resolveLaunch()
        const client = createClient({
          executable: launch.executable,
          cwd: homedir(),
          env: { CODEX_HOME: root },
          requestTimeoutMs: 20_000,
          maximumLineBytes: 8 * 1024 * 1024,
        })
        try {
          await client.started
          await client.request('initialize', {
            clientInfo: { name: 'tasks-recorder-sessions', version: '0.1.0' },
            capabilities: { experimentalApi: true },
          })
          client.notify('initialized')
          client.onNotification?.(({ method }) => {
            if (/^(thread\/(?:started|archived|unarchived|name\/updated|status\/changed)|turn\/completed)$/.test(method)) metadataPages.changed()
          })
          return client
        } catch (error) {
          client.close()
          throw error
        }
      })()
    }
    return connection
  }

  async function reconcile() {
    const launch = await resolveLaunch()
    if (closed) return
    // Log repair is slow and must not serialize interactive reads behind it.
    const client = createClient({ executable: launch.executable, cwd: homedir(), env: { CODEX_HOME: root }, requestTimeoutMs: 20_000, maximumLineBytes: 8 * 1024 * 1024 })
    repairClient = client
    try {
      await client.started
      await client.request('initialize', { clientInfo: { name: 'tasks-recorder-session-repair', version: '0.1.0' }, capabilities: { experimentalApi: true } })
      client.notify('initialized')
      for (const archived of [false, true]) nativePage(await client.request('thread/list', {
        cursor: null, limit: 100, archived, sortKey: 'recency_at', sortDirection: 'desc', useStateDbOnly: false,
      }))
    } catch {
      throw sessionBrowserError('SESSION_BROWSER_UNAVAILABLE', 'Codex 历史索引核验失败，请稍后重试。', 503)
    } finally {
      client.close()
      if (repairClient === client) repairClient = null
    }
  }

  async function listPage(params) {
    const result = nativePage(await request('thread/list', { ...params, useStateDbOnly: true }))
    if (result.cursor !== null && result.cursor === params.cursor) throw sessionBrowserError('SESSION_BROWSER_READ_FAILED', 'Codex returned a repeated cursor', 502)
    return { sessions: result.data.map(row => ({ ...session(row), snippet: null })).filter(row => !params.cwd || row.workspace === params.cwd), next_cursor: result.cursor, scanned_count: result.data.length, search_scope: null }
  }

  async function request(method, params) {
    activeRequests += 1
    clearTimeout(idleTimer)
    let attempt = null
    try {
      const pendingClient = connected()
      attempt = connection
      const client = await pendingClient
      return await client.request(method, params)
    } catch (error) {
      if (error.code?.startsWith('SESSION_BROWSER_')) throw error
      if (error.code === 'RUNTIME_PROTOCOL_METHOD_UNAVAILABLE') {
        throw sessionBrowserError('SESSION_BROWSER_UNSUPPORTED', '当前 Codex 版本不支持此会话能力，请更新 Codex。正文搜索没有降级为标题搜索。', 501)
      }
      closeConnection(attempt)
      const timeout = error.code === 'RUNTIME_PROTOCOL_TIMEOUT'
      throw sessionBrowserError('SESSION_BROWSER_UNAVAILABLE', timeout
        ? 'Codex 查询超时，请缩小搜索范围或稍后重试。'
        : '无法读取本机 Codex 会话，请确认 Codex CLI 和数据目录可用。', timeout ? 504 : 503)
    } finally {
      activeRequests -= 1
      if (activeRequests === 0) {
        idleTimer = setTimeout(closeConnection, IDLE_MS)
        idleTimer.unref?.()
      }
    }
  }

  function session(thread) {
    if (typeof thread?.id !== 'string' || !thread.id) {
      throw sessionBrowserError('SESSION_BROWSER_READ_FAILED', 'Codex returned an invalid session', 502)
    }
    const preview = bounded(thread.preview, 2000)
    const ref = (id) => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(id)
      ? { provider: 'codex', store_id: storeId, session_id: id } : null
    return {
      provider: 'codex',
      store_id: storeId,
      session_id: thread.id,
      title: bounded(thread.name, 200) || preview.split('\n')[0].slice(0, 200) || '未命名会话',
      preview,
      workspace: bounded(thread.cwd, 4096) || null,
      branch: bounded(thread.gitInfo?.branch, 200) || null,
      created_at: timestamp(thread.createdAt),
      updated_at: timestamp(thread.updatedAt),
      last_active_at: timestamp(thread.recencyAt ?? thread.updatedAt ?? thread.createdAt),
      state: bounded(thread.status?.type, 64) || 'unknown',
      active_flags: (thread.status?.activeFlags ?? []).filter(flag => ['waitingOnApproval', 'waitingOnUserInput'].includes(flag)),
      is_subagent: Boolean(thread.parentThreadId || (thread.source && typeof thread.source === 'object' && Object.hasOwn(thread.source, 'subAgent'))),
      native_parent: ref(thread.parentThreadId ?? thread.source?.subAgent?.thread_spawn?.parent_thread_id),
      forked_from: ref(thread.forkedFromId),
    }
  }

  async function readSession(sessionId) {
    const response = await request('thread/read', { threadId: sessionId, includeTurns: false })
    if (response?.thread?.id !== sessionId) {
      throw sessionBrowserError('SESSION_BROWSER_SESSION_NOT_FOUND', 'Session no longer exists', 404)
    }
    const metadata = session(response.thread)
    rolloutPaths.set(metadata, response.thread.path)
    return metadata
  }

  async function list({ workspace, branch, query, archived, cursor, limit }) {
    if (!query) {
      const page = await metadataPages.list({
        cursor, limit, archived, sortKey: 'recency_at', sortDirection: 'desc', sourceKinds: SOURCES,
        ...(workspace ? { cwd: workspace } : {}),
      })
      return branch ? { ...page, sessions: page.sessions.filter(row => row.branch === branch) } : page
    }
    let next = cursor
    let scanned = 0
    let data = []
    for (let pageNumber = 0; pageNumber < SEARCH_PAGE_BUDGET; pageNumber += 1) {
      const response = await request(query ? 'thread/search' : 'thread/list', {
        cursor: next,
        limit,
        archived,
        sortKey: 'recency_at',
        sortDirection: 'desc',
        sourceKinds: SOURCES,
        ...(query ? { searchTerm: query } : workspace ? { cwd: workspace } : {}),
      })
      const page = nativePage(response)
      scanned += page.data.length
      data = page.data.map((row) => ({
        ...session(query ? row.thread : row),
        snippet: query ? bounded(row.snippet, 4000) : null,
      })).filter((row) => (!workspace || row.workspace === workspace) && (!branch || row.branch === branch))
      if (page.cursor !== null && page.cursor === next) {
        throw sessionBrowserError('SESSION_BROWSER_READ_FAILED', 'Codex returned a repeated cursor', 502)
      }
      next = page.cursor
      if (data.length || next === null || !query) break
    }
    return { sessions: data, next_cursor: next, search_scope: query ? 'messages' : null, scanned_count: scanned }
  }

  async function workspaces(input) {
    const page = await list({ ...input, workspace: '', branch: '', query: '' })
    const groups = new Map()
    for (const row of page.sessions) {
      if (!row.workspace) continue
      const group = groups.get(row.workspace) ?? { path: row.workspace, observed_count: 0, branch_names: [], last_active_at: row.last_active_at }
      group.observed_count += 1
      if (row.branch && !group.branch_names.includes(row.branch)) group.branch_names.push(row.branch)
      if (String(row.last_active_at) > String(group.last_active_at)) group.last_active_at = row.last_active_at
      groups.set(row.workspace, group)
    }
    return { workspaces: [...groups.values()], next_cursor: page.next_cursor }
  }

  async function branches(input) {
    const page = await list({ ...input, workspace: '', branch: '', query: '' })
    const groups = new Map()
    for (const row of page.sessions) {
      if (!row.branch) continue
      const group = groups.get(row.branch) ?? { name: row.branch, observed_count: 0, workspace_paths: [], session_ids: [], last_active_at: row.last_active_at }
      group.observed_count += 1
      if (row.workspace && !group.workspace_paths.includes(row.workspace)) group.workspace_paths.push(row.workspace)
      group.session_ids.push(row.session_id)
      if (String(row.last_active_at) > String(group.last_active_at)) group.last_active_at = row.last_active_at
      groups.set(row.branch, group)
    }
    return { branches: [...groups.values()], next_cursor: page.next_cursor }
  }

  async function children(sessionId, { cursor, limit }) {
    const result = await metadataPages.list({
      parentThreadId: sessionId, cursor, limit, archived: false, sortKey: 'recency_at', sortDirection: 'desc',
      sourceKinds: ['subAgent', 'subAgentReview', 'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther'],
    })
    return { ...result, sessions: result.sessions.filter((row) => row.native_parent?.session_id === sessionId) }
  }

  async function messages(sessionId, { cursor, query = '', limit = 5, at = null, item_id = null }) {
    const metadata = await readSession(sessionId)
    if ((!query && !cursor) || cursor?.startsWith('items:')) {
      try {
        const nativeCursor = cursor?.startsWith('items:') ? Buffer.from(cursor.slice(6), 'base64url').toString('utf8') : null
        const page = await timeIndex.messagePage(metadata, { cursor: nativeCursor, at, itemId: item_id })
        if (page.state !== 'unavailable') {
          const output = []
          let characters = 0
          let truncated = false
          for (const entry of [...page.entries].reverse()) {
            const item = entry.item
            let role, body = ''
            if (item?.type === 'userMessage') { role = 'user'; body = (item.content ?? []).filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n') }
            if (item?.type === 'agentMessage') { role = 'assistant'; body = typeof item.text === 'string' ? item.text : '' }
            if (!role) continue
            if (!body.trim()) body = role === 'user' ? '[这条消息包含图片或附件，没有可显示的文字]' : '[这条助手消息尚无可显示的文字]'
            const excerpt = body.slice(0, MESSAGE_LIMIT)
            const budget = page.target ? 256 * 1024 - MESSAGE_LIMIT : 256 * 1024
            if (item.id !== page.target?.item_id && characters + excerpt.length > budget) { truncated = true; continue }
            characters += excerpt.length
            const time = messageTimestamp(entry)
            output.push({ id: item.id, turn_id: entry.turnId, role, text: excerpt, truncated: excerpt.length !== body.length, at: time, time_precision: time ? 'message' : 'unknown' })
          }
          if (page.target && !output.some((item) => item.id === page.target.item_id)) throw sessionBrowserError('SESSION_BROWSER_READ_FAILED', '会话消息已变化，请刷新后重新定位', 409)
          return { session: metadata, messages: output, match: null,
            seek: at ? { at: page.target?.at ?? at, precision: page.target ? 'message' : 'unknown', turn_id: page.target?.turn_id ?? null, item_id: page.target?.item_id ?? null, state: page.state } : null,
            next_cursor: page.next ? 'items:' + Buffer.from(page.next).toString('base64url') : null, truncated }
        }
      } catch (error) {
        if (error.code !== 'SESSION_BROWSER_UNSUPPORTED' || item_id) throw error
      }
    }
    let match = null
    let anchor = cursor
    let seek = null
    let targetTurn = null
    let itemTimes = null
    if (at && !cursor) {
      const location = await timeIndex.locate(metadata, at)
      if (!location.turn) return { session: metadata, messages: [], match: null, seek: { at, precision: 'unknown', turn_id: null, item_id: null, state: location.state }, next_cursor: null, truncated: false }
      targetTurn = location.turn
      anchor = location.cursor
      itemTimes = await timeIndex.itemTimes(sessionId, targetTurn.id, at)
      seek = { at, precision: itemTimes?.selected ? 'message' : 'turn', turn_id: targetTurn.id, item_id: itemTimes?.selected?.id ?? null, state: 'ready' }
    }
    if (query && !cursor) {
      const response = nativePage(await request('thread/searchOccurrences', { threadId: sessionId, searchTerm: query, limit: 1 }))
      const found = response.data[0]
      if (found) {
        match = { item_id: found.itemId, turn_id: found.turnId, snippet: bounded(found.snippet, 4000), range: found.snippetMatchRange }
        anchor = found.turnCursor
      }
    }
    const page = nativePage(await request('thread/turns/list', {
      threadId: sessionId,
      cursor: anchor,
      limit: Math.min(limit, 5),
      sortDirection: 'desc',
      itemsView: 'full',
    }))
    const output = []
    let characters = 0
    let truncated = false
    // Reserve room for the located message even when earlier context fills the page.
    const locatedItem = match?.item_id ?? seek?.item_id ?? (seek
      ? page.data.find((turn) => turn.id === seek.turn_id)?.items?.find((item) =>
        item.type === 'agentMessage' && item.text?.trim()
        || item.type === 'userMessage' && item.content?.some((part) => part.type === 'text' && part.text?.trim()))?.id
      : null)
    const contextLimit = locatedItem ? 256 * 1024 - MESSAGE_LIMIT : 256 * 1024
    for (const turn of [...page.data].reverse()) {
      for (const item of Array.isArray(turn.items) ? turn.items : []) {
        let text = ''
        let role
        if (item.type === 'userMessage') {
          role = 'user'
          text = (item.content ?? []).filter((part) => part.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n')
        } else if (item.type === 'agentMessage') {
          role = 'assistant'
          text = typeof item.text === 'string' ? item.text : ''
        }
        if (!text.trim()) continue
        const timedItem = turn.id === targetTurn?.id ? itemTimes?.rows.find((entry) => entry.id === item.id) : null
        const itemAt = timedItem?.at ?? codexTimestamp(turn.startedAt)
        const position = item.id === match?.item_id ? text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) : -1
        const start = position > MESSAGE_LIMIT / 2 ? position - MESSAGE_LIMIT / 2 : 0
        const excerpt = text.slice(start, start + MESSAGE_LIMIT)
        if (item.id !== locatedItem && characters + excerpt.length > contextLimit) {
          truncated = true
          continue
        }
        characters += excerpt.length
        output.push({ id: item.id, turn_id: turn.id, role, text: excerpt, truncated: excerpt.length !== text.length,
          at: itemAt, time_precision: timedItem?.at ? 'message' : itemAt ? 'turn' : 'unknown' })
      }
    }
    if (seek && !seek.item_id) seek.item_id = output.find((item) => item.turn_id === seek.turn_id)?.id ?? null
    return { session: metadata, messages: output, match, seek, next_cursor: page.cursor, truncated }
  }

  return {
    id: 'codex',
    name: 'Codex',
    runtimeId: 'codex',
    storeId,
    resumeOptions: { codexHome: root },
    capabilities: { full_text_search: true, search_experimental: true, message_location: true, resume: true, live_presence: true, timeline: true, relations: true, branch_groups: true },
    async activity() {
      const snapshot = await status.snapshot()
      return { store_id: storeId, available: snapshot.available, sessions: snapshot.threads.map(session), checked_at: snapshot.checked_at }
    },
    list,
    workspaces,
    branches,
    children,
    timeline: timeIndex.timeline,
    readSession,
    messages,
    close() { closed = true; status.close(); metadataPages.close(); repairClient?.close(); closeConnection(); timeIndex.clear(); rolloutTiming.clear() },
  }
}
