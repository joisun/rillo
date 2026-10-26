import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createTaskStore } from '../mcp/src/task-store.mjs'

export async function temporaryStore(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'tasks-recorder-test-'))
  const databasePath = join(directory, 'tasks.sqlite')
  const store = createTaskStore({ databasePath, ...options })
  return {
    databasePath,
    directory,
    store,
    async cleanup() {
      store.close()
      await rm(directory, { recursive: true, force: true })
    },
  }
}

export function taskInput(overrides = {}) {
  return {
    id: 'example-task',
    title: 'Example task',
    status: 'active',
    session_id: 'session-1',
    workfolder: '/workspace/example',
    agent: 'Codex',
    ...overrides,
  }
}
