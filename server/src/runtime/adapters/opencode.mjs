import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'

import { startOpenCodeServer } from '../opencode-server-client.mjs'
import { runtimeError } from '../runtime-errors.mjs'

const HISTORY_LIMIT = 100
const TEXT_LIMIT = 1024 * 1024
let lastMessageTimestamp = 0
let messageCounter = 0

// Match OpenCode's ascending IDs: six timestamp bytes followed by 14 base62 characters.
function nextMessageId() {
  const timestamp = Math.max(Date.now(), lastMessageTimestamp)
  messageCounter = timestamp === lastMessageTimestamp ? messageCounter + 1 : 1
  lastMessageTimestamp = timestamp
  const time = (BigInt(timestamp) * 0x1000n + BigInt(messageCounter)).toString(16).slice(-12).padStart(12, '0')
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  return `msg_${time}${Array.from(randomBytes(14), byte => alphabet[byte % 62]).join('')}`
}

export function createOpenCodeRuntimeDefinition({ startServer = startOpenCodeServer, runtimeEnvironment, pollMs = 1_000 } = {}) {
  const open = (options) => startServer({ ...options, runtimeEnvironment })
  let catalog = null
  let catalogExpires = 0
  return {
    id: 'opencode', displayName: 'OpenCode',
    launch: { overrideEnv: 'OPENCODE_BIN', executableNames: ['opencode'], packagedCandidates: [], platformResolvers: [] },
    versionProbe: { args: ['--version'], timeout_ms: 5_000 },
    fallbackModels: [],
    capabilities: { modelSelection: true, reasoning: true, sandbox: false, sessionResume: true, interactiveSession: true, conversationHistory: true },
    createInteractiveSession: options => createSession({ ...options, open, pollMs }),
    async fetchModels({ launch }) {
      if (catalog && Date.now() < catalogExpires) return catalog
      const client = await open({ executable: launch.executable, cwd: homedir() })
      try {
        const providers = await client.request('GET', '/provider')
        const connected = new Set(providers.connected ?? [])
        const models = []
        for (const provider of providers.all ?? []) {
          if (!connected.has(provider.id)) continue
          for (const [id, model] of Object.entries(provider.models ?? {})) {
            if (model.status === 'deprecated') continue
            models.push({ id: `${provider.id}/${id}`, displayName: model.name || id,
              reasoningLevels: Object.keys(model.variants ?? {}).filter(key => !model.variants[key]?.disabled).slice(0,16) })
          }
        }
        catalog = { source: 'live', models: models.slice(0,2000) }
        catalogExpires = Date.now() + 300_000
        return catalog
      } finally { client.close() }
    },
    async sessionExists({ launch, sessionId, workspace }) {
      const client = await open({ executable: launch.executable, cwd: workspace })
      try { return (await client.request('GET', `/session/${encodeURIComponent(sessionId)}`))?.id === sessionId }
      catch (error) { if (error.code === 'RUNTIME_SESSION_NOT_FOUND') return false; throw error }
      finally { client.close() }
    },
    async readConversation({ launch, run }) {
      if (!run.session_id || !run.snapshot?.workspace) throw runtimeError('RUNTIME_CONVERSATION_UNAVAILABLE', 'No OpenCode session')
      const client = await open({ executable: launch.executable, cwd: run.snapshot.workspace })
      try {
        const rows = await client.request('GET', `/session/${encodeURIComponent(run.session_id)}/message?limit=${HISTORY_LIMIT}`)
        return conversation(rows, run.session_id)
      } finally { client.close() }
    },
  }
}

function conversation(rows, sessionId) {
  if (!Array.isArray(rows)) throw runtimeError('RUNTIME_PROTOCOL_INVALID', 'Invalid OpenCode messages')
  let remaining = TEXT_LIMIT
  let truncated = rows.length >= HISTORY_LIMIT
  const messages = []
  for (const row of [...rows].reverse()) {
    if (!['user','assistant'].includes(row.info?.role)) continue
    const text = textParts(row.parts)
    if (!text) continue
    const bounded = text.slice(-remaining)
    truncated ||= bounded.length < text.length
    if (remaining === 0) { truncated = true; break }
    messages.push({ id: row.info.id, role: row.info.role, text: bounded })
    remaining -= bounded.length
  }
  return { session_id: sessionId, messages: messages.reverse(), truncated }
}

function textParts(parts) {
  return (parts ?? []).filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n\n')
}

function createSession({ launch, run, signal, emit, onSpawn, open, pollMs, logs }) {
  let client, sessionId, promptId, finalMessage = ''
  let finished = false, finishing = false, revision = 0, polling = false, sending = false
  let timer, pollTimer, reconnectTimer
  const startup = new AbortController()
  const parts = new Map()
  const textPartIds = new Set()
  const userMessageIds = new Set()
  let logQueue = Promise.resolve()
  let resolveCompletion
  const completion = new Promise(resolve => { resolveCompletion = resolve })
  const send = (type, payload) => { if (!finished) emit({ type, payload }) }
  const log = (stream, value) => {
    const writer = logs?.[stream === 'stderr' ? 'writeStderr' : 'writeStdout']
    if (typeof writer === 'function') {
      logQueue = logQueue.then(() => writer(Buffer.from(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`))).catch(() => {})
    }
  }
  const serverOutput = (stream, chunk) => {
    if (chunk?.length) log(stream, chunk.toString('utf8').slice(-8_000).trimEnd())
  }
  const fail = error => finish(error?.code === 'RUN_CANCELED' ? 'canceled' : 'failed', error?.code ?? 'RUNTIME_PROTOCOL_ERROR')
  const abort = () => { void finish('canceled', 'RUN_CANCELED') }

  async function finish(status, errorCode = null) {
    if (finished || finishing) return
    finishing = true
    clearTimeout(timer); clearInterval(pollTimer); clearTimeout(reconnectTimer)
    signal.removeEventListener('abort', abort)
    // Stop the actual session before releasing our server; never touch another user's server.
    if (client && sessionId && status !== 'succeeded') {
      await Promise.race([
        client.request('POST', `/session/${sessionId}/abort`).catch(() => {}),
        new Promise(resolve => { const timer = setTimeout(resolve, 2_000); timer.unref?.() }),
      ])
    }
    startup.abort()
    client?.close()
    await logQueue
    finished = true
    resolveCompletion({ status, exit_code: status === 'succeeded' ? 0 : null, error_code: errorCode,
      session_id: sessionId ?? null, final_message: finalMessage || null, usage: null, file_changes: [] })
  }

  function handleEvent(event) {
    if (finished || finishing) return
    const p = event.properties ?? {}
    if ((p.sessionID ?? p.part?.sessionID ?? p.info?.sessionID) !== sessionId) return
    if (event.type === 'permission.asked') { void finish('failed', 'RUNTIME_PERMISSION_REQUIRED'); return }
    if (event.type === 'question.asked') { void finish('failed', 'RUNTIME_INPUT_REQUIRED'); return }
    if (event.type === 'session.error') {
      const detail = errorDetail(p.error)
      finalMessage = detail.message
      log('stderr', { event: 'session.error', name: detail.name, message: detail.message })
      void finish('failed', detail.code)
      return
    }
    if (event.type === 'message.part.updated') {
      const part = p.part
      if (userMessageIds.has(part.messageID)) return
      if (part.type === 'text' && typeof part.text === 'string') {
        textPartIds.add(part.id)
        const previous = parts.get(part.id) ?? ''
        const delta = part.text.startsWith(previous) ? part.text.slice(previous.length) : part.text
        parts.set(part.id, part.text.slice(-TEXT_LIMIT))
        if (parts.size > 256) { const oldest = parts.keys().next().value; parts.delete(oldest); textPartIds.delete(oldest) }
        emitText(part.id, delta)
      }
      if (part.type === 'tool') {
        const state = part.state?.status
        if (['running','completed','error'].includes(state)) {
          const label = toolLabel(part).slice(0, 500)
          send(state === 'running' ? 'activity_started' : 'activity_completed', {
            item_id: part.id, turn_revision: revision, label,
            ...(state === 'running' ? {} : { state: state === 'error' ? 'failed' : 'completed' }),
          })
          log('stdout', { event: 'tool', state, label })
        }
      }
    }
    if (event.type === 'message.part.delta' && !userMessageIds.has(p.messageID) && textPartIds.has(p.partID) && p.field === 'text' && typeof p.delta === 'string') {
      parts.set(p.partID, ((parts.get(p.partID) ?? '') + p.delta).slice(-TEXT_LIMIT))
      emitText(p.partID, p.delta)
    }
    if (event.type === 'session.status' || event.type === 'session.idle') void reconcile()
  }

  function emitText(id, delta) {
    for (let start = 0; start < delta.length; start += 8_000) send('assistant_delta', {
      item_id: id, turn_revision: revision, delta: delta.slice(start, start + 8_000),
    })
  }

  function subscribe() {
    if (finished || finishing) return
    client.events(handleEvent).catch(error => {
      if (['RUNTIME_PROTOCOL_FRAME_TOO_LARGE','RUNTIME_PROTOCOL_INVALID'].includes(error?.code)) void fail(error)
    }).finally(() => {
      if (finished || finishing) return
      void reconcile()
      reconnectTimer = setTimeout(subscribe, pollMs)
    })
  }

  async function reconcile() {
    if (polling || sending || !promptId || finished || finishing) return
    polling = true
    const expectedPrompt = promptId
    try {
      const [statuses, permissions, questions] = await Promise.all([
        client.request('GET', '/session/status'), client.request('GET', '/permission'), client.request('GET', '/question'),
      ])
      if (permissions.some(item => item.sessionID === sessionId)) return await finish('failed', 'RUNTIME_PERMISSION_REQUIRED')
      if (questions.some(item => item.sessionID === sessionId)) return await finish('failed', 'RUNTIME_INPUT_REQUIRED')
      if (statuses[sessionId]?.type && statuses[sessionId].type !== 'idle') return
      const rows = await client.request('GET', `/session/${sessionId}/message?limit=${HISTORY_LIMIT}`)
      if (expectedPrompt !== promptId || sending || finishing) return
      const replies = rows.filter(row => row.info?.role === 'assistant' && row.info.parentID === expectedPrompt)
      const last = replies.at(-1)
      if (last?.info?.error) {
        const detail = errorDetail(last.info.error)
        finalMessage = detail.message
        log('stderr', { event: 'message.error', name: detail.name, message: detail.message })
        return await finish('failed', detail.code)
      }
      if (!last?.info?.time?.completed) return
      finalMessage = textParts(last.parts).slice(-8_000)
      // Tool-use steps can also have completed timestamps. Only the final reply ends a Run.
      if (!last.info.finish || ['tool-calls','unknown'].includes(last.info.finish)) return
      await finish('succeeded')
    } catch (error) { if (!finished && !finishing) await fail(error) }
    finally { polling = false }
  }

  async function prompt(text) {
    sending = true
    const next = nextMessageId()
    userMessageIds.add(next)
    promptId = next
    try {
      const model = run.model ? splitModel(run.model) : undefined
      await client.request('POST', `/session/${sessionId}/prompt_async`, {
        messageID: next, parts: [{ type: 'text', text }],
        ...(model ? { model } : {}), ...(run.reasoning_effort ? { variant: run.reasoning_effort } : {}),
      })
    } finally { sending = false }
  }

  async function start() {
    if (signal.aborted) { await finish('canceled', 'RUN_CANCELED'); return completion }
    signal.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => { void finish('timed_out', 'RUNTIME_TIMEOUT') }, run.timeout_seconds * 1_000)
    try {
      assertSettings(run)
      client = await open({ executable: launch.executable, cwd: run.workspace, signal: startup.signal, onSpawn,
        onStdout: chunk => serverOutput('stdout', chunk), onStderr: chunk => serverOutput('stderr', chunk) })
      if (finished || finishing) { client.close(); return completion }
      const created = run.resume_session_id
        ? await client.request('GET', `/session/${encodeURIComponent(run.resume_session_id)}`)
        : await client.request('POST', '/session', { title: run.title })
      if (typeof created?.id !== 'string' || !/^ses[a-zA-Z0-9_-]+$/.test(created.id)) throw runtimeError('RUNTIME_PROTOCOL_INVALID', 'Invalid OpenCode session ID')
      if (run.resume_session_id && created.id !== run.resume_session_id) throw runtimeError('RUNTIME_PROTOCOL_INVALID', 'OpenCode returned another session')
      sessionId = created.id
      if (finished || finishing) { client.close(); return completion }
      send('session', { session_id: sessionId })
      revision = 1
      send('turn_started', { turn_revision: revision })
      send('user_message', { kind: 'prompt', text: run.prompt })
      subscribe()
      await prompt(run.prompt)
      if (!finished && !finishing) pollTimer = setInterval(() => { void reconcile() }, pollMs)
    } catch (error) { await fail(error) }
    return completion
  }
  function assertTurn(expected) {
    if (finished || finishing || !sessionId) throw runtimeError('RUN_NOT_ACTIVE', 'Run is not active')
    if (expected !== revision) throw runtimeError('TURN_CHANGED', 'Turn changed')
    if (sending) throw runtimeError('TURN_CHANGED', 'Another message is being sent')
  }
  return {
    start, completion, close: abort,
    async steer({ expectedTurnRevision, text }) {
      assertTurn(expectedTurnRevision)
      if (typeof text !== 'string' || !text.trim()) throw runtimeError('INTERVENTION_INVALID', 'Message is empty')
      try { await prompt(text.trim()) } catch (error) { await fail(error); throw error }
      assertTurn(expectedTurnRevision)
      send('intervention_accepted', { turn_revision: revision, text: text.trim() })
      return { accepted: true, turnRevision: revision }
    },
    async interrupt({ expectedTurnRevision }) { assertTurn(expectedTurnRevision); await finish('canceled', 'RUN_CANCELED'); return { accepted: true, turnRevision: revision } },
    get turnRevision() { return revision },
    get steerable() { return !finished && !finishing && revision > 0 },
  }
}

function errorDetail(error) {
  const source = error && typeof error === 'object' ? error : { message: error }
  const name = typeof source.name === 'string' ? source.name.slice(0, 120) : ''
  const message = [source.message, source.data?.message, source.response?.message]
    .find(value => typeof value === 'string' && value.trim())?.trim().slice(0, 8_000)
    ?? (name ? `OpenCode returned ${name}` : 'OpenCode could not complete the request')
  const lower = `${name} ${message}`.toLowerCase()
  const code = /not available in your country|not available in (your )?region|country.*not supported|region.*not supported|model.*not found|modelnotfound/.test(lower)
    ? 'RUNTIME_MODEL_UNAVAILABLE'
    : 'RUNTIME_PROVIDER_ERROR'
  return { name, message, code }
}

function toolLabel(part) {
  const tool = String(part.tool ?? 'Tool')
  const state = part.state ?? {}
  const description = state.metadata?.title ?? state.metadata?.description ?? state.title
  const command = state.input?.command ?? state.input?.cmd
  const summary = description ?? (tool === 'bash' && typeof command === 'string' ? redactCommand(command) : '')
  return summary ? `${tool}: ${String(summary).replace(/\s+/g, ' ').trim()}` : tool
}

function redactCommand(command) {
  return command
    .replace(/\b(api[_-]?key|token|password|secret|authorization)\s*([=:])\s*([^\s,;]+)/gi, '$1$2[redacted]')
    .replace(/\bBearer\s+[^\s'";,]+/gi, 'Bearer [redacted]')
}

function assertSettings(run) {
  if (run.sandbox_mode !== 'danger-full-access' || run.fast_mode != null || run.network_access != null
    || ['skills','integrations'].some(key => run.capabilities?.[key] === 'disabled')) {
    throw runtimeError('RUNTIME_CONFIG_UNSUPPORTED', 'OpenCode requires no OS sandbox and inherited capabilities')
  }
}
function splitModel(value) {
  const slash = value.indexOf('/')
  if (slash <= 0 || slash === value.length - 1) throw runtimeError('RUNTIME_CONFIG_UNSUPPORTED', 'OpenCode model must be provider/model')
  return { providerID: value.slice(0,slash), modelID: value.slice(slash + 1) }
}
