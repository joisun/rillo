import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { normalizeSessionReference, sessionBrowserError, sessionReferenceKey } from './session-reference.mjs'

export function createSessionLinkStore({ databasePath, clock = () => new Date() } = {}) {
  if (typeof databasePath !== 'string' || !databasePath) throw new TypeError('databasePath is required')
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(databasePath)
  chmodSync(databasePath, 0o600)
  try {
    const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
    if (existing.some(({ name }) => name !== 'session_links')) throw new Error('Not a session relationship database')
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS session_links (
        id TEXT PRIMARY KEY,
        parent_key TEXT NOT NULL,
        child_key TEXT NOT NULL UNIQUE,
        parent_json TEXT NOT NULL,
        child_json TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        CHECK(parent_key <> child_key)
      );
      CREATE INDEX IF NOT EXISTS session_links_parent ON session_links(parent_key);
      PRAGMA user_version=1;`)
  } catch (error) {
    db.close()
    throw error
  }
  let closed = false
  const byChild = db.prepare('SELECT * FROM session_links WHERE child_key=?')
  const insert = db.prepare('INSERT INTO session_links VALUES(?,?,?,?,?,?,?)')

  function relation(row) {
    if (!row) return null
    return {
      id: row.id, kind: 'delegation', origin: 'registered',
      parent: JSON.parse(row.parent_json), child: JSON.parse(row.child_json),
      source: row.source, created_at: row.created_at,
    }
  }

  return {
    list({ session, parent, child } = {}) {
      const filters = []
      const params = []
      if (session) { filters.push('(parent_key=? OR child_key=?)'); params.push(sessionReferenceKey(session), sessionReferenceKey(session)) }
      if (parent) { filters.push('parent_key=?'); params.push(sessionReferenceKey(parent)) }
      if (child) { filters.push('child_key=?'); params.push(sessionReferenceKey(child)) }
      return db.prepare('SELECT * FROM session_links' + (filters.length ? ' WHERE ' + filters.join(' AND ') : '') + ' ORDER BY created_at,id')
        .all(...params).map(relation)
    },
    parentOf(ref) { return relation(byChild.get(sessionReferenceKey(ref))) },
    link({ parent: parentInput, child: childInput, source = 'external' }) {
      const parent = normalizeSessionReference(parentInput)
      const child = normalizeSessionReference(childInput)
      const parentKey = sessionReferenceKey(parent)
      const childKey = sessionReferenceKey(child)
      if (typeof source !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(source)) {
        throw sessionBrowserError('SESSION_BROWSER_INPUT_INVALID', '关系来源格式无效')
      }
      if (parentKey === childKey) throw sessionBrowserError('SESSION_LINK_CYCLE', '会话不能是自己的子会话', 409)
      db.exec('BEGIN IMMEDIATE')
      try {
        const existing = byChild.get(childKey)
        if (existing) {
          if (existing.parent_key !== parentKey) throw sessionBrowserError('SESSION_LINK_CONFLICT', '子会话已有主会话，不能自动改挂', 409)
          db.exec('COMMIT')
          return { relation: relation(existing), created: false }
        }
        let current = parentKey
        const visited = new Set()
        while (current) {
          if (current === childKey || visited.has(current)) throw sessionBrowserError('SESSION_LINK_CYCLE', '此关联会形成反向或循环关系', 409)
          if (visited.size >= 256) throw sessionBrowserError('SESSION_LINK_DEPTH_LIMIT', '会话层级超过可验证上限', 409)
          visited.add(current)
          current = byChild.get(current)?.parent_key
        }
        const now = new Date(clock()).toISOString()
        const id = randomUUID()
        insert.run(id, parentKey, childKey, JSON.stringify(parent), JSON.stringify(child), source, now)
        const result = relation(byChild.get(childKey))
        db.exec('COMMIT')
        return { relation: result, created: true }
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    unlink({ parent, child }) {
      const result = db.prepare('DELETE FROM session_links WHERE parent_key=? AND child_key=?')
        .run(sessionReferenceKey(parent), sessionReferenceKey(child))
      return { removed: Number(result.changes) > 0 }
    },
    check() {
      return { schemaVersion: 1, integrityCheck: db.prepare('PRAGMA quick_check').get().quick_check, foreignKeyViolations: [], invariantViolations: [] }
    },
    close() { if (!closed) { closed = true; db.close() } },
  }
}
