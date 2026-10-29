import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { TaskRecorderError } from './errors.mjs'

export const SERVER_INSTRUCTIONS = `Query native sessions and manage scheduled automation through these tools. Use runtime_list before choosing a schedule agent. Read schedule_get before changing a schedule and pass its latest etag as expected_etag; on SCHEDULE_VERSION_CONFLICT read again and reconsider the change, never silently overwrite. schedule_create creates an enabled task; cadence uses the service machine timezone. Reuse the same idempotency_key when retrying schedule_run. Session search covers user and assistant text, not just previews. Follow next_cursor even when a search page has no matches; do not claim that a partial page is the complete result. Use session_sources to obtain the exact provider and store_id before registering relations. SessionRef is {provider, store_id, session_id}; for Codex session_id is thread.id. After a delegated child session exists, register its actual identity with session_link. Never guess a session ID from an execution, agent key, PID, worktree, or title. Use session_unlink only to remove an explicitly registered relation; native subagent/fork relations are read-only. No Task, heartbeat, attribution, checkpoint or automatic summary recording is needed. Never edit local databases directly.`

const sessionRef = z.object({
  provider: z.string().min(1),
  store_id: z.string().min(1),
  session_id: z.string().min(1),
}).strict()
const page = {
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().max(8192).optional(),
}
const filters = {
  provider: z.string().min(1),
  workspace: z.string().min(1).max(4096).describe('Absolute workspace directory on the service machine.').optional(),
  branch: z.string().min(1).max(200).optional(),
  archived: z.boolean().optional(),
  ...page,
}
const scheduleId = { schedule_id: z.string().uuid() }
const scheduleVersion = {
  ...scheduleId,
  expected_etag: z.string().regex(/^[0-9a-f]{64}$/).describe('Latest etag from schedule_get. A stale value fails with SCHEDULE_VERSION_CONFLICT.'),
}
const timezone = { timezone_mode: z.literal('system').optional() }
const time = { hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59) }
const cadence = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), ...timezone, at: z.string().min(1).describe('Future ISO timestamp within 366 days; include an explicit UTC offset.') }).strict(),
  z.object({ kind: z.literal('hourly'), ...timezone, minute: time.minute }).strict(),
  z.object({ kind: z.literal('daily'), ...timezone, ...time }).strict(),
  z.object({ kind: z.literal('weekly'), ...timezone, weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).describe('Monday=1 through Sunday=7.'), ...time }).strict(),
  z.object({ kind: z.literal('monthly'), ...timezone, day: z.number().int().min(1).max(31), ...time }).strict(),
]).describe('Recurring schedules use the service machine timezone.')
const scheduleFields = {
  title: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(20000),
  workspace: z.string().min(1).max(4096).describe('Existing absolute directory on the service machine.'),
  cadence,
  agent: z.string().min(1).max(64).optional(),
  sandbox_mode: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
  model: z.string().max(256).nullable().optional(),
  reasoning_effort: z.string().max(64).nullable().optional(),
  fast_mode: z.boolean().nullable().optional(),
  network_access: z.boolean().nullable().optional(),
  timeout_seconds: z.number().int().min(60).max(86400).optional(),
  capabilities: z.object({
    skills: z.enum(['inherit', 'disabled']).optional(),
    integrations: z.enum(['inherit', 'disabled']).optional(),
  }).strict().optional(),
}
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
          message: known ? error.message : 'Tasks Recorder operation failed.',
          ...(known && error.details !== undefined ? { details: error.details } : {}),
        },
      }
      return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent, isError: true }
    }
  }
}

export function createTasksRecorderServer({ service }) {
  const server = new McpServer(
    { name: 'tasks-recorder', version: '0.13.0' },
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
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  const tools = [
    ['runtime_list', 'List installed agent runtimes and their availability before creating a schedule.', {}, 'runtimes', readOnly],
    ['schedule_list', 'List scheduled tasks, current etags, execution summaries and invalid Markdown definitions.', {}, 'listSchedules', readOnly],
    ['schedule_get', 'Read a scheduled task including its prompt and latest etag before an edit, delete, pause or resume.', scheduleId, 'getSchedule', readOnly],
    ['schedule_create', 'Create an enabled scheduled task backed by Markdown. Does not execute it immediately. Default sandbox is read-only; skills and integrations are disabled unless specified.', scheduleFields, 'createSchedule', { ...write, idempotentHint: false }],
    ['schedule_update', 'Patch only supplied fields of a scheduled task using its latest etag. Rejects concurrent changes.', { ...scheduleVersion, patch: z.object(scheduleFields).partial().strict().refine(value => Object.keys(value).length > 0, 'Provide at least one field to update.') }, 'updateSchedule', write],
    ['schedule_delete', 'Move a scheduled task definition to .trash using its latest etag. Preserves previous execution records.', scheduleVersion, 'deleteSchedule', { ...write, destructiveHint: true }],
    ['schedule_pause', 'Disable future scheduled executions using the latest etag. Does not stop an already running execution.', scheduleVersion, 'pauseSchedule', write],
    ['schedule_resume', 'Enable future scheduled executions using the latest etag.', scheduleVersion, 'resumeSchedule', write],
    ['schedule_run', 'Start one execution now, including for a paused task. Reuse the same idempotency_key when retrying to prevent duplicate execution.', { ...scheduleId, idempotency_key: z.string().min(1).max(128) }, 'runSchedule', { ...write, openWorldHint: true }],
    ['schedule_runs', 'Read recent execution records for a scheduled task. Returns truncated=true when more records exist.', { ...scheduleId, limit: page.limit }, 'scheduleRuns', readOnly],
    ['run_read', 'Read execution status and result. Optionally include the recorded conversation.', { run_id: z.string().min(1).max(256), include_conversation: z.boolean().optional() }, 'readRun', readOnly],
    ['session_list', 'List native sessions by provider, workspace or branch. Follow next_cursor for more results; includes parent and fork relations.', filters, 'listSessions', readOnly],
    ['session_search', 'Search user and assistant message bodies across native sessions. Returns matching snippets and pagination; an empty page with next_cursor is not the end.', { ...filters, query: z.string().trim().min(1).max(256) }, 'listSessions', readOnly],
    ['session_read', 'Read metadata for one native session using the exact provider, store_id and session_id.', sessionRef.shape, 'readSession', readOnly],
    ['session_messages', 'Read session messages: page (default) preserves native pagination and query/time seek; head reads the first count messages, tail the last count, all follows history automatically. History modes return chronological messages, complete/truncated and a continuation cursor. Continue using the same mode and SessionRef; count defaults to 20. all is bounded by max_chars, 50 pages and a time budget. Does not include tool or reasoning events.', { ...sessionRef.shape, ...page, mode: z.enum(['page', 'head', 'tail', 'all']).optional(), count: z.number().int().min(1).max(1000).describe('Number of messages for head/tail; default 20.').optional(), max_chars: z.number().int().min(1000).max(1000000).optional(), query: z.string().trim().min(1).max(256).optional(), at: z.string().min(1).max(64).optional() }, 'sessionMessages', readOnly],
    ['session_children', 'List delegated and native subagent child sessions. Follow next_cursor; fork relations are separate.', { ...sessionRef.shape, ...page }, 'sessionChildren', readOnly],
    ['session_relations', 'Read native subagent, fork and explicitly registered delegation relations for a session.', sessionRef.shape, 'sessionRelations', readOnly],
  ]
  for (const [name, description, inputSchema, operation, annotations] of tools) {
    server.registerTool(name, { description, inputSchema, outputSchema, annotations }, handler(input => service[operation](input)))
  }
  return server
}
