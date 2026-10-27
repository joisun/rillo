export function sessionKey(session: { provider: string; store_id: string; session_id: string }) {
  return `${session.provider}:${session.store_id}:${session.session_id}`
}

export function Highlight({ text, query }: { text: string; query: string }) {
  const position = query ? text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) : -1
  if (position < 0) return <>{text}</>
  return <>{text.slice(0, position)}<mark>{text.slice(position, position + query.length)}</mark>{text.slice(position + query.length)}</>
}
