#!/usr/bin/env node

import { readHookInput, sessionEndedEvent } from './src/hook-context.mjs'
import { sendJournalEvent } from './src/daemon-client.mjs'

try {
  const input = await readHookInput()
  if (input.session_id) {
    await sendJournalEvent(await sessionEndedEvent(input))
  }
} catch {
  // Session cleanup must fail open.
}
