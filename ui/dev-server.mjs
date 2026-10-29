#!/usr/bin/env node

import { resolveDashboardDevConfig } from './dev-gateway.mjs'
import { compileReactDashboard } from './compiler.mjs'
import { startDashboardDevRuntime } from './dev-runtime.mjs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

try {
  const args = process.argv.slice(2)
  if (args.length > 1 || (args[0] && !['--entry=legacy', '--entry=react'].includes(args[0]))) {
    throw new Error('usage: node ui/dev-server.mjs [--entry=legacy|--entry=react]')
  }
  const entry = args[0]?.slice('--entry='.length) ?? 'legacy'
  const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const config = resolveDashboardDevConfig()
  const reactSourceRoot = join(projectRoot, 'ui', 'react')
  const runtime = await startDashboardDevRuntime({
    config,
    projectRoot,
    ...(entry === 'react' ? {
      compile: () => compileReactDashboard({ sourceRoot: reactSourceRoot }),
      sourceRoots: [reactSourceRoot],
    } : {}),
  })
  process.stderr.write(`Rillo ${entry} source Dashboard: ${runtime.address.url}\n`)
  process.stderr.write(`Live daemon upstream: ${config.upstream.origin}\n`)
  process.stderr.write(
    'Warning: Dashboard mutations update your real local Rillo data.\n',
  )
  let stopping = false
  async function stop() {
    if (stopping) return
    stopping = true
    await runtime.close()
  }
  process.once('SIGINT', () => { stop().finally(() => process.exit(0)) })
  process.once('SIGTERM', () => { stop().finally(() => process.exit(0)) })
} catch (error) {
  process.stderr.write(`Rillo Dashboard dev server failed: ${error.message}\n`)
  process.exitCode = 1
}
