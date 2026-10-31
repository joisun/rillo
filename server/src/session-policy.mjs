export const THREAD_MODES = new Set(['new', 'reuse', 'auto'])

export function validAutoCompactLimit(value) {
  return value == null || (Number.isSafeInteger(value) && value >= 1_000 && value <= 10_000_000)
}

export function validInheritanceLimit(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 10000
}

export function nextSessionMode(run) {
  if (run?.status !== 'succeeded') return 'reuse'
  const match = /<!-- rillo:next-session=(new|reuse) -->\s*$/.exec(run.final_message ?? '')
  return match?.[1] ?? 'reuse'
}

export function scheduleExecutionPrompt(schedule) {
  if (schedule.thread_mode !== 'auto') return schedule.prompt
  return `${schedule.prompt}\n\n<rillo-session-policy>\n这是定时任务的一轮执行。请完成本轮工作后，根据下一轮是否需要当前上下文，决定下一轮使用新会话还是继承当前会话。在最终结果末尾单独输出一个标记：\n<!-- rillo:next-session=reuse --> 表示下一轮继承当前会话；\n<!-- rillo:next-session=new --> 表示下一轮新建会话。\n不要修改任务定义或删除历史会话。未输出有效标记时默认继承；本轮失败时不采纳新决定。\n</rillo-session-policy>`
}
