import type { BrowserSession } from '@/lib/api/types'

export type TimelineLoadRequest = { session: BrowserSession; sequence: number }
const MAX_TIMELINE_REQUESTS = 4

export function createTimelineRequestQueue(limit = MAX_TIMELINE_REQUESTS) {
  let active = 0
  let background = 0
  const waiting: Array<{ start: () => void; priority: 'foreground' | 'background' }> = []

  function drain() {
    while (active < limit) {
      const foreground = waiting.findIndex(entry => entry.priority === 'foreground')
      const index = foreground >= 0 ? foreground : background < Math.max(1, limit - 1) ? 0 : -1
      if (index < 0 || !waiting.length) return
      waiting.splice(index, 1)[0].start()
    }
  }

  return {
    run<T>(request: () => Promise<T>, signal: AbortSignal, priority: 'foreground' | 'background' = 'foreground'): Promise<T> {
      return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(signal.reason); return }
        const cancel = () => {
          const index = waiting.findIndex(entry => entry.start === start)
          if (index >= 0) waiting.splice(index, 1)
          reject(signal.reason)
        }
        const start = () => {
          signal.removeEventListener('abort', cancel)
          active += 1
          if (priority === 'background') background += 1
          Promise.resolve().then(() => { signal.throwIfAborted(); return request() }).then(resolve, reject).finally(() => {
            active -= 1
            if (priority === 'background') background -= 1
            drain()
          })
        }
        waiting.push({ start, priority })
        signal.addEventListener('abort', cancel, { once: true })
        drain()
      })
    },
  }
}

export const sessionReadRequests = createTimelineRequestQueue()
