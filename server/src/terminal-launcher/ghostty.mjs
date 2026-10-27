import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const SCRIPT = `on run argv
  set operation to item 1 of argv
  set separator to ASCII character 9
  if operation is "list" then
    if not (application "Ghostty" is running) then return ""
    tell application "Ghostty"
      set output to ""
      repeat with win in windows
        set output to output & "W" & separator & (id of win) & linefeed
        repeat with pane in terminals of win
          set output to output & "P" & separator & (id of pane) & linefeed
        end repeat
      end repeat
      if (count windows) > 0 then set output to output & "F" & separator & (id of front window) & linefeed
      return output
    end tell
  end if
  tell application "Ghostty"
    if operation is "focus" then
      set targetId to item 2 of argv
      set targetPane to first terminal whose id is targetId
      focus targetPane
      return id of targetPane
    end if
    set cfg to new surface configuration
    set initial working directory of cfg to item 2 of argv
    set command of cfg to item 3 of argv
    set wait after command of cfg to false
    if operation is "tab" then
      set targetId to item 5 of argv
      set targetWindow to first window whose id is targetId
      set targetTab to new tab in targetWindow with configuration cfg
    else
      set targetWindow to new window with configuration cfg
      set targetTab to selected tab of targetWindow
    end if
    set targetPane to focused terminal of targetTab
    perform action ("set_tab_title:" & item 4 of argv) on targetPane
    focus targetPane
    return id of targetPane
  end tell
end run`

function identifier(value) {
  if (typeof value !== 'string' || !value || value.length > 256 || /[\r\n\t\0]/.test(value)) throw new Error('Ghostty returned an invalid terminal identifier')
  return value
}

export function createGhosttyRouter({ runtimeDirectory, execFileImpl }) {
  const cachePath = join(runtimeDirectory, 'ghostty-targets.json')
  let targets
  async function call(operation, args = []) {
    const result = await execFileImpl('/usr/bin/osascript', ['-e', SCRIPT, operation, ...args], { timeout: operation === 'window' ? 15000 : 5000 })
    return String(result.stdout ?? '').trim()
  }
  async function inventory() {
    const output = await call('list')
    const windows = [], panes = new Set()
    let focused
    for (const row of output.split(/\r?\n/).filter(Boolean)) {
      const [kind, id, extra] = row.split('\t')
      if (extra !== undefined || !['W', 'P', 'F'].includes(kind)) throw new Error('Ghostty returned an invalid terminal inventory')
      identifier(id)
      if (kind === 'W') windows.push(id)
      if (kind === 'P') panes.add(id)
      if (kind === 'F') focused = id
    }
    return { windows, panes, focused }
  }
  async function knownTargets() {
    if (targets) return targets
    try {
      const contents = await readFile(cachePath, 'utf8')
      if (contents.length > 2 * 1024 * 1024) throw new Error('Ghostty routing cache is too large')
      const value = JSON.parse(contents)
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(id => typeof id !== 'string')) throw new Error('Invalid Ghostty routing cache')
      targets = value
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      targets = {}
    }
    return targets
  }
  return {
    async focus(key) {
      const snapshot = await inventory()
      const cache = await knownTargets()
      const pane = cache[key]
      if (!pane || !snapshot.panes.has(pane)) return null
      await call('focus', [pane])
      return { action: 'focused', pane_id: pane }
    },
    async create({ key, workspace, title, command }) {
      const snapshot = await inventory()
      const window = snapshot.windows.includes(snapshot.focused) ? snapshot.focused : snapshot.windows[0]
      const pane = identifier(await call(window ? 'tab' : 'window', [workspace, command, title, ...(window ? [window] : [])]))
      const cache = await knownTargets()
      const live = Object.entries(cache).filter(([, id]) => snapshot.panes.has(id))
      targets = Object.fromEntries([...live.filter(([ref]) => ref !== key), [key, pane]].slice(-256))
      await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 })
      const temporary = `${cachePath}.${process.pid}.tmp`
      await writeFile(temporary, JSON.stringify(targets), { mode: 0o600 })
      await rename(temporary, cachePath)
      return { action: window ? 'new_tab' : 'new_window', pane_id: pane }
    },
  }
}
