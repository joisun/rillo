import { isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { normalizeSessionReference, sessionBrowserError, sessionReferenceKey } from './session-reference.mjs'

export { sessionBrowserError } from './session-reference.mjs'

function text(value, field, maximum, fallback = '') {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string' || value.length > maximum || value.includes('\0')) {
    throw sessionBrowserError('SESSION_BROWSER_INPUT_INVALID', `${field} is invalid`)
  }
  return value.trim()
}

function query(input = {}) {
  const workspace = text(input.workspace, 'workspace', 4096)
  if (workspace && !isAbsolute(workspace)) {
    throw sessionBrowserError('SESSION_BROWSER_INPUT_INVALID', 'workspace must be absolute')
  }
  const limit = input.limit === undefined ? 30 : Number(input.limit)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw sessionBrowserError('SESSION_BROWSER_INPUT_INVALID', 'limit must be between 1 and 100')
  }
  if (input.archived !== undefined && ![true, false, 'true', 'false'].includes(input.archived)) {
    throw sessionBrowserError('SESSION_BROWSER_INPUT_INVALID', 'archived must be boolean')
  }
  return {
    workspace,
    branch: text(input.branch, 'branch', 200),
    limit,
    query: text(input.query, 'query', 256),
    cursor: text(input.cursor, 'cursor', 8192) || null,
    archived: input.archived === true || input.archived === 'true',
    at: instant(input.at, 'at'),
    item_id: text(input.item_id, 'item_id', 256) || null,
    from: instant(input.from, 'from'),
    to: instant(input.to, 'to'),
  }
}

function instant(value, field) {
  if (value === undefined || value === null || value === '') return null
  const candidate = text(value, field, 64)
  const date = new Date(candidate)
  if (!/^\d{4}-\d{2}-\d{2}T/.test(candidate) || Number.isNaN(date.valueOf())) {
    throw sessionBrowserError('SESSION_BROWSER_INPUT_INVALID', field + ' must be an ISO timestamp')
  }
  return date.toISOString()
}

function nativeRelations(session) {
  const child = normalizeSessionReference(session)
  return [['subagent', session.native_parent], ['fork', session.forked_from]]
    .filter(([, parent]) => parent)
    .map(([kind, parent]) => ({
      id: 'native-' + createHash('sha256').update(kind + sessionReferenceKey(parent) + sessionReferenceKey(child)).digest('hex').slice(0, 24),
      kind, parent, child, origin: 'native', source: session.provider, created_at: session.created_at,
    }))
}

export function createSessionBrowser({ adapters, settings, terminalLauncher, links = null }) {
  const sources = new Map(adapters.map((adapter) => [adapter.id, adapter]))
  if (sources.size !== adapters.length) throw new TypeError('Session adapter IDs must be unique')

  function source(id) {
    const adapter = sources.get(id)
    if (!adapter) throw sessionBrowserError('SESSION_BROWSER_PROVIDER_NOT_FOUND', 'Session provider is not available', 404)
    return adapter
  }

  function reference(adapter, sessionId, input) {
    if (input.store_id !== adapter.storeId
      || typeof sessionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(sessionId)) {
      throw sessionBrowserError('SESSION_BROWSER_REFERENCE_INVALID', 'Session reference does not match this local data source')
    }
  }

  function registered(ref) { return links?.list({ session: ref }) ?? [] }
  function relationsFor(sessions) {
    return [...new Map(sessions.flatMap((row) => [...nativeRelations(row), ...registered(normalizeSessionReference(row))])
      .map((row) => [row.id, row])).values()]
  }
  async function readRef(value) {
    const ref = normalizeSessionReference(value)
    const adapter = source(ref.provider)
    reference(adapter, ref.session_id, ref)
    return adapter.readSession(ref.session_id)
  }
  function requireLinks() {
    if (!links) throw sessionBrowserError('SESSION_BROWSER_UNAVAILABLE', '会话关系服务暂不可用', 503)
  }

  return {
    providers() {
      return { providers: [...sources.values()].map((adapter) => ({
        id: adapter.id,
        name: adapter.name,
        store_id: adapter.storeId,
        capabilities: { ...adapter.capabilities, resume: adapter.capabilities.resume && terminalLauncher.supported !== false },
      })) }
    },
    list(id, input) {
      const adapter = source(id)
      const filters = query(input)
      return adapter.list(filters).then((result) => ({ ...result, relations: relationsFor(result.sessions) }))
    },
    async read(id, sessionId, input) {
      const adapter = source(id)
      reference(adapter, sessionId, input)
      return { session: await adapter.readSession(sessionId) }
    },
    async relations(input) {
      const metadata = await readRef(input)
      return { relations: relationsFor([metadata]) }
    },
    async children(id, sessionId, input) {
      const adapter = source(id)
      reference(adapter, sessionId, input)
      const parent = { provider: id, store_id: adapter.storeId, session_id: sessionId }
      const filters = query(input)
      // Registered children are a separate bounded page before native child cursors.
      const manual = links?.list({ parent }) ?? []
      const offsetMatch = filters.cursor?.match(/^registered:(\d+)$/)
      const offset = offsetMatch ? Number(offsetMatch[1]) : 0
      if (!Number.isSafeInteger(offset) || offset > manual.length) throw sessionBrowserError('SESSION_BROWSER_INPUT_INVALID', '子会话分页位置无效')
      if ((!filters.cursor || offsetMatch) && manual.length) {
        const page = manual.slice(offset, offset + filters.limit)
        const results = await Promise.all(page.map(async (edge) => {
          try { return await readRef(edge.child) }
          catch { return { ...edge.child, title: '会话暂不可用', preview: '', workspace: null, branch: null, created_at: null, updated_at: null, last_active_at: null, state: 'unavailable', unavailable: true } }
        }))
        const next = offset + page.length
        return { sessions: results, relations: [...page, ...relationsFor(results)], next_cursor: next < manual.length ? 'registered:' + next : adapter.children ? 'native:start' : null, search_scope: null, scanned_count: page.length }
      }
      if (!adapter.children) return { sessions: [], relations: [], next_cursor: null, search_scope: null, scanned_count: 0 }
      const page = await adapter.children(sessionId, { ...filters, cursor: filters.cursor === 'native:start' ? null : filters.cursor })
      return { ...page, relations: relationsFor(page.sessions) }
    },
    async timeline(id, sessionId, input) {
      const adapter = source(id)
      reference(adapter, sessionId, input)
      const filters = query(input)
      if ((filters.from || filters.to) && (!filters.from || !filters.to || filters.from >= filters.to
        || Date.parse(filters.to) - Date.parse(filters.from) > 366 * 86400000)) {
        throw sessionBrowserError('SESSION_BROWSER_INPUT_INVALID', '请选择有效且不超过一年的时间范围')
      }
      if (!adapter.timeline) throw sessionBrowserError('SESSION_BROWSER_UNSUPPORTED', '此来源不支持会话时间数据', 501)
      return adapter.timeline(sessionId, filters)
    },
    async link(input) {
      requireLinks()
      const parent = normalizeSessionReference(input.parent)
      const child = normalizeSessionReference(input.child)
      const deadline = Date.now() + 30_000
      async function metadata(ref) {
        const remaining = deadline - Date.now()
        const timeout = () => sessionBrowserError('SESSION_BROWSER_UNAVAILABLE', '关系验证超时，请稍后重试', 504)
        if (remaining <= 0) throw timeout()
        let timer
        try {
          return await Promise.race([readRef(ref), new Promise((_, reject) => {
            timer = setTimeout(() => reject(timeout()), remaining)
            timer.unref?.()
          })])
        } finally { clearTimeout(timer) }
      }
      if (sessionReferenceKey(parent) === sessionReferenceKey(child)) throw sessionBrowserError('SESSION_LINK_CYCLE', '会话不能关联到自身', 409)
      const childSession = await metadata(child)
      if (childSession.native_parent) {
        if (sessionReferenceKey(childSession.native_parent) !== sessionReferenceKey(parent)) throw sessionBrowserError('SESSION_LINK_CONFLICT', '子会话已有原生主会话', 409)
        return { relation: nativeRelations(childSession).find((edge) => edge.kind === 'subagent'), created: false }
      }
      let ancestor = parent
      const visited = new Set()
      while (ancestor) {
        const key = sessionReferenceKey(ancestor)
        if (key === sessionReferenceKey(child) || visited.has(key)) throw sessionBrowserError('SESSION_LINK_CYCLE', '此关联会形成反向或循环关系', 409)
        if (visited.size >= 64) throw sessionBrowserError('SESSION_LINK_DEPTH_LIMIT', '会话层级超过可验证上限', 409)
        visited.add(key)
        const entry = await metadata(ancestor)
        ancestor = entry.native_parent ?? links.parentOf(ancestor)?.parent ?? null
      }
      return links.link({ parent, child, source: input.source ?? 'external' })
    },
    unlink(input) {
      requireLinks()
      return links.unlink({ parent: normalizeSessionReference(input.parent), child: normalizeSessionReference(input.child) })
    },
    check() { return links?.check() ?? { schemaVersion: 1, integrityCheck: 'ok', foreignKeyViolations: [], invariantViolations: [] } },
    activity(id) {
      const adapter = source(id)
      if (!adapter.activity) throw sessionBrowserError('SESSION_BROWSER_UNSUPPORTED', '此来源不支持会话活跃状态', 501)
      return adapter.activity()
    },
    workspaces(id, input) {
      return source(id).workspaces({ ...query(input), limit: 100 })
    },
    branches(id, input) {
      const adapter = source(id)
      if (!adapter.branches) throw sessionBrowserError('SESSION_BROWSER_UNSUPPORTED', '此来源不支持按分支浏览', 501)
      return adapter.branches({ ...query(input), limit: 100 })
    },
    messages(id, sessionId, input) {
      const adapter = source(id)
      reference(adapter, sessionId, input)
      const filters = query(input)
      if (filters.item_id && (!filters.at || filters.query)) throw sessionBrowserError('SESSION_BROWSER_INPUT_INVALID', '消息ID必须与定位时间一起使用')
      if (filters.at && filters.query) throw sessionBrowserError('SESSION_BROWSER_INPUT_INVALID', '时间定位和正文搜索不能同时提交')
      return adapter.messages(sessionId, filters)
    },
    async resume(id, sessionId, input) {
      const adapter = source(id)
      reference(adapter, sessionId, input)
      const session = await adapter.readSession(sessionId)
      if (!session.workspace || !isAbsolute(session.workspace)) {
        throw sessionBrowserError('SESSION_BROWSER_WORKSPACE_UNAVAILABLE', 'The original session workspace is unavailable', 409)
      }
      const activity = await adapter.activity?.()
      const nativeState = activity?.available && activity.store_id === adapter.storeId
        ? activity.sessions.find(row => row.session_id === session.session_id)?.state : null
      const current = await settings.get()
      const launch = await terminalLauncher.launch({
        ...adapter.resumeOptions,
        runtimeId: adapter.runtimeId,
        terminal: current.settings.resume_terminal,
        sessionId: session.session_id,
        workspace: session.workspace,
        title: session.title,
        allowCreate: nativeState !== 'active' && session.state !== 'active',
      })
      return { ok: true, terminal_label: launch.terminal_label, ...(launch.action ? { action: launch.action } : {}) }
    },
    close() {
      for (const adapter of sources.values()) adapter.close?.()
    },
  }
}
