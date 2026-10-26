import { expect, test, vi } from 'vitest'
import { createTimelineRequestQueue } from './session-timeline-queue'

test('at most four requests run, queued cancellation removes work and completion frees a slot', async () => {
  const queue = createTimelineRequestQueue()
  const started: number[] = []
  const finish = new Map<number, (value: number) => void>()
  const controllers = Array.from({ length: 6 }, () => new AbortController())
  const requests = controllers.map((controller, index) => queue.run(() => {
    started.push(index)
    return new Promise<number>((resolve) => { finish.set(index, resolve) })
  }, controller.signal))
  await Promise.resolve()
  expect(started).toEqual([0, 1, 2, 3])
  const canceled = expect(requests[4]).rejects.toMatchObject({ name: 'AbortError' })
  controllers[4].abort()
  await canceled
  finish.get(0)!(0)
  await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3, 5]))
  for (const [index, resolve] of finish) resolve(index)
  await Promise.all(requests.filter((_request, index) => index !== 4))
})

test('background reads reserve a foreground slot, and queued user work takes priority', async () => {
  const queue = createTimelineRequestQueue()
  const started: string[] = [], finish = new Map<string, () => void>()
  const run = (id: string, priority: 'foreground' | 'background') => queue.run(() => {
    started.push(id)
    return new Promise<void>(resolve => finish.set(id, resolve))
  }, new AbortController().signal, priority)
  const tasks = ['b1', 'b2', 'b3', 'b4'].map(id => run(id, 'background'))
  await Promise.resolve()
  expect(started).toEqual(['b1', 'b2', 'b3'])
  tasks.push(run('click', 'foreground'), run('seek', 'foreground'))
  await Promise.resolve()
  expect(started).toEqual(['b1', 'b2', 'b3', 'click'])
  finish.get('b1')!()
  await vi.waitFor(() => expect(started.at(-1)).toBe('seek'))
  finish.get('b2')!()
  await vi.waitFor(() => expect(started.at(-1)).toBe('b4'))
  for (const resolve of finish.values()) resolve()
  await Promise.all(tasks)
})
