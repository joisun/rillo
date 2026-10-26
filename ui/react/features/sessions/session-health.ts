import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useSyncExternalStore } from 'react'

export function isSessionBlockingError(key: readonly unknown[], error: unknown) {
  return Boolean(error) && key[0] === 'dashboard' && key[1] === 'session-browser'
    && (key[2] === 'providers' || key[3] === 'workspaces' || key[3] === 'branches' || (key[3] === 'list' && key[5] === ''))
}

export function useSessionConnectionError() {
  const client = useQueryClient()
  const subscribe = useCallback((listener: () => void) => client.getQueryCache().subscribe(listener), [client])
  const snapshot = useCallback(() => client.getQueryCache().getAll().find(query =>
    query.isActive() && query.queryKey[0] === 'dashboard' && query.queryKey[1] === 'session-browser' && isSessionBlockingError(query.queryKey, query.state.error))?.state.error ?? null, [client])
  return useSyncExternalStore(subscribe, snapshot, () => null)
}
