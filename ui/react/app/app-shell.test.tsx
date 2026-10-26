import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { createDashboardApi, type DashboardApi } from '@/lib/api/dashboard-api'
import type { DashboardMeta, RunRecord, ScheduleRecord } from '@/lib/api/types'
import { AppProviders } from './app-providers'
import { DashboardApp } from './dashboard-app'

const meta: DashboardMeta = {
  service: 'tasks-recorder',
  service_version: '0.8.0',
  api_version: 'v1',
  capabilities: {
    runtime_registry: true,
    unified_runs: true,
    internal_scheduler: true,
  },
}

const schedule: ScheduleRecord = {
  id: 'schedule-a', title: 'Codex update report', workspace: '/Users/me/notes', agent: 'codex',
  cadence: { kind: 'daily', hour: 9, minute: 0, timezone_mode: 'system' },
  capabilities: { skills: 'inherit', integrations: 'inherit' },
  timezone_mode: 'system', thread_mode: 'new', sandbox_mode: 'read-only', model: 'gpt-5.6',
  reasoning_effort: 'low', timeout_seconds: 7200, enabled: true, etag: 'a'.repeat(64),
  source_path: '/Users/me/schedules/codex-update-report.md', schedule_generation: 1,
  sync_state: 'synced', sync_error_code: null, next_run_at: '2026-08-29T01:00:00.000Z',
  last_run_at: null, unread_run_count: 0, last_run: null, current_execution: null,
  created_at: '2026-08-28T01:00:00.000Z', updated_at: '2026-08-28T01:00:00.000Z',
}

const run: RunRecord = {
  id: 'run-a', job_id: schedule.id, definition_etag: schedule.etag, runtime_id: 'codex',
  interactive: false, turn_revision: null, trigger: 'manual', status: 'succeeded',
  thread_id: '019fcfae-8d5b-7640-aec8-83a114810589', scheduled_for: null,
  claimed_at: '2026-08-28T02:00:00.000Z', started_at: '2026-08-28T02:00:01.000Z',
  heartbeat_at: '2026-08-28T02:00:03.000Z', finished_at: '2026-08-28T02:01:00.000Z',
  exit_code: 0, error_code: null, final_message: 'Report completed.',
  file_changes: [{ path: 'report.md', kind: 'update' }], has_stdout_log: true,
  has_stderr_log: false, reviewed_at: null, created_at: '2026-08-28T02:00:00.000Z',
  updated_at: '2026-08-28T02:01:00.000Z',
}

class FakeRunEventSource {
  static instances: FakeRunEventSource[] = []

  readonly url: string
  readonly listeners = new Map<string, EventListener[]>()
  closed = false

  constructor(url: string) {
    this.url = url
    FakeRunEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  dispatch(type: string, data?: object, lastEventId = '') {
    const event = data
      ? new MessageEvent(type, { data: JSON.stringify(data), lastEventId })
      : new Event(type)
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  close() { this.closed = true }
}

function dashboardApi(runRecord: RunRecord = run): DashboardApi {
  return {
    ...createDashboardApi({
      fetchImpl: vi.fn(async () => new Response('{}', {
        headers: { 'Content-Type': 'application/json' },
      })),
    }),
    meta: vi.fn(async () => meta),
    sessionProviders: vi.fn(async () => ({ providers: [] })),
    settings: vi.fn(async () => ({ settings: { resume_terminal: 'otty', schedule_definitions_dir: '/schedules' }, terminal_options: [{ id: 'otty', label: 'Otty', available: true }], restart_required: false })),
    runtimes: vi.fn(async () => ({
      runtimes: [{ id: 'codex', display_name: 'Codex', state: 'ready' }],
    })),
    runtimeModels: vi.fn(async () => ({
      source: 'live',
      models: [{
        id: 'gpt-5.6', displayName: 'GPT-5.6', description: 'Coding model',
        reasoningLevels: ['low', 'medium', 'high'], defaultReasoningLevel: 'medium',
      }],
    })),
    schedules: vi.fn(async () => ({
      capability: { supported: true, backend: 'internal' }, jobs: [schedule], invalid: [],
    })),
    runScheduleNow: vi.fn(async () => ({ dispatched: true })),
    pauseSchedule: vi.fn(async () => ({ job: { ...schedule, enabled: false } })),
    resumeSchedule: vi.fn(async () => ({ job: { ...schedule, enabled: true } })),
    schedule: vi.fn(async () => ({ job: { ...schedule, prompt: 'Create report.' } })),
    scheduleRuns: vi.fn(async () => ({ runs: [runRecord], dispatches: [] })),
    scheduledRun: vi.fn(async () => ({ run: runRecord })),
    scheduledRunLog: vi.fn(async () => ({ stream: 'stdout' as const, content: 'completed\n' })),
    markScheduledRunReviewed: vi.fn(async () => ({
      run: { ...runRecord, reviewed_at: '2026-08-28T03:00:00.000Z' }, changed: true,
    })),
    resumeScheduledRun: vi.fn(async () => ({ ok: true, run_id: runRecord.id })),
    steerRun: vi.fn(async (_id, input) => ({
      accepted: true, run_id: runRecord.id, turn_revision: input.expected_turn_revision,
    })),
    stopRun: vi.fn(async (_id, input) => ({
      accepted: true, run_id: runRecord.id, turn_revision: input.expected_turn_revision,
    })),
    cancelRun: vi.fn(async () => ({ run: { ...runRecord, status: 'canceled' as const } })),
  }
}

function renderApp(api = dashboardApi()) {
  return render(
    <AppProviders
      api={api}
      queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      createEventSource={null}
    >
      <DashboardApp />
    </AppProviders>,
  )
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  FakeRunEventSource.instances = []
})

afterEach(() => vi.unstubAllGlobals())

test('only Sessions and Scheduled remain and old Tasks URLs open activity', async () => {
  window.history.replaceState(null, '', '/?view=tasks')
  const api = dashboardApi()
  renderApp(api)
  expect(screen.getByRole('heading', { name: 'Tasks Recorder' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Sessions' })).toHaveAttribute('aria-current', 'page')
  expect(screen.queryByRole('button', { name: 'Tasks' })).not.toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Tree' })).toHaveAttribute('aria-selected', 'true')
  await waitFor(() => expect(window.location.search).toContain('view=sessions'))
  await userEvent.click(screen.getByRole('button', { name: 'Scheduled' }))
  expect(await screen.findByText('1 个计划')).toBeInTheDocument()
  expect(window.location.search).toContain('view=scheduled')
  expect(screen.getByTestId('global-actions')).toHaveAttribute('data-safe-area', 'global-actions')
})

test('opens Run Review and reads durable Run facts and logs', async () => {
  const user = userEvent.setup()
  const api = dashboardApi()
  renderApp(api)

  await user.click(screen.getByRole('button', { name: 'Scheduled' }))
  await user.click(await screen.findByRole('button', {
    name: '查看 Codex update report 的执行记录',
  }))

  expect(await screen.findByRole('heading', { name: 'Codex update report' })).toBeInTheDocument()
  expect(await screen.findByText('Report completed.')).toBeInTheDocument()
  expect(screen.getByText('report.md')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'stdout' }))
  expect(await screen.findByText('completed', { selector: '.run-detail__log code' })).toBeInTheDocument()
  expect(api.scheduledRunLog).toHaveBeenCalledWith('run-a', { stream: 'stdout', tail: 32 * 1024 })
})

test('streams an interactive Run and steers the authoritative Turn without an optimistic bubble', async () => {
  const user = userEvent.setup()
  const activeRun: RunRecord = {
    ...run,
    interactive: true,
    turn_revision: null,
    status: 'running',
    thread_id: null,
    finished_at: null,
    exit_code: null,
    final_message: null,
    file_changes: [],
  }
  const terminalRun: RunRecord = {
    ...activeRun,
    interactive: false,
    turn_revision: null,
    status: 'canceled',
    thread_id: 'session-after-stop',
    finished_at: '2026-08-28T02:02:00.000Z',
    error_code: 'RUN_CANCELED',
    final_message: 'Stopped after review.',
  }
  const api = dashboardApi(activeRun)
  let detailReads = 0
  api.scheduledRun = vi.fn(async () => ({ run: detailReads++ === 0 ? activeRun : terminalRun }))
  vi.stubGlobal('EventSource', FakeRunEventSource)
  renderApp(api)

  await user.click(screen.getByRole('button', { name: 'Scheduled' }))
  await user.click(await screen.findByRole('button', {
    name: '查看 Codex update report 的执行记录',
  }))
  expect(await screen.findByRole('region', { name: 'Live Session' })).toBeInTheDocument()
  await waitFor(() => expect(FakeRunEventSource.instances).toHaveLength(1))
  const source = FakeRunEventSource.instances[0]
  expect(source.url).toBe('/api/v1/runs/run-a/events')

  source.dispatch('open')
  source.dispatch('run', {
    runId: run.id, sequence: 1, observedAt: '2026-08-28T02:00:02.000Z',
    type: 'turn_started', payload: { turn_revision: 2 },
  }, '1')
  source.dispatch('run', {
    runId: run.id, sequence: 2, observedAt: '2026-08-28T02:00:03.000Z',
    type: 'activity_started', payload: { item_id: 'tool-1', label: 'Read schema' },
  }, '2')
  source.dispatch('run', {
    runId: run.id, sequence: 3, observedAt: '2026-08-28T02:00:04.000Z',
    type: 'assistant_delta', payload: { item_id: 'message-1', delta: 'Checking **schema**' },
  }, '3')
  source.dispatch('run', {
    runId: run.id, sequence: 4, observedAt: '2026-08-28T02:00:05.000Z',
    type: 'assistant_delta', payload: { item_id: 'message-1', delta: '.' },
  }, '4')

  expect(await screen.findByText('Read schema')).toBeInTheDocument()
  expect(await screen.findByText('schema')).toBeInTheDocument()
  const composer = screen.getByRole('textbox', { name: '追加指令' })
  await user.type(composer, 'Inspect rollback too.')
  await user.click(screen.getByRole('button', { name: '发送' }))
  await waitFor(() => expect(api.steerRun).toHaveBeenCalledWith(run.id, {
    expected_turn_revision: 2,
    text: 'Inspect rollback too.',
  }))
  expect(composer).toHaveValue('')
  expect(screen.queryByText('Inspect rollback too.')).not.toBeInTheDocument()

  source.dispatch('run', {
    runId: run.id, sequence: 5, observedAt: '2026-08-28T02:00:06.000Z',
    type: 'status', payload: { state: 'canceled' },
  }, '5')
  expect(await screen.findByText('Stopped after review.')).toBeInTheDocument()
  expect(source.closed).toBe(true)
})
