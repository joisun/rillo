import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, access, rm, symlink, readlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { createInstallationMigration } from '../server/migrate.mjs'

async function fixture(t, { platform = 'darwin', loaded = true } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'rillo-migration-test-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const oldData = join(home, '.config/tasks-recorder'), oldProgram = join(home, '.local/share/tasks-recorder')
  const label = platform === 'darwin' ? 'com.joi.tasks-recorder.taskd' : 'tasks-recorder.service'
  const service = platform === 'darwin' ? join(home, 'Library/LaunchAgents', label + '.plist') : join(home, '.config/systemd/user', label)
  await Promise.all([mkdir(oldData, { recursive: true }), mkdir(join(oldProgram, 'releases/0.14.0'), { recursive: true }), mkdir(join(home, '.local/bin'), { recursive: true }), mkdir(join(service, '..'), { recursive: true })])
  const config = { output_dir: '.', schedule_definitions_dir: '/external/user/definitions', logs_dir: join(oldData, 'logs'), server_port: 43127 }
  await writeFile(join(oldData, 'config.json'), JSON.stringify(config)); const database = new DatabaseSync(join(oldData, 'scheduler.sqlite')); database.exec("CREATE TABLE preserved(value TEXT); INSERT INTO preserved VALUES('original-ledger-bytes')"); database.close()
  await writeFile(join(oldProgram, 'releases/0.14.0/package.json'), '{"name":"tasks-recorder","version":"0.14.0"}')
  await symlink(join(oldProgram, 'releases/0.14.0'), join(oldProgram, 'current'))
  await writeFile(service, 'old service'); await writeFile(join(home, '.local/bin/tasks-recorder'), 'old wrapper')
  const calls = []; let active = loaded
  const run = async (file, args) => {
    calls.push({ file, args })
    if (file === 'launchctl') {
      if (args[0] === 'print') return { code: active ? 0 : 1, stdout: active ? 'path = ' + service : '' }
      if (args[0] === 'bootout') active = false
      if (args[0] === 'bootstrap') active = true
    }
    if (file === 'systemctl') {
      if (args[1] === 'show') return { code: 0, stdout: service }
      if (args[1] === 'is-active') return { code: active ? 0 : 3, stdout: '' }
      if (args[1] === 'is-enabled') return { code: 0, stdout: 'enabled' }
      if (args[1] === 'disable') active = false
      if (args[1] === 'start') active = true
    }
    return { code: 0, stdout: '' }
  }
  const migration = createInstallationMigration({ homeDirectory: home, platform, uid: 501, run, probe: async url => active ? (url.endsWith('/health/live') ? { service: 'tasks-recorder' } : { jobs: [] }) : null })
  return { home, oldData, oldProgram, config, service, migration, calls, active: () => active }
}

test('migration preserves data and external definitions, with old service stopped before moves', async t => {
  const f = await fixture(t)
  const result = await f.migration.prepare()
  assert.equal(result.migrated, true); assert.equal(f.active(), false)
  const db = new DatabaseSync(join(f.home, '.config/rillo/scheduler.sqlite')); assert.equal(db.prepare('SELECT value FROM preserved').get().value, 'original-ledger-bytes'); db.close()
  const config = JSON.parse(await readFile(join(f.home, '.config/rillo/config.json'), 'utf8'))
  assert.equal(config.schedule_definitions_dir, f.config.schedule_definitions_dir); assert.equal(config.logs_dir, join(f.home, '.config/rillo/logs'))
  assert.equal(await readFile(join(f.home, '.local/share/rillo/releases/0.14.0/package.json'), 'utf8'), '{"name":"tasks-recorder","version":"0.14.0"}')
  assert.equal((await f.migration.commit(result.journalPath)).status, 'committed')
  await assert.rejects(access(f.oldData)); await assert.rejects(access(f.service))
})

test('rollback restores original configuration bytes, service, wrapper and current pointer', async t => {
  const f = await fixture(t), before = await readFile(join(f.oldData, 'config.json'))
  const result = await f.migration.prepare()
  await f.migration.rollback(result.journalPath)
  assert.deepEqual(await readFile(join(f.oldData, 'config.json')), before)
  const db = new DatabaseSync(join(f.oldData, 'scheduler.sqlite')); assert.equal(db.prepare('SELECT value FROM preserved').get().value, 'original-ledger-bytes'); db.close()
  assert.equal(await readFile(join(f.home, '.local/bin/tasks-recorder'), 'utf8'), 'old wrapper')
  assert.equal(await readlink(join(f.oldProgram, 'current')), join(f.oldProgram, 'releases/0.14.0'))
  assert.equal(f.active(), true)
  assert.equal((await f.migration.rollback(result.journalPath)).status, 'rolled_back')
})

test('a conflicting new data directory fails before stopping the old service', async t => {
  const f = await fixture(t); await mkdir(join(f.home, '.config/rillo'))
  await assert.rejects(f.migration.prepare(), error => error.code === 'RILLO_MIGRATION_CONFLICT')
  assert.equal(f.active(), true); assert.equal(f.calls.some(call => call.args[0] === 'bootout'), false)
})

test('foreign-home service registration and active scheduled work are never stopped', async t => {
  const f = await fixture(t)
  const foreign = createInstallationMigration({ homeDirectory: f.home, platform: 'darwin', uid: 501,
    run: async () => ({ code: 0, stdout: 'path = /different/home/service.plist' }), probe: async () => null })
  await assert.rejects(foreign.prepare(), error => error.code === 'RILLO_MIGRATION_SERVICE_SCOPE')
  const active = createInstallationMigration({ homeDirectory: f.home, platform: 'darwin', uid: 501,
    run: async (_file, args) => ({ code: 0, stdout: 'path = ' + f.service }),
    probe: async url => url.endsWith('/health/live') ? { service: 'tasks-recorder' } : { jobs: [{ current_execution: { status: 'running' } }] } })
  await assert.rejects(active.prepare(), error => error.code === 'RILLO_MIGRATION_ACTIVE_RUNS')
})

test('Linux migration disables old systemd service and rollback restores its original enable state', async t => {
  const f = await fixture(t, { platform: 'linux' })
  const result = await f.migration.prepare()
  assert.ok(f.calls.some(call => call.args.join(' ') === '--user disable --now tasks-recorder.service'))
  await f.migration.rollback(result.journalPath)
  assert.ok(f.calls.some(call => call.args.join(' ') === '--user enable ' + f.service)); assert.equal(f.active(), true)
})

test('fresh installs do not query native managers and --no-start rejects an active legacy service', async t => {
  const home = await mkdtemp(join(tmpdir(), 'rillo-fresh-test-')); t.after(() => rm(home, { recursive: true, force: true }))
  const fresh = createInstallationMigration({ homeDirectory: home, run: async () => { throw new Error('must not query host manager') } })
  assert.deepEqual(await fresh.prepare(), { journalPath: null, migrated: false })
  const f = await fixture(t)
  await assert.rejects(f.migration.prepare({ startService: false }), error => error.code === 'RILLO_MIGRATION_SERVICE_SWITCH_REQUIRED')
  assert.equal(f.active(), true)
})

test('installer migration entry runs through a symlinked temporary directory', async t => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const home = await mkdtemp(join(tmpdir(), 'rillo-entry-test-')); t.after(() => rm(home, { recursive: true, force: true }))
  const entry = join(home, 'migration-entry.mjs')
  await symlink(new URL('../server/migrate.mjs', import.meta.url).pathname, entry)
  const result = await promisify(execFile)(process.execPath, [entry, 'plan'], { env: { ...process.env, HOME: home } })
  assert.deepEqual(JSON.parse(result.stdout), { moves: [], services: [] })
})

test('a WAL-backed database is backed up using a consistent SQLite snapshot', async t => {
  const f = await fixture(t)
  const writer = new DatabaseSync(join(f.oldData, 'scheduler.sqlite'))
  writer.exec("PRAGMA journal_mode=WAL; INSERT INTO preserved VALUES('uncheckpointed history')")
  try {
    const result = await f.migration.prepare()
    const state = JSON.parse(await readFile(result.journalPath, 'utf8'))
    const snapshot = new DatabaseSync(join(state.backup, 'data', 'scheduler.sqlite'), { readOnly: true })
    assert.deepEqual(snapshot.prepare('SELECT value FROM preserved ORDER BY value').all().map(row => row.value), ['original-ledger-bytes', 'uncheckpointed history'])
    assert.equal(snapshot.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); snapshot.close()
    await f.migration.commit(result.journalPath)
  } finally { writer.close() }
})

test('persistent-data backup records IPC sockets without copying or stopping them', async t => {
  const { createServer } = await import('node:net')
  const { backupLegacyData } = await import('../server/migrate.mjs')
  const root = await mkdtemp('/tmp/rillo-ipc-'), source = join(root, 'source')
  await mkdir(source); await writeFile(join(source, 'user-data'), 'keep')
  const socket = join(source, 'legacy.sock'), server = createServer()
  await new Promise(resolve => server.listen(socket, resolve))
  try {
    const result = await backupLegacyData(source, join(root, 'backup'))
    assert.deepEqual(result.ephemeral, [{ path: 'legacy.sock', kind: 'socket' }])
    assert.equal(await readFile(join(root, 'backup/user-data'), 'utf8'), 'keep')
    assert.equal(server.listening, true); await assert.rejects(access(join(root, 'backup/legacy.sock')))
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})
