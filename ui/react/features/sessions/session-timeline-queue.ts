import type { BrowserSession } from '@/lib/api/types'

export type TimelineLoadRequest = { session: BrowserSession; sequence: number }
const MAX_TIMELINE_REQUESTS = 4

export function createTimelineRequestQueue(limit = MAX_TIMELINE_REQUESTS) {
  let active = 0
  const waiting: Array<() => void> = []

  return {
    run<T>(request: () => Promise<T>, signal: AbortSignal): Promise<T> {
      return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(signal.reason); return }
        const cancel = () => {
          const index = waiting.indexOf(start)
          if (index >= 0) waiting.splice(index, 1)
          reject(signal.reason)
        }
        const start = () => {
          signal.removeEventListener('abort', cancel)
          active += 1
          Promise.resolve().then(() => { signal.throwIfAborted(); return request() }).then(resolve, reject).finally(() => {
            active -= 1
            waiting.shift()?.()
          })
        }
        if (active < limit) start()
        else { waiting.push(start); signal.addEventListener('abort', cancel, { once: true }) }
      })
    },
  }
}
