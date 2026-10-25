import { createHash } from 'node:crypto'
import { open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'

// Prove that an indexed journal prefix is unchanged before reusing old points.
// Keep hashes only; the bytes never leave this read or become a transcript cache.
export function createCodexRolloutHistory({ dataRoot, resolvePath }) {
  return async function revision(metadata, previous = null) {
    const nativePath = resolvePath(metadata)
    if (typeof nativePath !== 'string' || !isAbsolute(nativePath)) return null
    let file
    try {
      const [root, path] = await Promise.all([realpath(dataRoot), realpath(nativePath)])
      const inside = relative(root, path)
      if (isAbsolute(inside) || !['sessions' + sep, 'archived_sessions' + sep].some(prefix => inside.startsWith(prefix))) return null
      file = await open(path, 'r')
      const before = await file.stat()
      if (!before.isFile() || before.size > 64 * 1024 * 1024) return null
      const identity = `${before.dev}:${before.ino}`
      const hash = createHash('sha256'), prefix = createHash('sha256'), buffer = Buffer.alloc(64 * 1024)
      let position = 0
      while (position < before.size) {
        const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, before.size - position), position)
        if (!bytesRead) return null
        hash.update(buffer.subarray(0, bytesRead))
        if (previous && position < previous.size) prefix.update(buffer.subarray(0, Math.min(bytesRead, previous.size - position)))
        position += bytesRead
      }
      const after = await file.stat()
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) return null
      return { identity, size: before.size, digest: hash.digest('hex'),
        preserves: Boolean(previous && previous.identity === identity && before.size >= previous.size && prefix.digest('hex') === previous.digest) }
    } catch { return null } finally { await file?.close() }
  }
}
