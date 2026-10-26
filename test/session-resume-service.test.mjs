import assert from 'node:assert/strict'
import test from 'node:test'

import { createSessionResumeService } from '../server/src/session-resume-service.mjs'

const SCHEDULED_RUN_ID = '22222222-2222-4222-8222-222222222222'
const SCHEDULED_JOB_ID = '11111111-1111-4111-8111-111111111111'

function scheduledRun(overrides = {}) {
  return {
    id: SCHEDULED_RUN_ID,
    job_id: SCHEDULED_JOB_ID,
    status: 'succeeded',
    thread_id: 'thread-scheduled',
    spec_json: JSON.stringify({
      title: 'Canonical scheduled title',
      workspace: '/canonical/scheduled-workspace',
      prompt: 'private scheduled prompt',
    }),
    ...overrides,
  }
}

test('scheduled Run resume uses only canonical Run facts and returns privacy-bounded metadata', async () => {
  const requests = []
  const launches = []
  const service = createSessionResumeService({
    settings: { get: async () => ({ settings: { resume_terminal: 'otty' } }) },
    schedulerService: {
      getRun: async (...args) => {
        requests.push(args)
        return { run: scheduledRun() }
      },
    },
    sessionInventory: { has: async (sessionId) => sessionId === 'thread-scheduled' },
    terminalLauncher: {
      launch: async (input) => {
        launches.push(input)
        return {
          terminal: 'otty', terminal_label: 'Otty', session_id: input.sessionId,
          workspace: input.workspace, window_title: input.title,
        }
      },
    },
  })

  const result = await service.resumeScheduledRun(SCHEDULED_RUN_ID, {
    thread_id: 'browser-thread', workspace: '/browser/workspace', title: 'Browser title',
  })

  assert.deepEqual(requests, [[SCHEDULED_RUN_ID]])
  assert.deepEqual(launches, [{
    terminal: 'otty', sessionId: 'thread-scheduled',
    workspace: '/canonical/scheduled-workspace', title: 'Canonical scheduled title',
  }])
  assert.deepEqual(result, {
    ok: true, run_id: SCHEDULED_RUN_ID, job_id: SCHEDULED_JOB_ID,
    terminal: 'otty', terminal_label: 'Otty',
  })
  assert.equal('session_id' in result, false)
  assert.equal('workspace' in result, false)
})

test('scheduled Run resume rejects a missing or invalid thread before lookup or launch', async () => {
  let threadId = null
  const service = createSessionResumeService({
    settings: { get: async () => assert.fail('settings must not be read') },
    schedulerService: { getRun: async () => ({ run: scheduledRun({ thread_id: threadId }) }) },
    sessionInventory: { has: async () => assert.fail('inventory must not be read') },
    terminalLauncher: { launch: async () => assert.fail('launcher must not run') },
  })

  for (const value of [null, 'invalid thread id']) {
    threadId = value
    await assert.rejects(
      service.resumeScheduledRun(SCHEDULED_RUN_ID),
      (error) => error.code === 'SCHEDULE_RUN_NOT_RESUMABLE',
    )
  }
})

test('scheduled OpenCode Run resume accepts native underscore session IDs', async () => {
  const sessionId = 'ses_f2e6a1c3_abc123'
  const launches = []
  const service = createSessionResumeService({
    settings: { get: async () => ({ settings: { resume_terminal: 'terminal' } }) },
    schedulerService: { getRun: async () => ({ run: scheduledRun({ thread_id: sessionId, runtime_id: 'opencode' }) }) },
    sessionInventory: { has: async (id, runtimeId) => id === sessionId && runtimeId === 'opencode' },
    runtimeRegistry: {
      get: () => ({ sessionExists: async ({ sessionId: id }) => id === sessionId }),
      resolve: async () => ({ executable: '/usr/local/bin/opencode' }),
    },
    terminalLauncher: { launch: async (input) => { launches.push(input); return { terminal: 'terminal' } } },
  })

  await service.resumeScheduledRun(SCHEDULED_RUN_ID)
  assert.equal(launches[0].sessionId, sessionId)
})

test('scheduled RunService resume accepts its canonical run_id-shaped resume target', async () => {
  const launches = []
  const service = createSessionResumeService({
    settings: { get: async () => ({ settings: { resume_terminal: 'terminal' } }) },
    runService: { resumeTarget: () => ({
      run_id: SCHEDULED_RUN_ID, schedule_id: SCHEDULED_JOB_ID, runtime_id: 'opencode',
      session_id: 'ses_f1525bbabffeWegAS6bSi3rcC9', workspace: '/workspace', title: 'Scheduled task',
    }) },
    runtimeRegistry: {
      get: () => ({ sessionExists: async () => true }),
      resolve: async () => ({ executable: '/usr/local/bin/opencode' }),
    },
    sessionInventory: { has: async () => false },
    terminalLauncher: { launch: async input => { launches.push(input); return { terminal: 'terminal' } } },
  })

  const result = await service.resumeScheduledRun(SCHEDULED_RUN_ID)
  assert.equal(result.ok, true)
  assert.equal(launches[0].sessionId, 'ses_f1525bbabffeWegAS6bSi3rcC9')
})

test('scheduled Run resume rejects a missing local transcript before launch', async () => {
  const service = createSessionResumeService({
    settings: { get: async () => assert.fail('settings must not be read') },
    schedulerService: { getRun: async () => ({ run: scheduledRun() }) },
    sessionInventory: { has: async () => false },
    terminalLauncher: { launch: async () => assert.fail('launcher must not run') },
  })

  await assert.rejects(
    service.resumeScheduledRun(SCHEDULED_RUN_ID),
    (error) => error.code === 'CODEX_SESSION_NOT_FOUND',
  )
})

test('scheduled Run resume preserves typed terminal launch errors', async () => {
  const terminalError = Object.assign(new Error('Otty is unavailable'), { code: 'TERMINAL_UNAVAILABLE' })
  const service = createSessionResumeService({
    settings: { get: async () => ({ settings: { resume_terminal: 'otty' } }) },
    schedulerService: { getRun: async () => ({ run: scheduledRun() }) },
    sessionInventory: { has: async () => true },
    terminalLauncher: { launch: async () => { throw terminalError } },
  })

  await assert.rejects(
    service.resumeScheduledRun(SCHEDULED_RUN_ID),
    (error) => error === terminalError,
  )
})
