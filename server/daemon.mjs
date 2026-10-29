#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveAppConfig } from '../mcp/src/config.mjs'
import { startDaemon } from './src/daemon-runtime.mjs'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const dashboardPath = join(projectRoot, 'ui', 'dist', 'react.html')

try {
  const config = await resolveAppConfig({ projectRoot })
  const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) {
    throw new Error('Rillo package.json must declare a version')
  }
  config.packageVersion = manifest.version
  const dashboardHtml = await readFile(dashboardPath, 'utf8')
  const runtime = await startDaemon({ config, dashboardPath, dashboardHtml })
  let stopping = false
  async function stop() {
    if (stopping) return
    stopping = true
    await runtime.close()
  }
  process.once('SIGTERM', () => { stop().catch(() => {}).finally(() => process.exit(0)) })
  process.once('SIGINT', () => { stop().catch(() => {}).finally(() => process.exit(0)) })
  process.stderr.write(`rillo daemon listening at ${runtime.address.url}\n`)
} catch (error) {
  process.stderr.write(`rillo daemon failed to start: ${error.stack ?? error}\n`)
  process.exitCode = 1
}
