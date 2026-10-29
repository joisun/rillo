#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { DatabaseSync, backup as backupDatabase } from 'node:sqlite'
import { chmod, cp, lstat, mkdir, readFile, readlink, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// These names identify installations created before the Rillo rename. Never use them for new resources.
export const LEGACY_INSTALLATIONS = ['tasks-recorder', 'task-recorder', 'tasks_recorder', 'task_recorder']
const DATABASE_FILES = ['tasks.sqlite', 'scheduler.sqlite', 'session-links.sqlite', 'session-messages.sqlite']
const NEW_LAUNCH_LABEL = 'com.joi.rillo.daemon'
const executeFile = promisify(execFile)

async function command(file, args) {
  try { const result = await executeFile(file, args, { timeout: 15000, maxBuffer: 1024 * 1024 }); return { code: 0, ...result } }
  catch (error) { if (Number.isInteger(error.code)) return { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }; throw error }
}
async function exists(path) { try { return await lstat(path) } catch (error) { if (error.code === 'ENOENT') return null; throw error } }
function failure(code, message) { return Object.assign(new Error(message), { code }) }
async function checked(run, file, args) {
  const result = await run(file, args)
  if (result.code !== 0) throw failure('RILLO_MIGRATION_SERVICE_FAILED', `${file} could not complete the service transition`)
  return result
}
async function save(path, state) {
  const temporary = path + '.tmp'
  await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
  await rename(temporary, path)
}

export async function backupLegacyData(source, destination) {
  const ephemeral = []
  const databaseNames = new Set(DATABASE_FILES.flatMap(name => [name, name + '-wal', name + '-shm', name + '-journal']))
  async function copyEntry(from, to, relativePath) {
    const stat = await lstat(from)
    if (stat.isSocket() || stat.isFIFO()) { ephemeral.push({ path: relativePath, kind: stat.isSocket() ? 'socket' : 'fifo' }); return }
    if (stat.isSymbolicLink()) { await symlink(await readlink(from), to); return }
    if (stat.isDirectory()) {
      await mkdir(to, { recursive: true, mode: 0o700 })
      for (const name of await readdir(from)) await copyEntry(join(from, name), join(to, name), relativePath ? relativePath + '/' + name : name)
      return
    }
    if (!stat.isFile()) throw failure('RILLO_MIGRATION_UNSAFE_PATH', `Inspect the special file before migrating: ${relativePath}`)
    await cp(from, to)
  }
  await mkdir(destination, { recursive: true, mode: 0o700 })
  for (const name of await readdir(source)) {
    if (!databaseNames.has(name)) await copyEntry(join(source, name), join(destination, name), name)
  }
  for (const name of DATABASE_FILES) {
    const path = join(source, name)
    if (!await exists(path)) continue
    const database = new DatabaseSync(path, { readOnly: true, timeout: 5000 })
    try {
      if (database.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw failure('RILLO_MIGRATION_DATABASE_INVALID', `Database needs recovery before migrating: ${name}`)
      await backupDatabase(database, join(destination, name))
      await chmod(join(destination, name), 0o600)
    } finally { database.close() }
  }
  return { ephemeral }
}

export function createInstallationMigration({ homeDirectory = homedir(), platform = process.platform, uid = process.getuid?.(), run = command,
  probe = async (url) => { try { const response = await fetch(url, { signal: AbortSignal.timeout(1000) }); return response.ok ? await response.json() : null } catch { return null } },
} = {}) {
  const home = resolve(homeDirectory)
  const domain = `gui/${uid}`
  const logs = platform === 'darwin' ? ['Library', 'Logs'] : ['.local', 'state']
  const newData = join(home, '.config', 'rillo')
  const newProgram = join(home, '.local', 'share', 'rillo')

  async function servicesFor(name) {
    if (platform === 'darwin') {
      const services = []
      for (const suffix of ['taskd', 'daemon']) {
        const label = `com.joi.${name}.${suffix}`
        const path = join(home, 'Library', 'LaunchAgents', label + '.plist')
        if (!await exists(path)) continue
        const loaded = await run('launchctl', ['print', `${domain}/${label}`])
        if (loaded.code === 0 && !loaded.stdout.includes(path)) throw failure('RILLO_MIGRATION_SERVICE_SCOPE', 'Loaded service belongs to another home; it was left running')
        services.push({ label, path, active: loaded.code === 0 })
      }
      return services
    }
    if (platform !== 'linux') throw failure('RILLO_MIGRATION_PLATFORM', 'Rillo migration supports macOS and Linux')
    const label = name + '.service', path = join(home, '.config', 'systemd', 'user', label)
    if (!await exists(path)) return []
    const fragment = await run('systemctl', ['--user', 'show', label, '--property=FragmentPath', '--value'])
    if (fragment.code === 0 && fragment.stdout.trim() !== path) throw failure('RILLO_MIGRATION_SERVICE_SCOPE', 'Existing unit belongs to another home; it was left unchanged')
    const active = await run('systemctl', ['--user', 'is-active', label])
    const enabled = await run('systemctl', ['--user', 'is-enabled', label])
    return [{ label, path, active: active.code === 0, enabled: enabled.code === 0 }]
  }

  async function plan() {
    const moves = [], services = []
    for (const name of LEGACY_INSTALLATIONS) {
      for (const [from, to, kind] of [
        [join(home, '.config', name), newData, 'data'],
        [join(home, '.local', 'share', name), newProgram, 'program'],
        [join(home, ...logs, name), join(home, ...logs, 'rillo'), 'logs'],
      ]) {
        const stat = await exists(from)
        if (!stat) continue
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure('RILLO_MIGRATION_UNSAFE_PATH', `Inspect the legacy ${kind} path before migration: ${from}`)
        if (await exists(to) || moves.some(move => move.to === to)) throw failure('RILLO_MIGRATION_CONFLICT', `Both legacy and Rillo ${kind} paths exist; no data was merged or overwritten`)
        moves.push({ from, to, kind })
      }
      const wrapper = join(home, '.local', 'bin', name)
      if (await exists(wrapper)) moves.push({ from: wrapper, kind: 'wrapper' })
      services.push(...await servicesFor(name))
    }
    const newService = platform === 'darwin' ? join(home, 'Library', 'LaunchAgents', NEW_LAUNCH_LABEL + '.plist') : join(home, '.config', 'systemd', 'user', 'rillo.service')
    if ((moves.length || services.length) && await exists(newService)) throw failure('RILLO_MIGRATION_CONFLICT', 'Rillo already has a service registration; resolve the two installations before migrating')
    const source = moves.find(move => move.kind === 'data')
    let config = null
    if (source) {
      config = JSON.parse(await readFile(join(source.from, 'config.json'), 'utf8'))
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw failure('RILLO_MIGRATION_CONFIG_INVALID', 'The existing configuration is invalid')
    }
    return { moves, services, config }
  }

  async function stopOld(service) {
    if (platform === 'darwin') {
      if (!service.active) return
      await checked(run, 'launchctl', ['bootout', `${domain}/${service.label}`])
      for (let attempt = 0; attempt < 50; attempt++) {
        if ((await run('launchctl', ['print', `${domain}/${service.label}`])).code !== 0) return
        await new Promise(resolveWait => setTimeout(resolveWait, 100))
      }
      throw failure('RILLO_MIGRATION_SERVICE_STILL_RUNNING', 'Wait for the legacy service to finish unloading before migrating')
    } else await checked(run, 'systemctl', ['--user', 'disable', '--now', service.label])
  }

  async function rollback(journalPath) {
    const state = JSON.parse(await readFile(journalPath, 'utf8'))
    if (state.home !== home || state.platform !== platform) throw failure('RILLO_MIGRATION_SCOPE', 'Migration journal belongs to another installation')
    if (['rolled_back', 'committed'].includes(state.status)) return { status: state.status }
    if (platform === 'darwin') {
      const newPlist = join(home, 'Library', 'LaunchAgents', NEW_LAUNCH_LABEL + '.plist')
      if (await exists(newPlist)) {
        const loaded = await run('launchctl', ['print', `${domain}/${NEW_LAUNCH_LABEL}`])
        if (loaded.code === 0 && !loaded.stdout.includes(newPlist)) throw failure('RILLO_MIGRATION_SERVICE_SCOPE', 'New service belongs to another home; rollback did not stop it')
        if (loaded.code === 0) await checked(run, 'launchctl', ['bootout', `${domain}/${NEW_LAUNCH_LABEL}`])
        await rm(newPlist)
      }
    } else {
      const newUnit = join(home, '.config', 'systemd', 'user', 'rillo.service')
      if (await exists(newUnit)) { await checked(run, 'systemctl', ['--user', 'disable', '--now', 'rillo.service']); await rm(newUnit) }
    }
    for (const move of [...state.completedMoves].reverse()) {
      if (!await exists(move.from) && await exists(move.to)) { await mkdir(dirname(move.from), { recursive: true }); await rename(move.to, move.from) }
    }
    const data = state.moves.find(move => move.kind === 'data')
    if (data && await exists(join(state.backup, 'config-before.json'))) await cp(join(state.backup, 'config-before.json'), join(data.from, 'config.json'))
    const program = state.moves.find(move => move.kind === 'program')
    if (program && state.oldCurrent) {
      const current = join(program.from, 'current')
      await rm(current, { force: true }); await symlink(state.oldCurrent, current)
    }
    await rm(join(home, '.local', 'bin', 'rillo'), { force: true })
    if (platform === 'linux') await checked(run, 'systemctl', ['--user', 'daemon-reload'])
    for (const service of state.services) {
      if (platform === 'darwin') {
        if (!service.active) continue
        const loaded = await run('launchctl', ['print', `${domain}/${service.label}`])
        if (loaded.code !== 0) await checked(run, 'launchctl', ['bootstrap', domain, service.path])
        else await checked(run, 'launchctl', ['kickstart', '-k', `${domain}/${service.label}`])
      }
      else {
        if (service.enabled) await checked(run, 'systemctl', ['--user', 'enable', service.path])
        if (service.active) await checked(run, 'systemctl', ['--user', 'start', service.label])
      }
    }
    state.status = 'rolled_back'; await save(journalPath, state)
    return { status: state.status }
  }

  async function prepare({ startService = true } = {}) {
    const planned = await plan()
    if (planned.moves.length === 0 && planned.services.length === 0) return { journalPath: null, migrated: false }
    if (!startService && planned.services.some(service => service.active)) throw failure('RILLO_MIGRATION_SERVICE_SWITCH_REQUIRED', 'An active legacy service requires installation with service startup, not --no-start')
    const baseUrl = `http://127.0.0.1:${planned.config?.server_port ?? 43127}`
    const health = await probe(baseUrl + '/health/live')
    if (planned.services.some(service => service.active) && (!health || !LEGACY_INSTALLATIONS.includes(health.service))) throw failure('RILLO_MIGRATION_STATUS_UNKNOWN', 'Existing service is not healthy enough to verify active work; it was left running')
    if (health && LEGACY_INSTALLATIONS.includes(health.service)) {
      if (!planned.services.some(service => service.active)) throw failure('RILLO_MIGRATION_UNMANAGED_SERVICE', 'Stop the manually launched legacy daemon before migrating')
      const scheduled = await probe(baseUrl + '/api/v1/schedules')
      if (!Array.isArray(scheduled?.jobs)) throw failure('RILLO_MIGRATION_STATUS_UNKNOWN', 'Cannot verify the existing scheduled executions; service was left running')
      if (scheduled.jobs.some(job => ['queued', 'running'].includes(job.current_execution?.status))) throw failure('RILLO_MIGRATION_ACTIVE_RUNS', 'Wait for active scheduled executions to finish before migrating')
    }
    const backup = join(home, '.local', 'state', 'rillo-migrations', `${Date.now()}-${randomUUID()}`)
    await mkdir(backup, { recursive: true, mode: 0o700 })
    const journalPath = join(backup, 'journal.json')
    const state = { home, platform, backup, status: 'preparing', ...planned, completedMoves: [] }
    const program = planned.moves.find(move => move.kind === 'program')
    if (program) { try { state.oldCurrent = await readlink(join(program.from, 'current')) } catch {} }
    await save(journalPath, state)
    try {
      for (const service of planned.services) await stopOld(service)
      if (health && LEGACY_INSTALLATIONS.includes(health.service)) {
        let stopped = false
        for (let attempt = 0; attempt < 30; attempt++) {
          if (!await probe(baseUrl + '/health/live')) { stopped = true; break }
          await new Promise(resolveWait => setTimeout(resolveWait, 100))
        }
        if (!stopped) throw failure('RILLO_MIGRATION_SERVICE_STILL_RUNNING', 'Existing daemon did not stop; migration was not performed')
      }
      const data = planned.moves.find(move => move.kind === 'data')
      if (data) {
        state.backupReport = await backupLegacyData(data.from, join(backup, 'data'))
        await cp(join(data.from, 'config.json'), join(backup, 'config-before.json'))
      }
      for (const move of planned.moves) {
        const target = move.to ?? join(backup, 'commands', move.from.split('/').at(-1))
        await mkdir(dirname(target), { recursive: true, mode: 0o700 })
        state.completedMoves.push({ from: move.from, to: target }); await save(journalPath, state)
        await rename(move.from, target)
      }
      for (const service of planned.services) {
        if (!await exists(service.path)) continue
        const target = join(backup, 'services', service.label)
        await mkdir(dirname(target), { recursive: true, mode: 0o700 })
        state.completedMoves.push({ from: service.path, to: target }); await save(journalPath, state)
        await rename(service.path, target)
      }
      if (data) {
        const text = JSON.stringify(planned.config)
        const migrated = JSON.parse(text, (_key, value) => {
          if (typeof value !== 'string') return value
          const move = planned.moves.find(item => item.to && (value === item.from || value.startsWith(item.from + '/')))
          return move ? move.to + value.slice(move.from.length) : value
        })
        if (JSON.stringify(migrated) !== text) await writeFile(join(newData, 'config.json'), JSON.stringify(migrated, null, 2) + '\n', { mode: 0o600 })
      }
      if (platform === 'linux' && planned.services.length) await checked(run, 'systemctl', ['--user', 'daemon-reload'])
      state.status = 'prepared'; await save(journalPath, state)
      return { journalPath, migrated: true }
    } catch (error) {
      try { await rollback(journalPath) } catch (rollbackError) { throw failure('RILLO_MIGRATION_ROLLBACK_FAILED', `Migration failed and needs recovery from ${journalPath}: ${rollbackError.message}`) }
      throw error
    }
  }

  async function commit(journalPath) {
    const state = JSON.parse(await readFile(journalPath, 'utf8'))
    if (state.home !== home || state.status !== 'prepared') throw failure('RILLO_MIGRATION_STATE', 'Migration is not ready to commit')
    state.status = 'committed'; await save(journalPath, state)
    return { status: state.status, backup: state.backup }
  }
  return { plan, prepare, rollback, commit }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [operation, journalPath] = process.argv.slice(2)
    const migration = createInstallationMigration()
    if (operation === 'prepare') { const result = await migration.prepare({ startService: !process.argv.includes('--no-start') }); process.stdout.write(result.journalPath ?? '') }
    else if (operation === 'rollback' && journalPath) await migration.rollback(journalPath)
    else if (operation === 'commit' && journalPath) await migration.commit(journalPath)
    else if (operation === 'plan') { const { config, ...summary } = await migration.plan(); process.stdout.write(JSON.stringify(summary, null, 2) + '\n') }
    else throw new Error('Usage: migrate.mjs plan|prepare|rollback <journal>|commit <journal>')
  } catch (error) { process.stderr.write(`${error.code ?? 'RILLO_MIGRATION_FAILED'}: ${error.message}\n`); process.exitCode = 1 }
}
