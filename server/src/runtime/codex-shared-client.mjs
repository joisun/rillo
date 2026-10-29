import { join } from 'node:path'

import WebSocket from '../../vendor/ws.mjs'

// This connection observes the existing daemon. It never starts or owns that server.
export function createCodexSharedClient({ dataRoot, requestTimeoutMs = 5000, allowedMethods = ['initialize', 'thread/loaded/list', 'thread/read'] }) {
  const socket = new WebSocket(`ws+unix:${join(dataRoot, 'app-server-control', 'app-server-control.sock')}:/`, {
    handshakeTimeout: requestTimeoutMs,
    maxPayload: 8 * 1024 * 1024,
    perMessageDeflate: false,
  })
  const pending = new Map()
  const listeners = new Set()
  let nextId = 0
  let closed = false
  const started = new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
    socket.once('close', () => reject(new Error('CODEX_SHARED_SERVER_CLOSED')))
  })
  started.catch(() => {})

  function close() {
    if (closed) return
    closed = true
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('CODEX_SHARED_SERVER_CLOSED'))
    }
    pending.clear()
    listeners.clear()
    socket.terminate()
  }
  socket.on('error', close)
  socket.on('close', close)
  socket.on('message', bytes => {
    let message
    try { message = JSON.parse(bytes.toString()) } catch { return }
    if (typeof message.method === 'string' && !Object.hasOwn(message, 'id')) {
      for (const listener of listeners) { try { listener(message) } catch {} }
      return
    }
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timer)
    if (message.error) request.reject(Object.assign(new Error('CODEX_SHARED_SERVER_REQUEST_FAILED'), { rpcCode: message.error.code }))
    else request.resolve(message.result)
  })

  return {
    started,
    get closed() { return closed },
    request(method, params = {}) {
      if (!allowedMethods.includes(method)) throw new Error('CODEX_SHARED_SERVER_READ_ONLY')
      if (closed) return Promise.reject(new Error('CODEX_SHARED_SERVER_CLOSED'))
      const id = ++nextId
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error('CODEX_SHARED_SERVER_TIMEOUT'))
        }, requestTimeoutMs)
        timer.unref?.()
        pending.set(id, { resolve, reject, timer })
        socket.send(JSON.stringify({ id, method, params }), error => {
          if (!error || !pending.delete(id)) return
          clearTimeout(timer)
          reject(error)
        })
      })
    },
    notify(method) {
      if (method !== 'initialized') throw new Error('CODEX_SHARED_SERVER_READ_ONLY')
      socket.send(JSON.stringify({ method }))
    },
    onNotification(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    close,
  }
}
