import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { open, realpath, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function fileError(code, message, statusCode) {
  return Object.assign(new Error(message), { code, statusCode })
}

function inside(root, target) {
  const difference = relative(root, target)
  return difference !== '..' && !difference.startsWith(`..${sep}`) && !isAbsolute(difference)
}

async function resolveRunFile(run, path) {
  if (typeof path !== 'string' || !path.trim() || path.includes(String.fromCharCode(0))
    || Buffer.byteLength(path) > 4096) {
    throw fileError('RUN_FILE_PATH_INVALID', '文件路径无效', 400)
  }
  const recorded = run.file_changes?.find(file => file.path === path)
  if (!recorded) throw fileError('RUN_FILE_NOT_RECORDED', '文件不在该 Run 的产出记录中', 403)
  if (['delete', 'deleted', 'removed'].includes(recorded.kind)) {
    throw fileError('RUN_FILE_DELETED', '该文件已在此 Run 中删除，无法打开', 409)
  }
  const workspace = run.snapshot?.workspace
  if (typeof workspace !== 'string' || !isAbsolute(workspace) || workspace.includes(String.fromCharCode(0))) {
    throw fileError('RUN_FILE_WORKSPACE_INVALID', '该 Run 没有有效的 workspace', 409)
  }
  const target = resolve(workspace, path)
  if (!inside(workspace, target)) {
    throw fileError('RUN_FILE_OUTSIDE_WORKSPACE', '仅支持打开该 Run workspace 内的文件', 403)
  }
  let canonicalTarget
  let metadata
  try {
    const canonicalWorkspace = await realpath(workspace)
    canonicalTarget = await realpath(target)
    if (!inside(canonicalWorkspace, canonicalTarget)) {
      throw fileError('RUN_FILE_OUTSIDE_WORKSPACE', '文件链接指向该 Run workspace 之外', 403)
    }
    metadata = await stat(canonicalTarget)
  } catch (error) {
    if (error.code?.startsWith('RUN_FILE_')) throw error
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) {
      throw fileError('RUN_FILE_NOT_FOUND', '文件或该 Run 的 workspace 已不存在', 404)
    }
    throw fileError('RUN_FILE_UNREADABLE', '无法访问该文件，请检查文件权限', 403)
  }
  if (!metadata.isFile()) throw fileError('RUN_FILE_NOT_REGULAR', '产出路径不是普通文件', 409)
  return canonicalTarget
}

export async function openRunFile(run, path, {
  platform = process.platform,
  execFileImpl = execFileAsync,
} = {}) {
  const canonicalTarget = await resolveRunFile(run, path)
  if (platform !== 'darwin') {
    throw fileError('RUN_FILE_OPEN_UNSUPPORTED', '当前仅支持在 macOS 上使用默认应用打开文件', 409)
  }
  try {
    await execFileImpl('/usr/bin/open', [pathToFileURL(canonicalTarget).href], { timeout: 5000, shell: false })
  } catch {
    throw fileError('RUN_FILE_OPEN_FAILED', '无法打开文件，请检查系统默认应用关联', 409)
  }
  return { opened: true, path }
}

const PREVIEW_TTL_MS = 30 * 60 * 1000
const PREVIEW_LIMIT = 64
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.pdf': 'application/pdf', '.wasm': 'application/wasm',
}

export function createRunFilePreviews({ clock = Date.now, ttlMs = PREVIEW_TTL_MS } = {}) {
  const grants = new Map()
  return {
    async create(run, path) {
      const target = await resolveRunFile(run, path)
      if (basename(target).startsWith('.')) throw fileError('RUN_FILE_PREVIEW_FORBIDDEN', '隐藏文件不支持网页预览', 403)
      const now = clock()
      for (const [token, grant] of grants) if (grant.expiresAt <= now) grants.delete(token)
      while (grants.size >= PREVIEW_LIMIT) grants.delete(grants.keys().next().value)
      const token = randomBytes(24).toString('hex')
      const expiresAt = now + ttlMs
      grants.set(token, { root: dirname(target), entry: target, expiresAt })
      return { token, filename: basename(target), expires_at: new Date(expiresAt).toISOString() }
    },
    async read(token, path) {
      const grant = grants.get(token)
      if (!grant || grant.expiresAt <= clock()) {
        grants.delete(token)
        throw fileError('RUN_FILE_PREVIEW_EXPIRED', '预览链接已过期，请从运行记录重新打开文件', 410)
      }
      if (typeof path !== 'string' || Buffer.byteLength(path) > 4096 || path.includes('\0') || path.includes('\\')
        || path.split('/').some(part => part === '..' || part.startsWith('.'))) {
        throw fileError('RUN_FILE_PREVIEW_FORBIDDEN', '该路径不在本次产物预览范围内', 403)
      }
      let handle
      try {
        let target = resolve(grant.root, path || 'index.html')
        if (!inside(grant.root, target)) throw fileError('RUN_FILE_PREVIEW_FORBIDDEN', '该路径不在本次产物预览范围内', 403)
        if ((await stat(target)).isDirectory()) target = resolve(target, 'index.html')
        const canonical = await realpath(target)
        if (await realpath(grant.root) !== grant.root || !inside(grant.root, canonical)
          || relative(grant.root, canonical).split(sep).some(part => part.startsWith('.'))) {
          throw fileError('RUN_FILE_PREVIEW_FORBIDDEN', '文件链接指向本次产物预览范围之外', 403)
        }
        if (!(await stat(canonical)).isFile()) throw fileError('RUN_FILE_NOT_REGULAR', '产出路径不是普通文件', 409)
        const contentType = CONTENT_TYPES[extname(canonical).toLowerCase()] ?? 'application/octet-stream'
        if (contentType === 'application/octet-stream' && canonical !== grant.entry) {
          throw fileError('RUN_FILE_PREVIEW_FORBIDDEN', '该资源类型不支持作为预览依赖访问', 403)
        }
        handle = await open(canonical, 'r')
        const metadata = await handle.stat()
        if (!metadata.isFile()) throw fileError('RUN_FILE_NOT_REGULAR', '产出路径不是普通文件', 409)
        return { handle, size: metadata.size, contentType, filename: basename(canonical), attachment: contentType === 'application/octet-stream' }
      } catch (error) {
        await handle?.close()
        if (error.code?.startsWith('RUN_FILE_')) throw error
        if (['ENOENT', 'ENOTDIR'].includes(error.code)) throw fileError('RUN_FILE_NOT_FOUND', '预览文件已不存在', 404)
        throw fileError('RUN_FILE_UNREADABLE', '无法读取预览文件，请检查权限', 403)
      }
    },
    clear() { grants.clear() },
  }
}
