#!/usr/bin/env node

import { readHookInput, sessionStartedEvent } from './src/hook-context.mjs'
import { sendJournalEvent } from './src/daemon-client.mjs'

try {
  const input = await readHookInput()
  if (input.session_id) {
    await sendJournalEvent(await sessionStartedEvent(input))
  }
} catch {
  // Lifecycle recording must never prevent a Codex session from starting.
}
