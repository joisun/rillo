#!/usr/bin/env node

import { startSessionMcp } from '../../../../mcp/src/session-server.mjs'

try {
  await startSessionMcp()
} catch (error) {
  process.stderr.write(`rillo failed to start: ${error.stack ?? error}\n`)
  process.exitCode = 1
}
