import { execFile } from 'node:child_process'
import { open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const SESSION_SUFFIX = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i

async function rolloutWorkspace(path) {
  const file = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(512 * 1024)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    const end = buffer.subarray(0, bytesRead).indexOf(10)
    if (end < 0) return null
    const metadata = JSON.parse(buffer.subarray(0, end).toString('utf8'))
    const cwd = metadata.type === 'session_meta' ? metadata.payload?.cwd : null
    return typeof cwd === 'string' && cwd.length <= 4096 && isAbsolute(cwd) && !cwd.includes('\0') ? cwd : null
  } finally { await file.close() }
}

export function createCodexSessionPresence({
  dataRoot, execFileImpl = execFileAsync, realpathImpl = realpath,
  platform = process.platform, clock = Date.now,
  readWorkspace = rolloutWorkspace,
} = {}) {
  let cached = null
  let expiresAt = 0
  let pending = null
  const workspaceCache = new Map()

  async function scan() {
    const checkedAt = new Date(clock()).toISOString()
    const unavailable = { available: false, open_session_ids: [], checked_at: checkedAt }
    if (platform !== 'darwin') return unavailable
    try {
      const root = await realpathImpl(dataRoot)
      let stdout
      try {
        const result = await execFileImpl('/usr/sbin/lsof', ['-nP', '-c', 'codex', '-F', 'fan'], {
          timeout: 2000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', shell: false,
        })
        stdout = result.stdout
      } catch (error) {
        // lsof exits 1 with no output when no process matches.
        if (error.code !== 1 || error.stdout || error.stderr) throw error
        stdout = ''
      }
      const ids = new Set()
      const files = new Map()
      let writable = false
      for (const line of stdout.split('\n')) {
        if (line.startsWith('f')) writable = false
        if (line.startsWith('a')) writable = ['aw', 'au'].includes(line)
        if (!writable || !line.startsWith('n')) continue
        const path = relative(root, line.slice(1))
        if (isAbsolute(path) || !['sessions' + sep, 'archived_sessions' + sep].some((prefix) => path.startsWith(prefix))) continue
        const match = path.match(SESSION_SUFFIX)
        if (match) { ids.add(match[1]); files.set(match[1], line.slice(1)) }
      }
      const activeWorkspaces = new Set()
      for (const [id, path] of files) {
        let entry = workspaceCache.get(id)
        if (!entry || entry.expires < clock()) {
          const cwd = await readWorkspace(path).catch(() => null)
          entry = { cwd, expires: clock() + 300_000 }
          workspaceCache.set(id, entry)
          if (workspaceCache.size > 128) workspaceCache.delete(workspaceCache.keys().next().value)
        }
        if (entry.cwd) activeWorkspaces.add(entry.cwd)
      }
      return { available: true, open_session_ids: [...ids], active_workspaces: [...activeWorkspaces], checked_at: checkedAt }
    } catch {
      return unavailable
    }
  }

  return {
    snapshot() {
      if (pending) return pending
      if (cached && clock() < expiresAt) return Promise.resolve(cached)
      pending = scan().then((result) => {
        cached = result
        expiresAt = clock() + 3000
        return result
      }).finally(() => { pending = null })
      return pending
    },
  }
}
