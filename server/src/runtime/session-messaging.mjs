import { normalizeSessionReference, sessionReferenceKey } from '../session-reference.mjs'
import { messageError, MESSAGE_MODES } from './session-messaging/common.mjs'

export function createSessionMessaging({ providers, store, requestTimeoutMs = 25000 }) {
  const byId = new Map(providers.map(provider => [provider.id, provider]))
  const active = new Map(), lanes = new Map()
  let closed = false
  function providerFor(session) {
    const provider = byId.get(session.provider)
    if (!provider || session.store_id !== provider.storeId) throw messageError('SESSION_MESSAGE_REFERENCE_INVALID', '消息目标与本机已配置数据源不匹配')
    return provider
  }
  async function sources() {
    return { providers: await Promise.all(providers.map(async provider => ({ id: provider.id, store_id: provider.storeId,
      capabilities: await provider.capabilities().catch(() => []), data_root: provider.dataRoot }))) }
  }
  async function runChain(provider, operation, context, attempts) {
    const candidates = provider.transports.filter(transport => transport.operations.includes(operation))
    for (const transport of candidates) {
      if (Date.now() >= context.deadline) throw messageError('SESSION_MESSAGE_DEADLINE', '达到投递时限；没有再尝试备用通道')
      try {
        await transport.prepare(context, operation)
      } catch (error) {
        attempts.push({ transport: transport.id, operation, status: 'not_sent', code: error.code ?? 'SESSION_MESSAGE_UNAVAILABLE' })
        if (error.delivery === 'not_sent' && error.fallback === true) continue
        throw error
      }
      if (Date.now() >= context.deadline) throw messageError('SESSION_MESSAGE_DEADLINE', '通道准备超时；尚未投递消息')
      store.update(context.request_id, 'sending', { attempts })
      try {
        const result = await transport.execute(operation, context)
        attempts.push({ transport: transport.id, operation, status: 'accepted' })
        return { ...result, transport: transport.id }
      } catch (error) {
        attempts.push({ transport: transport.id, operation, status: error.delivery ?? 'unknown', code: error.code ?? 'SESSION_MESSAGE_UNKNOWN' })
        if (error.delivery === 'not_sent' && error.fallback === true) continue
        throw error
      }
    }
    throw messageError('SESSION_MESSAGE_UNSUPPORTED', '所有可用通道均不能完成此操作；消息未发送')
  }
  async function execute(input) {
    if (closed) throw messageError('SESSION_MESSAGE_UNAVAILABLE', '消息服务已关闭')
    const session = normalizeSessionReference(input.session)
    const provider = providerFor(session)
    const operation = input.operation ?? input.mode ?? 'queue'
    if (![...MESSAGE_MODES, 'stop', 'compact'].includes(operation)) throw messageError('SESSION_MESSAGE_INPUT_INVALID', '消息模式无效', { statusCode: 400 })
    if (typeof input.request_id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.request_id)) throw messageError('SESSION_MESSAGE_INPUT_INVALID', 'request_id 必须为 1–128 个字母、数字或 ._:-', { statusCode: 400 })
    const text = operation === 'stop' ? '' : operation === 'compact' ? input.instructions ?? '' : input.text
    if (typeof text !== 'string' || (!['stop', 'compact'].includes(operation) && !text.trim()) || text.length > 16000 || text.includes('\0')) throw messageError('SESSION_MESSAGE_INPUT_INVALID', '消息或压缩说明必须为最多 16000 字符', { statusCode: 400 })
    const expected_turn_id = input.expected_turn_id ?? null
    if (['steer', 'interrupt', 'stop'].includes(operation) && (typeof expected_turn_id !== 'string' || !expected_turn_id || expected_turn_id.length > 256)) throw messageError('SESSION_MESSAGE_INPUT_INVALID', '追加或打断必须指定 expected_turn_id', { statusCode: 400 })
    const canonical = { request_id: input.request_id, session, operation, text, expected_turn_id }
    if (active.size >= 100 && !active.has(input.request_id) && !store.get(input.request_id)) throw messageError('SESSION_MESSAGE_LIMIT', '投递请求达到并发上限，请稍后重试', { statusCode: 429 })
    const begun = store.begin(canonical)
    if (active.has(input.request_id)) return active.get(input.request_id)
    if (!begun.created && begun.receipt.status !== 'pending') {
      if (begun.receipt.status === 'unknown' && provider.reconcile) {
        const verified = await provider.reconcile(begun.receipt).catch(() => null)
        if (verified && !closed) return { delivery: store.update(input.request_id, 'accepted', { ...verified, ...(begun.receipt.interrupted_turn_id ? { interrupted_turn_id: begun.receipt.interrupted_turn_id } : {}), reconciled: true, attempts: begun.receipt.attempts ?? [] }), reused: true }
      }
      return { delivery: begun.receipt, reused: true }
    }
    const key = sessionReferenceKey(session)
    const previous = lanes.get(key) ?? Promise.resolve()
    const pending = previous.catch(() => {}).then(async () => {
      const attempts = []
      const context = { ...canonical, message_id: begun.receipt.message_id, deadline: Date.now() + requestTimeoutMs }
      let interrupted = null
      try {
        context.target = await provider.resolve(session)
        if (operation === 'interrupt' || operation === 'stop') interrupted = await runChain(provider, 'stop', context, attempts)
        const result = operation === 'stop' ? interrupted : await runChain(provider, operation === 'interrupt' ? 'queue' : operation, context, attempts)
        return { delivery: store.update(input.request_id, 'accepted', { ...result, ...(interrupted ? { interrupted_turn_id: expected_turn_id } : {}), attempts }), reused: false }
      } catch (error) {
        const status = error.delivery === 'not_sent' ? 'rejected' : 'unknown'
        return { delivery: store.update(input.request_id, status, { ...(interrupted ? { interrupted_turn_id: expected_turn_id } : {}), error: { code: error.code ?? 'SESSION_MESSAGE_UNKNOWN', message: error.delivery ? error.message : '投递结果未知，未自动重试' }, attempts }), reused: false }
      }
    })
    active.set(input.request_id, pending); lanes.set(key, pending)
    pending.finally(() => { active.delete(input.request_id); if (lanes.get(key) === pending) lanes.delete(key) }).catch(() => {})
    return pending
  }
  return {
    sources,
    async capabilities(input) {
      const session = normalizeSessionReference(input)
      const provider = providerFor(session)
      return { session, ...(await provider.describe(session)) }
    },
    send: execute,
    interrupt: input => execute({ ...input, operation: 'stop' }),
    compact: input => execute({ ...input, operation: 'compact' }),
    async delivery({ request_id }) {
      if (closed) throw messageError('SESSION_MESSAGE_UNAVAILABLE', '消息服务已关闭', { statusCode: 503 })
      if (typeof request_id !== 'string' || !request_id) throw messageError('SESSION_MESSAGE_INPUT_INVALID', '缺少 request_id', { statusCode: 400 })
      const delivery = store.get(request_id)
      if (!delivery) throw messageError('SESSION_MESSAGE_NOT_FOUND', '发送回执不存在', { statusCode: 404 })
      if (delivery.status === 'unknown' || (delivery.status === 'accepted' && delivery.operation === 'compact' && delivery.completed !== true)) {
        const verified = await providerFor(delivery.session).reconcile?.(delivery).catch(() => null)
        if (verified && !closed) return { delivery: store.update(request_id, 'accepted', { ...verified, ...(delivery.interrupted_turn_id ? { interrupted_turn_id: delivery.interrupted_turn_id } : {}), reconciled: true, attempts: delivery.attempts ?? [] }) }
      }
      return { delivery }
    },
    async close() { closed = true; for (const provider of providers) await provider.close?.(); await Promise.allSettled([...active.values()]); store.close() },
  }
}
