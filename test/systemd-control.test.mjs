import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createSystemdController, renderSystemdUnit } from '../server/control/systemd.mjs'
import { defaultDashboardOpener } from '../server/cli.mjs'

test('systemd unit quotes literal paths, disables command expansion, and restricts file permissions', () => {
  const unit = renderSystemdUnit({ nodePath: '/tools/Node $x %n/bin/node', taskdPath: '/projects/a "quoted"/server/taskd.mjs', workingDirectory: '/projects/space project', homeDirectory: '/home/user', path: '/bin:/usr/bin', stdoutPath: '/tmp/out file', stderrPath: '/tmp/err', codexHome: '/tmp/private codex' })
  assert.match(unit, /ExecStart=":\/tools\/Node \$x %%n\/bin\/node"/)
  assert.ok(unit.includes('a \\"quoted\\"/server/taskd.mjs'))
  assert.match(unit, /WorkingDirectory=\/projects\/space project/)
  assert.ok(unit.includes('CODEX_HOME=/tmp/private codex"\nRestart=on-failure'))
  assert.match(unit, /UMask=0077/)
  assert.match(unit, /Restart=on-failure/)
  assert.match(unit, /WantedBy=default.target/)
})

test('systemd controller installs, restarts, stops and removes only its own user unit', async t => {
  const home = await mkdtemp(join(tmpdir(), 'tasks-recorder-systemd-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const calls = []
  const controller = createSystemdController({ projectRoot: '/projects/source', config: { serverBaseUrl: 'http://127.0.0.1:43127', schedulerDatabasePath: '/keep/db' }, homeDirectory: home, nodePath: '/tools/node', nodeVersion: '24.0.0', env: { PATH: '/usr/bin:/bin' }, build: async () => calls.push('build'), probeHealth: async () => ({ service: 'tasks-recorder', ready: true }), run: async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0, stdout: '', stderr: '' } } })
  await controller.install()
  assert.equal(calls.filter(row => Array.isArray(row) && row.includes('restart')).length, 1)
  assert.ok(calls.some(row => Array.isArray(row) && row[2] === 'enable' && row[3] === controller.paths.unitPath))
  assert.ok(calls.every(row => row === 'build' || row[0] === 'systemctl'))
  assert.match(await readFile(controller.paths.unitPath, 'utf8'), /HOME=/)
  assert.equal((await controller.status()).ready, true)
  await controller.stop()
  await controller.start()
  await writeFile(controller.paths.stdoutPath, 'keep-log')
  const removed = await controller.uninstall()
  assert.ok(removed.preserved.includes('/keep/db'))
  assert.equal(await readFile(controller.paths.stdoutPath, 'utf8'), 'keep-log')
  await assert.rejects(access(controller.paths.unitPath))
  const previous = calls.length
  await controller.uninstall()
  assert.equal(calls.length, previous)
})

test('systemd missing user manager fails before writing files or starting a service', async () => {
  let builds = 0
  const controller = createSystemdController({ projectRoot: '/projects/source', config: { serverBaseUrl: 'http://127.0.0.1:43127' }, homeDirectory: '/unwritten', nodeVersion: '24.0.0', build: async () => { builds += 1 }, probeHealth: async () => null, run: async () => ({ code: 1 }) })
  await assert.rejects(controller.install(), /systemd user manager is required/)
  assert.equal(builds, 0)
})

test('Linux open reports the browser URL without trying to start a desktop application', async () => {
  const result = await defaultDashboardOpener('http://127.0.0.1:43127', { platform: 'linux' })
  assert.equal(result.opened, false)
  assert.equal(result.url, 'http://127.0.0.1:43127')
  assert.match(result.message, /SSH port forwarding/)
})


test('the real Linux systemd parser accepts directories with spaces, quotes and percent signs', { skip: process.platform !== 'linux' }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tasks-recorder-unit-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const workingDirectory = join(directory, 'space "quoted" %literal $HOME')
  await mkdir(workingDirectory)
  const unitPath = join(directory, 'tasks-recorder-verify.service')
  await writeFile(unitPath, renderSystemdUnit({ nodePath: process.execPath, taskdPath: '/tmp/taskd.mjs', workingDirectory, homeDirectory: directory, path: '/usr/bin:/bin', stdoutPath: join(workingDirectory, 'out.log'), stderrPath: join(directory, 'err.log') }))
  await promisify(execFile)('systemd-analyze', ['verify', unitPath], { timeout: 10000 })
})
