import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useSyncExternalStore } from 'react'

import { DashboardApiError } from '@/lib/api/dashboard-api'

export function isSessionConnectionError(error: unknown) {
  return error instanceof DashboardApiError && (['SESSION_BROWSER_UNAVAILABLE', 'DASHBOARD_CONNECTION_FAILED', 'DASHBOARD_REQUEST_TIMEOUT', 'DASHBOARD_INVALID_RESPONSE'].includes(error.code) || error.status === 503 || error.status === 504)
}

export function isSessionBlockingError(key: readonly unknown[], error: unknown) {
  return Boolean(error) && (isSessionConnectionError(error) || key[2] === 'providers' || key[3] === 'workspaces' || (key[3] === 'list' && key[5] === ''))
}

export function useSessionConnectionError() {
  const client = useQueryClient()
  const subscribe = useCallback((listener: () => void) => client.getQueryCache().subscribe(listener), [client])
  const snapshot = useCallback(() => client.getQueryCache().getAll().find(query =>
    query.isActive() && query.queryKey[0] === 'dashboard' && query.queryKey[1] === 'session-browser' && isSessionBlockingError(query.queryKey, query.state.error))?.state.error ?? null, [client])
  return useSyncExternalStore(subscribe, snapshot, () => null)
}
