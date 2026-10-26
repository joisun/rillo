import assert from 'node:assert/strict'
import test from 'node:test'
import { createCodexSessionPresence } from '../server/src/runtime/codex-session-presence.mjs'

const first = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'
const log = (id) => '/real/codex/sessions/2026/10/23/rollout-' + id + '.jsonl'
const setup = (options = {}) => createCodexSessionPresence({
  dataRoot: '/symlink/codex', platform: 'darwin', realpathImpl: async () => '/real/codex',
  clock: () => 10000, ...options,
})

test('presence selects only writable Codex rollouts under the exact canonical data root', async () => {
  const probe = setup({ execFileImpl: async (path, args, options) => {
    assert.equal(path, '/usr/sbin/lsof')
    assert.deepEqual(args, ['-nP', '-c', 'codex', '-F', 'fan'])
    assert.equal(options.timeout, 2000)
    assert.equal(options.shell, false)
    return { stdout: [
      'p10', 'f1', 'aw', 'n' + log(first),
      'f2', 'au', 'n' + log(first),
      'f3', 'ar', 'n' + log(second),
      'f4', 'au', 'n/other/codex/sessions/rollout-' + second + '.jsonl',
      'f5', 'au', 'n' + log(second) + ' (deleted)',
      'f6', 'ar', 'n/real/codex/archived_sessions/rollout-' + second + '.jsonl',
    ].join('\n') }
  } })
  assert.deepEqual(await probe.snapshot(), { available: true, open_session_ids: [first], active_workspaces: [], checked_at: '1970-01-01T00:00:10.000Z' })
})

test('cache and concurrent reads share one bounded process scan; failed refresh removes stale evidence', async () => {
  let now = 10000
  let calls = 0
  const probe = setup({ clock: () => now, execFileImpl: async () => {
    calls += 1
    if (calls > 1) throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })
    return { stdout: 'f1\naw\nn' + log(first) }
  } })
  const [one, two] = await Promise.all([probe.snapshot(), probe.snapshot()])
  assert.deepEqual(one, two)
  await probe.snapshot()
  assert.equal(calls, 1)
  now += 3001
  const result = await probe.snapshot()
  assert.equal(result.available, false)
  assert.deepEqual(result.open_session_ids, [])
})

test('no matching processes is an empty observation; denied or unsupported probes are unavailable', async () => {
  const noProcesses = setup({ execFileImpl: async () => { throw Object.assign(new Error('none'), { code: 1, stdout: '', stderr: '' }) } })
  assert.equal((await noProcesses.snapshot()).available, true)
  const denied = setup({ execFileImpl: async () => { throw Object.assign(new Error('denied'), { code: 1, stdout: '', stderr: 'denied' }) } })
  assert.equal((await denied.snapshot()).available, false)
  const unsupported = setup({ platform: 'linux', execFileImpl: async () => assert.fail() })
  assert.equal((await unsupported.snapshot()).available, false)
})

test('active directory evidence follows writable sessions even before their list page is loaded', async () => {
  const reads = []
  let writable = true, now = 10000
  const probe = setup({ clock: () => now, execFileImpl: async () => ({ stdout: 'f1\n' + (writable ? 'aw' : 'ar') + '\nn' + log(first) }), readWorkspace: async path => { reads.push(path); return '/workspace/active-project' } })
  assert.deepEqual((await probe.snapshot()).active_workspaces, ['/workspace/active-project'])
  now += 3001
  await probe.snapshot()
  assert.equal(reads.length, 1)
  writable = false; now += 3001
  assert.deepEqual((await probe.snapshot()).active_workspaces, [])
})
