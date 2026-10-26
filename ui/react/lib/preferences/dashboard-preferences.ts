export type DashboardView = 'scheduled' | 'sessions'
export type SessionsViewMode = 'list' | 'activity'
export type SessionGroupMode = 'workspace' | 'branch'
const SESSIONS_VIEW_KEY = 'tasks-recorder.sessions-view'
const SESSIONS_GROUP_KEY = 'tasks-recorder.sessions-group'

export function readSessionsGroup(location = window.location): SessionGroupMode {
  const group = new URLSearchParams(location.search).get('group') ?? window.localStorage.getItem(SESSIONS_GROUP_KEY)
  return group === 'branch' ? 'branch' : 'workspace'
}

export function persistSessionsGroup(group: SessionGroupMode) {
  window.localStorage.setItem(SESSIONS_GROUP_KEY, group)
  const url = new URL(window.location.href)
  url.searchParams.set('group', group)
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

export function readDashboardView(location = window.location): DashboardView {
  const view = new URLSearchParams(location.search).get('view')
  return view === 'scheduled' ? view : 'sessions'
}

export function readSessionsView(location = window.location): SessionsViewMode {
  const parameters = new URLSearchParams(location.search)
  if (parameters.get('view') === 'tasks') return 'activity'
  const mode = parameters.get('sessions') ?? window.localStorage.getItem(SESSIONS_VIEW_KEY)
  return mode === 'list' ? 'list' : 'activity'
}

export function persistSessionsView(mode: SessionsViewMode) {
  window.localStorage.setItem(SESSIONS_VIEW_KEY, mode)
  const url = new URL(window.location.href)
  url.searchParams.set('sessions', mode)
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

export function persistDashboardView(view: DashboardView, history = window.history) {
  const url = new URL(window.location.href)
  if (url.searchParams.get('view') === view) return
  url.searchParams.set('view', view)
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`)
}
