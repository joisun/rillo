import type { BrowserSession } from '@/lib/api/types'
import { sessionStatusGroup, sessionStatusOptions, SessionStatusGroup } from './session-status'

export function SessionActivity({ session }: { session: BrowserSession }) {
  const group = sessionStatusGroup(session)
  if (group === SessionStatusGroup.Unknown) return null
  const option = sessionStatusOptions.find(option => option.id === group)!
  const label = session.state === 'systemError' ? 'Error' : option.label
  return <span className="session-activity" data-status={group} role="img" aria-label={label} title={`${label} · ${option.description}`}><span aria-hidden="true" /></span>
}
