import assert from 'node:assert/strict'
import test from 'node:test'
import { createSessionClient } from '../mcp/src/session-client.mjs'

test('API v4 service is rejected before any relation mutation', async () => {
  const requests = []
  const client = createSessionClient({ baseUrl: 'http://127.0.0.1:43127', fetchImpl: async (url, options) => {
    requests.push({ url, options })
    return Response.json({ api_version: 4 })
  } })
  await assert.rejects(client.link({ parent: {}, child: {} }), error => error.code === 'API_VERSION_MISMATCH' && /v5/.test(error.message))
  assert.equal(requests.length, 1)
  assert.equal(new URL(requests[0].url).pathname, '/api/v1/meta')
  assert.equal(requests[0].options.method, 'GET')
  assert.equal(requests[0].options.headers['X-Tasks-Recorder-API-Version'], '5')
})

test('session client preserves actionable errors and normalizes connection failures', async () => {
  const offline = createSessionClient({ baseUrl: 'http://127.0.0.1:43127', fetchImpl: async () => { throw new Error('ECONNREFUSED') } })
  await assert.rejects(offline.providers(), error => error.code === 'SERVICE_UNAVAILABLE')
  const conflict = createSessionClient({ baseUrl: 'http://127.0.0.1:43127', fetchImpl: async url => (
    url.endsWith('/meta') ? Response.json({ api_version: 5 })
      : Response.json({ error: { code: 'SESSION_LINK_CONFLICT', message: 'Child already linked', details: { parent: 'existing' } } }, { status: 409 })
  ) })
  await assert.rejects(conflict.link({ parent: {}, child: {} }), error => error.code === 'SESSION_LINK_CONFLICT' && error.details.parent === 'existing')
  const invalid = createSessionClient({ baseUrl: 'http://127.0.0.1:43127', fetchImpl: async () => new Response('not JSON') })
  await assert.rejects(invalid.providers(), error => error.code === 'SERVICE_RESPONSE_INVALID')
})

test('session client rejects remote origins before making requests', () => {
  for (const baseUrl of ['https://127.0.0.1', 'http://localhost:43127', 'http://127.0.0.1:43127/path', 'http://user:secret@127.0.0.1:43127']) {
    assert.throws(() => createSessionClient({ baseUrl }), error => error.code === 'CONFIG_INVALID')
  }
})
