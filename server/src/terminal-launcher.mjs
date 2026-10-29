import { execFile as nodeExecFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'

import { RilloError } from '../../mcp/src/errors.mjs'
import { createGhosttyRouter } from './terminal-launcher/ghostty.mjs'

const execFileAsync = promisify(nodeExecFile)

export const DEFAULT_RESUME_TERMINAL = 'terminal'

const TERMINALS = Object.freeze([
  {
    id: 'terminal',
    label: 'Terminal.app',
    description: 'macOS 系统终端，兼容性最佳',
  },
  {
    id: 'otty',
    label: 'Otty',
    description: '优先定位已有会话，否则在现有窗口新建标签页',
  },
  {
    id: 'ghostty',
    label: 'Ghostty',
    description: '优先定位已有会话，否则在现有窗口新建标签页',
  },
])

const APP_PATHS = Object.freeze({
  terminal: '/System/Applications/Utilities/Terminal.app',
  ghostty: '/Applications/Ghostty.app',
})

function taskError(code, message, details) {
  return new RilloError(code, message, details)
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`
}

function executableCandidates(name, { env, homeDirectory }) {
  const fromPath = String(env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory, name))
  return [...new Set([
    ...fromPath,
    `/usr/local/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    join(homeDirectory, '.local', 'bin', name),
  ])]
}

async function firstExecutable(candidates, accessImpl) {
  for (const candidate of candidates) {
    try {
      await accessImpl(candidate, constants.X_OK)
      return candidate
    } catch {
      // Continue through the bounded allowlist.
    }
  }
  return null
}

function validateSessionId(sessionId) {
  if (
    typeof sessionId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(sessionId)
  ) {
    throw taskError('SESSION_ID_INVALID', 'Session ID is not safe to resume.')
  }
  return sessionId
}

function normalizeWindowTitle(title, runtimeId) {
  const fallback = runtimeId === 'opencode' ? 'OpenCode Resume' : 'Codex Resume'
  if (typeof title !== 'string') return fallback
  const normalized = title.replace(/\s+/g, ' ').trim()
  return normalized === '' ? fallback : normalized.slice(0, 160)
}

function launcherScript({ scriptPath, runtimePath, runtimeId, sessionId, workspace, codexHome }) {
  return `#!/bin/zsh
rm -f -- ${shellQuote(scriptPath)}
cd -- ${shellQuote(workspace)}
exec ${resumeShellCommand({ runtimePath, runtimeId, sessionId, codexHome })}
`
}

function resumeShellCommand({ runtimePath, runtimeId, sessionId, codexHome }) {
  const option = runtimeId === 'opencode' ? '--session' : 'resume'
  const prefix = codexHome === undefined ? '' : `/usr/bin/env ${shellQuote('CODEX_HOME=' + codexHome)} `
  return `${prefix}${shellQuote(runtimePath)} ${option} ${shellQuote(sessionId)}`
}

function parseOttyInventory(result, entity) {
  let payload
  try {
    payload = JSON.parse(String(result?.stdout ?? ''))
  } catch {
    throw new Error(`Otty returned invalid ${entity} inventory JSON`)
  }
  if (payload?.ok !== true || !Array.isArray(payload.data)) {
    throw new Error(`Otty returned an invalid ${entity} inventory`)
  }
  return payload.data.filter((item) => typeof item?.id === 'string' && item.id !== '')
}

function parseOttyWindows(result) {
  return parseOttyInventory(result, 'window')
}

function parseOttyPanes(result) {
  return parseOttyInventory(result, 'pane')
}

export function createTerminalLauncher({
  platform = process.platform,
  env = process.env,
  homeDirectory = homedir(),
  runtimeDirectory = join(homeDirectory, '.config', 'rillo', 'runtime'),
  accessImpl = access,
  statImpl = stat,
  mkdirImpl = mkdir,
  writeFileImpl = writeFile,
  rmImpl = rm,
  execFileImpl = execFileAsync,
  delayImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  clock = Date.now,
  randomId = randomUUID,
  appPaths = APP_PATHS,
} = {}) {
  let launchQueue = Promise.resolve()
  const pendingOtty = new Map()
  const ghostty = createGhosttyRouter({ runtimeDirectory, execFileImpl })

  async function resolveExecutable(name) {
    return firstExecutable(executableCandidates(name, { env, homeDirectory }), accessImpl)
  }

  async function resolveAdapter(id) {
    if (id === 'otty') {
      const executable = await resolveExecutable('otty')
      return executable ? { executable } : null
    }
    const appPath = appPaths[id]
    if (!appPath) return null
    try {
      await accessImpl(appPath, constants.F_OK)
      return { appPath }
    } catch {
      return null
    }
  }

  async function options() {
    const resolved = await Promise.all(TERMINALS.map(async (terminal) => ({
      ...terminal,
      available: platform === 'darwin' && Boolean(await resolveAdapter(terminal.id)),
    })))
    return resolved
  }

  async function listOttyWindows(executable) {
    return parseOttyWindows(await execFileImpl(
      executable,
      ['window', 'list', '--json'],
      { timeout: 5_000 },
    ))
  }

  async function ottySnapshot(executable) {
    try {
      const panes = parseOttyPanes(await execFileImpl(executable, ['pane', 'list', '--json'], { timeout: 5000 }))
      return { panes, running: true }
    } catch (error) {
      if (error.code !== 3) throw error
      return { panes: [], running: false }
    }
  }

  async function focusOtty(executable, { key, runtimeId, sessionId }) {
    const snapshot = await ottySnapshot(executable)
    let matches = snapshot.panes.filter(pane => pane.agent?.toLowerCase() === runtimeId && pane.agent_session_id === sessionId)
    const pending = pendingOtty.get(key)
    if (!matches.length && pending) {
      matches = snapshot.panes.filter(pane => pane.id === pending.pane && (!pane.agent_session_id || pane.agent_session_id === sessionId) && (pane.agent?.toLowerCase() === runtimeId || clock() - pending.at < 10000))
    }
    if (matches.length > 1) {
      const live = matches.filter(pane => pane.agent_state && pane.agent_state !== 'unknown')
      if (live.length === 1) matches = live
    }
    if (matches.length > 1) throw taskError('TERMINAL_SESSION_AMBIGUOUS', '多个 Otty pane 对应此会话，请在 Otty 中选择目标。')
    if (!matches.length) return null
    await execFileImpl(executable, ['pane', 'focus', '--pane', matches[0].id, '--json'], { timeout: 5000 })
    return { action: 'focused', pane_id: matches[0].id, tab_id: matches[0].tab_id, window_id: matches[0].window_id }
  }

  async function launchOtty({ executable, command, workspace, title, key }) {
    let windows = []
    try { windows = await listOttyWindows(executable) }
    catch (error) { if (error.code !== 3) throw error }
    const window = windows.find(item => item.focused) ?? windows[0]
    let tabId, windowId = window?.id
    if (window) {
      const created = JSON.parse((await execFileImpl(executable, ['tab', 'new', '--window', window.id, '--cwd', workspace, '--title', title, '--json'], { timeout: 5000 })).stdout)
      if (created.ok !== true || typeof created.data?.id !== 'string' || !created.data.id) throw new Error('Otty did not return the created tab')
      tabId = created.data.id
    } else {
      await execFileImpl(executable, ['open', workspace, '--title', title, '--json'], { timeout: 5000 })
      for (let attempt = 0; attempt < 20; attempt++) {
        let candidates = []
        try { candidates = await listOttyWindows(executable) }
        catch (error) { if (error.code !== 3) throw error }
        if (candidates.length === 1) { windowId = candidates[0].id; break }
        if (candidates.length > 1) throw new Error('More than one Otty window appeared during resume')
        if (attempt < 19) await delayImpl(25)
      }
      if (!windowId) throw new Error('Unable to resolve the new Otty window')
    }
    const panes = parseOttyPanes(await execFileImpl(executable, ['pane', 'list', ...(tabId ? ['--tab', tabId] : ['--window', windowId]), '--json'], { timeout: 5000 }))
    if (panes.length !== 1) throw new Error('The new Otty tab does not have one target pane')
    await execFileImpl(executable, ['pane', 'send-text', '--pane', panes[0].id, '--no-escape', command, '--json'], { timeout: 5000 })
    await execFileImpl(executable, ['pane', 'send-keys', '--pane', panes[0].id, 'key:Enter', '--json'], { timeout: 5000 })
    pendingOtty.set(key, { pane: panes[0].id, at: clock() })
    if (pendingOtty.size > 256) pendingOtty.delete(pendingOtty.keys().next().value)
    await execFileImpl(executable, ['pane', 'focus', '--pane', panes[0].id, '--json'], { timeout: 5000 })
    return { action: window ? 'new_tab' : 'new_window', pane_id: panes[0].id, tab_id: panes[0].tab_id, window_id: panes[0].window_id, focused: true }
  }

  function enqueueLaunch(operation) {
    const launch = launchQueue.then(operation, operation)
    launchQueue = launch.catch(() => undefined)
    return launch
  }

  async function launch(input) {
    return enqueueLaunch(async () => {
      try { return await launchOnce(input) }
      catch (error) {
        if (error instanceof RilloError) throw error
        throw taskError('TERMINAL_LAUNCH_FAILED', '无法定位或打开目标终端，请检查终端的控制权限。', { terminal: input.terminal ?? DEFAULT_RESUME_TERMINAL, cause: error.code ?? error.message })
      }
    })
  }

  async function launchOnce({ terminal = DEFAULT_RESUME_TERMINAL, runtimeId = 'codex', sessionId, workspace, title, codexHome, allowCreate = true }) {
    if (!['codex', 'opencode'].includes(runtimeId)) {
      throw taskError('RUNTIME_RESUME_UNSUPPORTED', 'This runtime cannot currently be resumed.', { runtime_id: runtimeId })
    }
    if (codexHome !== undefined && (runtimeId !== 'codex' || typeof codexHome !== 'string'
      || !isAbsolute(codexHome) || codexHome.includes('\0') || codexHome.length > 4096)) {
      throw taskError('SESSION_DATA_ROOT_INVALID', 'Session data root must be an absolute Codex path.')
    }
    if (platform !== 'darwin') {
      throw taskError('PLATFORM_UNSUPPORTED', 'Session resume currently requires macOS.')
    }
    const terminalDefinition = TERMINALS.find(({ id }) => id === terminal)
    if (!terminalDefinition) {
      throw taskError('TERMINAL_INVALID', 'Selected terminal is not supported.', { terminal })
    }
    const adapter = await resolveAdapter(terminal)
    if (!adapter) {
      throw taskError('TERMINAL_UNAVAILABLE', `${terminalDefinition.label} is not installed or available.`, {
        terminal,
      })
    }
    const normalizedSessionId = validateSessionId(sessionId)
    if (typeof workspace !== 'string' || !isAbsolute(workspace)) {
      throw taskError('WORKSPACE_INVALID', 'Session Workspace must be an absolute path.')
    }
    const key = JSON.stringify([runtimeId, runtimeId === 'codex' ? codexHome ?? env.CODEX_HOME ?? join(homeDirectory, '.codex') : null, normalizedSessionId])
    const focused = terminal === 'otty' ? await focusOtty(adapter.executable, { key, runtimeId, sessionId: normalizedSessionId }) : terminal === 'ghostty' ? await ghostty.focus(key) : null
    if (focused) return { terminal, terminal_label: terminalDefinition.label, session_id: normalizedSessionId, workspace, ...focused }
    if (!allowCreate) throw taskError('SESSION_BROWSER_SESSION_ACTIVE', '会话正在执行，未找到可定位的终端 pane，未重复启动会话。')
    try {
      const workspaceStat = await statImpl(workspace)
      if (!workspaceStat.isDirectory()) throw new Error('not a directory')
    } catch {
      throw taskError('WORKSPACE_NOT_FOUND', 'Session Workspace no longer exists.', { workspace })
    }
    const runtimePath = await resolveExecutable(runtimeId)
    if (!runtimePath) {
      throw taskError(runtimeId === 'codex' ? 'CODEX_UNAVAILABLE' : 'RUNTIME_UNAVAILABLE',
        `${runtimeId} CLI was not found in a supported executable path.`)
    }

    let scriptPath = null
    let launchMetadata = {}
    try {
      if (terminal === 'otty') {
        launchMetadata = await launchOtty({
          executable: adapter.executable,
          command: resumeShellCommand({ runtimePath, runtimeId, sessionId: normalizedSessionId, codexHome }),
          workspace,
          key,
          title: normalizeWindowTitle(title, runtimeId),
        })
      } else {
        await mkdirImpl(runtimeDirectory, { recursive: true, mode: 0o700 })
        scriptPath = join(runtimeDirectory, `resume-${randomId()}.command`)
        await writeFileImpl(scriptPath, launcherScript({
          scriptPath,
          runtimePath,
          runtimeId,
          sessionId: normalizedSessionId,
          workspace,
          codexHome,
        }), { encoding: 'utf8', mode: 0o700 })
        if (terminal === 'ghostty') {
          launchMetadata = await ghostty.create({ key, workspace, title: normalizeWindowTitle(title, runtimeId), command: `${shellQuote('/bin/zsh')} ${shellQuote(scriptPath)}` })
        } else {
          await execFileImpl('/usr/bin/open', ['-na', adapter.appPath, scriptPath], { timeout: 5_000 })
        }
      }
    } catch (error) {
      if (scriptPath) await rmImpl(scriptPath, { force: true }).catch(() => undefined)
      if (error instanceof RilloError) throw error
      throw taskError('TERMINAL_LAUNCH_FAILED', `Unable to launch ${terminalDefinition.label}.`, {
        terminal,
        cause: error?.code ?? error?.message ?? 'launch failed',
      })
    }

    return {
      terminal: terminalDefinition.id,
      terminal_label: terminalDefinition.label,
      session_id: normalizedSessionId,
      workspace,
      ...launchMetadata,
    }
  }

  return { launch, options, supported: platform === 'darwin' }
}
