import type { BrowserSession, SessionActivityPage } from '@/lib/api/types'
import { sessionKey } from './session-format'

export enum SessionStatusGroup {
  NeedsYou = 'needs-you',
  Working = 'working',
  Ready = 'ready',
  Inactive = 'inactive',
  Unknown = 'unknown',
}

export const sessionStatusOptions = [
  { id: SessionStatusGroup.NeedsYou, label: 'Needs you', description: '等待审批、输入，或主会话发生错误' },
  { id: SessionStatusGroup.Working, label: 'Working', description: '正在执行' },
  { id: SessionStatusGroup.Ready, label: 'Ready', description: '已加载，等待新的指令' },
  { id: SessionStatusGroup.Inactive, label: 'Inactive', description: '未加载，或子会话已失败' },
] as const

export function sessionStatusGroup(session: BrowserSession): SessionStatusGroup {
  if (session.state === 'active') {
    return session.active_flags?.some(flag => flag === 'waitingOnApproval' || flag === 'waitingOnUserInput')
      ? SessionStatusGroup.NeedsYou : SessionStatusGroup.Working
  }
  if (session.state === 'systemError') return session.native_parent ? SessionStatusGroup.Inactive : SessionStatusGroup.NeedsYou
  if (session.state === 'idle') return SessionStatusGroup.Ready
  if (session.state === 'notLoaded') return SessionStatusGroup.Inactive
  return SessionStatusGroup.Unknown
}

export function sessionWithStatus(session: BrowserSession, activity: SessionActivityPage | undefined, statuses: Map<string, BrowserSession>) {
  if (session.state === 'unavailable') return session
  const native = statuses.get(sessionKey(session))
  const available = activity?.available && activity.store_id === session.store_id
  return { ...session, is_subagent: Boolean(session.is_subagent || native?.is_subagent), state: available ? native?.state ?? 'notLoaded' : 'unknown', active_flags: available ? native?.active_flags ?? [] : [] }
}

export function compareSessions(left: BrowserSession, right: BrowserSession, preferred: SessionStatusGroup | null = null) {
  const promoted = Number(sessionStatusGroup(right) === preferred) - Number(sessionStatusGroup(left) === preferred)
  return promoted || (right.last_active_at ?? '').localeCompare(left.last_active_at ?? '')
}
