import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'

import { runtimeError } from './runtime-errors.mjs'

const MAXIMUM_BYTES = 16 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 30_000

export function connectOpenCodeServer({ url, password, cwd, maximumBytes = MAXIMUM_BYTES }) {
  const lifetime = new AbortController()
  const headers = {
    Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
    'Content-Type': 'application/json',
  }
  const endpoint = (path) => {
    const target = new URL(path, url)
    target.searchParams.set('directory', cwd)
    return target
  }
  async function request(method, path, body) {
    const response = await fetch(endpoint(path), {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw runtimeError(response.status === 404 ? 'RUNTIME_SESSION_NOT_FOUND' : 'RUNTIME_REQUEST_FAILED', `OpenCode HTTP ${response.status}`)
    }
    if (response.status === 204) return null
    const chunks = []
    let bytes = 0
    for await (const chunk of response.body) {
      bytes += chunk.byteLength
      if (bytes > maximumBytes) throw runtimeError('RUNTIME_PROTOCOL_FRAME_TOO_LARGE', 'OpenCode response exceeds limit')
      chunks.push(chunk)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    catch { throw runtimeError('RUNTIME_PROTOCOL_INVALID', 'OpenCode returned invalid JSON') }
  }
  async function events(onEvent) {
    const response = await fetch(endpoint('/event'), { headers, signal: lifetime.signal })
    if (!response.ok) {
      await response.body?.cancel()
      throw runtimeError('RUNTIME_REQUEST_FAILED', 'OpenCode event stream unavailable')
    }
    let pending = ''
    const decoder = new TextDecoder()
    for await (const chunk of response.body) {
      pending += decoder.decode(chunk, { stream: true })
      let boundary
      while ((boundary = /\r?\n\r?\n/.exec(pending))) {
        const frame = pending.slice(0, boundary.index)
        pending = pending.slice(boundary.index + boundary[0].length)
        if (Buffer.byteLength(frame) > maximumBytes) throw runtimeError('RUNTIME_PROTOCOL_FRAME_TOO_LARGE', 'OpenCode event exceeds limit')
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (data) {
          let event
          try { event = JSON.parse(data) }
          catch { throw runtimeError('RUNTIME_PROTOCOL_INVALID', 'OpenCode returned an invalid event') }
          onEvent(event)
        }
      }
      if (Buffer.byteLength(pending) > maximumBytes) throw runtimeError('RUNTIME_PROTOCOL_FRAME_TOO_LARGE', 'OpenCode event exceeds limit')
    }
  }
  return { request, events, close: () => lifetime.abort() }
}

export async function startOpenCodeServer({ executable, cwd, runtimeEnvironment, signal, onSpawn = () => {} }) {
  signal?.throwIfAborted()
  const port = await availablePort()
  signal?.throwIfAborted()
  const password = randomBytes(24).toString('hex')
  const overrides = { OPENCODE_SERVER_PASSWORD: password, OPENCODE_SERVER_USERNAME: 'opencode' }
  const child = spawn(executable, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd, env: runtimeEnvironment?.childEnvironment(overrides) ?? { ...process.env, ...overrides },
    stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
  })
  let closed = false
  const client = connectOpenCodeServer({ url: `http://127.0.0.1:${port}`, password, cwd })
  const close = () => {
    if (closed) return
    closed = true
    signal?.removeEventListener('abort', close)
    client.close()
    kill('SIGTERM')
    const timer = setTimeout(() => kill('SIGKILL'), 2_000)
    timer.unref()
    child.once('exit', () => clearTimeout(timer))
  }
  const kill = (signalName) => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
    try {
      if (process.platform === 'win32') child.kill(signalName)
      else process.kill(-child.pid, signalName)
    } catch {}
  }
  signal?.addEventListener('abort', close, { once: true })
  if (signal?.aborted) close()
  try {
    await new Promise((resolve, reject) => {
      let pending = ''
      const timer = setTimeout(() => reject(runtimeError('RUNTIME_START_TIMEOUT', 'OpenCode did not start')), 30_000)
      const done = (error) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', aborted)
        child.stdout.off('data', output)
        error ? reject(error) : resolve()
      }
      const aborted = () => done(runtimeError('RUN_CANCELED', 'OpenCode start canceled'))
      const output = (chunk) => {
        pending = (pending + chunk.toString()).slice(-4096)
        if (pending.includes(`http://127.0.0.1:${port}`)) done()
      }
      child.stdout.on('data', output)
      child.stderr.resume()
      child.once('spawn', () => onSpawn({ pid: child.pid }))
      child.once('error', () => done(runtimeError('RUNTIME_SPAWN_FAILED', 'OpenCode failed to spawn')))
      child.once('exit', () => done(runtimeError('RUNTIME_PROTOCOL_CLOSED', 'OpenCode server exited')))
      signal?.addEventListener('abort', aborted, { once: true })
      if (signal?.aborted) aborted()
    })
    if (closed) throw runtimeError('RUN_CANCELED', 'OpenCode start canceled')
    const health = await client.request('GET', '/global/health')
    if (health?.healthy !== true) throw runtimeError('RUNTIME_PROTOCOL_INVALID', 'OpenCode health check failed')
    child.stdout.resume()
    return { ...client, pid: child.pid, close }
  } catch (error) {
    close()
    throw error
  }
}

async function availablePort() {
  const server = createServer()
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}
