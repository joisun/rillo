import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { startTaskd } from '../server/src/taskd-runtime.mjs'

function scheduleDefinition(id, title, workspace) {
  return `---
type: tasks-recorder/schedule
id: ${id}
title: ${title}
workspace: ${workspace}
schedule:
  kind: daily
  at: "09:00"
---

Review the project.
`
}

test('taskd opens only the session links store and never touches legacy persistence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sessions-runtime-'))
  const legacyPath = join(directory, 'tasks.sqlite')
  const legacy = Buffer.from('legacy database must remain byte-for-byte unchanged')
  await writeFile(legacyPath, legacy)
  let runtime
  try {
    runtime = await startTaskd({
      config: { databasePath: legacyPath, serverHost: '127.0.0.1', serverPort: 0 },
      dashboardHtml: '<!doctype html>',
      createStore: () => assert.fail('legacy store must never be created'),
      createSpool: () => assert.fail('legacy spool must never be created'),
      createJournal: () => assert.fail('journal must never be created'),
      prepareStartup: () => assert.fail('Task startup must never run'),
      scheduleInterval: () => assert.fail('Task maintenance must never be scheduled'),
    })
    assert.equal(runtime.startup.api_version, 5)
    assert.equal(runtime.scheduler.ready, true)
    assert.equal((await fetch(`${runtime.address.url}/health/ready`)).status, 200)
    assert.deepEqual(await readFile(legacyPath), legacy)
    await runtime.close()
    await runtime.close()
    assert.deepEqual(await readFile(legacyPath), legacy)
    await assert.rejects(readFile(join(directory, 'spool')), { code: 'ENOENT' })
    assert.ok((await readFile(join(directory, 'session-links.sqlite'))).length > 0)
  } finally {
    await runtime?.close()
    await rm(directory, { recursive: true, force: true })
  }
})
test('settings relocates the live Schedule registry, persists the path, and archives the old definition without restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tasks-recorder-runtime-relocation-'))
  const sourceRoot = join(directory, 'source-schedules')
  const targetRoot = join(directory, 'target-schedules')
  const workspace = join(directory, 'workspace')
  const configPath = join(directory, 'config.json')
  const scheduleId = '11111111-1111-4111-8111-111111111111'
  const monitorRoots = []
  let runtime
  try {
    await mkdir(sourceRoot)
    await mkdir(targetRoot)
    await mkdir(workspace)
    const canonicalSourceRoot = await realpath(sourceRoot)
    const canonicalTargetRoot = await realpath(targetRoot)
    await writeFile(join(sourceRoot, 'review.md'), scheduleDefinition(scheduleId, 'Review', workspace))
    await writeFile(configPath, `${JSON.stringify({
      output_dir: '.', server_port: 0, schedule_definitions_dir: sourceRoot,
    }, null, 2)}\n`)
    runtime = await startTaskd({
      config: {
        configPath,
        databasePath: join(directory, 'tasks.sqlite'), outputDir: directory,
        serverHost: '127.0.0.1', serverPort: 0,
        scheduleDefinitionsDirectory: sourceRoot,
        schedulerDatabasePath: join(directory, 'scheduler.sqlite'),
        schedulerLocksDirectory: join(directory, 'locks'),
        schedulerLogsDirectory: join(directory, 'schedule-logs'),
        schedulerSpoolDirectory: join(directory, 'schedule-spool'),
      },
      dashboardPath: join(directory, 'index.html'), dashboardHtml: '<!doctype html>',
      createLauncher: () => ({
        options: async () => [{ id: 'terminal', label: 'Terminal.app', available: true }],
        launch: async () => ({}),
      }),
      createSchedulerDefinitionMonitor: ({ repository, onDiff }) => {
        monitorRoots.push(repository.rootDirectory)
        return {
          async start({ emitInitial = true } = {}) {
            if (emitInitial) await onDiff({ added: await repository.list(), changed: [], removed: [], invalid: [] })
          },
          async close() {},
        }
      },
      clock: () => new Date('2026-08-26T04:00:00.000Z'),
    })
    assert.equal(runtime.scheduler.ready, true, JSON.stringify(runtime.scheduler))

    const response = await fetch(`${runtime.address.url}/api/v1/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedule_definitions_dir: targetRoot }),
    })
    const result = await response.json()
    assert.equal(response.status, 200, JSON.stringify(result))
    assert.equal(result.restart_required, false)
    assert.deepEqual(result.relocation, { moved_count: 1, merged_count: 0, cleanup_warning: null })
    assert.equal(JSON.parse(await readFile(configPath, 'utf8')).schedule_definitions_dir, canonicalTargetRoot)
    const schedules = await fetch(`${runtime.address.url}/api/v1/schedules`).then((value) => value.json())
    assert.equal(schedules.jobs[0].id, scheduleId)
    assert.equal(schedules.jobs[0].source_path, join(canonicalTargetRoot, 'review.md'))
    assert.deepEqual(monitorRoots, [canonicalSourceRoot, canonicalTargetRoot])
    await assert.rejects(readFile(join(sourceRoot, 'review.md'), 'utf8'), { code: 'ENOENT' })
    assert.match(
      await readFile(join(sourceRoot, '.trash', 'migrated-2026-08-26T04-00-00-000Z', 'review.md'), 'utf8'),
      /title: Review/,
    )
  } finally {
    await runtime?.close().catch(() => {})
    await rm(directory, { recursive: true, force: true })
  }
})

test('taskd closes an active SSE response and closes session links once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sessions-runtime-sse-'))
  let closes = 0
  let runtime
  let reader
  try {
    runtime = await startTaskd({
      config: { databasePath: join(directory, 'tasks.sqlite'), serverHost: '127.0.0.1', serverPort: 0 },
      dashboardHtml: '<!doctype html>',
      createLinks: () => ({ check: () => ({ integrityCheck: 'ok', foreignKeyViolations: [] }), close: () => { closes += 1 } }),
    })
    reader = (await fetch(`${runtime.address.url}/api/v1/events`)).body.getReader()
    await reader.read()
    await Promise.race([
      runtime.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('SSE close timed out')), 1_000).unref()),
    ])
    await runtime.close()
    assert.equal(closes, 1)
    await assert.rejects(readFile(join(directory, 'tasks.sqlite')), { code: 'ENOENT' })
  } finally {
    await reader?.cancel().catch(() => {})
    await runtime?.close()
    await rm(directory, { recursive: true, force: true })
  }
})

for (const phase of ['definitions', 'runs']) {
test(`scheduler failure at ${phase} leaves Sessions and runtime registry available without a Task database`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sessions-runtime-degraded-'))
  const resolved = []
  let runtime
  try {
    runtime = await startTaskd({
      config: { databasePath: join(directory, 'tasks.sqlite'), serverHost: '127.0.0.1', serverPort: 0 },
      dashboardHtml: '<!doctype html>',
      ...(phase === 'definitions'
        ? { createSchedulerDefinitions: () => { throw Object.assign(new Error('broken schedules'), { code: 'SCHEDULE_SCAN_FAILED' }) } }
        : { createRuns: () => { throw Object.assign(new Error('broken runs'), { code: 'RUN_STARTUP_FAILED' }) } }),
      createRuntimeRegistry: () => ({
        list: async () => [{ id: 'codex' }],
        resolve: async (id) => { resolved.push(id); return { executable: '/codex' } },
      }),
      createSessionAdapter: ({ resolveLaunch }) => ({
        id: 'codex', label: 'Codex', storeId: 'native-test', capabilities: {},
        list: async () => { await resolveLaunch(); return { sessions: [], relations: [], next_cursor: null } },
        close() {},
      }),
    })
    assert.equal(runtime.scheduler.degraded, true)
    assert.equal(runtime.scheduler.error_code, phase === 'definitions' ? 'SCHEDULE_SCAN_FAILED' : 'RUN_STARTUP_FAILED')
    const base = runtime.address.url
    assert.equal((await fetch(`${base}/health/ready`)).status, 200)
    assert.equal((await fetch(`${base}/api/v1/runtimes`)).status, 200)
    const sessions = await fetch(`${base}/api/v1/session-browser/codex/sessions?store_id=native-test`)
    assert.equal(sessions.status, 200, await sessions.clone().text())
    assert.deepEqual((await sessions.json()).sessions, [])
    assert.deepEqual(resolved, ['codex'])
    const status = await fetch(`${base}/api/v1/status`).then(response => response.json())
    assert.equal(status.scheduler.degraded, true)
    await assert.rejects(readFile(join(directory, 'tasks.sqlite')), { code: 'ENOENT' })
  } finally {
    await runtime?.close()
    await rm(directory, { recursive: true, force: true })
  }
})
}
