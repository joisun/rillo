import type {
  RuntimeModel,
  ScheduleCadence,
  ScheduleMutationInput,
  ScheduleRecord,
} from '@/lib/api/types'

const CADENCE_KINDS = new Set(['once', 'interval', 'hourly', 'daily', 'weekly', 'monthly'])
const SANDBOX_MODES = new Set(['read-only', 'workspace-write', 'danger-full-access'])
const MODEL_SLUG = /^[a-z0-9][a-z0-9._-]{0,127}$/
const REASONING_LEVEL = /^[a-z][a-z0-9_-]{0,15}$/
const OPENCODE_MODEL = /^(?=.{1,256}$)[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9~][A-Za-z0-9._:/~-]*$/
const OPENCODE_VARIANT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const AGENT_ID = /^[a-z][a-z0-9-]{0,63}$/

export type CadenceKind = ScheduleCadence['kind']

export interface ScheduleDraft {
  title: string
  prompt: string
  workspace: string
  agent: string
  thread_mode: 'new' | 'reuse' | 'auto'
  compactMode: 'inherit' | 'custom'
  autoCompactTokenLimit: string
  maxInheritRuns: string
  cadenceKind: CadenceKind
  intervalMinutes: string
  workHoursEnabled: boolean
  workWeekdays: number[]
  workWindows: { start: string; end: string }[]
  onceAt: string
  minute: string
  hour: string
  weekdays: number[]
  day: string
  sandbox_mode: ScheduleRecord['sandbox_mode']
  dangerConfirmed: boolean
  model: string
  reasoning_effort: string
  fast_mode: '' | 'on' | 'off'
  network_access: '' | 'on' | 'off'
  timeout_seconds: string
  loadSkills: boolean
  loadIntegrations: boolean
}

export interface ModelOption {
  slug: string
  displayName: string
  description: string
  defaultReasoning: string
  reasoningLevels: string[]
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function boundedText(value: unknown, name: string, limit: number) {
  const normalized = text(value)
  if (!normalized) throw new TypeError(`${name} 不能为空`)
  if (normalized.length > limit) throw new TypeError(`${name} 不能超过 ${limit} 个字符`)
  return normalized
}

function safeModelSlug(value: unknown, agent = 'codex') {
  const normalized = text(value)
  return (agent === 'opencode' ? OPENCODE_MODEL : MODEL_SLUG).test(normalized) ? normalized : ''
}

function safeReasoningLevel(value: unknown, agent = 'codex') {
  const normalized = text(value)
  return (agent === 'opencode' ? OPENCODE_VARIANT : REASONING_LEVEL).test(normalized) ? normalized : ''
}

function integer(value: unknown, name: string, minimum: number, maximum: number) {
  const normalized = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(normalized) || Number(normalized) < minimum || Number(normalized) > maximum) {
    throw new TypeError(`${name} 必须是 ${minimum}–${maximum} 之间的整数`)
  }
  return Number(normalized)
}

function normalizedWeekdays(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))]
    .sort((left, right) => left - right)
}

function dateTimeLocal(value: unknown) {
  if (!value) return ''
  const date = new Date(String(value))
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function onceInstant(value: unknown) {
  const source = text(value)
  if (!source) throw new TypeError('请选择执行日期和时间')
  const date = new Date(source)
  if (!Number.isFinite(date.getTime())) throw new TypeError('执行日期和时间无效')
  return date.toISOString()
}

export function defaultScheduleDraft(): ScheduleDraft {
  return {
    title: '', prompt: '', workspace: '', agent: 'codex', cadenceKind: 'daily',
    thread_mode: 'new', compactMode: 'inherit', autoCompactTokenLimit: '',
    maxInheritRuns: '20',
    intervalMinutes: '10', workHoursEnabled: false, workWeekdays: [1, 2, 3, 4, 5],
    workWindows: [{ start: '09:00', end: '18:00' }],
    onceAt: '', minute: '0', hour: '9', weekdays: [1], day: '1',
    sandbox_mode: 'read-only', dangerConfirmed: false, model: '',
    reasoning_effort: '', fast_mode: '', network_access: '', timeout_seconds: '7200',
    loadSkills: false, loadIntegrations: false,
  }
}

export function changeDraftAgent(draft: ScheduleDraft, agent: string): ScheduleDraft {
  return {
    ...draft, agent, model: '', reasoning_effort: '', fast_mode: '', network_access: '',
    compactMode: 'inherit', autoCompactTokenLimit: '',
    sandbox_mode: agent === 'opencode' ? 'danger-full-access' : 'read-only',
    dangerConfirmed: false,
    loadSkills: agent === 'opencode',
    loadIntegrations: agent === 'opencode',
  }
}

export function scheduleToDraft(source: Partial<ScheduleRecord> = {}): ScheduleDraft {
  const cadence = source.cadence ?? { kind: 'daily', hour: 9, minute: 0 }
  const cadenceKind = CADENCE_KINDS.has(cadence.kind) ? cadence.kind : 'daily'
  const minute = 'minute' in cadence ? cadence.minute : 0
  const hour = 'hour' in cadence ? cadence.hour : 9
  const day = 'day' in cadence ? cadence.day : 1
  const weekdays = 'weekdays' in cadence ? normalizedWeekdays(cadence.weekdays) : []
  const workHours = 'work_hours' in cadence ? cadence.work_hours : undefined
  return {
    ...defaultScheduleDraft(),
    title: text(source.title),
    prompt: text(source.prompt),
    workspace: text(source.workspace),
    agent: AGENT_ID.test(text(source.agent)) ? text(source.agent) : 'codex',
    thread_mode: ['new', 'reuse', 'auto'].includes(source.thread_mode ?? '') ? source.thread_mode! : 'new',
    compactMode: source.auto_compact_token_limit == null ? 'inherit' : 'custom',
    autoCompactTokenLimit: source.auto_compact_token_limit == null ? '' : String(source.auto_compact_token_limit),
    maxInheritRuns: String(source.max_inherit_runs ?? 20),
    cadenceKind,
    intervalMinutes: cadence.kind === 'interval' ? String(cadence.minutes) : '10',
    workHoursEnabled: Boolean(workHours),
    workWeekdays: workHours ? [...workHours.weekdays] : [1, 2, 3, 4, 5],
    workWindows: workHours ? workHours.windows.map((window) => ({ ...window })) : [{ start: '09:00', end: '18:00' }],
    onceAt: 'at' in cadence ? dateTimeLocal(cadence.at) : '',
    minute: String(Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : 0),
    hour: String(Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 9),
    weekdays: weekdays.length ? weekdays : [1],
    day: String(Number.isInteger(day) && day >= 1 && day <= 31 ? day : 1),
    sandbox_mode: SANDBOX_MODES.has(source.sandbox_mode ?? '')
      ? source.sandbox_mode as ScheduleRecord['sandbox_mode']
      : 'read-only',
    model: safeModelSlug(source.model, source.agent),
    reasoning_effort: safeReasoningLevel(source.reasoning_effort, source.agent),
    network_access: source.network_access == null ? '' : source.network_access ? 'on' : 'off',
    fast_mode: source.fast_mode == null ? '' : source.fast_mode ? 'on' : 'off',
    timeout_seconds: String(Number.isSafeInteger(source.timeout_seconds)
      && Number(source.timeout_seconds) >= 60 && Number(source.timeout_seconds) <= 86_400
      ? source.timeout_seconds : 7_200),
    loadSkills: source.capabilities?.skills !== 'disabled',
    loadIntegrations: source.capabilities?.integrations !== 'disabled',
  }
}

export function normalizeModelCatalog(value: RuntimeModel[], agent = 'codex'): ModelOption[] {
  if (!Array.isArray(value) || value.length > (agent === 'opencode' ? 2000 : 100)) throw new TypeError('Runtime model catalog 响应无效')
  const seen = new Set<string>()
  return value.map((item) => {
    const slug = safeModelSlug(item.id ?? item.slug, agent)
    const displayName = text(item.displayName ?? item.display_name ?? slug)
    const description = text(item.description)
    const sourceLevels = item.reasoningLevels ?? item.supported_reasoning_levels ?? []
    if (!slug || seen.has(slug) || !displayName || displayName.length > 128
      || description.length > 512 || !Array.isArray(sourceLevels) || sourceLevels.length > 16) {
      throw new TypeError('Runtime model catalog 响应无效')
    }
    seen.add(slug)
    const reasoningLevels = sourceLevels.map((level) => safeReasoningLevel(level, agent))
    if (reasoningLevels.some((level) => !level) || new Set(reasoningLevels).size !== reasoningLevels.length) {
      throw new TypeError('Runtime model catalog 响应无效')
    }
    const defaultReasoning = safeReasoningLevel(
      item.defaultReasoningLevel ?? item.default_reasoning_level, agent,
    )
    if (defaultReasoning && !reasoningLevels.includes(defaultReasoning)) {
      throw new TypeError('Runtime model catalog 响应无效')
    }
    return { slug, displayName, description, defaultReasoning, reasoningLevels }
  })
}

export function draftToScheduleInput(
  draft: ScheduleDraft,
  { modelCatalog = [] }: { modelCatalog?: ModelOption[] } = {},
): ScheduleMutationInput {
  if (!CADENCE_KINDS.has(draft.cadenceKind)) throw new TypeError('执行频率无效')
  if (!['new', 'reuse', 'auto'].includes(draft.thread_mode)) throw new TypeError('会话方式无效')
  if (!['inherit', 'custom'].includes(draft.compactMode)) throw new TypeError('自动压缩方式无效')
  if (draft.compactMode === 'custom' && draft.agent !== 'codex') throw new TypeError('当前仅 Codex 支持自定义自动压缩 token 阈值')
  if (!SANDBOX_MODES.has(draft.sandbox_mode)) throw new TypeError('Sandbox mode 无效')
  if (draft.sandbox_mode === 'danger-full-access' && !draft.dangerConfirmed) {
    throw new TypeError('使用 danger-full-access 前需要明确确认风险')
  }

  if (draft.agent === 'opencode' && draft.sandbox_mode !== 'danger-full-access') {
    throw new TypeError('OpenCode 不提供操作系统沙箱，只支持 danger-full-access')
  }
  if (draft.agent === 'opencode' && (!draft.loadSkills || !draft.loadIntegrations)) {
    throw new TypeError('OpenCode 当前仅支持继承 Skills 和 integrations')
  }

  let cadence: ScheduleCadence
  if (draft.cadenceKind === 'once') {
    cadence = { kind: 'once', at: onceInstant(draft.onceAt), timezone_mode: 'system' }
  } else if (draft.cadenceKind === 'interval') {
    cadence = { kind: 'interval', minutes: integer(draft.intervalMinutes, '间隔分钟', 1, 1440), timezone_mode: 'system' }
  } else if (draft.cadenceKind === 'hourly') {
    cadence = {
      kind: 'hourly', minute: integer(draft.minute, 'Minute', 0, 59), timezone_mode: 'system',
    }
  } else {
    const clock = {
      hour: integer(draft.hour, 'Hour', 0, 23),
      minute: integer(draft.minute, 'Minute', 0, 59),
      timezone_mode: 'system' as const,
    }
    if (draft.cadenceKind === 'weekly') {
      const weekdays = normalizedWeekdays(draft.weekdays)
      if (!weekdays.length) throw new TypeError('每周计划至少选择一天')
      cadence = { kind: 'weekly', ...clock, weekdays }
    } else if (draft.cadenceKind === 'monthly') {
      cadence = { kind: 'monthly', ...clock, day: integer(draft.day, 'Day', 1, 31) }
    } else {
      cadence = { kind: 'daily', ...clock }
    }
  }

  if (cadence.kind !== 'once' && draft.workHoursEnabled) {
    const weekdays = normalizedWeekdays(draft.workWeekdays)
    if (!weekdays.length) throw new TypeError('工作时段至少选择一天')
    const minute = (value: string, end = false) => {
      if (end && value === '24:00') return 1440
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new TypeError('工作时段请使用 HH:mm，结束时间可填 24:00')
      const [hour, part] = value.split(':').map(Number)
      return hour * 60 + part
    }
    if (!draft.workWindows.length || draft.workWindows.length > 24) throw new TypeError('请设置 1–24 个工作时段')
    const windows = draft.workWindows.map(({ start, end }) => {
      if (minute(start) >= minute(end, true)) throw new TypeError('工作时段结束时间须晚于开始时间，跨天请拆成两段')
      return { start, end }
    }).sort((a, b) => a.start.localeCompare(b.start))
    for (let index = 1; index < windows.length; index += 1) {
      if (minute(windows[index].start) < minute(windows[index - 1].end, true)) throw new TypeError('工作时段不能重叠')
    }
    if (cadence.kind === 'weekly' && !cadence.weekdays.some((day) => weekdays.includes(day))) {
      throw new TypeError('每周执行日期与工作时段至少需要有一天重合')
    }
    let slots: number[] = []
    if (cadence.kind === 'hourly') slots = Array.from({ length: 24 }, (_, hour) => hour * 60 + cadence.minute)
    else if (cadence.kind !== 'interval') slots = [cadence.hour * 60 + cadence.minute]
    if (cadence.kind !== 'interval' && !slots.some((slot) => windows.some((window) => slot >= minute(window.start) && slot < minute(window.end, true)))) {
      throw new TypeError('执行时间不在任何工作时段内')
    }
    cadence.work_hours = { weekdays, windows }
  }

  const model = text(draft.model)
  const reasoningEffort = text(draft.reasoning_effort)
  if (model && !safeModelSlug(model, draft.agent)) throw new TypeError('Model 无效')
  if (reasoningEffort && !safeReasoningLevel(reasoningEffort, draft.agent)) throw new TypeError('Reasoning 无效')
  if (modelCatalog.length) {
    const selected = model ? modelCatalog.find((item) => item.slug === model) : null
    if (model && !selected) throw new TypeError('所选 Model 当前不可用')
    const supported = !reasoningEffort || (selected
      ? selected.reasoningLevels.includes(reasoningEffort)
      : modelCatalog.some((item) => item.reasoningLevels.includes(reasoningEffort)))
    if (!supported) throw new TypeError('所选 Model 不支持该 Reasoning level')
  }

  return {
    title: boundedText(draft.title, 'Title', 200),
    prompt: boundedText(draft.prompt, 'Prompt', 20_000),
    workspace: boundedText(draft.workspace, 'Workspace', 4_096),
    agent: AGENT_ID.test(text(draft.agent)) ? text(draft.agent) : 'codex',
    thread_mode: draft.thread_mode,
    max_inherit_runs: integer(draft.maxInheritRuns, '最大继承轮数', 1, 10000),
    auto_compact_token_limit: draft.compactMode === 'custom' ? integer(draft.autoCompactTokenLimit, '自动压缩 token 阈值', 1000, 10000000) : null,
    cadence,
    sandbox_mode: draft.sandbox_mode,
    model: model || null,
    reasoning_effort: reasoningEffort || null,
    network_access: draft.agent !== 'codex' || !draft.network_access ? null : draft.network_access === 'on',
    fast_mode: draft.agent !== 'codex' || !draft.fast_mode ? null : draft.fast_mode === 'on',
    timeout_seconds: integer(draft.timeout_seconds, 'Timeout', 60, 86_400),
    capabilities: {
      skills: draft.loadSkills ? 'inherit' : 'disabled',
      integrations: draft.loadIntegrations ? 'inherit' : 'disabled',
    },
  }
}
