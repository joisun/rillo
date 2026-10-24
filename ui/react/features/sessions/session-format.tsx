export function sessionKey(session: { provider: string; store_id: string; session_id: string }) {
  return `${session.provider}:${session.store_id}:${session.session_id}`
}

export function workspaceName(path: string) {
  return path.split('/').filter(Boolean).at(-1) || path
}

export function activityDay(timestamp: string | null) {
  if (!timestamp) return '时间未知'
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return '今天'
  if (date.toDateString() === yesterday.toDateString()) return '昨天'
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

export function activityTime(timestamp: string | null) {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function Highlight({ text, query }: { text: string; query: string }) {
  const position = query ? text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) : -1
  if (position < 0) return <>{text}</>
  return <>{text.slice(0, position)}<mark>{text.slice(position, position + query.length)}</mark>{text.slice(position + query.length)}</>
}
