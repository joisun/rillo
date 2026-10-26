import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createApiServer } from '../server/src/api-server.mjs'
import { createRevisionHub } from '../server/src/revision-hub.mjs'
import { createSessionBrowser } from '../server/src/session-browser.mjs'
import { createSessionLinkStore } from '../server/src/session-link-store.mjs'

test('root MCP forwards only session tools through API v5 without a Task database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'session-mcp-'))
  const hub = createRevisionHub()
  const links = createSessionLinkStore({ databasePath: join(directory, 'session-links.sqlite') })
  const parent = { provider: 'codex', store_id: 'native-store', session_id: 'parent-thread' }
  const child = { ...parent, session_id: 'child-thread' }
  const browser = createSessionBrowser({ adapters: [{
    id: 'codex', name: 'Codex', storeId: parent.store_id, capabilities: {},
    readSession: async id => ({ ...parent, session_id: id, native_parent: null, forked_from: null, created_at: null }),
  }], links })
  const api = createApiServer({ hub, sessionBrowser: browser, port: 0, dashboardHtml: '<!doctype html>' })
  const address = await api.listen()
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL('../mcp/server.mjs', import.meta.url).pathname],
    cwd: directory,
    env: { ...process.env, AGENT_TASKS_SERVER_URL: address.url },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'session-integration', version: '1.0.0' })
  try {
    await client.connect(transport)
    assert.deepEqual((await client.listTools()).tools.map(({ name }) => name).sort(), ['session_link', 'session_sources', 'session_unlink'])
    const sources = await client.callTool({ name: 'session_sources', arguments: {} })
    assert.equal(sources.structuredContent.providers[0].store_id, parent.store_id)
    const written = await client.callTool({ name: 'session_link', arguments: { parent, child, source: 'otty' } })
    assert.equal(written.structuredContent.created, true)
    assert.equal(written.structuredContent.relation.kind, 'delegation')
    assert.equal(hub.current().revision, 1)
    assert.equal(links.list({ parent }).length, 1)
    const repeated = await client.callTool({ name: 'session_link', arguments: { parent, child, source: 'otty' } })
    assert.equal(repeated.structuredContent.created, false)
    assert.equal(hub.current().revision, 1)
    const query = new URLSearchParams(parent)
    const relations = await fetch(`${address.url}/api/v1/session-browser/relations?${query}`).then(response => response.json())
    assert.equal(relations.relations.length, 1)
    assert.equal((await fetch(`${address.url}/api/v1/session-browser/relations`)).status, 400)
    const invalid = await client.callTool({ name: 'session_link', arguments: { parent, child: { ...child, store_id: 'wrong-store' } } })
    assert.equal(invalid.isError, true)
    assert.equal(invalid.structuredContent.error.code, 'SESSION_BROWSER_REFERENCE_INVALID')
    const removed = await client.callTool({ name: 'session_unlink', arguments: { parent, child } })
    assert.equal(removed.structuredContent.removed, true)
    assert.equal(hub.current().revision, 2)
    assert.equal(links.list({ parent }).length, 0)
    await assert.rejects(readFile(join(directory, 'tasks.sqlite')), { code: 'ENOENT' })
  } finally {
    await client.close()
    hub.close()
    await api.close()
    browser.close()
    links.close()
    await rm(directory, { recursive: true, force: true })
  }
})
