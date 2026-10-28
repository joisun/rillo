import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { constants } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { createApiServer } from './api-server.mjs'
import { createDashboardSettings } from './dashboard-settings.mjs'
import { createCodexSessionInventory } from './codex/session-inventory.mjs'
import { createRevisionHub } from './revision-hub.mjs'
import { createSessionResumeService } from './session-resume-service.mjs'
import { createSessionBrowser } from './session-browser.mjs'
import { createSessionLinkStore } from './session-link-store.mjs'
import { createTerminalLauncher } from './terminal-launcher.mjs'
import { createRunEventHub } from './runs/run-event-hub.mjs'
import { createRunService } from './runs/run-service.mjs'
import { createRunStore } from './runs/run-store.mjs'
import { createOpenCodeRuntimeDefinition } from './runtime/adapters/opencode.mjs'
import { createCodexRuntimeDefinition } from './runtime/adapters/codex.mjs'
import { createCodexSessionAdapter } from './runtime/adapters/codex-sessions.mjs'
import { createExecutableResolver } from './runtime/executable-resolver.mjs'
import { createProcessSupervisor } from './runtime/process-supervisor.mjs'
import { createRuntimeAgentRegistry } from './runtime/runtime-agent-registry.mjs'
import { createRuntimeEnvironment as createRuntimeEnvironmentService } from './runtime/runtime-environment.mjs'
import { createRunLogStore, createScheduledRunLogs } from './scheduler/scheduled-run-logs.mjs'
import { createScheduleDefinitionMonitor } from './scheduler/schedule-definition-monitor.mjs'
import { createScheduleDefinitionRepository } from './scheduler/schedule-definition-repository.mjs'
import {
  createSwitchableScheduleDefinitionRepository,
  stageScheduleDefinitionRelocation,
} from './scheduler/schedule-definition-relocation.mjs'
import { migrateSchedulerV1, migrateSchedulerV4 } from './scheduler/scheduler-migration.mjs'
import { createDefinitionScheduleService } from './scheduler/scheduler-service.mjs'
import { createSchedulerClock } from './scheduler/scheduler-clock.mjs'


const MAX_SCHEDULER_STATUS_COUNT = 1_000_000

function schedulerError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function schedulerErrorCode(error, fallback = 'SCHEDULER_STARTUP_FAILED') {
  return typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,95}$/.test(error.code)
    ? error.code
    : fallback
}


function schedulerPaths(config, dataDirectory) {
  return {
    databasePath: config.schedulerDatabasePath ?? join(dataDirectory, 'scheduler.sqlite'),
    logsDirectory: config.schedulerLogsDirectory ?? join(dataDirectory, 'schedules', 'logs'),
    logMaxFileBytes: config.schedulerLogMaxFileBytes ?? 1024 * 1024,
    logMaxFiles: config.schedulerLogMaxFiles ?? 8,
    logMaxAgeMs: config.schedulerLogMaxAgeMs ?? 7 * 24 * 60 * 60 * 1000,
  }
}

async function canonicalRuntimeExecutable(path) {
  const canonical = await realpath(path)
  const metadata = await stat(canonical)
  if (!metadata.isFile()) throw schedulerError('RUNTIME_EXECUTABLE_INVALID')
  await access(canonical, constants.X_OK)
  return canonical
}

function probeRuntimeExecutable(executable, probe, { cwd, execFileImpl = execFile } = {}) {
  return new Promise((resolve, reject) => {
    execFileImpl(executable, [...(probe?.args ?? ['--version'])], {
      cwd,
      encoding: 'utf8',
      timeout: probe?.timeout_ms ?? 5_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
      shell: false,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(error)
        return
      }
      const version = String(stdout || stderr || '').trim().slice(0, 512)
      if (!version) {
        reject(schedulerError('RUNTIME_VERSION_INVALID'))
        return
      }
      resolve({ version })
    })
  })
}

function boundedSchedulerCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, MAX_SCHEDULER_STATUS_COUNT) : 0
}


export async function startTaskd({
  config,
  dashboardHtml,
  createSettings = createDashboardSettings,
  createSessionInventory = createCodexSessionInventory,
  createLinks = createSessionLinkStore,
  createBrowser = createSessionBrowser,
  createSessionAdapter = createCodexSessionAdapter,
  createResumeService = createSessionResumeService,
  createLauncher = createTerminalLauncher,
  createApi = createApiServer,
  createSchedulerDefinitions = createScheduleDefinitionRepository,
  createSchedulerDefinitionMonitor = createScheduleDefinitionMonitor,
  stageSchedulerDefinitionRelocation = stageScheduleDefinitionRelocation,
  migrateSchedulerStore = migrateSchedulerV1,
  migrateRunLedger = migrateSchedulerV4,
  createRunLedger = createRunStore,
  createRuntimeEnvironment = createRuntimeEnvironmentService,
  createRuntimeResolver = createExecutableResolver,
  createRuntimeRegistry = createRuntimeAgentRegistry,
  createCodexRuntime = createCodexRuntimeDefinition,
  createOpenCodeRuntime = createOpenCodeRuntimeDefinition,
  createSupervisor = createProcessSupervisor,
  createRunEvents = createRunEventHub,
  createRuns = createRunService,
  createRunLogs = createRunLogStore,
  createClockScheduler = createSchedulerClock,
  runtimeExecFile = execFile,
  clock = () => new Date(),
  createDefinitionScheduleService: createScheduleService = createDefinitionScheduleService,
  createScheduledRunLogs: createScheduleLogs = createScheduledRunLogs,
}) {
  const hub = createRevisionHub()
  const dataDirectory = config.dataDirectory ?? dirname(config.configPath ?? config.databasePath)
  let links = null
  const schedulePaths = schedulerPaths(config, dataDirectory)
  let schedulerState = {
    capability: null,
    ready: false,
    degraded: false,
    error_code: null,
    backlog: 0,
    count: 0,
  }
  let schedulerStore = null
  let schedulerDefinitions = null
  let schedulerMonitor = null
  let schedulerService = null
  let schedulerClock = null
  let runtimeRegistry = null
  let runtimeEnvironment = null
  let sessionBrowser = null
  let runService = null
  let runEventHub = null
  let scheduledRunLogs = null
  let schedulerClosed = false

  function newSchedulerMonitor(onDiff = async () => {
    schedulerClock?.notifyDefinitionsChanged()
    hub.publish()
  }) {
    return createSchedulerDefinitionMonitor({
      repository: schedulerDefinitions,
      onDiff,
    })
  }

  async function restoreSchedulerMonitor() {
    const monitor = newSchedulerMonitor()
    await monitor.start({ emitInitial: false })
    schedulerMonitor = monitor
  }

  async function relocateDefinitionsDirectory({ directory, persist }) {
    if (!schedulerDefinitions?.current || typeof persist !== 'function') {
      throw schedulerError('SCHEDULE_RELOCATION_UNAVAILABLE')
    }
    const oldRepository = schedulerDefinitions.current()
    const oldMonitor = schedulerMonitor
    await oldMonitor?.close()
    schedulerMonitor = null
    let transaction = null
    let nextMonitor = null
    let swapped = false
    try {
      transaction = await stageSchedulerDefinitionRelocation({
        sourceRepository: oldRepository,
        targetDirectory: directory,
        createRepository: createSchedulerDefinitions,
        clock,
      })
      await transaction.verifySource()
      await transaction.candidateRepository.list()
      schedulerDefinitions.replace(transaction.candidateRepository)
      swapped = true
      nextMonitor = newSchedulerMonitor()
      await nextMonitor.start({ emitInitial: false })
      schedulerMonitor = nextMonitor
      await persist()
      const committed = await transaction.commit()
      schedulerClock?.notifyDefinitionsChanged()
      hub.publish()
      return {
        moved_count: transaction.movedCount,
        merged_count: transaction.mergedCount,
        cleanup_warning: committed.cleanupWarning,
      }
    } catch (error) {
      await nextMonitor?.close().catch(() => undefined)
      if (schedulerMonitor === nextMonitor) schedulerMonitor = null
      if (swapped) schedulerDefinitions.replace(oldRepository)
      await transaction?.rollback().catch(() => undefined)
      await restoreSchedulerMonitor().catch(() => undefined)
      throw error
    }
  }
  let closed = false
  let api = null
  async function closeScheduler() {
    if (schedulerClosed) return
    schedulerClosed = true
    try {
      await schedulerClock?.close()
      await runService?.shutdown()
      await schedulerMonitor?.close()
    } finally {
      schedulerClock = null
      schedulerMonitor = null
      schedulerService = null
      schedulerDefinitions = null
      scheduledRunLogs = null
      runService = null
      runEventHub?.close()
      runEventHub = null
      try { schedulerStore?.close() } finally { schedulerStore = null }
    }
  }


  async function startScheduler() {
    let startupCount = 0
    try {
      const definitionsDirectory = config.scheduleDefinitionsDirectory ?? join(dataDirectory, 'schedules')
      const initialDefinitions = createSchedulerDefinitions({
        rootDirectory: definitionsDirectory,
        clock,
        hardenRoot: definitionsDirectory === join(dataDirectory, 'schedules'),
      })
      await initialDefinitions.scan()
      await migrateSchedulerStore({
        databasePath: schedulePaths.databasePath,
        repository: initialDefinitions,
        clock,
      })
      migrateRunLedger({ databasePath: schedulePaths.databasePath, clock })
      schedulerDefinitions = createSwitchableScheduleDefinitionRepository(initialDefinitions)
      schedulerStore = createRunLedger({
        databasePath: schedulePaths.databasePath,
        clock,
      })
      runEventHub = createRunEvents({ maximumEventsPerRun: 256 })
      const runLogStore = createRunLogs({
        root: schedulePaths.logsDirectory,
        maxFileBytes: schedulePaths.logMaxFileBytes,
        maxFiles: schedulePaths.logMaxFiles,
        maxAgeMs: schedulePaths.logMaxAgeMs,
      })
      scheduledRunLogs = createScheduleLogs({
        store: schedulerStore,
        root: schedulePaths.logsDirectory,
      })
      runService = createRuns({
        runStore: schedulerStore,
        registry: runtimeRegistry,
        supervisor: createSupervisor({ runtimeEnvironment }),
        eventHub: runEventHub,
        logStore: runLogStore,
        clock,
        onChange: (change) => hub.publish(change),
      })
      runService.recover()
      schedulerService = createScheduleService({
        definitions: schedulerDefinitions,
        runtimeRegistry,
        runService,
        clock,
      })
      schedulerClock = createClockScheduler({
        definitions: schedulerDefinitions,
        runService,
        clock,
      })
      schedulerMonitor = newSchedulerMonitor()
      await schedulerMonitor.start()
      schedulerClock.start()
      startupCount = boundedSchedulerCount(
        (await schedulerDefinitions.list()).length + runService.list({ limit: 1_000 }).length,
      )
      schedulerState = {
        capability: { backend: 'taskd-clock', supported: true },
        ready: true,
        degraded: false,
        error_code: null,
        backlog: 0,
        count: startupCount,
      }
    } catch (error) {
      const code = schedulerErrorCode(error)
      try {
        startupCount = boundedSchedulerCount((schedulerDefinitions?.list ? (await schedulerDefinitions.list()).length : 0)
          + (runService?.list?.({ limit: 1_000 })?.length ?? 0))
      } catch {}
      await closeScheduler().catch(() => {})
      schedulerState = {
        capability: null,
        ready: false,
        degraded: true,
        error_code: code,
        backlog: 0,
        count: startupCount,
      }
    }
  }

  async function serviceStatus() {
    const check = await sessionBrowser.check()
    const ready = check.integrityCheck === 'ok'
      && (check.foreignKeyViolations?.length ?? 0) === 0
      && (check.invariantViolations?.length ?? 0) === 0
    const scheduler = { ...schedulerState }
    if (schedulerDefinitions && runService) {
      try {
        scheduler.count = boundedSchedulerCount((await schedulerDefinitions.list()).length + runService.list({ limit: 1_000 }).length)
      } catch (error) {
        scheduler.ready = false
        scheduler.degraded = true
        scheduler.error_code = schedulerErrorCode(error, 'SCHEDULER_STATUS_UNAVAILABLE')
      }
    }
    return {
      ok: ready,
      service: 'tasks-recorder',
      api_version: 5,
      live: true,
      ready,
      degraded: !ready || scheduler.degraded,
      check,
      scheduler,
    }
  }

  try {
    links = createLinks({ databasePath: join(dataDirectory, 'session-links.sqlite') })
    const terminalLauncher = createLauncher({
      runtimeDirectory: join(dataDirectory, 'runtime'),
    })
    const dashboardSettings = createSettings({
      configPath: config.configPath ?? join(dataDirectory, 'config.json'),
      terminalLauncher,
      relocateDefinitionsDirectory,
    })
    const sessionInventory = createSessionInventory()
    const resolverEnvironment = { ...process.env }
    if (typeof config.codexPath === 'string' && config.codexPath.length > 0) {
      resolverEnvironment.CODEX_BIN = config.codexPath
    }
    runtimeEnvironment = createRuntimeEnvironment({ env: resolverEnvironment })
    const runtimeResolver = createRuntimeResolver({
      env: resolverEnvironment,
      runtimeEnvironment,
      canonicalize: canonicalRuntimeExecutable,
      probe: (executable, probe) => probeRuntimeExecutable(executable, probe, {
        cwd: dataDirectory,
        execFileImpl: runtimeExecFile,
      }),
    })
    runtimeRegistry = createRuntimeRegistry({
      definitions: [createCodexRuntime({
        execFileImpl: runtimeExecFile,
        runtimeEnvironment,
      }), createOpenCodeRuntime({ runtimeEnvironment })],
      resolver: runtimeResolver,
    })
    await startScheduler()
    const sessionResume = createResumeService({
      settings: dashboardSettings,
      terminalLauncher,
      sessionInventory,
      runtimeRegistry,
      runService,
    })
    sessionBrowser = createBrowser({
      adapters: [createSessionAdapter({ resolveLaunch: () => runtimeRegistry.resolve('codex'), onChange: () => hub.publish() })],
      settings: dashboardSettings,
      terminalLauncher,
      links,
    })
    api = createApi({
      serviceStatus,
      hub,
      host: config.serverHost,
      port: config.serverPort,
      publicUrl: config.serverPublicUrl,
      allowedClients: config.serverAllowedClients,
      dashboardHtml,
      dashboardSettings,
      sessionResume,
      sessionBrowser,
      schedulerService,
      scheduledRunLogs,
      runtimeRegistry,
      runService,
      schedulerClock,
      packageVersion: config.packageVersion ?? 'source',
    })
    const address = await api.listen()
    return {
      address,
      startup: { api_version: 5 },
      scheduler: { ...schedulerState },
      async close() {
        if (closed) return
        closed = true
        sessionBrowser?.close?.()
        hub.close()
        try {
          await api?.close()
        } finally {
          try { await closeScheduler() } finally { links?.close() }
        }
      },
    }
  } catch (error) {
    sessionBrowser?.close?.()
    hub.close()
    try { await api?.close() } catch {}
    try { await closeScheduler() } finally { links?.close() }
    throw error
  }
}
