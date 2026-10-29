#!/usr/bin/env node

import { readHookInput, toolHeartbeatEvent } from './src/hook-context.mjs'
import { sendJournalEvent } from './src/daemon-client.mjs'
import { currentTurn } from './src/turn-state.mjs'

try {
  const input = await readHookInput()
  const toolName = String(input.tool_name ?? '')
  if (
    process.env.AGENT_SUPERVISOR_ROLE !== 'worker'
    && input.session_id
    && !toolName.includes('rillo')
    && !toolName.includes('rillo_')
  ) {
    const turn = await currentTurn(input.session_id)
    if (turn?.turn_key) {
      await sendJournalEvent(await toolHeartbeatEvent(input, turn.turn_key))
    }
  }
} catch {
  // Activity tracking must never interfere with the completed tool call.
}
