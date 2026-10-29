import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const SYSTEMD_UNIT = 'rillo.service'

function quote(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%').replaceAll('\n', '\\n').replaceAll('\r', '\\r')}"`
}

function pathValue(value) {
  if (typeof value !== 'string' || value.trim() !== value || /[\n\r\0]/.test(value)) throw new Error('systemd paths must not contain control characters or surrounding whitespace')
  return value.replaceAll('%', '%%')
}

export function renderSystemdUnit({ nodePath, daemonPath, workingDirectory, homeDirectory, path, stdoutPath, stderrPath, codexHome }) {
  return `[Unit]
Description=Rillo
After=network.target

[Service]
Type=exec
ExecStart=${quote(`:${nodePath}`)} ${quote(daemonPath)}
WorkingDirectory=${pathValue(workingDirectory)}
Environment=${quote(`HOME=${homeDirectory}`)} ${quote(`PATH=${path}`)}
${codexHome ? `Environment=${quote(`CODEX_HOME=${codexHome}`)}\n` : ''}Restart=on-failure
RestartSec=3
TimeoutStopSec=30
UMask=0077
StandardOutput=append:${pathValue(stdoutPath)}
StandardError=append:${pathValue(stderrPath)}

[Install]
WantedBy=default.target
`
}

export function createSystemdController({ projectRoot, config, homeDirectory, nodePath = process.execPath, nodeVersion = process.versions.node, env = process.env, unitName = SYSTEMD_UNIT, run, build, probeHealth }) {
  const unitDirectory = join(homeDirectory, '.config', 'systemd', 'user')
  const logDirectory = join(homeDirectory, '.local', 'state', 'rillo')
  const paths = {
    unitPath: join(unitDirectory, unitName),
    stdoutPath: join(logDirectory, 'daemon.stdout.log'),
    stderrPath: join(logDirectory, 'daemon.stderr.log'),
    daemonPath: join(projectRoot, 'server', 'daemon.mjs'),
  }
  const systemctl = (args, options) => run('systemctl', ['--user', ...args], { timeoutMs: 15000, ...options })

  async function status() {
    const state = await systemctl(['is-active', unitName], { allowFailure: true })
    const health = await probeHealth(config.serverBaseUrl)
    return { label: unitName, loaded: state.code === 0, ready: health?.service === 'rillo' && health.ready !== false, url: config.serverPublicUrl ?? config.serverBaseUrl, unitPath: paths.unitPath }
  }

  async function install() {
    if (Number(nodeVersion.split('.')[0]) < 24) throw new Error('rillo daemon requires Node.js 24 or newer')
    const manager = await systemctl(['show-environment'], { allowFailure: true })
    if (manager.code !== 0) throw new Error('A running systemd user manager is required; run this command in a user login session.')
    const health = await probeHealth(config.serverBaseUrl)
    if (health && health.service !== 'rillo') throw new Error(`${config.serverBaseUrl} is occupied by another service`)
    await build()
    await Promise.all([mkdir(unitDirectory, { recursive: true, mode: 0o700 }), mkdir(logDirectory, { recursive: true, mode: 0o700 })])
    const unit = renderSystemdUnit({ ...paths, nodePath, workingDirectory: projectRoot, homeDirectory, codexHome: env.CODEX_HOME, path: [...new Set([dirname(nodePath), join(homeDirectory, '.local', 'bin'), ...(env.PATH ?? '/usr/local/bin:/usr/bin:/bin').split(':')])].join(':') })
    const temporaryPath = `${paths.unitPath}.${process.pid}.tmp`
    await writeFile(temporaryPath, unit, { mode: 0o600 })
    await rename(temporaryPath, paths.unitPath)
    await systemctl(['daemon-reload'])
    await systemctl(['enable', paths.unitPath])
    await systemctl(['restart', unitName])
    return { label: unitName, unitPath: paths.unitPath, url: config.serverPublicUrl ?? config.serverBaseUrl }
  }

  async function start() {
    await access(paths.unitPath)
    await systemctl(['start', unitName])
    return status()
  }

  async function stop() {
    await systemctl(['stop', unitName])
    return { stopped: true, label: unitName }
  }

  async function uninstall() {
    try { await access(paths.unitPath) } catch (error) {
      if (error.code !== 'ENOENT') throw error
      return { uninstalled: true, preserved: [paths.stdoutPath, paths.stderrPath, config.schedulerDatabasePath, config.schedulerLogsDirectory].filter(Boolean) }
    }
    await systemctl(['disable', '--now', unitName])
    await rm(paths.unitPath, { force: true })
    await systemctl(['daemon-reload'])
    await systemctl(['reset-failed', unitName], { allowFailure: true })
    return { uninstalled: true, preserved: [paths.stdoutPath, paths.stderrPath, config.schedulerDatabasePath, config.schedulerLogsDirectory].filter(Boolean) }
  }

  return { install, start, stop, status, uninstall, paths }
}
