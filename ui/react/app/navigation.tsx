import { CalendarClock, MessagesSquare } from 'lucide-react'
import { SegmentedControl } from '@/components/ui/segmented-control'
import type { DashboardView } from '@/lib/preferences/dashboard-preferences'

export function Navigation({ view, onViewChange }: { view: DashboardView; onViewChange: (view: DashboardView) => void }) {
  return <nav aria-label="Dashboard views"><SegmentedControl className="app-navigation" label="Dashboard 视图" value={view} onValueChange={onViewChange} options={[
    { value: 'sessions', label: <><MessagesSquare aria-hidden="true" />Sessions</> },
    { value: 'scheduled', label: <><CalendarClock aria-hidden="true" />Scheduled</> },
  ]} /></nav>
}
