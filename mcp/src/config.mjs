import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { RilloError } from './errors.mjs'

function positiveInteger(value, field, fallback) {
  const candidate = value ?? fallback
  const normalized = typeof candidate === 'string' && candidate.trim() !== ''
    ? Number(candidate)
    : candidate
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new RilloError('CONFIG_INVALID', `${field} must be a positive safe integer.`)
  }
  return normalized
}

function schedulerPositiveInteger(value, field, fallback) {
  if (value === null) {
    throw new RilloError('CONFIG_INVALID', `${field} must be a positive safe integer.`)
  }
  return positiveInteger(value, field, fallback)
}

function isUnsafeRemotePath(value) {
  return value.startsWith('//')
    || value.startsWith('\\\\')
    || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
}

function resolvesUnderDirectory(value, directory) {
  const pathRelative = relative(directory, value)
  return pathRelative === '' || (!pathRelative.startsWith('..') && !isAbsolute(pathRelative))
}

function schedulerPath(value, field, fallback, dataDirectory) {
  const candidate = value === undefined ? fallback : value
  if (
    typeof candidate !== 'string'
    || candidate.trim() === ''
    || candidate.includes('\0')
    || isUnsafeRemotePath(candidate)
  ) {
    throw new RilloError('CONFIG_INVALID', `${field} must be a safe non-empty local path.`)
  }

  const resolved = isAbsolute(candidate)
    ? resolve(candidate)
    : resolve(dataDirectory, candidate)
  if (!resolvesUnderDirectory(resolved, dataDirectory)) {
    throw new RilloError('CONFIG_INVALID', `${field} must resolve under the data directory.`)
  }
  return resolved
}

function definitionsDirectory(value, dataDirectory) {
  const candidate = value ?? 'schedules'
  if (
    typeof candidate !== 'string'
    || candidate.trim() === ''
    || candidate.includes('\0')
    || isUnsafeRemotePath(candidate)
  ) {
    throw new RilloError('CONFIG_INVALID', 'schedule_definitions_dir must be a safe non-empty local path.')
  }
  const resolved = isAbsolute(candidate) ? resolve(candidate) : resolve(dataDirectory, candidate)
  if (dirname(resolved) === resolved) {
    throw new RilloError('CONFIG_INVALID', 'schedule_definitions_dir must not be a filesystem root.')
  }
  return resolved
}

function configuredCodexPath(value) {
  if (value === undefined || value === null) {
    return null
  }
  if (
    typeof value !== 'string'
    || value.trim() === ''
    || value.includes('\0')
    || !isAbsolute(value)
    || isUnsafeRemotePath(value)
  ) {
    throw new RilloError('CONFIG_INVALID', 'codex_path must be an absolute local executable path or null.')
  }
  return resolve(value)
}

export async function resolveAppConfig({
  projectRoot,
  env = process.env,
  homeDirectory = homedir(),
}) {
  const normalizedProjectRoot = resolve(projectRoot)
  const dataDirectory = join(resolve(homeDirectory), '.config', 'rillo')
  const configPath = join(dataDirectory, 'config.json')
  let fileConfig

  try {
    const source = await readFile(configPath, 'utf8')
    fileConfig = JSON.parse(source)
  } catch (error) {
    throw new RilloError(
      'CONFIG_INVALID',
      `Unable to read a valid rillo config at ${configPath}.`,
      { cause: error.message },
    )
  }

  const configuredOutput = env.RILLO_OUTPUT_DIR || fileConfig.output_dir
  if (typeof configuredOutput !== 'string' || configuredOutput.trim() === '') {
    throw new RilloError(
      'CONFIG_INVALID',
      'output_dir must be a non-empty string.',
    )
  }

  const outputDir = isAbsolute(configuredOutput)
    ? resolve(configuredOutput)
    : resolve(dataDirectory, configuredOutput)
  const configuredDatabase = env.RILLO_DATABASE_PATH
  if (configuredDatabase !== undefined && (
    typeof configuredDatabase !== 'string' || configuredDatabase.trim() === ''
  )) {
    throw new RilloError('CONFIG_INVALID', 'RILLO_DATABASE_PATH must be a non-empty string.')
  }
  const databasePath = configuredDatabase
    ? (isAbsolute(configuredDatabase) ? resolve(configuredDatabase) : resolve(dataDirectory, configuredDatabase))
    : join(dataDirectory, 'tasks.sqlite')
  const configuredSpool = env.RILLO_SPOOL_DIR ?? fileConfig.spool_dir ?? 'spool'
  if (typeof configuredSpool !== 'string' || configuredSpool.trim() === '') {
    throw new RilloError('CONFIG_INVALID', 'spool_dir must be a non-empty string.')
  }
  const spoolDirectory = isAbsolute(configuredSpool)
    ? resolve(configuredSpool)
    : resolve(dataDirectory, configuredSpool)
  const spoolMaxBytes = positiveInteger(
    env.RILLO_SPOOL_MAX_BYTES ?? fileConfig.spool_max_bytes,
    'spool_max_bytes',
    4 * 1024 * 1024,
  )
  const spoolMaxFiles = positiveInteger(
    env.RILLO_SPOOL_MAX_FILES ?? fileConfig.spool_max_files,
    'spool_max_files',
    512,
  )
  const spoolMaxAgeMs = positiveInteger(
    env.RILLO_SPOOL_MAX_AGE_MS ?? fileConfig.spool_max_age_ms,
    'spool_max_age_ms',
    7 * 24 * 60 * 60 * 1000,
  )
  const configuredLogs = env.RILLO_LOGS_DIR ?? fileConfig.logs_dir ?? 'logs'
  if (typeof configuredLogs !== 'string' || configuredLogs.trim() === '') {
    throw new RilloError('CONFIG_INVALID', 'logs_dir must be a non-empty string.')
  }
  const logsDirectory = isAbsolute(configuredLogs)
    ? resolve(configuredLogs)
    : resolve(dataDirectory, configuredLogs)
  const logMaxFileBytes = positiveInteger(
    env.RILLO_LOG_MAX_FILE_BYTES ?? fileConfig.log_max_file_bytes,
    'log_max_file_bytes',
    1024 * 1024,
  )
  const logMaxFiles = positiveInteger(
    env.RILLO_LOG_MAX_FILES ?? fileConfig.log_max_files,
    'log_max_files',
    5,
  )
  const logMaxAgeMs = positiveInteger(
    env.RILLO_LOG_MAX_AGE_MS ?? fileConfig.log_max_age_ms,
    'log_max_age_ms',
    14 * 24 * 60 * 60 * 1000,
  )

  const schedulerDatabasePath = schedulerPath(
    fileConfig.scheduler_database_path,
    'scheduler_database_path',
    'scheduler.sqlite',
    dataDirectory,
  )
  const scheduleDefinitionsDirectory = definitionsDirectory(
    env.RILLO_SCHEDULE_DEFINITIONS_DIR ?? fileConfig.schedule_definitions_dir,
    dataDirectory,
  )
  const schedulerLogsDirectory = schedulerPath(
    fileConfig.scheduler_logs_dir,
    'scheduler_logs_dir',
    join('schedules', 'logs'),
    dataDirectory,
  )
  const schedulerLogMaxFileBytes = schedulerPositiveInteger(
    fileConfig.scheduler_log_max_file_bytes,
    'scheduler_log_max_file_bytes',
    1024 * 1024,
  )
  const schedulerLogMaxFiles = schedulerPositiveInteger(
    fileConfig.scheduler_log_max_files,
    'scheduler_log_max_files',
    8,
  )
  const schedulerLogMaxAgeMs = schedulerPositiveInteger(
    fileConfig.scheduler_log_max_age_ms,
    'scheduler_log_max_age_ms',
    7 * 24 * 60 * 60 * 1000,
  )
  const codexPath = configuredCodexPath(fileConfig.codex_path)

  const configuredHost = fileConfig.server_listen_host ?? fileConfig.server_host ?? '127.0.0.1'
  const configuredPort = fileConfig.server_port ?? 43127
  if (!['127.0.0.1', '0.0.0.0'].includes(configuredHost)) {
    throw new RilloError('CONFIG_INVALID', 'server_listen_host must be 127.0.0.1 or 0.0.0.0')
  }
  if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65535) {
    throw new RilloError('CONFIG_INVALID', 'server_port must be an integer between 1 and 65535')
  }

  let serverUrl
  try {
    serverUrl = new URL(env.RILLO_SERVER_URL ?? `http://127.0.0.1:${configuredPort}`)
  } catch (error) {
    throw new RilloError('CONFIG_INVALID', 'daemon URL is invalid', { cause: error.message })
  }
  if (
    serverUrl.protocol !== 'http:'
    || serverUrl.hostname !== '127.0.0.1'
    || serverUrl.username !== ''
    || serverUrl.password !== ''
    || !['', '/'].includes(serverUrl.pathname)
    || serverUrl.search !== ''
    || serverUrl.hash !== ''
  ) {
    throw new RilloError('CONFIG_INVALID', 'daemon URL must be an http://127.0.0.1 origin')
  }
  const serverPort = Number(serverUrl.port || 80)
  let serverPublicUrl = null
  if (fileConfig.server_public_url !== undefined) {
    let publicUrl
    try { publicUrl = new URL(fileConfig.server_public_url) } catch {
      throw new RilloError('CONFIG_INVALID', 'server_public_url must be an http origin')
    }
    if (publicUrl.protocol !== 'http:' || publicUrl.username || publicUrl.password
      || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash || publicUrl.hostname === '0.0.0.0' || publicUrl.port === '0') {
      throw new RilloError('CONFIG_INVALID', 'server_public_url must be a concrete http origin without a path or credentials')
    }
    serverPublicUrl = publicUrl.origin
  }
  return {
    projectRoot: normalizedProjectRoot,
    dataDirectory,
    configPath,
    databasePath,
    outputDir,
    spoolDirectory,
    spoolMaxBytes,
    spoolMaxFiles,
    spoolMaxAgeMs,
    logsDirectory,
    logMaxFileBytes,
    logMaxFiles,
    logMaxAgeMs,
    schedulerDatabasePath,
    scheduleDefinitionsDirectory,
    schedulerLogsDirectory,
    schedulerLogMaxFileBytes,
    schedulerLogMaxFiles,
    schedulerLogMaxAgeMs,
    codexPath,
    serverHost: configuredHost,
    serverPort,
    serverBaseUrl: serverUrl.origin,
    serverPublicUrl,
  }
}
