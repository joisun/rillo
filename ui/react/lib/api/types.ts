export interface SessionProvider {
  id: string
  name: string
  store_id: string
  capabilities: { full_text_search: boolean; search_experimental: boolean; message_location: boolean; resume: boolean; live_presence?: boolean; branch_groups?: boolean }
}

export interface SessionActivityPage {
  store_id: string
  available: boolean
  sessions: BrowserSession[]
  checked_at: string
}

export interface SessionRef {
  provider: string
  store_id: string
  session_id: string
}

export interface SessionPin extends SessionRef {
  pinned_at: string
}

export interface BrowserSession extends SessionRef {
  title: string
  preview: string
  snippet?: string | null
  workspace: string | null
  branch: string | null
  created_at: string | null
  updated_at: string | null
  last_active_at: string | null
  state: string
  active_flags?: ('waitingOnApproval' | 'waitingOnUserInput')[]
  is_subagent?: boolean
  native_parent: SessionRef | null
  forked_from: SessionRef | null
}

export interface SessionRelation {
  id: string
  kind: 'delegation' | 'subagent' | 'fork'
  origin: 'registered' | 'native'
  parent: SessionRef
  child: SessionRef
  created_at: string | null
  source: string
}

export interface SessionTimeline {
  session: BrowserSession
  segments: { turn_id: string; start: string; end: string | null; status: string }[]
  anchors: { turn_id: string; at: string; cursor: string | null }[]
  next_cursor: string | null
  coverage: 'partial' | 'complete' | 'unsupported'
  from: string | null
  to: string | null
  scope?: 'session' | 'window'
  bounds?: { start_at: string | null; end_at: string | null; end_state: 'known' | 'unknown' | 'pending' | 'empty'; indexed_from: string | null }
  unplaced_turns: number
  points?: { item_id: string; turn_id: string; at: string; role: 'user' | 'assistant' }[]
  points_coverage?: 'partial' | 'complete' | 'unsupported'
  untimed_messages?: number
}

export interface SessionFilters {
  branch?: string
  item_id?: string
  workspace?: string
  query?: string
  archived?: boolean
  cursor?: string | null
  limit?: number
  store_id?: string
  at?: string
  from?: string
  to?: string
}

export interface SessionPage {
  sessions: BrowserSession[]
  next_cursor: string | null
  search_scope: 'messages' | null
  scanned_count: number
  relations: SessionRelation[]
}

export interface SessionWorkspacePage {
  workspaces: { path: string; observed_count: number; branch_names?: string[]; last_active_at: string | null }[]
  next_cursor: string | null
}

export interface SessionBranchPage {
  branches: { name: string; observed_count: number; workspace_paths: string[]; session_ids: string[]; last_active_at: string | null }[]
  next_cursor: string | null
}

export interface SessionMessagesPage {
  session: BrowserSession
  messages: { id: string; turn_id: string; role: 'user' | 'assistant'; text: string; truncated: boolean; at: string | null; time_precision: 'message' | 'turn' | 'unknown' }[]
  seek?: { at: string; precision: 'message' | 'turn' | 'unknown'; turn_id: string | null; item_id: string | null; state?: string } | null
  match: { item_id: string; turn_id: string; snippet: string; range: { start: number; end: number } } | null
  next_cursor: string | null
  truncated: boolean
}

export interface DashboardSettingsResponse {
  local_actions_supported?: boolean
  settings: {
    resume_terminal: string
    schedule_definitions_dir: string
  }
  terminal_options: { id: string; label: string; available: boolean }[]
  restart_required: boolean
}

export interface DashboardMeta {
  service: 'rillo'
  service_version: string
  api_version: string
  capabilities: {
    runtime_registry: boolean
    unified_runs: boolean
    internal_scheduler: boolean
  }
}

export interface ScheduleWorkHours {
  weekdays: number[]
  windows: { start: string; end: string }[]
}

export type ScheduleCadence =
  | { kind: 'once'; at: string; timezone_mode?: 'system' }
  | (({ kind: 'interval'; minutes: number; timezone_mode?: 'system' }
  | { kind: 'hourly'; minute: number; timezone_mode?: 'system' }
  | { kind: 'daily'; hour: number; minute: number; timezone_mode?: 'system' }
  | { kind: 'weekly'; hour: number; minute: number; weekdays: number[]; timezone_mode?: 'system' }
  | { kind: 'monthly'; hour: number; minute: number; day: number; timezone_mode?: 'system' }) & { work_hours?: ScheduleWorkHours })

export type RunStatus =
  | 'queued'
  | 'claimed'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'skipped_overlap'
  | 'canceled'
  | 'lost'
  | 'interrupted'

export type ScheduleExecutionStatus = RunStatus | 'dispatch_failed' | 'dispatch_stalled'

export interface ScheduleExecutionSummary {
  kind: 'run' | 'dispatch'
  id: string
  status: ScheduleExecutionStatus
  trigger?: 'scheduled' | 'manual' | 'catchup' | string
  requested_at?: string | null
  last_attempted_at?: string | null
  claim_deadline_at?: string | null
  started_at?: string | null
  finished_at?: string | null
  error_code?: string | null
  output_count?: number
  attempt_count?: number
}

export interface ScheduleLastRun {
  id: string
  status: RunStatus
  finished_at: string | null
  reviewed_at: string | null
}

export type ScheduleCapabilityMode = 'inherit' | 'disabled'

export interface ScheduleCapabilities {
  skills: ScheduleCapabilityMode
  integrations: ScheduleCapabilityMode
}

export interface ScheduleRecord {
  id: string
  title: string
  prompt?: string
  workspace: string
  agent: string
  cadence: ScheduleCadence
  timezone_mode: string
  thread_mode: 'new' | 'reuse' | 'auto'
  auto_compact_token_limit?: number | null
  max_inherit_runs?: number
  sandbox_mode: 'read-only' | 'workspace-write' | 'danger-full-access'
  model: string | null
  reasoning_effort: string | null
  fast_mode?: boolean | null
  network_access?: boolean | null
  timeout_seconds: number
  capabilities: ScheduleCapabilities
  enabled: boolean
  etag: string
  source_path: string
  schedule_generation: number
  sync_state: string
  sync_error_code: string | null
  next_run_at: string | null
  last_run_at: string | null
  unread_run_count?: number
  last_run?: ScheduleLastRun | null
  current_execution?: ScheduleExecutionSummary | null
  created_at: string
  updated_at: string
}

export interface ScheduleCapability {
  supported: boolean
  backend?: string
  reason?: string | null
  [key: string]: unknown
}

export interface RuntimeStatus {
  id: string
  display_name: string
  state: 'ready' | 'unavailable' | string
  models_source?: string
  error_code?: string | null
  capabilities?: Record<string, unknown>
}

export interface RuntimeListResponse {
  runtimes: RuntimeStatus[]
}

export interface RuntimeSettingsResponse {
  auto_compact_token_limit: {
    supported: boolean
    configured_tokens: number | null
    source: 'local_config' | 'model_default' | 'unsupported'
  }
}

export interface RuntimeModel {
  id?: string
  slug?: string
  displayName?: string
  display_name?: string
  description?: string
  reasoningLevels?: string[]
  supported_reasoning_levels?: string[]
  defaultReasoningLevel?: string
  default_reasoning_level?: string
}

export interface RuntimeModelCatalogResponse {
  source: string
  models: RuntimeModel[]
  error_code?: string | null
}

export interface InvalidScheduleDefinition {
  source_path?: string
  error_code?: string
  path?: string
  title?: string
  code?: string
  message?: string
  [key: string]: unknown
}

export interface ScheduleListResponse {
  capability: ScheduleCapability
  jobs: ScheduleRecord[]
  invalid?: InvalidScheduleDefinition[]
}

export interface ScheduleResponse {
  job: ScheduleRecord
  changed?: boolean
}

export interface RunFileChange {
  path: string
  kind: 'add' | 'update' | 'delete' | string
}

export interface RunRecord {
  id: string
  job_id: string
  definition_etag: string
  runtime_id: string
  interactive: boolean
  turn_revision: number | null
  trigger: 'scheduled' | 'manual' | 'catchup' | string
  status: RunStatus
  thread_id: string | null
  thread_mode?: 'new' | 'reuse' | 'auto'
  session_mode?: 'new' | 'reuse'
  session_mode_reason?: string
  inherit_run_number?: number
  max_inherit_runs?: number
  scheduled_for: string | null
  claimed_at: string | null
  started_at: string | null
  heartbeat_at: string | null
  finished_at: string | null
  exit_code: number | null
  error_code: string | null
  final_message: string | null
  file_changes: RunFileChange[]
  has_stdout_log: boolean
  has_stderr_log: boolean
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

export interface RunDispatchRecord extends ScheduleExecutionSummary {
  kind: 'dispatch'
  job_id?: string
}

export interface ScheduleRunsResponse {
  runs: RunRecord[]
  dispatches?: RunDispatchRecord[]
}

export interface RunResponse {
  run: RunRecord
  changed?: boolean
}

export interface RunLogResponse {
  stream: 'stdout' | 'stderr'
  content: string
  truncated?: boolean
}

export interface RunControlResponse {
  accepted: boolean
  run_id: string
  turn_revision: number
}

export type TerminalResumeAction = 'focused' | 'new_tab' | 'new_window'

export interface RunResumeResponse {
  action?: TerminalResumeAction
  ok?: boolean
  terminal?: string
  run_id?: string
  session_id?: string
}

export interface RunEvent {
  sequence: number
  runId: string
  type: string
  observedAt: string
  payload: Record<string, unknown>
}

export interface RunConversationMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
}

export interface RunConversationResponse {
  run_id: string
  session_id: string
  messages: RunConversationMessage[]
  truncated: boolean
}

export interface ScheduleMutationInput {
  title: string
  prompt: string
  workspace: string
  agent: string
  thread_mode?: ScheduleRecord['thread_mode']
  auto_compact_token_limit?: number | null
  max_inherit_runs?: number
  cadence: ScheduleCadence
  sandbox_mode: ScheduleRecord['sandbox_mode']
  model: string | null
  reasoning_effort: string | null
  fast_mode?: boolean | null
  network_access?: boolean | null
  timeout_seconds: number
  capabilities: ScheduleCapabilities
}
