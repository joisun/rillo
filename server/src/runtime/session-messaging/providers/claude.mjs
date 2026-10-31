import { createHash, randomUUID } from 'node:crypto'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { messageError, unavailable, unknown, runCommand, deferred, timeout } from '../common.mjs'

function inputFeed() {
  const values = []
  let waiting = null, done = false
  return {
    push(value) { if (done) throw unavailable('Claude 输入连接已关闭'); if (waiting) { waiting({ value, done: false }); waiting = null } else values.push(value) },
    close() { done = true; waiting?.({ done: true }); waiting = null },
    [Symbol.asyncIterator]() { return this },
    next() { if (values.length) return Promise.resolve({ value: values.shift(), done: false }); if (done) return Promise.resolve({ done: true }); return new Promise(resolveNext => { waiting = resolveNext }) },
  }
}

export async function createClaudeSdkDriver({ executable, workspace, sessionId, env, onMessage, onClose, onDiagnostic = () => {}, loadSdk = () => import('../../../../vendor/claude-sdk.mjs') }) {
  const sdk = await loadSdk().catch(() => { throw unavailable('Claude SDK 未安装，尝试 CLI 通道') })
  const feed = inputFeed()
  let query
  try {
    query = sdk.query({ prompt: feed, options: { resume: sessionId, cwd: workspace, env,
      pathToClaudeCodeExecutable: executable, systemPrompt: { type: 'preset', preset: 'claude_code' }, settingSources: ['user', 'project', 'local'],
      includePartialMessages: true, stderr: onDiagnostic, extraArgs: { 'replay-user-messages': null } } })
  } catch { throw unavailable('Claude SDK 无法初始化') }
  const consuming = (async () => { try { for await (const message of query) onMessage(message) } catch (error) { onDiagnostic(String(error)); onClose() } finally { feed.close(); query.close(); onClose() } })()
  consuming.catch(() => {})
  try { await timeout(query.initializationResult(), 10000) }
  catch { feed.close(); query.close(); await consuming; throw unavailable('Claude SDK 初始化失败；尚未投递消息') }
  return {
    send: message => feed.push(message),
    interrupt: () => query.interrupt(),
    async close() { feed.close(); query.close(); await consuming },
  }
}

export async function createClaudeCliDriver({ executable, workspace, sessionId, env, onMessage, onClose, spawnImpl = spawn }) {
  const child = spawnImpl(executable, ['--print', '--resume', sessionId, '--input-format', 'stream-json', '--output-format', 'stream-json', '--replay-user-messages', '--include-partial-messages', '--verbose'], { cwd: workspace, env, stdio: ['pipe', 'pipe', 'pipe'], shell: false })
  const requests = new Map()
  const ended = deferred()
  let buffer = '', closed = false, exited = false, forceTimer
  const write = message => { if (closed || !child.stdin.writable) throw unknown(); child.stdin.write(JSON.stringify(message) + '\n') }
  child.stdin.on('error', () => { closed = true; onClose() })
  child.once('error', () => { closed = true; exited = true; for (const value of requests.values()) value.reject(unavailable('Claude CLI 无法启动')); onClose(); ended.resolve() })
  child.once('close', () => { closed = true; exited = true; clearTimeout(forceTimer); for (const value of requests.values()) value.reject(unknown()); requests.clear(); onClose(); ended.resolve() })
  const terminate = () => {
    if (exited) return
    child.stdin.end(); child.kill('SIGTERM')
    forceTimer ??= setTimeout(() => child.kill('SIGKILL'), 1000)
    forceTimer.unref?.()
  }
  child.stderr.on('data', () => {})
  child.stdout.on('data', bytes => {
    buffer += bytes
    if (buffer.length > 2 * 1024 * 1024) { terminate(); onClose(); return }
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
      let message
      try { message = JSON.parse(line) } catch { continue }
      if (message.type === 'control_response') {
        const pending = requests.get(message.response?.request_id)
        if (!pending) continue
        requests.delete(message.response.request_id)
        if (message.response.subtype === 'error') pending.reject(pending.kind === 'initialize' ? unavailable('Claude 拒绝初始化') : unknown('Claude 未确认控制请求的执行结果'))
        else pending.resolve(message.response.response)
      } else if (message.type === 'control_request') {
        write({ type: 'control_response', response: { subtype: 'error', request_id: message.request_id, error: '需要用户处理权限或输入请求；任务服务不会自动批准' } })
      } else onMessage(message)
    }
  })
  async function control(request) {
    const id = randomUUID(), pending = deferred()
    requests.set(id, { ...pending, kind: request.subtype })
    try { write({ type: 'control_request', request_id: id, request }); return await timeout(pending.promise, 10000) }
    finally { requests.delete(id) }
  }
  async function close() { terminate(); await ended.promise }
  try { await control({ subtype: 'initialize' }) }
  catch { await close(); throw unavailable('Claude CLI 初始化失败；尚未投递消息') }
  return { send: write, interrupt: () => control({ subtype: 'interrupt' }), close }
}

export function createClaudeMessageProvider({ dataRoot = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), resolveLaunch, command = runCommand, sdkDriver = createClaudeSdkDriver, cliDriver = createClaudeCliDriver, terminal = null, idleTimeoutMs = 60000, environment = process.env }) {
  const root = resolve(dataRoot), storeId = createHash('sha256').update(root).digest('hex').slice(0, 20)
  const workers = new Map()
  let closed = false
  const env = { ...environment, CLAUDE_CONFIG_DIR: root }
  function idle(worker) {
    clearTimeout(worker.idleTimer)
    if (worker.busy || worker.closed) return
    worker.idleTimer = setTimeout(() => { worker.driver?.close().catch(() => {}) }, idleTimeoutMs)
    worker.idleTimer.unref?.()
  }
  async function metadata(session) {
    if (!/^[0-9a-f-]{36}$/i.test(session.session_id)) throw messageError('SESSION_MESSAGE_REFERENCE_INVALID', 'Claude Session ID 必须为 UUID')
    let directories
    try { directories = await readdir(join(root, 'projects'), { withFileTypes: true }) } catch { throw messageError('SESSION_MESSAGE_REFERENCE_INVALID', 'Claude 会话目录不可用') }
    for (const directory of directories.slice(0, 10000)) {
      if (!directory.isDirectory() || directory.isSymbolicLink()) continue
      const path = join(root, 'projects', directory.name, session.session_id + '.jsonl')
      let handle
      try {
        const stat = await lstat(path)
        if (!stat.isFile() || stat.isSymbolicLink()) continue
        handle = await open(path, 'r')
        const buffer = Buffer.alloc(256 * 1024)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        for (const line of buffer.subarray(0, bytesRead).toString('utf8').split('\n')) {
          let row
          try { row = JSON.parse(line) } catch { continue }
          if (row.sessionId !== session.session_id || !isAbsolute(row.cwd ?? '')) continue
          const workspace = await realpath(row.cwd)
          return { workspace, path }
        }
      } catch (error) { if (error.code !== 'ENOENT') throw messageError('SESSION_MESSAGE_REFERENCE_INVALID', '无法安全读取 Claude 会话元数据') }
      finally { await handle?.close() }
    }
    throw messageError('SESSION_MESSAGE_REFERENCE_INVALID', '在指定 Claude 数据源中找不到会话')
  }
  async function guardExternal(session, launch) {
    const result = await command(launch.executable, ['agents', '--json'], { env, timeoutMs: 5000 })
    let rows
    try { rows = JSON.parse(result.stdout) } catch { throw unavailable('无法确认 Claude 会话运行归属') }
    if (!Array.isArray(rows)) throw unavailable('Claude 未提供可核对的会话目录')
    for (const row of rows) {
      const id = row.sessionId ?? row.session_id
      if (!id) throw unavailable('Claude 活跃目录未提供完整 Session ID；没有另起 worker')
      if (id === session.session_id) throw unavailable('Claude 会话已由其他连接运行，不能通过 resume 接管')
    }
  }
  function transport(id, driverFactory) {
    return {
      id, operations: ['queue', 'steer', 'stop', 'compact'],
      async prepare(context, operation) {
        if (closed) throw unavailable('Claude 消息 provider 已关闭')
        const existing = workers.get(context.session.session_id)
        if (existing) {
          if (existing.transport !== id) throw unavailable('会话已由另一条通道持有，不能并发接管')
          context.claudeWorker = existing
          return
        }
        if (!['queue', 'compact'].includes(operation)) throw unavailable('此通道未持有目标会话的活动连接')
        if (workers.size >= 8) throw unavailable('受控 Claude 连接达到上限；没有另起 worker')
        const launch = await resolveLaunch().catch(() => { throw unavailable('Claude CLI 不可用') })
        await guardExternal(context.session, launch)
        const worker = { transport: id, driver: null, turnId: null, busy: false, closed: false, pending: new Map(), sent: new Map(), queue: [], consumed: new Set(), finished: deferred() }
        const onClose = () => {
          if (worker.closed) return
          worker.closed = true
          clearTimeout(worker.idleTimer)
          for (const pending of worker.pending.values()) pending.reject(unknown())
          worker.pending.clear(); worker.finished.reject(unknown())
          if (workers.get(context.session.session_id) === worker) workers.delete(context.session.session_id)
        }
        worker.driver = await driverFactory({ executable: launch.executable, workspace: context.target.workspace, sessionId: context.session.session_id, env,
          onClose, onMessage: message => {
            if (message.session_id && message.session_id !== context.session.session_id) { onClose(); worker.driver?.close(); return }
            if (message.type === 'system' && message.subtype === 'compact_boundary') {
              for (const [messageId, sent] of worker.sent) {
                if (sent.operation !== 'compact' || sent.acknowledged) continue
                sent.acknowledged = true
                sent.pre_tokens = message.compact_metadata?.pre_tokens ?? null
                worker.pending.get(messageId)?.resolve()
                worker.pending.delete(messageId)
              }
            }
            const acknowledgedIds = message.type === 'user' ? [message.uuid]
              : !message.parent_tool_use_id && ['assistant', 'stream_event'].includes(message.type)
                ? (message.user_message_uuids ?? [message.user_message_uuid]) : []
            if (['assistant', 'stream_event'].includes(message.type) && !message.parent_tool_use_id) {
              for (const messageId of acknowledgedIds) if (worker.sent.has(messageId)) worker.consumed.add(messageId)
            }
            for (const messageId of acknowledgedIds) {
              const sent = worker.sent.get(messageId)
              if (!sent || sent.acknowledged) continue
              if (sent.operation === 'compact') continue
              if (!sent.acknowledged && sent.operation === 'queue') worker.queue.push(messageId)
              sent.acknowledged = true
              worker.pending.get(messageId)?.resolve()
              worker.pending.delete(messageId)
              clearTimeout(worker.idleTimer)
              worker.busy = true
              if (!worker.turnId) { worker.turnId = messageId; worker.consumed.add(messageId) }
            }
            if (message.type === 'result') {
              const finishedTurn = worker.turnId
              worker.queue = worker.queue.filter(id => !worker.consumed.has(id))
              worker.consumed.clear()
              worker.turnId = worker.queue[0] ?? null
              if (worker.turnId) worker.consumed.add(worker.turnId)
              worker.busy = worker.turnId !== null
              worker.finished.resolve({ message, turn_id: finishedTurn }); worker.finished = deferred(); idle(worker)
            }
          },
        })
        if (closed || worker.closed) { await worker.driver.close(); throw unavailable('Claude 连接在初始化时关闭') }
        workers.set(context.session.session_id, worker); context.claudeWorker = worker; idle(worker)
      },
      async execute(operation, context) {
        const worker = context.claudeWorker
        if (worker.closed) throw unavailable('Claude 连接已关闭')
        if (operation === 'compact' && worker.busy) throw messageError('SESSION_COMPACT_BUSY', 'Claude 会话正在运行，请等待本轮结束后再压缩')
        if (!['queue', 'compact'].includes(operation) && (!worker.busy || worker.turnId !== context.expected_turn_id)) throw messageError('SESSION_MESSAGE_TURN_CHANGED', 'Claude 当前轮次已变化；没有执行控制')
        if (operation === 'stop') {
          const done = worker.finished.promise
          await worker.driver.interrupt()
          const finished = await timeout(done, 10000)
          if (finished.turn_id !== context.expected_turn_id || !['aborted_streaming', 'aborted_tools'].includes(finished.message.terminal_reason)) throw unknown('没有确认指定 Claude 轮次因打断结束；没有发送后续消息')
          return { kind: 'native_interrupted', turn_id: context.expected_turn_id }
        }
        if (worker.sent.size >= 1000) throw messageError('SESSION_MESSAGE_LIMIT', '此连接的回执数达到上限，消息未发送')
        const pending = deferred()
        worker.sent.set(context.message_id, { operation, acknowledged: false })
        worker.pending.set(context.message_id, pending)
        try {
          if (operation === 'compact') {
            clearTimeout(worker.idleTimer)
            worker.busy = true
            worker.driver.send({ type: 'user', session_id: context.session.session_id, uuid: context.message_id, parent_tool_use_id: null,
              message: { role: 'user', content: `/compact${context.text ? ` ${context.text}` : ''}` } })
            await timeout(pending.promise, Math.max(1, context.deadline - Date.now()))
            return { kind: 'native_compacted', completed: true, pre_tokens: worker.sent.get(context.message_id).pre_tokens }
          }
          worker.driver.send({ type: 'user', session_id: context.session.session_id, uuid: context.message_id, parent_tool_use_id: null,
            priority: operation === 'queue' ? 'next' : 'now', message: { role: 'user', content: context.text } })
          await timeout(pending.promise, 10000)
          return { kind: operation === 'queue' ? 'native_input_accepted' : 'native_steered', native_message_id: context.message_id, turn_id: worker.turnId }
        } catch (error) { if (error.delivery === 'not_sent') throw error; throw unknown() }
        finally { worker.pending.delete(context.message_id) }
      },
    }
  }
  return {
    id: 'claude', dataRoot: root, storeId,
    transports: [transport('claude-sdk', sdkDriver), transport('claude-cli', cliDriver), ...(terminal ? [terminal] : [])],
    resolve: metadata,
    async capabilities() { return [{ operation: 'queue', priority: ['claude-sdk', 'claude-cli', ...(terminal ? ['terminal'] : [])] }, { operation: 'steer', priority: ['claude-sdk', 'claude-cli'], requires: 'owned_connection' }, { operation: 'stop', priority: ['claude-sdk', 'claude-cli'], requires: 'owned_connection' }, { operation: 'compact', priority: ['claude-sdk', 'claude-cli'], instructions: true, requires: 'idle_session' }] },
    async describe(session) {
      const target = await metadata(session), worker = workers.get(session.session_id)
      return { workspace: target.workspace, active_turn_id: worker?.turnId ?? null, owned_connection: Boolean(worker), operations: await this.capabilities() }
    },
    async reconcile(receipt) {
      const worker = workers.get(receipt.session.session_id)
      if (receipt.operation === 'compact') {
        const sent = worker?.sent.get(receipt.message_id)
        return sent?.acknowledged ? { kind: 'native_compacted', completed: true, pre_tokens: sent.pre_tokens, transport: receipt.transport } : null
      }
      return worker?.sent.get(receipt.message_id)?.acknowledged ? { kind: 'native_input_accepted', native_message_id: receipt.message_id } : null
    },
    async close() { closed = true; await Promise.allSettled([...workers.values()].map(worker => worker.driver.close())); workers.clear() },
  }
}
