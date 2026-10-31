import { isAbsolute, relative, resolve, sep } from 'node:path'

import { skillsThreadConfig } from '../codex-capability-policy.mjs'

const FINAL_MESSAGE_BYTES = 8 * 1024
const RETRY_DELAYS_MS = [10_000, 30_000, 90_000]
const RETRY_PROMPT = 'The previous turn failed because of a temporary model or network error. Continue the original task from this conversation. Check existing results and complete only unfinished work. Do not repeat successful file changes, commands, or external actions.'
const READ_ONLY_ITEMS = new Set(['userMessage', 'agentMessage', 'reasoning', 'plan', 'webSearch', 'imageView', 'contextCompaction', 'enteredReviewMode', 'exitedReviewMode'])
const FILE_CHANGE_KINDS = new Set(['add', 'update', 'delete'])

export function createCodexInteractiveSessionFactory({
  createClient,
  resolveCapabilityLaunch = async () => ({ disabledFeatures: [], configOverrides: [] }),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  random = Math.random,
} = {}) {
  if (typeof createClient !== 'function' || typeof setTimer !== 'function'
    || typeof clearTimer !== 'function' || typeof resolveCapabilityLaunch !== 'function'
    || typeof random !== 'function') {
    throw new TypeError('Codex interactive session requires createClient')
  }

  return Object.freeze({
    create(options) {
      return createSession({
        ...options, createClient, resolveCapabilityLaunch, setTimer, clearTimer, random,
      })
    },
  })
}

function createSession({
  launch, run, signal, emit, onSpawn, createClient, resolveCapabilityLaunch,
  setTimer, clearTimer, random, logs,
}) {
  if (typeof launch?.executable !== 'string' || !run || typeof run !== 'object'
    || typeof run.workspace !== 'string' || typeof run.prompt !== 'string'
    || !signal || typeof emit !== 'function' || typeof onSpawn !== 'function') {
    throw new TypeError('Codex interactive session options are invalid')
  }

  const capabilities = normalizedCapabilities(run.capabilities)
  let client = null
  let unsubscribe = () => {}
  let unsubscribeClosed = () => {}
  let threadId = null
  let turnId = null
  let turnRevision = 0
  let finalMessage = ''
  let retryTimer = null
  let retries = 0
  let requestRevision = 0
  let providerError = null
  let uncertainOperation = false
  const pendingOperations = new Set()
  const fileChanges = new Map()
  let settled = false
  let resolveCompletion
  const completion = new Promise((resolve) => { resolveCompletion = resolve })

  const handleNotification = ({ method, params }) => {
    if (settled) return
    if (method === 'error' && params?.threadId === threadId
      && turnId !== null && (!params.turnId || params.turnId === turnId)) {
      providerError = params.error
      return
    }
    if (method === 'turn/started') {
      if (retryTimer !== null) return
      const nextTurnId = params?.turn?.id
      if (params?.threadId !== threadId || typeof nextTurnId !== 'string') return
      if (turnId !== nextTurnId) {
        turnId = nextTurnId
        turnRevision += 1
        safeEmit(emit, { type: 'turn_started', payload: { turn_revision: turnRevision } })
      }
      return
    }
    if (method === 'item/agentMessage/delta') {
      if (params?.threadId !== threadId || params?.turnId !== turnId
        || typeof params?.itemId !== 'string' || typeof params?.delta !== 'string') return
      finalMessage = appendBounded(finalMessage, params.delta, FINAL_MESSAGE_BYTES)
      safeEmit(emit, {
        type: 'assistant_delta',
        payload: {
          turn_revision: turnRevision,
          item_id: params.itemId,
          delta: params.delta,
        },
      })
      return
    }
    if (method === 'item/started' || method === 'item/completed') {
      if (params?.threadId !== threadId || params?.turnId !== turnId
        || typeof params?.item?.id !== 'string') return
      const item = params.item
      if (!READ_ONLY_ITEMS.has(item.type)) {
        if (method === 'item/started') pendingOperations.add(item.id)
        else {
          pendingOperations.delete(item.id)
          if (item.status !== 'completed' && item.success !== true) uncertainOperation = true
        }
      }
      if (method === 'item/completed' && item.type === 'agentMessage'
        && typeof item.text === 'string') {
        finalMessage = appendBounded('', item.text, FINAL_MESSAGE_BYTES)
      }
      if (method === 'item/completed' && item.type === 'fileChange'
        && item.status === 'completed' && Array.isArray(item.changes)) {
        for (const candidate of item.changes) {
          const change = containedFileChange(candidate, run.workspace)
          if (change && (fileChanges.has(change.path) || fileChanges.size < 128)) {
            fileChanges.set(change.path, change)
          }
        }
      }
      const label = activityLabel(item)
      if (label) {
        safeEmit(emit, {
          type: method === 'item/started' ? 'activity_started' : 'activity_completed',
          payload: {
            turn_revision: turnRevision,
            item_id: item.id,
            label,
            ...(method === 'item/completed' ? { state: activityState(item) } : {}),
          },
        })
      }
      return
    }
    if (method === 'turn/completed') {
      if (params?.threadId !== threadId || params?.turn?.id !== turnId) return
      const failure = providerFailure(params.turn.error ?? providerError, finalMessage)
      if (params.turn.status === 'failed') {
        for (const item of params.turn.items ?? []) {
          if (!READ_ONLY_ITEMS.has(item.type) && item.status !== 'completed' && item.success !== true) uncertainOperation = true
        }
        if (failure.retryable && pendingOperations.size === 0 && !uncertainOperation
          && retries < RETRY_DELAYS_MS.length) {
          scheduleRetry(failure)
          return
        }
        writeRetryLog({ event: 'turn_failed', attempt: retries + 1, code: failure.code, message: failure.message })
      }
      finish(turnResult(params.turn, {
        threadId,
        finalMessage,
        failure,
        fileChanges: [...fileChanges.values()],
      }))
    }
  }
  const onAbort = () => finish(failedResult(sessionError('RUN_CANCELED')))
  const timeout = setTimer(() => finish(timeoutResult()), run.timeout_seconds * 1_000)
  timeout?.unref?.()
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) onAbort()

  async function start() {
    if (settled) return completion
    try {
      const capabilityLaunch = await resolveCapabilityLaunch({
        executable: launch.executable,
        cwd: run.workspace,
        capabilities,
      })
      if (settled) return completion
      client = createClient({
        executable: launch.executable,
        cwd: run.workspace,
        signal,
        disabledFeatures: capabilityLaunch.disabledFeatures,
        configOverrides: capabilityLaunch.configOverrides,
      })
      unsubscribe = client.onNotification(handleNotification)
      unsubscribeClosed = client.onClose?.((error) => finish({
        ...failedResult(error),
        session_id: threadId,
        file_changes: [...fileChanges.values()],
      })) ?? (() => {})
      const spawned = await client.started
      if (settled) return completion
      onSpawn({ pid: spawned.pid })
      await client.request('initialize', {
        clientInfo: { name: 'rillo', title: 'Rillo', version: 'source' },
      })
      const threadConfig = capabilities.skills === 'disabled'
        ? skillsThreadConfig(await client.request('skills/list', {
          cwds: [run.workspace],
          forceReload: true,
        }), { cwd: run.workspace })
        : null
      const config = {
        ...threadConfig,
        ...(run.network_access == null ? {} : { 'sandbox_workspace_write.network_access': run.network_access }),
        ...(run.auto_compact_token_limit == null ? {} : { model_auto_compact_token_limit: run.auto_compact_token_limit }),
      }
      const startedThread = await client.request(run.resume_session_id ? 'thread/resume' : 'thread/start', compact({
        ...(run.resume_session_id ? { threadId: run.resume_session_id } : { ephemeral: false }),
        cwd: run.workspace,
        model: run.model,
        approvalPolicy: 'never',
        sandbox: run.sandbox_mode,
        config: Object.keys(config).length ? config : null,
      }))
      if (settled) return completion
      threadId = startedThread?.thread?.id
      if (typeof threadId !== 'string' || threadId.length === 0) {
        throw sessionError('RUNTIME_PROTOCOL_INVALID')
      }
      if (run.resume_session_id && threadId !== run.resume_session_id) throw sessionError('RUNTIME_PROTOCOL_INVALID')
      safeEmit(emit, { type: 'session', payload: { session_id: threadId } })
      await startTurn(run.prompt, 'prompt')
    } catch (error) {
      finish(failedResult(error))
    }
    return completion
  }

  async function startTurn(text, kind) {
    const request = ++requestRevision
    try {
      providerError = null
      finalMessage = ''
      safeEmit(emit, { type: 'user_message', payload: { kind, text } })
      const result = await client.request('turn/start', compact({
        threadId, input: [{ type: 'text', text }], cwd: run.workspace,
        model: run.model, effort: run.reasoning_effort,
        serviceTier: run.fast_mode == null ? undefined : run.fast_mode ? 'fast' : 'default',
      }))
      if (settled || request !== requestRevision || retryTimer !== null) return
      const nextTurnId = result?.turn?.id
      if (typeof nextTurnId !== 'string' || !nextTurnId) throw sessionError('RUNTIME_PROTOCOL_INVALID')
      if (turnId === null) {
        turnId = nextTurnId
        turnRevision += 1
        safeEmit(emit, { type: 'turn_started', payload: { turn_revision: turnRevision } })
      }
    } catch (error) {
      if (!settled && request === requestRevision && retryTimer === null) finish(failedResult(error))
    }
  }

  function scheduleRetry(failure) {
    const delay = Math.ceil(RETRY_DELAYS_MS[retries] * (1 + random() * 0.2))
    retries += 1
    requestRevision += 1
    turnId = null
    const activity = { item_id: `runtime-retry-${retries}`, turn_revision: turnRevision,
      label: `${Math.ceil(delay / 1000)} 秒后重试（${retries}/${RETRY_DELAYS_MS.length}）`,
      attempt: retries, delay_ms: delay, error_code: failure.code }
    writeRetryLog({ event: 'retry_scheduled', ...activity, message: failure.message })
    safeEmit(emit, { type: 'activity_started', payload: activity })
    retryTimer = setTimer(() => {
      retryTimer = null
      if (settled || signal.aborted) return
      safeEmit(emit, { type: 'activity_completed', payload: { ...activity, state: 'completed' } })
      void startTurn(RETRY_PROMPT, 'retry')
    }, delay)
    retryTimer?.unref?.()
  }

  function writeRetryLog(value) {
    try { Promise.resolve(logs?.writeStderr?.(JSON.stringify(value) + '\n')).catch(() => {}) } catch {}
  }

  async function steer({ expectedTurnRevision, text } = {}) {
    assertCurrentTurn(expectedTurnRevision)
    if (typeof text !== 'string' || text.trim() === '') {
      throw sessionError('INTERVENTION_INVALID')
    }
    await client.request('turn/steer', {
      threadId,
      expectedTurnId: turnId,
      input: [{ type: 'text', text }],
    })
    safeEmit(emit, {
      type: 'intervention_accepted',
      payload: { turn_revision: turnRevision, text: text.trim() },
    })
    return { accepted: true, turnRevision }
  }

  async function interrupt({ expectedTurnRevision } = {}) {
    if (!settled && retryTimer !== null) {
      if (expectedTurnRevision !== turnRevision) throw sessionError('TURN_CHANGED')
      finish(failedResult(sessionError('RUN_CANCELED')))
      return { accepted: true, turnRevision }
    }
    assertCurrentTurn(expectedTurnRevision)
    await client.request('turn/interrupt', { threadId, turnId })
    return { accepted: true, turnRevision }
  }

  function assertCurrentTurn(expectedTurnRevision) {
    if (settled || threadId === null || turnId === null || turnRevision < 1) {
      throw sessionError('RUN_NOT_ACTIVE')
    }
    if (expectedTurnRevision !== turnRevision) throw sessionError('TURN_CHANGED')
  }

  function finish(result) {
    if (settled) return
    settled = true
    clearTimer(timeout)
    if (retryTimer !== null) clearTimer(retryTimer)
    retryTimer = null
    signal.removeEventListener('abort', onAbort)
    unsubscribe()
    unsubscribeClosed()
    client?.close()
    resolveCompletion({
      ...result,
      session_id: threadId ?? result.session_id,
      final_message: result.final_message ?? (finalMessage || null),
      file_changes: [...fileChanges.values()],
    })
  }

  return Object.freeze({
    start,
    steer,
    interrupt,
    close: () => finish(failedResult(sessionError('RUN_CANCELED'))),
    completion,
    get turnRevision() { return turnRevision },
    get steerable() { return !settled && turnId !== null && turnRevision > 0 },
  })
}

function normalizedCapabilities(value) {
  const mode = (field) => value?.[field] === 'disabled' ? 'disabled' : 'inherit'
  return { skills: mode('skills'), integrations: mode('integrations') }
}

function turnResult(turn, { threadId, finalMessage, fileChanges, failure }) {
  const succeeded = turn?.status === 'completed'
  return {
    status: succeeded ? 'succeeded' : (turn?.status === 'interrupted' ? 'canceled' : 'failed'),
    exit_code: succeeded ? 0 : null,
    error_code: succeeded ? null : (turn?.status === 'interrupted' ? 'RUN_CANCELED' : failure.code),
    session_id: threadId,
    final_message: succeeded ? (finalMessage || null) : (failure.message || finalMessage || null),
    usage: null,
    file_changes: fileChanges,
  }
}

function providerFailure(error, fallbackMessage) {
  const message = appendBounded('', typeof error?.message === 'string' ? error.message : fallbackMessage, FINAL_MESSAGE_BYTES)
  const info = error?.codexErrorInfo
  const kind = typeof info === 'string' ? info : Object.keys(info ?? {})[0] ?? ''
  const normalized = kind.toLowerCase()
  const detail = typeof info?.[kind] === 'object' ? info[kind] : info
  const status = detail?.httpStatusCode
  const permanent = ['contextwindowexceeded', 'usagelimitexceeded', 'badrequest', 'unauthorized', 'sandboxerror'].includes(normalized)
    || /insufficient.quota|exceeded.{0,40}quota|quota.{0,40}exceeded|credit.balance|billing|usage.limit|spend.limit|account.deactivated|payment.required|invalid.api.key|unauthorized|authentication|permission.denied/i.test(message)
    || (Number.isInteger(status) && status >= 400 && ![408, 429, 500, 502, 503, 504, 529].includes(status))
  if (permanent) return { code: 'RUNTIME_PROVIDER_ERROR', message, retryable: false }
  if (/selected model is at capacity|server.is.overloaded|model.{0,40}(?:overloaded|at capacity)/i.test(message)) {
    return { code: 'RUNTIME_MODEL_AT_CAPACITY', message, retryable: true }
  }
  if (status === 429 || /rate.limit|too many requests/i.test(message)) return { code: 'RUNTIME_RATE_LIMITED', message, retryable: true }
  const retryable = [408, 500, 502, 503, 504, 529].includes(status)
    || ['httpconnectionfailed', 'responsestreamconnectionfailed', 'responsestreamdisconnected', 'responsetoomanyfailedattempts', 'internalservererror'].includes(normalized)
    || /^(?:error: )?(?:error sending request|stream disconnected before completion|request timed out|connection (?:reset|refused|timed out))/i.test(message)
  return { code: error ? 'RUNTIME_PROVIDER_ERROR' : 'RUNTIME_PROCESS_FAILED', message, retryable }
}

function failedResult(error) {
  return {
    status: error?.code === 'RUN_CANCELED' ? 'canceled' : 'failed',
    exit_code: Number.isSafeInteger(error?.exit_code) ? error.exit_code : null,
    error_code: error?.code ?? 'RUNTIME_PROTOCOL_ERROR',
    session_id: null,
    final_message: null,
    usage: null,
    file_changes: [],
  }
}

function timeoutResult() {
  return {
    status: 'timed_out',
    exit_code: null,
    error_code: 'RUNTIME_TIMEOUT',
    session_id: null,
    final_message: null,
    usage: null,
    file_changes: [],
  }
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, nested]) => nested !== null && nested !== undefined))
}

function appendBounded(current, delta, maximumBytes) {
  const next = `${current}${delta}`
  if (Buffer.byteLength(next) <= maximumBytes) return next
  const bytes = Buffer.from(next)
  return bytes.subarray(bytes.byteLength - maximumBytes).toString('utf8').replace(/^\uFFFD/, '')
}

function containedFileChange(change, workspace) {
  if (!change || typeof change !== 'object' || !FILE_CHANGE_KINDS.has(change.kind)
    || typeof change.path !== 'string' || change.path.length === 0
    || Buffer.byteLength(change.path) > 2048) return null
  const root = resolve(workspace)
  const absolute = isAbsolute(change.path) ? resolve(change.path) : resolve(root, change.path)
  const child = relative(root, absolute)
  if (child === '' || isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`)) return null
  return { path: child.split(sep).join('/'), kind: change.kind }
}

function activityLabel(item) {
  if (item.type === 'commandExecution' && typeof item.command === 'string') {
    return `Command · ${item.command.slice(0, 160)}`
  }
  if (item.type === 'fileChange') {
    const count = Array.isArray(item.changes) ? item.changes.length : 0
    return count === 1 ? '1 file changed' : `${count} files changed`
  }
  if (item.type === 'mcpToolCall' && typeof item.tool === 'string') {
    return `${item.server || 'MCP'} · ${item.tool}`.slice(0, 180)
  }
  if (item.type === 'webSearch') return 'Web search'
  if (item.type === 'imageView') return 'View image'
  return null
}

function activityState(item) {
  if (item.status === 'failed' || item.status === 'declined') return 'failed'
  return 'completed'
}

function safeEmit(emit, event) {
  try { emit(event) } catch {}
}

function sessionError(code) {
  return Object.assign(new Error(code), { code })
}
