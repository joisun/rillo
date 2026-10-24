#!/usr/bin/env node

import { startSessionMcp } from './src/session-server.mjs'

try {
  await startSessionMcp()
} catch (error) {
  process.stderr.write(`tasks-recorder failed to start: ${error.stack ?? error}\n`)
  process.exitCode = 1
}
