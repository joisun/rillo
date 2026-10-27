import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createGhosttyRouter } from '../server/src/terminal-launcher/ghostty.mjs'

async function fixture(t, existingWindows = ['w_live']) {
  const runtimeDirectory = await mkdtemp(join(tmpdir(), 'tasks-recorder-ghostty-'))
  t.after(() => rm(runtimeDirectory, { recursive: true, force: true }))
  const state = { windows: existingWindows, panes: [], created: 0, calls: [] }
  const execFileImpl = async (file, args) => {
    assert.equal(file, '/usr/bin/osascript')
    const operation = args[2]; state.calls.push({ operation, args: args.slice(3) })
    if (operation === 'list') return { stdout: [...state.windows.map(id => 'W\t' + id), ...state.panes.map(id => 'P\t' + id), ...(state.windows.length ? ['F\t' + state.windows.at(-1)] : [])].join('\n') }
    if (operation === 'focus') return { stdout: args[3] }
    const id = 'p_created_' + ++state.created; state.panes.push(id)
    if (operation === 'window') state.windows.push('w_created')
    return { stdout: id }
  }
  const make = () => createGhosttyRouter({ runtimeDirectory, execFileImpl })
  return { state, make, runtimeDirectory }
}
const target = { key: 'codex-store-session', workspace: '/workspace', title: '会话 "标题"', command: "'/bin/zsh' '/private/runtime/script.command'" }

test('Ghostty creates a tab in an existing window, then focuses the same terminal after service restart', async t => {
  const f = await fixture(t)
  const first = f.make()
  assert.equal(await first.focus(target.key), null)
  assert.equal((await first.create(target)).action, 'new_tab')
  assert.equal((await f.make().focus(target.key)).action, 'focused')
  assert.equal(f.state.created, 1)
  assert.ok(f.state.calls.some(call => call.operation === 'tab' && call.args.at(-1) === 'w_live'))
  const cache = JSON.parse(await readFile(join(f.runtimeDirectory, 'ghostty-targets.json'), 'utf8'))
  assert.equal(cache[target.key], 'p_created_1')
})

test('Ghostty with no windows creates one window with its initial tab', async t => {
  const f = await fixture(t, [])
  const result = await f.make().create(target)
  assert.equal(result.action, 'new_window')
  assert.equal(f.state.created, 1)
  assert.equal(f.state.calls.filter(call => call.operation === 'tab').length, 0)
})

test('a closed Ghostty terminal is not focused and another data source does not reuse its reference', async t => {
  const f = await fixture(t)
  const router = f.make()
  await router.create(target)
  assert.equal(await router.focus('other-codex-store-session'), null)
  f.state.panes = []
  assert.equal(await router.focus(target.key), null)
  assert.equal((await router.create(target)).pane_id, 'p_created_2')
})
