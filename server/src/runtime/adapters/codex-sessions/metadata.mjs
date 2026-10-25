import { watch } from 'node:fs'
import { join } from 'node:path'

const FRESH_MS = 3_000
const RETAIN_MS = 30_000
const RECONCILE_MS = 300_000
const MAX_PAGES = 64

// Only normalized metadata lives here. Search snippets and message bodies bypass it.
export function createSessionMetadata({ load, reconcile, dataRoot, onChange = () => {}, clock = Date.now, watchImpl = watch }) {
  const pages = new Map()
  const pending = new Map()
  const watchers = new Map()
  let generation = 0
  let lastReconciled = -Infinity
  let lastAttempt = -Infinity
  let repairing = null
  let repairTimer = null
  let changeTimer = null
  let closed = false

  function changed() {
    if (closed) return
    generation += 1
    pages.clear()
    if (changeTimer !== null) return
    changeTimer = setTimeout(() => { changeTimer = null; if (!closed) onChange() }, 1000)
    changeTimer.unref?.()
  }

  function watchDirectory(name) {
    if (watchers.has(name) || closed) return
    try {
      const observer = watchImpl(join(dataRoot, name), { persistent: false, recursive: Boolean(name) }, (_event, filename) => {
        if (!name && ['sessions', 'archived_sessions'].includes(String(filename))) {
          watchDirectory(String(filename))
          changed()
        } else if (name ? String(filename).endsWith('.jsonl') : String(filename) === 'session_index.jsonl') changed()
      })
      observer.on('error', () => { observer.close(); watchers.delete(name) })
      watchers.set(name, observer)
    } catch { /* Periodic reads also cover missing directories and unavailable watchers. */ }
  }

  async function repair() {
    if (repairing) return repairing
    if (closed) return
    clearTimeout(repairTimer)
    repairTimer = null
    repairing = Promise.resolve().then(reconcile).then(() => { lastReconciled = clock(); changed() }).finally(() => { repairing = null })
    // A failing native scan is retried later, without breaking a valid fast page.
    lastAttempt = clock()
    return repairing
  }

  function scheduleRepair() {
    if (closed || repairing || repairTimer !== null || clock() - lastAttempt < RECONCILE_MS) return
    repairTimer = setTimeout(() => { repairTimer = null; void repair().catch(() => {}) }, 3000)
    repairTimer.unref?.()
  }

  function fetchPage(key, params) {
    let version = generation
    const pendingKey = version + ':' + key
    if (pending.has(pendingKey)) return pending.get(pendingKey)
    const promise = Promise.resolve().then(() => load(params)).then(async result => {
      // An empty database is not proof that there are no legacy rollout files.
      if (!params.cursor && !params.cwd && !params.parentThreadId && !params.archived && !result.sessions.length && clock() - lastReconciled >= RECONCILE_MS) {
        await repair()
        version = generation
        result = await load(params)
      }
      if (!closed && generation === version) {
        const previous = pages.get(key)
        pages.delete(key)
        pages.set(key, { result, at: clock() })
        if (pages.size > MAX_PAGES) pages.delete(pages.keys().next().value)
        if (previous && JSON.stringify(result) !== JSON.stringify(previous.result)) onChange()
      }
      return result
    }).finally(() => pending.delete(pendingKey))
    pending.set(pendingKey, promise)
    return promise
  }

  for (const name of ['', 'sessions', 'archived_sessions']) watchDirectory(name)
  return {
    async list(params) {
      const key = JSON.stringify(params)
      const cached = pages.get(key)
      scheduleRepair()
      if (!cached || clock() - cached.at >= RETAIN_MS) return fetchPage(key, params)
      if (clock() - cached.at >= FRESH_MS) {
        void fetchPage(key, params).catch(() => {})
      }
      return cached.result
    },
    changed,
    close() {
      closed = true
      clearTimeout(repairTimer)
      clearTimeout(changeTimer)
      for (const observer of watchers.values()) observer.close()
      watchers.clear()
      pages.clear()
      pending.clear()
    },
  }
}
