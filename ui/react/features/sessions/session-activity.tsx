export function SessionActivity({ state, isOpen = false }: { state: string; isOpen?: boolean }) {
  if (state !== 'active' && !isOpen) return null
  return <span className="session-activity" role="img" aria-label="会话活跃" title="会话活跃"><span aria-hidden="true" /></span>
}
