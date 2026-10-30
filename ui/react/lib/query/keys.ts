import type { SessionRef } from '../api/types'

export function isSessionMetadataQuery(key: readonly unknown[]) {
  if (key[0] !== 'dashboard' || key[1] !== 'session-browser') return false
  if (key[3] === 'list') return key[5] === ''
  if (key[3] === 'workspaces' || key[3] === 'branches') return true
  if (key[3] === 'pinned' || key.at(-1) === 'pins') return true
  return key.at(-1) === 'children' || key.at(-1) === 'relations' || key.at(-1) === 'activity'
}

export const queryKeys = {
  all: ['dashboard'] as const,
  meta: ['dashboard', 'meta'] as const,
  settings: ['dashboard', 'settings'] as const,
  sessionBrowser: ['dashboard', 'session-browser'] as const,
  sessionProviders: ['dashboard', 'session-browser', 'providers'] as const,
  sessionPins: ['dashboard', 'session-browser', 'pins'] as const,
  sessionPinnedList: (provider: string, store: string, workspace: string, branch: string) => ['dashboard', 'session-browser', provider, 'pinned', store, workspace, branch] as const,
  sessionActivity: (provider: string, store: string) => ['dashboard', 'session-browser', provider, store, 'activity'] as const,
  sessionWorkspaces: (provider: string, archived: boolean) => ['dashboard', 'session-browser', provider, 'workspaces', archived] as const,
  sessionBranches: (provider: string, archived: boolean) => ['dashboard', 'session-browser', provider, 'branches', archived] as const,
  sessionList: (provider: string, workspace: string, query: string, archived: boolean, branch = '') => ['dashboard', 'session-browser', provider, 'list', workspace, query, archived, branch] as const,
  sessionSearch: (provider: string, workspace: string, query: string, archived: boolean, branch = '') => ['dashboard', 'session-browser', provider, 'search', workspace, query, archived, branch] as const,
  sessionMessages: (provider: string, store: string, id: string, query: string, at = '', itemId = '') => ['dashboard', 'session-browser', provider, store, id, 'messages', query, at, itemId] as const,
  sessionRead: (ref: SessionRef) => ['dashboard', 'session-browser', ref.provider, ref.store_id, ref.session_id, 'read'] as const,
  sessionChildren: (ref: SessionRef) => ['dashboard', 'session-browser', ref.provider, ref.store_id, ref.session_id, 'children'] as const,
  sessionTimeline: (ref: SessionRef, scope: string, revision: string) => ['dashboard', 'session-browser', ref.provider, ref.store_id, ref.session_id, 'timeline', scope, revision] as const,
  sessionRelations: (ref: SessionRef) => ['dashboard', 'session-browser', ref.provider, ref.store_id, ref.session_id, 'relations'] as const,
  schedules: ['dashboard', 'schedules'] as const,
  schedule: (id: string) => ['dashboard', 'schedules', id] as const,
  runs: (scheduleId: string) => ['dashboard', 'schedules', scheduleId, 'runs'] as const,
  allRuns: ['dashboard', 'runs'] as const,
  run: (runId: string) => ['dashboard', 'runs', runId] as const,
  runConversation: (runId: string) => ['dashboard', 'runs', runId, 'conversation'] as const,
  runLog: (runId: string, stream: 'stdout' | 'stderr') => (
    ['dashboard', 'runs', runId, 'logs', stream] as const
  ),
}
