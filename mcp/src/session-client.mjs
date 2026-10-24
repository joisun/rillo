import { TaskRecorderError } from './errors.mjs'

export const API_VERSION = 5

function localOrigin(value) {
  let url
  try { url = new URL(value) } catch {
    throw new TaskRecorderError('CONFIG_INVALID', 'Tasks Recorder service URL is invalid.')
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
    || url.username || url.password || !['', '/'].includes(url.pathname) || url.search || url.hash) {
    throw new TaskRecorderError('CONFIG_INVALID', 'Tasks Recorder service URL must be an http://127.0.0.1 origin.')
  }
  return url.origin
}

export function createSessionClient({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 35_000 }) {
  const origin = localOrigin(baseUrl)
  async function request(path, { method = 'GET', body } = {}) {
    let response
    try {
      response = await fetchImpl(`${origin}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          'X-Tasks-Recorder-API-Version': String(API_VERSION),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      throw new TaskRecorderError('SERVICE_UNAVAILABLE', 'Tasks Recorder service is unavailable. Run `tasks-recorder status` or install the service.')
    }
    const result = await response.json().catch(() => {
      throw new TaskRecorderError('SERVICE_RESPONSE_INVALID', 'Tasks Recorder service returned invalid JSON.')
    })
    if (!response.ok) {
      throw new TaskRecorderError(result?.error?.code ?? 'SERVICE_REQUEST_FAILED', result?.error?.message ?? `HTTP ${response.status}`, result?.error?.details)
    }
    return result
  }

  async function compatibleRequest(path, options) {
    const meta = await request('/api/v1/meta')
    if (meta.api_version !== API_VERSION) {
      throw new TaskRecorderError('API_VERSION_MISMATCH', `Tasks Recorder API v${API_VERSION} is required (service reports ${meta.api_version ?? 'unknown'}). Update the client and service together.`)
    }
    return request(path, options)
  }

  return {
    providers: () => compatibleRequest('/api/v1/session-browser/providers'),
    link: (input) => compatibleRequest('/api/v1/session-browser/links', { method: 'POST', body: input }),
    unlink: (input) => compatibleRequest('/api/v1/session-browser/links', { method: 'DELETE', body: input }),
    schedulerStatus: () => compatibleRequest('/api/v1/status'),
    schedulerReconcile: () => compatibleRequest('/api/v1/scheduler/reconcile', { method: 'POST', body: {} }),
  }
}
