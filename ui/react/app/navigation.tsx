import { CalendarClock, MessagesSquare } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { DashboardView } from '@/lib/preferences/dashboard-preferences'

export function Navigation({
  view,
  onViewChange,
}: {
  view: DashboardView
  onViewChange: (view: DashboardView) => void
}) {
  return (
    <nav className="app-navigation" aria-label="Dashboard views">
      <Button
        type="button"
        className={`app-navigation__item${view === 'sessions' ? ' is-active' : ''}`}
        aria-current={view === 'sessions' ? 'page' : undefined}
        size="xs"
        variant={view === 'sessions' ? 'secondary' : 'quiet'}
        onPress={() => onViewChange('sessions')}
      >
        <MessagesSquare aria-hidden="true" />
        Sessions
      </Button>
      <Button
        type="button"
        className={`app-navigation__item${view === 'scheduled' ? ' is-active' : ''}`}
        aria-current={view === 'scheduled' ? 'page' : undefined}
        size="xs"
        variant={view === 'scheduled' ? 'secondary' : 'quiet'}
        onPress={() => onViewChange('scheduled')}
      >
        <CalendarClock aria-hidden="true" />
        Scheduled
      </Button>
    </nav>
  )
}
