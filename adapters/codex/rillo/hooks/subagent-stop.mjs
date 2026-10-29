#!/usr/bin/env node

import { readHookInput, subagentStoppedEvent } from './src/hook-context.mjs'
import { sendJournalEvent } from './src/daemon-client.mjs'

try {
  const input = await readHookInput()
  await sendJournalEvent(await subagentStoppedEvent(input))
} catch {
  // Subagent recording must fail open.
}
process.stdout.write('{}')
