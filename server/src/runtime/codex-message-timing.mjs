export function messageTimestamp(entry) {
  const value = entry.completedAtMs ?? entry.startedAtMs
  if (!Number.isFinite(value)) return null
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? null : date.toISOString()
}
