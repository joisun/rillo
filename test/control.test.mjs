import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  LAUNCH_AGENT_LABEL,
  createInstallBuildStep,
  createDaemonController,
  renderLaunchAgentPlist,
} from '../server/control.mjs'

test('LaunchAgent plist fixes Node/daemon paths, lifecycle policy, logs, and XML escaping', () => {
  const plist = renderLaunchAgentPlist({
    label: LAUNCH_AGENT_LABEL,
    nodePath: '/opt/Node & Tools/bin/node',
    daemonPath: '/Users/me/rillo/server/daemon.mjs',
    workingDirectory: '/Users/me/rillo',
    stdoutPath: '/Users/me/Library/Logs/rillo/out.log',
    stderrPath: '/Users/me/Library/Logs/rillo/error.log',
  })

  assert.match(plist, /<string>com\.joi\.rillo\.daemon<\/string>/)
  assert.match(plist, /<string>\/opt\/Node &amp; Tools\/bin\/node<\/string>/)
  assert.match(plist, /<string>\/Users\/me\/rillo\/server\/daemon\.mjs<\/string>/)
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/)
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/)
  assert.match(plist, /StandardOutPath[\s\S]*out\.log/)
  assert.match(plist, /StandardErrorPath[\s\S]*error\.log/)
})

test('controller install is repeatable and uninstall removes only the plist', async () => {
  const homeDirectory = await mkdtemp(join(tmpdir(), 'rillo-control-'))
  const projectRoot = join(homeDirectory, 'projects', 'rillo')
  const calls = []
  let builds = 0
  const run = async (command, args, options = {}) => {
    calls.push({ command, args, allowFailure: options.allowFailure ?? false })
    return { code: command === 'launchctl' && args[0] === 'bootout' ? 3 : 0, stdout: '', stderr: '' }
  }
  try {
    const controller = createDaemonController({
      projectRoot,
      homeDirectory,
      nodePath: '/opt/homebrew/bin/node',
      nodeVersion: '24.13.1',
      uid: 502,
      config: { serverBaseUrl: 'http://127.0.0.1:43127' },
      run,
      build: async () => { builds += 1 },
      probeHealth: async () => null,
    })

    const installed = await controller.install()
    assert.equal(builds, 1)
    assert.equal(installed.label, LAUNCH_AGENT_LABEL)
    const plist = await readFile(installed.plistPath, 'utf8')
    assert.match(plist, /\/opt\/homebrew\/bin\/node/)
    assert.match(plist, /projects\/rillo\/server\/daemon\.mjs/)
    assert.match(plist, /<key>WorkingDirectory<\/key>\s*<string>[^<]*projects\/rillo<\/string>/)
    assert.deepEqual(calls.slice(-2).map(({ args }) => args[0]), ['bootout', 'bootstrap'])

    await writeFile(controller.paths.stdoutPath, 'keep-log')
    await controller.uninstall()
    await assert.rejects(access(controller.paths.plistPath))
    assert.equal(await readFile(controller.paths.stdoutPath, 'utf8'), 'keep-log')
  } finally {
    await rm(homeDirectory, { recursive: true, force: true })
  }
})

test('controller uninstall delegates schedule cleanup through the owned-unit verifier and preserves Scheduler data', async () => {
  const homeDirectory = await mkdtemp(join(tmpdir(), 'rillo-control-schedules-'))
  const projectRoot = join(homeDirectory, 'projects', 'rillo')
  const known = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ]
  const calls = []
  try {
    const controller = createDaemonController({
      projectRoot,
      homeDirectory,
      nodePath: '/opt/homebrew/bin/node',
      uid: 502,
      config: {
        serverBaseUrl: 'http://127.0.0.1:43127',
        schedulerDatabasePath: join(homeDirectory, '.config', 'rillo', 'scheduler.sqlite'),
        schedulerLogsDirectory: join(homeDirectory, '.config', 'rillo', 'schedules', 'logs'),
      },
      run: async (command, args, options = {}) => {
        calls.push(['launchctl', command, args, options.allowFailure ?? false])
        return { code: 0, stdout: '', stderr: '' }
      },
      cleanupLegacySchedules: async (options) => {
        calls.push(['cleanup-legacy', options.uid, options.homeDirectory])
        return {
          removed: known.map((job_id) => ({
            job_id,
            label: `com.joi.rillo.schedule.${job_id}`,
          })),
          skipped: [],
        }
      },
    })

    const result = await controller.uninstall()
    assert.deepEqual(calls, [
      ['cleanup-legacy', 502, homeDirectory],
      ['launchctl', 'launchctl', ['bootout', 'gui/502', controller.paths.plistPath], true],
    ])
    assert.ok(result.preserved.includes(join(homeDirectory, '.config', 'rillo', 'scheduler.sqlite')))
    assert.ok(result.preserved.includes(join(homeDirectory, '.config', 'rillo', 'schedules', 'logs')))
  } finally {
    await rm(homeDirectory, { recursive: true, force: true })
  }
})

test('controller rejects old Node and a foreign service occupying the configured port', async () => {
  const common = {
    projectRoot: '/projects/rillo', homeDirectory: '/Users/me', nodePath: '/node', uid: 502,
    config: { serverBaseUrl: 'http://127.0.0.1:43127' },
    run: async () => ({ code: 0, stdout: '', stderr: '' }),
    build: async () => {},
  }
  await assert.rejects(
    createDaemonController({ ...common, nodeVersion: '22.0.0', probeHealth: async () => null }).install(),
    /Node\.js 24 or newer/,
  )
  await assert.rejects(
    createDaemonController({
      ...common,
      nodeVersion: '24.0.0',
      probeHealth: async () => ({ service: 'another-service', ready: true }),
    }).install(),
    /occupied by another service/,
  )
})

test('release install validates the prebuilt dashboard without invoking the source builder', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'rillo-prebuilt-'))
  const calls = []
  try {
    const run = async (...args) => { calls.push(args) }
    const build = createInstallBuildStep({
      projectRoot,
      nodePath: '/opt/homebrew/bin/node',
      env: { RILLO_PREBUILT: '1' },
      run,
    })
    await assert.rejects(build(), /prebuilt Dashboard is missing/)
    assert.deepEqual(calls, [])

    const dashboardDirectory = join(projectRoot, 'ui', 'dist')
    await mkdir(dashboardDirectory, { recursive: true })
    await writeFile(join(dashboardDirectory, 'react.html'), '<!doctype html>')
    await build()
    assert.deepEqual(calls, [])
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('source install invokes the Dashboard builder with the selected Node runtime', async () => {
  const calls = []
  const run = async (...args) => { calls.push(args) }
  const build = createInstallBuildStep({
    projectRoot: '/projects/rillo',
    nodePath: '/opt/homebrew/bin/node',
    env: {},
    run,
  })
  await build()
  assert.deepEqual(calls, [[
    '/opt/homebrew/bin/node',
    ['/projects/rillo/ui/build.mjs'],
  ]])
})
