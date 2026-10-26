import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createSessionLinkStore } from '../server/src/session-link-store.mjs'
import { createSessionBrowser } from '../server/src/session-browser.mjs'

const ref = (session_id, provider = 'codex', store_id = 'local-store') => ({ provider, store_id, session_id })

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'session-links-test-'))
  const path = join(directory, 'session-links.sqlite')
  const legacy = join(directory, 'tasks.sqlite')
  await writeFile(legacy, 'legacy database must remain untouched')
  let store = createSessionLinkStore({ databasePath: path, clock: () => new Date('2026-10-24T00:00:00Z') })
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }) })
  return { get store() { return store }, legacy, reopen() { store.close(); store = createSessionLinkStore({ databasePath: path }); return store } }
}

test('relationships survive restart without opening or migrating the old Task database', async (t) => {
  const current = await fixture(t)
  const saved = current.store.link({ parent: ref('a'), child: ref('b'), source: 'otty' })
  assert.equal(saved.created, true)
  assert.equal(saved.relation.kind, 'delegation')
  assert.equal(saved.relation.origin, 'registered')
  assert.equal(current.store.link({ parent: ref('a'), child: ref('b') }).created, false)
  assert.deepEqual(current.reopen().list({ parent: ref('a') }), [saved.relation])
  assert.equal(await readFile(current.legacy, 'utf8'), 'legacy database must remain untouched')
  assert.equal(current.store.check().integrityCheck, 'ok')
})

test('one parent per child, self-links, reverse links and indirect cycles are enforced transactionally', async (t) => {
  const { store } = await fixture(t)
  store.link({ parent: ref('a'), child: ref('b') })
  store.link({ parent: ref('b'), child: ref('c') })
  assert.throws(() => store.link({ parent: ref('a'), child: ref('a') }), { code: 'SESSION_LINK_CYCLE' })
  assert.throws(() => store.link({ parent: ref('b'), child: ref('a') }), { code: 'SESSION_LINK_CYCLE' })
  assert.throws(() => store.link({ parent: ref('c'), child: ref('a') }), { code: 'SESSION_LINK_CYCLE' })
  assert.throws(() => store.link({ parent: ref('d'), child: ref('b') }), { code: 'SESSION_LINK_CONFLICT' })
  assert.equal(store.list().length, 2)
  assert.deepEqual(store.unlink({ parent: ref('wrong'), child: ref('b') }), { removed: false })
  assert.deepEqual(store.unlink({ parent: ref('a'), child: ref('b') }), { removed: true })
  assert.deepEqual(store.unlink({ parent: ref('a'), child: ref('b') }), { removed: false })
})

test('same CLI id in different providers or roots is not the same session', async (t) => {
  const { store } = await fixture(t)
  store.link({ parent: ref('same'), child: ref('same', 'claude') })
  store.link({ parent: ref('same'), child: ref('same', 'codex', 'other-store') })
  assert.equal(store.list({ parent: ref('same') }).length, 2)
  assert.equal(store.list({ child: ref('same', 'claude') }).length, 1)
  assert.throws(() => store.link({ parent: ref('../bad'), child: ref('valid') }), { code: 'SESSION_BROWSER_REFERENCE_INVALID' })
})

test('SessionBrowser preserves native fork lineage separately from collaboration hierarchy', async (t) => {
  const current = await fixture(t)
  const entries = new Map(['a', 'b', 'c', 'native', 'cycle'].map((id) => [id, {
    ...ref(id), title: id, workspace: '/workspace', created_at: '2026-10-24T00:00:00Z',
    native_parent: id === 'native' ? ref('a') : id === 'cycle' ? ref('b') : null,
    forked_from: id === 'b' ? ref('a') : null,
  }]))
  const adapter = {
    id: 'codex', storeId: 'local-store', name: 'Codex', capabilities: {},
    readSession: async (id) => entries.get(id),
    list: async () => ({ sessions: [...entries.values()], next_cursor: null }),
    children: async () => ({ sessions: [entries.get('native')], next_cursor: null }),
  }
  const browser = createSessionBrowser({ adapters: [adapter], links: current.store })
  const result = await browser.link({ parent: ref('a'), child: ref('b'), source: 'otty' })
  assert.equal(result.relation.kind, 'delegation')
  const linked = await browser.relations(ref('b'))
  assert.deepEqual(linked.relations.map((edge) => edge.kind).sort(), ['delegation', 'fork'])
  assert.equal((await browser.link({ parent: ref('a'), child: ref('native') })).created, false)
  assert.equal(current.store.list().length, 1)
  await assert.rejects(browser.link({ parent: ref('c'), child: ref('native') }), { code: 'SESSION_LINK_CONFLICT' })
  await assert.rejects(browser.link({ parent: ref('cycle'), child: ref('b') }), { code: 'SESSION_LINK_CYCLE' })
  const children = await browser.children('codex', 'a', { store_id: 'local-store' })
  assert.deepEqual(children.sessions.map((row) => row.session_id), ['b'])
  assert.equal(children.next_cursor, 'native:start')
  assert.deepEqual((await browser.children('codex', 'a', { store_id: 'local-store', cursor: children.next_cursor })).sessions.map((row) => row.session_id), ['native'])
})
