import assert from 'node:assert/strict'
import test from 'node:test'

import { createOpenCodeRuntimeDefinition } from '../server/src/runtime/adapters/opencode.mjs'

function fixture() {
  let handler
  const stdout = []
  const stderr = []
  const events = []
  const client = {
    request: async (method, path) => path === '/session' ? { id: 'ses_test_session' } : null,
    events: (callback) => { handler = callback; return new Promise(() => {}) },
    close() {},
  }
  const definition = createOpenCodeRuntimeDefinition({
    pollMs: 60_000,
    startServer: async (options) => {
      options.onStdout?.(Buffer.from('OpenCode server ready\n'))
      options.onStderr?.(Buffer.from('server diagnostic\n'))
      return client
    },
  })
  const session = definition.createInteractiveSession({
    launch: { executable: '/usr/bin/opencode' },
    run: { workspace: '/workspace', title: 'test', prompt: 'do work', timeout_seconds: 60,
      sandbox_mode: 'danger-full-access', fast_mode: null, network_access: null },
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
    logs: { writeStdout: async (chunk) => stdout.push(chunk.toString()), writeStderr: async (chunk) => stderr.push(chunk.toString()) },
  })
  return { session, stdout, stderr, events, get handler() { return handler }, setHandler: value => { handler = value } }
}

test('OpenCode provider failures retain the actionable model error instead of a generic process failure', async () => {
  const run = fixture()
  const resultPromise = run.session.start()
  while (!run.handler) await new Promise(resolve => setImmediate(resolve))
  run.handler({ type: 'session.error', properties: { sessionID: 'ses_test_session', error: {
    name: 'APIError', data: { message: 'This model is not available in your country.' },
  } } })
  const result = await resultPromise
  assert.equal(result.error_code, 'RUNTIME_MODEL_UNAVAILABLE')
  assert.equal(result.final_message, 'This model is not available in your country.')
})

test('OpenCode adapter records server stdout/stderr and useful tool activity labels', async () => {
  const run = fixture()
  const resultPromise = run.session.start()
  while (!run.handler) await new Promise(resolve => setImmediate(resolve))
  run.handler({ type: 'message.part.updated', properties: { sessionID: 'ses_test_session', part: {
    id: 'tool-1', messageID: 'assistant-1', type: 'tool', tool: 'bash', state: {
      status: 'running', metadata: { title: 'Install project dependencies' },
    },
  } } })
  run.handler({ type: 'message.part.updated', properties: { sessionID: 'ses_test_session', part: {
    id: 'tool-2', messageID: 'assistant-1', type: 'tool', tool: 'bash', state: {
      status: 'running', input: { command: 'npm test API_KEY=private-value && echo done' },
    },
  } } })
  assert.ok(run.events.some(event => event.type === 'activity_started' && /Install project dependencies/.test(event.payload.label)))
  const commandActivity = run.events.find(event => event.type === 'activity_started' && event.payload.item_id === 'tool-2')
  assert.match(commandActivity.payload.label, /npm test/)
  assert.doesNotMatch(commandActivity.payload.label, /private-value/)
  await run.session.close()
  await resultPromise
  assert.ok(run.stdout.join('').includes('Install project dependencies'))
  assert.ok(run.stdout.join('').includes('OpenCode server ready'))
  assert.ok(run.stderr.join('').includes('server diagnostic'))
})
