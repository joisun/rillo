export function sessionBrowserError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode })
}

export function normalizeSessionReference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.provider !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value.provider)
    || typeof value.store_id !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(value.store_id)
    || typeof value.session_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value.session_id)) {
    throw sessionBrowserError('SESSION_BROWSER_REFERENCE_INVALID', '会话引用不完整或格式无效')
  }
  return { provider: value.provider, store_id: value.store_id, session_id: value.session_id }
}

export function sessionReferenceKey(value) {
  const ref = normalizeSessionReference(value)
  return JSON.stringify([ref.provider, ref.store_id, ref.session_id])
}
