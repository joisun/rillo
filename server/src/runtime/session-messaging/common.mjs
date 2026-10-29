import { spawn } from 'node:child_process'

export const MESSAGE_MODES = ['queue', 'steer', 'interrupt']

export function messageError(code, message, { delivery = 'not_sent', fallback = false, statusCode = 409 } = {}) {
  return Object.assign(new Error(message), { code, delivery, fallback, statusCode })
}
export function unavailable(message = '此通道暂不可用') {
  return messageError('SESSION_MESSAGE_UNAVAILABLE', message, { fallback: true, statusCode: 503 })
}
export function unknown(message = '无法确认消息是否已接受；未自动重发') {
  return messageError('SESSION_MESSAGE_UNKNOWN', message, { delivery: 'unknown' })
}
export function timeout(promise, milliseconds = 15000) {
  let timer
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(unknown('等待原生回执超时；未自动重发')), milliseconds) })]).finally(() => clearTimeout(timer))
}
export function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  promise.catch(() => {})
  return { promise, resolve, reject }
}
export async function runCommand(executable, args, { env = process.env, cwd, timeoutMs = 10000, spawnImpl = spawn, mutation = false } = {}) {
  return new Promise((resolve, reject) => {
    let started = false, stdout = '', stderr = '', settled = false, forceTimer
    const child = spawnImpl(executable, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    const finish = (error, result) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      if (error) reject(error); else resolve(result)
    }
    const failure = () => mutation && started ? unknown() : unavailable()
    const terminate = () => {
      child.kill('SIGTERM')
      forceTimer ??= setTimeout(() => child.kill('SIGKILL'), 1000)
      forceTimer.unref?.()
    }
    const timer = setTimeout(() => { terminate(); finish(failure()) }, timeoutMs)
    child.once('spawn', () => { started = true })
    child.once('error', () => finish(failure()))
    child.stdout.on('data', bytes => {
      stdout += bytes
      if (stdout.length > 2 * 1024 * 1024) { terminate(); finish(failure()) }
    })
    child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-4096) })
    child.once('close', code => {
      clearTimeout(forceTimer)
      if (code !== 0) return finish(Object.assign(failure(), { exitCode: code }))
      finish(null, { stdout, stderr })
    })
  })
}
