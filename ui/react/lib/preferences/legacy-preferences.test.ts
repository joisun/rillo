import { describe, expect, it } from 'vitest'
import { migrateLegacyPreferences } from './legacy-preferences'

function storage(entries: Record<string, string>) {
  const data = new Map(Object.entries(entries))
  return {
    get length() { return data.size },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
    clear: () => data.clear(),
  } satisfies Storage
}

describe('legacy browser preference migration', () => {
  it('moves old product keys while keeping unrelated preferences', () => {
    const data = storage({ 'tasks-recorder.sessions-group': 'branch', unrelated: 'value' })
    migrateLegacyPreferences(data)
    expect(data.getItem('rillo.sessions-group')).toBe('branch')
    expect(data.getItem('tasks-recorder.sessions-group')).toBeNull()
    expect(data.getItem('unrelated')).toBe('value')
  })
  it('retains an existing Rillo preference', () => {
    const data = storage({ 'task_recorder.sessions-group': 'branch', 'rillo.sessions-group': 'workspace' })
    migrateLegacyPreferences(data)
    expect(data.getItem('rillo.sessions-group')).toBe('workspace')
  })
  it('keeps the old value when storage cannot write the migrated preference', () => {
    const data = storage({ 'tasks-recorder.sessions-group': 'branch' })
    data.setItem = () => { throw new Error('quota') }
    expect(() => migrateLegacyPreferences(data)).not.toThrow()
    expect(data.getItem('tasks-recorder.sessions-group')).toBe('branch')
  })
})
