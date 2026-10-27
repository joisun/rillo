import { createCodexSharedClient } from './codex-shared-client.mjs'

const FRESH_MS = 3000
const MAX_LOADED_THREADS = 10000

export function createCodexSessionStatus({ dataRoot, createClient = createCodexSharedClient, onChange = () => {}, clock = Date.now }) {
  let client = null
  let connecting = null
  let cached = null
  let pending = null
  let generation = 0
  let closed = false

  async function connected() {
    if (connecting) return connecting
    if (client && !client.closed) return client
    client = createClient({ dataRoot })
    const current = client
    connecting = (async () => {
      await current.started
      await current.request('initialize', {
        clientInfo: { name: 'tasks-recorder-session-status', version: '0.10.0' },
        capabilities: { experimentalApi: true },
      })
      current.notify('initialized')
      current.onNotification(({ method }) => {
        if (!/^(thread\/(?:started|closed|status\/changed)|turn\/(?:started|completed))$/.test(method)) return
        generation += 1
        cached = null
        onChange()
      })
      return current
    })().finally(() => { connecting = null })
    return connecting
  }

  async function scan() {
    const version = generation
    const checked_at = new Date(clock()).toISOString()
    try {
      if (closed) throw new Error('CLOSED')
      const connection = await connected()
      const ids = new Set()
      const cursors = new Set()
      let cursor = null
      do {
        cursors.add(cursor)
        const page = await connection.request('thread/loaded/list', { cursor, limit: 100 })
        if (!Array.isArray(page.data) || ids.size + page.data.length > MAX_LOADED_THREADS
          || (page.nextCursor && cursors.has(page.nextCursor))) throw new Error('INVALID_LOADED_THREADS')
        for (const id of page.data) ids.add(id)
        cursor = page.nextCursor ?? null
      } while (cursor)
      const queue = [...ids]
      const threads = []
      await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
        while (queue.length) {
          const id = queue.shift()
          const { thread } = await connection.request('thread/read', { threadId: id, includeTurns: false })
          if (thread?.id !== id || !thread.status?.type) throw new Error('INVALID_THREAD_STATUS')
          threads.push(thread)
        }
      }))
      return { available: true, threads: threads.sort((left, right) => left.id.localeCompare(right.id)), checked_at, generation: version }
    } catch {
      client?.close()
      client = null
      return { available: false, threads: [], checked_at, generation: version }
    }
  }

  return {
    async snapshot() {
      if (cached && clock() - Date.parse(cached.checked_at) < FRESH_MS) return cached
      if (pending) return pending
      pending = scan().then(result => {
        if (!closed && result.generation === generation) cached = result
        return result
      }).finally(() => { pending = null })
      return pending
    },
    close() { closed = true; cached = null; client?.close() },
  }
}
