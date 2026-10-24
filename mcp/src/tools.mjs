import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { TaskRecorderError } from './errors.mjs'

export const SERVER_INSTRUCTIONS = `Browse native sessions in the Sessions dashboard. Use session_sources to obtain the exact provider and store_id before registering relations. SessionRef is {provider, store_id, session_id}; for Codex session_id is thread.id. After a delegated child session exists, register its actual identity with session_link. Never guess a session ID from an execution, agent key, PID, worktree, or title. Use session_unlink only to remove an explicitly registered relation; native subagent/fork relations are read-only. No Task, heartbeat, attribution, checkpoint or automatic summary recording is needed. Never edit local databases directly.`

const sessionRef = z.object({
  provider: z.string().min(1),
  store_id: z.string().min(1),
  session_id: z.string().min(1),
}).strict()
const outputSchema = z.object({}).catchall(z.unknown())

function handler(operation) {
  return async (input) => {
    try {
      const structuredContent = await operation(input)
      return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent }
    } catch (error) {
      const known = error instanceof TaskRecorderError
      const structuredContent = {
        ok: false,
        error: {
          code: known ? error.code : 'INTERNAL_ERROR',
          message: known ? error.message : 'Session operation failed.',
          ...(known && error.details !== undefined ? { details: error.details } : {}),
        },
      }
      return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent, isError: true }
    }
  }
}

export function createTasksRecorderServer({ service }) {
  const server = new McpServer(
    { name: 'tasks-recorder', version: '0.8.8' },
    { instructions: SERVER_INSTRUCTIONS },
  )
  server.registerTool('session_sources', {
    description: 'Query available native session providers and their exact store_id. Use these values in SessionRef; Codex session_id is thread.id.',
    inputSchema: {},
    outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, handler(() => service.providers()))
  server.registerTool('session_link', {
    description: 'Register an explicit delegation from parent to an existing child session. Both refs require exact provider, store_id and native session_id. Repeating the same relation is idempotent.',
    inputSchema: { parent: sessionRef, child: sessionRef, source: z.string().min(1).optional() },
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, handler((input) => service.link(input)))
  server.registerTool('session_unlink', {
    description: 'Remove an explicitly registered parent-child delegation. Native subagent and fork relations cannot be removed.',
    inputSchema: { parent: sessionRef, child: sessionRef },
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, handler((input) => service.unlink(input)))
  return server
}
