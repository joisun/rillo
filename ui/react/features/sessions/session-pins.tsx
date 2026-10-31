import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pin } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { DashboardApi } from '@/lib/api/dashboard-api'
import type { BrowserSession, SessionPin } from '@/lib/api/types'
import { queryKeys } from '@/lib/query/keys'
import { sessionKey } from './session-format'

export function useSessionPins(api: DashboardApi) {
  return useQuery({ queryKey: queryKeys.sessionPins, queryFn: () => api.sessionPins(), retry: false, staleTime: 15_000 })
}

export function SessionPinButton({ api, session }: { api: DashboardApi; session: BrowserSession }) {
  const client = useQueryClient()
  const pins = useSessionPins(api)
  const key = sessionKey(session)
  const pinned = pins.data?.pins.some(pin => sessionKey(pin) === key) ?? false
  const mutationKey = [...queryKeys.sessionPins, key]
  const pending = useIsMutating({ mutationKey }) > 0
  const mutation = useMutation({
    mutationKey,
    mutationFn: () => api.setSessionPin(session, !pinned),
    onMutate: () => client.cancelQueries({ queryKey: queryKeys.sessionPins, exact: true }),
    onSuccess: result => {
      client.setQueryData<{ pins: SessionPin[] }>(queryKeys.sessionPins, current => ({ pins: [
        ...(current?.pins ?? []).filter(pin => sessionKey(pin) !== key), ...(result.pin ? [result.pin] : []),
      ] }))
      void client.invalidateQueries({ queryKey: queryKeys.sessionBrowser, predicate: query => query.queryKey[3] === 'pinned' })
    },
  })
  const label = pinned ? '取消 Pin' : 'Pin 会话'
  return <span className="session-pin" data-pinned={pinned || undefined} title={label}>
    <Button size="xs" variant={pinned ? 'secondary' : 'quiet'} isIconOnly aria-label={`${label}：${session.title}`} aria-pressed={pinned}
      disabled={pending || !pins.data || (!pinned && session.state === 'unavailable')} isPending={pending} onClick={() => mutation.mutate()}>
      <Pin />
    </Button>
    {mutation.isError ? <span className="session-row-resume__feedback session-error" role="alert">{mutation.error.message}</span> : null}
  </span>
}
