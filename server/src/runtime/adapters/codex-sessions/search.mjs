import { sessionBrowserError } from '../../../session-reference.mjs'

const PAGE_BUDGET = 3
const CURSOR_PREFIX = 'body:'

function decodeCursor(cursor) {
  if (cursor === null) return null
  if (!cursor.startsWith(CURSOR_PREFIX)) throw sessionBrowserError('SESSION_BROWSER_INPUT_INVALID', 'Invalid body search cursor')
  const encoded = cursor.slice(CURSOR_PREFIX.length)
  const decoded = Buffer.from(encoded, 'base64url').toString('utf8')
  if (!decoded || Buffer.from(decoded).toString('base64url') !== encoded) throw sessionBrowserError('SESSION_BROWSER_INPUT_INVALID', 'Invalid body search cursor')
  return decoded
}

export async function searchCodexSessions({ workspace, branch, query, archived, cursor = null, limit }, { load, session, signal }) {
  let next = decodeCursor(cursor)
  let scanned = 0
  let sessions = []
  for (let pageNumber = 0; pageNumber < PAGE_BUDGET; pageNumber += 1) {
    signal?.throwIfAborted()
    // Return a match before Codex finishes resolving older, potentially large histories.
    const page = await load({ cursor: next, limit: next === null ? 1 : limit, archived, sortKey: 'recency_at', sortDirection: 'desc', searchTerm: query })
    signal?.throwIfAborted()
    scanned += page.data.length
    sessions = page.data.map(row => ({ ...session(row.thread), snippet: typeof row.snippet === 'string' ? row.snippet.slice(0, 4000) : '' }))
      .filter(row => (!workspace || row.workspace === workspace) && (!branch || row.branch === branch))
    if (page.cursor !== null && page.cursor === next) throw sessionBrowserError('SESSION_BROWSER_READ_FAILED', 'Codex returned a repeated search cursor', 502)
    next = page.cursor
    if (sessions.length || next === null) break
  }
  return { sessions, next_cursor: next === null ? null : CURSOR_PREFIX + Buffer.from(next).toString('base64url'), search_scope: 'messages', scanned_count: scanned }
}
