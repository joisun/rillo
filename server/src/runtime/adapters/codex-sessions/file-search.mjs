import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { sessionBrowserError } from '../../../session-reference.mjs'
import { createRuntimeEnvironment } from '../../runtime-environment.mjs'

const MAX_ROW_BYTES = 16 * 1024
const MAX_THREADS = 10000
const INITIAL_BATCH_SIZE = 16
const BATCH_SIZE = 100

export function messageSearchPattern(query) {
  const literal = JSON.stringify(query).slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const char = '(?:[^"\\\\]|\\\\(?:["\\\\/bfnrt]|u[0-9a-fA-F]{4}))'
  // Match Codex's envelope before inspecting payload text, so tool/image records fail early.
  const prefix = '^\\s*\\{\\s*(?:"timestamp"\\s*:\\s*"[^"]*"\\s*,\\s*)?(?:"ordinal"\\s*:\\s*\\d+\\s*,\\s*)?"type"\\s*:\\s*"(?<entry>response_item|event_msg)"\\s*,\\s*"payload"\\s*:\\s*\\{\\s*"type"\\s*:\\s*"(?<kind>message|user_message|agent_message)"'
  const field = '(?:.*?"role"\\s*:\\s*"(?<role>user|assistant)".*?"text"|.*?"message")\\s*:\\s*"'
  return prefix + field + char + '*?(?<excerpt>' + char + '{0,80}' + literal + char + '{0,160})' + char + '*"'
}

async function ripgrep(executable) {
  let binary
  try { binary = await realpath(executable) } catch { return null }
  const candidates = [join(dirname(binary), 'rg'), join(dirname(binary), '..', 'codex-path', 'rg'), ...createRuntimeEnvironment().searchDirectories().map(path => join(path, 'rg'))]
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return candidate } catch {}
  }
  return null
}

function cursorScope({ query, workspace, branch, archived }) {
  return createHash('sha256').update(JSON.stringify([query, workspace, branch, archived])).digest('hex')
}

function readCursor(cursor, filters) {
  if (!cursor) return null
  try {
    if (!cursor.startsWith('files:')) throw new Error('invalid prefix')
    const value = JSON.parse(Buffer.from(cursor.slice(6), 'base64url').toString('utf8'))
    if (value.scope !== cursorScope(filters) || typeof value.at !== 'string' || typeof value.id !== 'string') throw new Error('invalid scope')
    return value
  } catch { throw sessionBrowserError('SESSION_BROWSER_INPUT_INVALID', 'Invalid file search cursor') }
}

async function scan(executable, files, query, signal, spawnImpl) {
  signal?.throwIfAborted()
  const matches = new Map()
  const allowed = new Set(files)
  const child = spawnImpl(executable, ['--no-config', '--threads', '2', '--only-matching', '--with-filename', '--no-heading', '--no-line-number', '--null', '--max-count', '1', '--ignore-case', '--regexp', messageSearchPattern(query), '--replace', '$entry\t$kind\t$role\t$excerpt', '--', ...files], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = new Promise((resolveExit, reject) => { child.once('error', reject); child.once('close', resolveExit) })
  exited.catch(() => {})
  child.stderr?.resume()
  const abort = () => child.kill('SIGTERM')
  signal?.addEventListener('abort', abort, { once: true })
  let fragments = [], bytes = 0, pathEnded = false
  function consume(record) {
    const split = record.indexOf(0)
    const path = record.subarray(0, split).toString('utf8')
    const [entry, kind, role, excerpt] = record.subarray(split + 1).toString('utf8').split('\t')
    if (split < 0 || !allowed.has(path) || typeof excerpt !== 'string') throw new Error('Invalid ripgrep search record')
    const visible = entry === 'response_item' && kind === 'message' && ['user', 'assistant'].includes(role)
      || entry === 'event_msg' && ['user_message', 'agent_message'].includes(kind)
    if (!visible) return
    const snippet = JSON.parse('"' + excerpt + '"')
    if (snippet.toLocaleLowerCase().includes(query.toLocaleLowerCase())) matches.set(path, snippet)
  }
  try {
    for await (const chunk of child.stdout) {
      let offset = 0
      while (offset < chunk.length) {
        let end = -1
        if (!pathEnded) { const nul = chunk.indexOf(0, offset); if (nul >= 0) { pathEnded = true; end = chunk.indexOf(10, nul + 1) } }
        else end = chunk.indexOf(10, offset)
        const part = chunk.subarray(offset, end < 0 ? chunk.length : end)
        fragments.push(part); bytes += part.length
        if (bytes > MAX_ROW_BYTES) throw new Error('File search record exceeds its limit')
        if (end < 0) break
        consume(Buffer.concat(fragments, bytes))
        fragments = []; bytes = 0; pathEnded = false; offset = end + 1
      }
      signal?.throwIfAborted()
    }
    if (bytes) consume(Buffer.concat(fragments, bytes))
    const code = await exited
    signal?.throwIfAborted()
    if (code !== 0 && code !== 1) throw new Error('ripgrep search failed')
    return matches
  } catch (error) {
    child.kill('SIGTERM')
    await exited.catch(() => {})
    signal?.throwIfAborted()
    throw sessionBrowserError('SESSION_BROWSER_SEARCH_FAILED', '会话文件搜索失败，请稍后重试。', 503)
  } finally { signal?.removeEventListener('abort', abort) }
}

export async function searchCodexFiles(filters, { dataRoot, resolveLaunch, load, session, signal, spawnImpl = spawn, resolveExecutable = ripgrep }) {
  const anchor = readCursor(filters.cursor, filters)
  let root
  try { root = await realpath(join(dataRoot, filters.archived ? 'archived_sessions' : 'sessions')); if (!(await stat(root)).isDirectory()) return null }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
  const executable = await resolveExecutable((await resolveLaunch()).executable)
  if (!executable) return null
  const candidates = []
  let next = null
  do {
    signal?.throwIfAborted()
    const page = await load({ cursor: next, limit: 100, archived: filters.archived, sortKey: 'recency_at', sortDirection: 'desc', useStateDbOnly: true, ...(filters.workspace ? { cwd: filters.workspace } : {}) })
    for (const row of page.data) {
      const metadata = session(row)
      if (filters.branch && metadata.branch !== filters.branch) continue
      if (filters.workspace && metadata.workspace !== filters.workspace) continue
      const at = metadata.last_active_at ?? ''
      if (anchor && (at > anchor.at || at === anchor.at && metadata.session_id.localeCompare(anchor.id) >= 0)) continue
      if (typeof row.path !== 'string' || !row.path.endsWith('.jsonl')) return null
      let path
      try { path = await realpath(row.path) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
      const inside = relative(root, path)
      if (inside.startsWith('..' + sep) || inside === '..' || resolve(root, inside) !== path || inside.startsWith(sep)) continue
      candidates.push({ path, metadata })
    }
    if (candidates.length > MAX_THREADS) throw sessionBrowserError('SESSION_BROWSER_SEARCH_FAILED', '会话数量过多，请按目录缩小搜索范围。', 409)
    if (page.cursor !== null && page.cursor === next) throw sessionBrowserError('SESSION_BROWSER_READ_FAILED', 'Codex returned a repeated cursor', 502)
    next = page.cursor
  } while (next !== null)
  candidates.sort((a, b) => (b.metadata.last_active_at ?? '').localeCompare(a.metadata.last_active_at ?? '') || b.metadata.session_id.localeCompare(a.metadata.session_id))
  const results = []
  let scanned = 0
  const batchSize = anchor ? BATCH_SIZE : INITIAL_BATCH_SIZE
  if (candidates.length) {
    const batches = []
    for (let worker = 0; worker < (anchor ? 2 : 1) && scanned < candidates.length; worker++) {
      const batch = []; let argumentBytes = 0
      while (scanned < candidates.length && batch.length < batchSize) {
        const candidate = candidates[scanned]
        if (batch.length && argumentBytes + Buffer.byteLength(candidate.path) > 48 * 1024) break
        batch.push(candidate); argumentBytes += Buffer.byteLength(candidate.path) + 1; scanned++
      }
      batches.push(batch)
    }
    const matches = await Promise.all(batches.map(batch => scan(executable, batch.map(row => row.path), filters.query, signal, spawnImpl)))
    for (const [index, batch] of batches.entries()) for (const row of batch) if (matches[index].has(row.path)) results.push({ ...row.metadata, snippet: matches[index].get(row.path) })
  }
  const sessions = results.slice(0, filters.limit)
  // Advance past inspected files even on an empty page; keep excess matches for the next page.
  const last = results.length > sessions.length ? sessions.at(-1) : candidates[scanned - 1]?.metadata
  const more = results.length > sessions.length || scanned < candidates.length
  const cursor = more && last ? 'files:' + Buffer.from(JSON.stringify({ scope: cursorScope(filters), at: last.last_active_at ?? '', id: last.session_id })).toString('base64url') : null
  return { sessions, next_cursor: cursor, scanned_count: scanned, search_scope: 'messages' }
}
