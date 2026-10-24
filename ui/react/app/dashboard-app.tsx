import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { queryKeys } from '@/lib/query/keys'
import { persistDashboardView, readDashboardView } from '@/lib/preferences/dashboard-preferences'
import { ScheduledView } from '@/features/scheduled/scheduled-view'
import { SessionsView } from '@/features/sessions/sessions-view'
import { AppShell } from './app-shell'
import { useDashboardApi, useDashboardConnection } from './app-providers'

export function DashboardApp() {
  const api = useDashboardApi()
  const connectionState = useDashboardConnection()
  const [view, setView] = useState(readDashboardView)
  const schedules = useQuery({ queryKey: queryKeys.schedules, queryFn: () => api.schedules(), enabled: view === 'scheduled' })
  useEffect(() => persistDashboardView(view), [view])

  return (
    <AppShell connectionState={connectionState} countLabel={view === 'sessions' ? '本机会话' : `${schedules.data?.jobs.length ?? '—'} 个计划`} onViewChange={setView} view={view}>
      <div className="sessions-host" hidden={view !== 'sessions'}><SessionsView api={api} /></div>
      {view === 'scheduled' ? <ScheduledView api={api} data={schedules.data ?? null} isPending={schedules.isPending} error={schedules.error} /> : null}
    </AppShell>
  )
}
