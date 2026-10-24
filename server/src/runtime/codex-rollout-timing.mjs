import { createHash } from 'node:crypto'
import { open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

import { messageTimestamp } from './codex-message-timing.mjs'

const MAX_BYTES = 64 * 1024 * 1024
const MAX_LINE_CHARACTERS = 4 * 1024 * 1024
const MAX_MESSAGES = 50_000
const TTL = 300_000

function fingerprint(turn, role, text) {
  return turn && text ? JSON.stringify([turn, role, createHash('sha256').update(text).digest('hex')]) : null
}

function remember(map, key, at) {
  if (!key) return
  if (!map.has(key)) map.set(key, at)
  else if (map.get(key) !== at) map.set(key, null)
}

async function scan(file, size) {
  const ids = new Map(), texts = new Map()
  let turn = null, count = 0, tail = '', oversized = false
  function line(value) {
    let entry
    try { entry = JSON.parse(value) } catch { return }
    if (entry.type === 'turn_context') { turn = entry.payload?.turn_id ?? null; return }
    const item = entry.payload
    if (entry.type !== 'response_item' || item?.type !== 'message' || !['user', 'assistant'].includes(item.role)) return
    const time = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN
    if (!Number.isFinite(time)) return
    if (++count > MAX_MESSAGES) throw new Error('rollout timing limit')
    const at = new Date(time).toISOString()
    if (typeof item.id === 'string') remember(ids, JSON.stringify([item.role, item.id]), at)
    const content = item.content ?? []
    if (!Array.isArray(content) || content.some(part => !['input_text', 'output_text', 'text'].includes(part.type))) return
    const text = content.map(part => part.text ?? '').join('\n')
    remember(texts, fingerprint(turn, item.role, text), at)
  }
  const buffer = Buffer.alloc(64 * 1024), decoder = new StringDecoder('utf8')
  let position = 0
  while (position < size) {
    const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, size - position), position)
    if (!bytesRead) break
    position += bytesRead
    const parts = decoder.write(buffer.subarray(0, bytesRead)).split('\n')
    for (let i = 0; i < parts.length; i++) {
      if (!oversized) tail += parts[i]
      if (tail.length > MAX_LINE_CHARACTERS) { tail = ''; oversized = true }
      if (i < parts.length - 1) {
        if (!oversized) line(tail)
        tail = ''; oversized = false
      }
    }
  }
  // A partial final line can be an active write; wait for a complete record.
  return { ids, texts }
}

export function createCodexRolloutTiming({ dataRoot, resolvePath, clock = Date.now }) {
  const cache = new Map(), pending = new Map()
  async function catalog(nativePath) {
    const [root, path] = await Promise.all([realpath(dataRoot), realpath(nativePath)])
    const inside = relative(root, path)
    if (isAbsolute(inside) || !['sessions' + sep, 'archived_sessions' + sep].some(prefix => inside.startsWith(prefix))) return null
    const file = await open(path, 'r')
    try {
      const info = await file.stat()
      if (!info.isFile() || info.size > MAX_BYTES) return null
      const signature = `${info.size}:${info.mtimeMs}`
      const previous = cache.get(path)
      if (previous?.signature === signature && previous.expires > clock()) return previous.value
      const value = await scan(file, info.size)
      cache.delete(path)
      cache.set(path, { value, signature, expires: clock() + TTL })
      if (cache.size > 16) cache.delete(cache.keys().next().value)
      return value
    } finally { await file.close() }
  }
  return {
    async hydrate(metadata, entries) {
      if (!entries.some(entry => ['userMessage', 'agentMessage'].includes(entry.item?.type) && !messageTimestamp(entry))) return entries
      const path = resolvePath(metadata)
      if (typeof path !== 'string' || !isAbsolute(path)) return entries
      if (!pending.has(path)) pending.set(path, catalog(path).catch(() => null).finally(() => pending.delete(path)))
      const value = await pending.get(path)
      if (!value) return entries
      return entries.map(entry => {
        if (messageTimestamp(entry)) return entry
        const item = entry.item
        const role = item?.type === 'agentMessage' ? 'assistant' : item?.type === 'userMessage' ? 'user' : null
        if (!role) return entry
        const text = role === 'assistant' ? item.text : (item.content ?? []).every(part => part.type === 'text') ? item.content.map(part => part.text ?? '').join('\n') : null
        const id = JSON.stringify([role, item.id])
        const at = value.ids.has(id) ? value.ids.get(id) : value.texts.get(fingerprint(entry.turnId, role, text))
        return at ? { ...entry, completedAtMs: Date.parse(at) } : entry
      })
    },
    clear() { cache.clear() },
  }
}
