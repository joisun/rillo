import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCliArguments, runCli, runCliMain } from '../server/cli.mjs'

test('CLI opens the configured Dashboard URL without modifying service state', async () => {
  const calls = []
  const result = await runCli(['open'], {
    configResolver: async () => ({ serverBaseUrl: 'http://127.0.0.1:43127' }),
    dashboardOpener: async (url) => {
      calls.push(url)
      return { opened: true, url }
    },
    controlRunner: async () => {
      throw new Error('open must not invoke service control')
    },
  })

  assert.deepEqual(result, { opened: true, url: 'http://127.0.0.1:43127' })
  assert.deepEqual(calls, ['http://127.0.0.1:43127'])
})

test('CLI scheduler commands delegate only to the typed daemon control-plane client', async () => {
  const calls = []
  const configResolver = async () => ({ serverBaseUrl: 'http://127.0.0.1:43127' })
  const clientFactory = ({ baseUrl }) => ({
    schedulerStatus: async () => {
      calls.push(['status', baseUrl])
      return { ready: true, scheduler: { supported: true } }
    },
    schedulerReconcile: async () => {
      calls.push(['reconcile', baseUrl])
      return { jobs: [{ id: '11111111-1111-4111-8111-111111111111', reconciled: true, error_code: null }] }
    },
  })

  assert.deepEqual(await runCli(['scheduler', 'status'], { configResolver, clientFactory }), {
    ready: true, scheduler: { supported: true },
  })
  assert.deepEqual(await runCli(['scheduler', 'reconcile'], { configResolver, clientFactory }), {
    jobs: [{ id: '11111111-1111-4111-8111-111111111111', reconciled: true, error_code: null }],
  })
  assert.deepEqual(calls, [
    ['status', 'http://127.0.0.1:43127'],
    ['reconcile', 'http://127.0.0.1:43127'],
  ])

  await assert.rejects(runCli(['scheduler', 'reconcile'], {
    configResolver,
    clientFactory: () => ({
      schedulerReconcile: async () => {
        const error = new Error('unavailable')
        error.code = 'SERVICE_UNAVAILABLE'
        throw error
      },
    }),
  }), (error) => error.code === 'SERVICE_UNAVAILABLE')
})

test('CLI retains service control commands and rejects retired import/migrate before opening config or storage', async () => {
  const calls = []
  for (const command of ['install', 'start', 'stop', 'status', 'uninstall']) {
    assert.deepEqual(parseCliArguments([command]), { type: 'control', command })
    await runCli([command], { controlRunner: async value => calls.push(value) })
  }
  assert.deepEqual(calls, ['install', 'start', 'stop', 'status', 'uninstall'])
  assert.deepEqual(parseCliArguments([]), { type: 'control', command: 'status' })
  for (const args of [['migrate', '--dry-run'], ['migrate', '--apply'], ['import', 'codex', '--session', 'thread']]) {
    await assert.rejects(runCli(args, {
      configResolver: () => assert.fail('retired command must not access config'),
      clientFactory: () => assert.fail('retired command must not invoke service'),
    }), error => error.code === 'TASKS_RETIRED' && /preserved/.test(error.message))
  }
})

test('CLI main returns stable success and failure exit codes with JSON-only stdout', async () => {
  let stdout = ''
  let stderr = ''
  const success = await runCliMain([], {
    stdout: { write: (value) => { stdout += value } },
    stderr: { write: (value) => { stderr += value } },
    controlRunner: async () => ({ ready: true }),
  })
  assert.equal(success, 0)
  assert.deepEqual(JSON.parse(stdout), { ready: true })
  assert.equal(stderr, '')

  stdout = ''
  const failure = await runCliMain(['invalid'], {
    stdout: { write: (value) => { stdout += value } },
    stderr: { write: (value) => { stderr += value } },
  })
  assert.equal(failure, 1)
  assert.equal(stdout, '')
  assert.match(stderr, /usage:/)
})
