import assert from 'node:assert/strict'
import test from 'node:test'

import { createTerminalLauncher, shellQuote } from '../server/src/terminal-launcher.mjs'

test('terminal launcher builds a private self-cleaning resume script without shell interpolation', async () => {
  const existing = new Set([
    '/System/Applications/Utilities/Terminal.app',
    '/usr/local/bin/codex',
    '/usr/local/bin/otty',
  ])
  const writes = []
  const executions = []
  const launcher = createTerminalLauncher({
    platform: 'darwin',
    env: { PATH: '/usr/local/bin:/usr/bin' },
    homeDirectory: '/Users/me',
    runtimeDirectory: '/Users/me/.config/tasks-recorder/runtime',
    accessImpl: async (path) => {
      if (!existing.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    },
    statImpl: async () => ({ isDirectory: () => true }),
    mkdirImpl: async () => {},
    writeFileImpl: async (...args) => { writes.push(args) },
    execFileImpl: async (...args) => { executions.push(args) },
    randomId: () => 'fixed-id',
  })

  assert.deepEqual((await launcher.options()).map(({ id, available }) => [id, available]), [
    ['terminal', true], ['otty', true], ['ghostty', false],
  ])
  const result = await launcher.launch({
    terminal: 'terminal',
    sessionId: '019fa297-4567-7bf0-a69a-84fd23b3aaab',
    workspace: "/Users/me/Work Folder/project's-copy",
  })

  assert.equal(result.terminal_label, 'Terminal.app')
  assert.equal(writes.length, 1)
  assert.equal(writes[0][0], '/Users/me/.config/tasks-recorder/runtime/resume-fixed-id.command')
  assert.equal(writes[0][2].mode, 0o700)
  assert.match(writes[0][1], /^#!\/bin\/zsh\nrm -f -- /)
  assert.match(writes[0][1], /cd -- '\/Users\/me\/Work Folder\/project'\\''s-copy'/)
  assert.match(writes[0][1], /exec '\/usr\/local\/bin\/codex' resume '019fa297-4567-7bf0-a69a-84fd23b3aaab'/)
  assert.deepEqual(executions, [[
    '/usr/bin/open',
    ['-na', '/System/Applications/Utilities/Terminal.app', '/Users/me/.config/tasks-recorder/runtime/resume-fixed-id.command'],
    { timeout: 5_000 },
  ]])
})

test('session browser resumes from its trusted Codex data root with shell metacharacters quoted', async () => {
  let script
  const launcher = createTerminalLauncher({
    platform: 'darwin', env: { PATH: '/usr/local/bin' },
    accessImpl: async () => {}, statImpl: async () => ({ isDirectory: () => true }),
    mkdirImpl: async () => {}, writeFileImpl: async (_path, contents) => { script = contents },
    execFileImpl: async () => {}, randomId: () => 'source-root',
  })
  const codexHome = "/Users/me/Codex's data/$(ignored)"
  await launcher.launch({ terminal: 'terminal', sessionId: 'session-safe', workspace: '/workspace', codexHome })
  assert.ok(script.includes('exec /usr/bin/env ' + shellQuote('CODEX_HOME=' + codexHome) + " '/usr/local/bin/codex' resume 'session-safe'"))
  await assert.rejects(launcher.launch({ sessionId: 'session-safe', workspace: '/workspace', codexHome: 'relative' }), { code: 'SESSION_DATA_ROOT_INVALID' })
})

function ottyFixture({ panes = [], windows = [{ id: 'w_existing', focused: true }], running = true, missingWorkspace = false } = {}) {
  const calls = [], writes = []
  const state = { panes, windows, running, created: 0 }
  const launcher = createTerminalLauncher({
    platform: 'darwin', env: { PATH: '/tools' }, homeDirectory: '/home/user',
    accessImpl: async path => { if (!['/tools/otty', '/tools/codex', '/tools/opencode'].includes(path)) throw new Error('missing') },
    statImpl: async () => { if (missingWorkspace) throw new Error('missing'); return { isDirectory: () => true } },
    mkdirImpl: async () => {}, writeFileImpl: async (...args) => writes.push(args), delayImpl: async () => {},
    execFileImpl: async (_file, args) => {
      calls.push(args)
      const reply = data => ({ stdout: JSON.stringify({ ok: true, data }) })
      if (args[0] === 'pane' && args[1] === 'list') {
        if (!state.running) throw Object.assign(new Error('Otty is not running'), { code: 3 })
        const tab = args.includes('--tab') ? args[args.indexOf('--tab') + 1] : null
        return reply(state.panes.filter(p => !tab || p.tab_id === tab))
      }
      if (args[0] === 'window' && args[1] === 'list') {
        if (!state.running) throw Object.assign(new Error('Otty is not running'), { code: 3 })
        return reply(state.windows)
      }
      if (args[0] === 'open' || args[0] === 'tab' && args[1] === 'new') {
        state.created++
        const window = args[0] === 'open' ? 'w_created' : args[args.indexOf('--window') + 1]
        if (args[0] === 'open') { state.running = true; state.windows = [{ id: window, focused: true }] }
        const tab = 't_created_' + state.created
        state.panes.push({ id: 'p_created_' + state.created, tab_id: tab, window_id: window, agent: '', agent_session_id: '' })
        return reply({ id: tab })
      }
      return reply(null)
    },
  })
  return { launcher, calls, writes, state }
}
const ottyTarget = { terminal: 'otty', sessionId: 'session-safe', workspace: '/workspace/project', title: '继续会话' }

test('Otty focuses the exact native session pane before checking the workspace or starting a CLI', async () => {
  const f = ottyFixture({ panes: [{ id: 'p_live', tab_id: 't_live', window_id: 'w_existing', agent: 'Codex', agent_session_id: 'session-safe', agent_state: 'processing' }], missingWorkspace: true })
  const result = await f.launcher.launch({ ...ottyTarget, allowCreate: false })
  assert.equal(result.action, 'focused')
  assert.equal(result.pane_id, 'p_live')
  assert.deepEqual(f.calls, [['pane', 'list', '--json'], ['pane', 'focus', '--pane', 'p_live', '--json']])
  assert.equal(f.writes.length, 0)
})

test('Otty creates a tab in the focused existing window without renaming any window', async () => {
  const f = ottyFixture({ windows: [{ id: 'w_other', focused: false }, { id: 'w_focused', focused: true }] })
  const result = await f.launcher.launch(ottyTarget)
  assert.equal(result.action, 'new_tab')
  assert.ok(f.calls.some(args => args[0] === 'tab' && args[1] === 'new' && args[3] === 'w_focused'))
  assert.ok(!f.calls.some(args => args[0] === 'open' || args[0] === 'window' && args[1] === 'rename'))
  const input = f.calls.find(args => args[1] === 'send-text')
  assert.ok(input.includes("'/tools/codex' resume 'session-safe'"))
  assert.ok(input.includes('--no-escape'))
  assert.ok(f.calls.some(args => args[1] === 'send-keys' && args.includes('key:Enter')))
})

test('Otty cold launch creates one window and uses its initial tab', async () => {
  const f = ottyFixture({ running: false, windows: [] })
  const result = await f.launcher.launch(ottyTarget)
  assert.equal(result.action, 'new_window')
  assert.equal(f.state.created, 1)
  assert.ok(!f.calls.some(args => args[0] === 'tab' && args[1] === 'new'))
})

test('concurrent Otty resume clicks reuse the created pane while native session discovery starts', async () => {
  const f = ottyFixture()
  const results = await Promise.all([f.launcher.launch(ottyTarget), f.launcher.launch(ottyTarget)])
  assert.deepEqual(results.map(result => result.action), ['new_tab', 'focused'])
  assert.equal(f.state.created, 1)
  assert.equal(f.calls.filter(args => args[1] === 'send-text').length, 1)
})

test('an active session with no matching Otty pane never creates a tab or sends input', async () => {
  const f = ottyFixture({ panes: [{ id: 'p_other', agent: 'Codex', agent_session_id: 'session-safe-other' }] })
  await assert.rejects(f.launcher.launch({ ...ottyTarget, allowCreate: false }), { code: 'SESSION_BROWSER_SESSION_ACTIVE' })
  assert.equal(f.state.created, 0)
  assert.ok(!f.calls.some(args => args[1] === 'send-text'))
})

test('ambiguous Otty sessions are rejected without focusing a pane or launching another session', async () => {
  const f = ottyFixture({ panes: ['first', 'second'].map(id => ({ id, agent: 'Codex', agent_session_id: 'session-safe', agent_state: 'processing' })) })
  await assert.rejects(f.launcher.launch(ottyTarget), { code: 'TERMINAL_SESSION_AMBIGUOUS' })
  assert.deepEqual(f.calls, [['pane', 'list', '--json']])
  assert.equal(f.state.created, 0)
})

test('native Otty metadata for another session is never replaced by a pending launch reference', async () => {
  const f = ottyFixture()
  const created = await f.launcher.launch(ottyTarget)
  Object.assign(f.state.panes.find(pane => pane.id === created.pane_id), { agent: 'Codex', agent_session_id: 'another-session' })
  const result = await f.launcher.launch(ottyTarget)
  assert.equal(result.action, 'new_tab')
  assert.notEqual(result.pane_id, created.pane_id)
})

test('Otty inventory errors do not cause a new-window fallback', async () => {
  const f = ottyFixture()
  f.launcher = createTerminalLauncher({ platform: 'darwin', env: { PATH: '/tools' }, accessImpl: async () => {}, execFileImpl: async () => { throw Object.assign(new Error('permission denied'), { code: 7 }) } })
  await assert.rejects(f.launcher.launch(ottyTarget), { code: 'TERMINAL_LAUNCH_FAILED' })
})

test('terminal launcher rejects missing workspaces and unsafe session identities before launch', async () => {
  const launcher = createTerminalLauncher({
    platform: 'darwin',
    env: { PATH: '/usr/local/bin' },
    accessImpl: async () => {},
    statImpl: async () => { throw new Error('missing') },
  })
  await assert.rejects(
    launcher.launch({ terminal: 'terminal', sessionId: 'session-safe', workspace: '/missing' }),
    (error) => error.code === 'WORKSPACE_NOT_FOUND',
  )
  await assert.rejects(
    launcher.launch({ terminal: 'terminal', sessionId: 'bad session;open', workspace: '/workspace' }),
    (error) => error.code === 'SESSION_ID_INVALID',
  )
})

test('terminal launcher safely quotes native OpenCode session IDs with underscores', async () => {
  const writes = []
  const launcher = createTerminalLauncher({
    platform: 'darwin', env: { PATH: '/usr/local/bin' }, homeDirectory: '/Users/me',
    runtimeDirectory: '/Users/me/.config/tasks-recorder/runtime',
    accessImpl: async () => {}, statImpl: async () => ({ isDirectory: () => true }),
    mkdirImpl: async () => {}, writeFileImpl: async (...args) => writes.push(args),
    execFileImpl: async () => {}, randomId: () => 'opencode-id',
  })
  await launcher.launch({ terminal: 'terminal', runtimeId: 'opencode', sessionId: 'ses_abcdef_123456', workspace: '/workspace' })
  assert.match(writes[0][1], /exec '.*opencode' --session 'ses_abcdef_123456'/)
})
