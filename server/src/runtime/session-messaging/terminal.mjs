import { unavailable, messageError, runCommand } from './common.mjs'

export function createTerminalMessageTransport({ command = runCommand, executable = 'otty', enabled = async () => false } = {}) {
  return {
    id: 'terminal', operations: ['queue'],
    async prepare(context) {
      if (!await enabled()) throw unavailable('未启用支持消息投递的终端适配')
      const result = await command(executable, ['pane', 'list', '--json'], { timeoutMs: 3000 })
      let rows
      try { rows = JSON.parse(result.stdout).data } catch { throw unavailable('终端会话目录不可用') }
      if (!Array.isArray(rows)) throw unavailable('终端会话目录格式不支持')
      const names = context.session.provider === 'codex' ? ['codex'] : ['claude', 'claude code']
      const matches = rows.filter(row => row.agent_session_id === context.session.session_id && names.includes(String(row.agent).toLowerCase()) && row.cwd === context.target.workspace)
      if (matches.length !== 1) throw unavailable('未找到唯一匹配的终端会话')
      if (matches[0].agent_state === 'awaiting') throw messageError('SESSION_MESSAGE_NEEDS_USER', '终端正在等待用户回答；没有注入消息')
      if (!['processing', 'idle'].includes(matches[0].agent_state)) throw unavailable('终端未报告可确认的 agent 状态')
      context.terminalPane = matches[0].id
    },
    async execute(operation, context) {
      try { await command(executable, ['pane', 'send-text', '--pane', context.terminalPane, '--no-escape', operation === 'queue' ? '--submit=queue' : '--submit=now', '--wait-secs', '2', '--', context.text], { timeoutMs: 5000, mutation: true }) } catch (error) {
        if ([4, 7, 9].includes(error.exitCode)) throw messageError('SESSION_MESSAGE_TERMINAL_REJECTED', '终端明确拒绝输入或未找到会话；消息未发送')
        throw error
      }
      return { kind: operation === 'queue' ? 'terminal_queued' : 'terminal_input_accepted', pane_id: context.terminalPane, native_message_id: null }
    },
  }
}
