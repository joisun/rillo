import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export function createSessionMessageStore({ databasePath, clock = () => new Date() }) {
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(databasePath)
  chmodSync(databasePath, 0o600)
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS deliveries (
      request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, message_id TEXT NOT NULL,
      session_json TEXT NOT NULL, operation TEXT NOT NULL, expected_turn_id TEXT, status TEXT NOT NULL,
      receipt_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    UPDATE deliveries SET status='unknown' WHERE status='sending';`)
  function get(id) {
    const row = db.prepare('SELECT * FROM deliveries WHERE request_id=?').get(id)
    if (!row) return null
    return { request_id: row.request_id, message_id: row.message_id, session: JSON.parse(row.session_json), operation: row.operation,
      ...JSON.parse(row.receipt_json), status: row.status, expected_turn_id: row.expected_turn_id, created_at: row.created_at, updated_at: row.updated_at }
  }
  return {
    get,
    begin(input) {
      const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex')
      const row = db.prepare('SELECT fingerprint FROM deliveries WHERE request_id=?').get(input.request_id)
      if (row && row.fingerprint !== fingerprint) throw Object.assign(new Error('请求 ID 已用于另一条消息或操作'), { code: 'SESSION_MESSAGE_CONFLICT', statusCode: 409 })
      if (!row) {
        const at = clock().toISOString()
        db.prepare('INSERT INTO deliveries(request_id,fingerprint,message_id,session_json,operation,expected_turn_id,status,receipt_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(input.request_id, fingerprint, randomUUID(), JSON.stringify(input.session), input.operation, input.expected_turn_id, 'pending', '{}', at, at)
      }
      return { receipt: get(input.request_id), created: !row }
    },
    update(id, status, details = {}) {
      db.prepare('UPDATE deliveries SET status=?, receipt_json=?, updated_at=? WHERE request_id=?').run(status, JSON.stringify(details), clock().toISOString(), id)
      return get(id)
    },
    close() { db.close() },
  }
}
