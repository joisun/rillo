import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { createCodexSharedClient } from '../../codex-shared-client.mjs'
import { messageError, unavailable, unknown, runCommand, timeout, deferred } from '../common.mjs'

const METHODS = ['initialize', 'thread/read', 'thread/turns/list', 'thread/items/list', 'thread/queue/add', 'thread/queue/list', 'turn/steer', 'turn/interrupt']
export function createCodexMessageProvider({ dataRoot = process.env.CODEX_HOME ?? join(homedir(), '.codex'), resolveLaunch, readSession, createClient = createCodexSharedClient, command = runCommand, terminal = null }) {
  const root = resolve(dataRoot)
  const storeId = createHash('sha256').update(root).digest('hex').slice(0, 20)
  let client = null, connecting = null, closed = false
  async function connected() {
    if (connecting) return connecting
    if (client && !client.closed) return client
    connecting = (async () => {
      const next = createClient({ dataRoot: root, allowedMethods: METHODS })
      try {
        await next.started
        await next.request('initialize', { clientInfo: { name: 'rillo-session-control', version: '0.15.0' }, capabilities: { experimentalApi: true } })
        next.notify('initialized')
        if (closed) throw unavailable()
        client = next
        return next
      } catch { next.close(); throw unavailable('无法连接承载会话的 Codex app-server') }
    })().finally(() => { connecting = null })
    return connecting
  }
  async function currentTurn(connection, sessionId) {
    const result = await connection.request('thread/turns/list', { threadId: sessionId, limit: 1, sortDirection: 'desc', itemsView: 'summary' })
    if (!Array.isArray(result?.data)) throw unavailable('无法核对当前 Codex turn')
    return result.data.find(turn => turn.status === 'inProgress') ?? null
  }
  async function mutation(connection, method, params) {
    try { return await connection.request(method, params) }
    catch (error) {
      if ([-32601, -32602].includes(error.rpcCode)) throw unavailable('当前 Codex 不支持此原生控制接口')
      if (error.rpcCode !== undefined) throw unknown('Codex 返回了未能确认是否接受的错误，未切换通道重发')
      throw unknown()
    }
  }
  const native = {
    id: 'codex-app-server', operations: ['queue', 'steer', 'stop'],
    async prepare(context) {
      context.codexConnection = await connected()
      try {
        const result = await context.codexConnection.request('thread/read', { threadId: context.session.session_id, includeTurns: false })
        if (result?.thread?.id !== context.session.session_id) throw messageError('SESSION_MESSAGE_REFERENCE_INVALID', 'Codex 返回了其他会话')
      } catch (error) { if (error.delivery) throw error; throw unavailable('无法通过 app-server 核对目标会话') }
    },
    async execute(operation, context) {
      const connection = context.codexConnection
      const threadId = context.session.session_id
      if (operation === 'queue') {
        const result = await mutation(connection, 'thread/queue/add', { threadId, clientUserMessageId: context.message_id, input: [{ type: 'text', text: context.text }] })
        if (!result?.queuedSubmission || typeof result.queuedSubmission.id !== 'string') throw unknown('原生入队返回格式无效，未自动重发')
        return { kind: 'native_queued', native_message_id: result.queuedSubmission.id }
      }
      let turn
      try { turn = await currentTurn(connection, threadId) }
      catch (error) { if (error.delivery) throw error; throw unavailable('无法核对当前 Codex turn') }
      if (!turn || turn.id !== context.expected_turn_id) throw messageError('SESSION_MESSAGE_TURN_CHANGED', '当前 turn 已变化；没有追加或打断')
      if (operation === 'steer') {
        const result = await mutation(connection, 'turn/steer', { threadId, expectedTurnId: turn.id, clientUserMessageId: context.message_id, input: [{ type: 'text', text: context.text }] })
        if (result?.turnId !== turn.id) throw unknown('追加输入未返回预期 turn 的回执')
        return { kind: 'native_steered', turn_id: turn.id }
      }
      const completed = deferred()
      const unsubscribe = connection.onNotification(event => {
        if (event.method === 'turn/completed' && event.params?.threadId === threadId && event.params.turn?.id === turn.id) completed.resolve(event.params.turn)
      })
      try {
        await mutation(connection, 'turn/interrupt', { threadId, turnId: turn.id })
        const observed = (async () => {
          for (let attempt = 0; attempt < 12; attempt += 1) {
            const page = await connection.request('thread/turns/list', { threadId, limit: 1, sortDirection: 'desc', itemsView: 'summary' })
            const current = page?.data?.[0]
            if (current?.id === turn.id && current.status !== 'inProgress') return current
            await new Promise(resolveWait => setTimeout(resolveWait, 250))
          }
          throw unknown('未确认目标 turn 已打断')
        })()
        const result = await timeout(Promise.race([completed.promise, observed]), 10000)
        if (result.status !== 'interrupted') throw unknown('目标 turn 已结束，但未确认被打断；没有发送后续消息')
        return { kind: 'native_interrupted', turn_id: turn.id }
      } finally { unsubscribe() }
    },
  }
  const cli = {
    id: 'codex-cli', operations: ['queue'],
    async prepare(context) {
      context.codexLaunch = await resolveLaunch().catch(() => { throw unavailable('Codex CLI 不可用') })
      const result = await command(context.codexLaunch.executable, ['queue', '--help'], { env: { ...process.env, CODEX_HOME: root }, timeoutMs: 5000 })
      if (!result.stdout.includes('--thread') || !result.stdout.includes('--message')) throw unavailable('此 Codex CLI 不支持 queue')
    },
    async execute(_operation, context) {
      await command(context.codexLaunch.executable, ['queue', '--thread', context.session.session_id, '--message', context.text], { env: { ...process.env, CODEX_HOME: root }, cwd: context.target.workspace, mutation: true })
      return { kind: 'native_queued', native_message_id: null }
    },
  }
  return {
    id: 'codex', dataRoot: root, storeId, transports: [native, cli, ...(terminal ? [terminal] : [])],
    async resolve(session) {
      try { return await readSession(session) }
      catch { throw messageError('SESSION_MESSAGE_REFERENCE_INVALID', '无法核对本机 Codex 会话；消息未发送') }
    },
    async capabilities() { return [{ operation: 'queue', priority: ['codex-app-server', 'codex-cli', ...(terminal ? ['terminal'] : [])] }, { operation: 'steer', priority: ['codex-app-server'] }, { operation: 'stop', priority: ['codex-app-server'] }] },
    async describe(session) {
      const target = await this.resolve(session)
      let active_turn_id = null, native_available = false
      try { const connection = await connected(); active_turn_id = (await currentTurn(connection, session.session_id))?.id ?? null; native_available = true } catch {}
      return { workspace: target.workspace, active_turn_id, native_available, operations: await this.capabilities() }
    },
    async reconcile(receipt) {
      const connection = await connected()
      const threadId = receipt.session.session_id
      if (receipt.operation === 'stop') {
        const page = await connection.request('thread/turns/list', { threadId, limit: 5, sortDirection: 'desc', itemsView: 'summary' })
        if (page?.data?.some(turn => turn.id === receipt.expected_turn_id && turn.status === 'interrupted')) return { kind: 'native_interrupted', turn_id: receipt.expected_turn_id }
        return null
      }
      let cursor = null
      for (let pageNumber = 0; pageNumber < 5; pageNumber += 1) {
        const page = await connection.request('thread/queue/list', { threadId, cursor, limit: 100 })
        const queued = page?.data?.find(row => row.clientUserMessageId === receipt.message_id)
        if (queued) return { kind: 'native_queued', native_message_id: queued.id }
        if (!page?.nextCursor || page.nextCursor === cursor) break
        cursor = page.nextCursor
      }
      const items = await connection.request('thread/items/list', { threadId, cursor: null, limit: 100, sortDirection: 'desc' })
      const item = items?.data?.find(entry => entry.item?.clientId === receipt.message_id)
      return item ? { kind: 'native_input_accepted', native_message_id: item.item.id } : null
    },
    close() { closed = true; client?.close() },
  }
}
