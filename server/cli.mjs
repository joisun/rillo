#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveAppConfig } from '../mcp/src/config.mjs'
import { createSessionClient } from '../mcp/src/session-client.mjs'
import { runControlCommand } from './control.mjs'

const CONTROL_COMMANDS = new Set(['install', 'start', 'stop', 'status', 'uninstall'])

function usageError() {
  return new Error(
    'usage: rillo [install|start|stop|status|uninstall|open] | '
    + 'scheduler (status|reconcile)',
  )
}

export async function defaultDashboardOpener(url, { platform = process.platform } = {}) {
  if (platform === 'linux') return { opened: false, url, message: 'Open this URL in your browser.' }
  await new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/open', [url], { stdio: 'ignore' })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`/usr/bin/open failed with exit ${code}`))
    })
  })
  return { opened: true, url }
}

export function parseCliArguments(argv) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array')
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { type: 'help' }
  if (argv.length === 1 && ['--version', '-v'].includes(argv[0])) return { type: 'version' }
  if (argv.length === 0) return { type: 'control', command: 'status' }
  if (CONTROL_COMMANDS.has(argv[0])) {
    if (argv.length !== 1) throw new Error(`${argv[0]} does not accept additional arguments`)
    return { type: 'control', command: argv[0] }
  }
  if (argv[0] === 'open') {
    if (argv.length !== 1) throw new Error('open does not accept additional arguments')
    return { type: 'open-dashboard' }
  }
  if (argv[0] === 'scheduler') {
    if (!['status', 'reconcile'].includes(argv[1])) throw usageError()
    if (argv.length !== 2) throw new Error(`scheduler ${argv[1]} does not accept additional arguments`)
    return { type: 'scheduler', command: argv[1] }
  }
  if (['migrate', 'import'].includes(argv[0])) {
    const error = new Error('Tasks import and migration have been retired. Existing data files are preserved; use the Sessions browser.')
    error.code = 'TASKS_RETIRED'
    throw error
  }
  throw usageError()
}

export async function runCli(argv, {
  projectRoot = fileURLToPath(new URL('..', import.meta.url)),
  env = process.env,
  homeDirectory = homedir(),
  controlRunner = (command) => runControlCommand(command, {
    projectRoot, env, homeDirectory,
  }),
  configResolver = resolveAppConfig,
  clientFactory = createSessionClient,
  dashboardOpener = defaultDashboardOpener,
} = {}) {
  const command = parseCliArguments(argv)
  if (command.type === 'help') return { name: 'rillo', usage: 'rillo [install|start|stop|status|uninstall|open] | scheduler (status|reconcile)', description: 'Rillo: native agent sessions and scheduled automation' }
  if (command.type === 'version') return { name: 'rillo', version: JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')).version }
  if (command.type === 'control') return controlRunner(command.command)

  if (command.type === 'open-dashboard') {
    const config = await configResolver({ projectRoot, env, homeDirectory })
    return dashboardOpener(config.serverPublicUrl ?? config.serverBaseUrl)
  }

  if (command.type === 'scheduler') {
    const config = await configResolver({ projectRoot, env, homeDirectory })
    const client = clientFactory({ baseUrl: config.serverBaseUrl })
    return command.command === 'status'
      ? client.schedulerStatus()
      : client.schedulerReconcile()
  }

}

export async function runCliMain(argv = process.argv.slice(2), {
  stdout = process.stdout,
  stderr = process.stderr,
  ...dependencies
} = {}) {
  try {
    const result = await runCli(argv, dependencies)
    stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return 0
  } catch (error) {
    stderr.write(`${error.message}\n`)
    return 1
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCliMain()
}
