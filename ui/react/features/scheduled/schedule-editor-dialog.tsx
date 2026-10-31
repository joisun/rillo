import { AlertTriangle, Info, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input, TextArea } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DashboardApiError, type DashboardApi } from '@/lib/api/dashboard-api'
import type { RuntimeStatus, RuntimeSettingsResponse, ScheduleRecord } from '@/lib/api/types'
import {
  changeDraftAgent,
  defaultScheduleDraft,
  draftToScheduleInput,
  normalizeModelCatalog,
  scheduleToDraft,
  type CadenceKind,
  type ModelOption,
  type ScheduleDraft,
} from './schedule-draft'

const WEEKDAYS = [
  [1, '一'], [2, '二'], [3, '三'], [4, '四'], [5, '五'], [6, '六'], [7, '日'],
] as const

type EditorPhase = 'loading' | 'ready' | 'saving' | 'deleting'
type CatalogState = 'loading' | 'ready' | 'error'

function editorError(error: unknown) {
  if (error instanceof DashboardApiError && error.code === 'SCHEDULE_VERSION_CONFLICT') {
    return 'Schedule 已在其他位置更新。当前输入已保留，请关闭后重新打开以载入最新版本。'
  }
  return error instanceof Error ? error.message : 'Schedule 保存失败'
}

function FieldHelp({ label, children }: { label: string; children: ReactNode }) {
  return <Tooltip>
    <TooltipTrigger render={<Button className="schedule-editor__info" isIconOnly size="xs" variant="quiet" aria-label={`${label}说明`} />}><Info aria-hidden="true" /></TooltipTrigger>
    <TooltipContent>{children}</TooltipContent>
  </Tooltip>
}

export function ScheduleEditorDialog({
  api,
  open,
  schedule,
  onOpenChange,
  onSaved,
}: {
  api: DashboardApi
  open: boolean
  schedule: ScheduleRecord | null
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void>
}) {
  const catalogRequest = useRef(0)
  const [draft, setDraft] = useState<ScheduleDraft>(defaultScheduleDraft)
  const [phase, setPhase] = useState<EditorPhase>('ready')
  const [error, setError] = useState('')
  const [etag, setEtag] = useState<string | null>(null)
  const [runtimes, setRuntimes] = useState<RuntimeStatus[]>([])
  const [catalog, setCatalog] = useState<ModelOption[]>([])
  const [catalogState, setCatalogState] = useState<CatalogState>('loading')
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [localSettings, setLocalSettings] = useState<RuntimeSettingsResponse | null>(null)
  const [settingsError, setSettingsError] = useState(false)
  const editing = Boolean(schedule)
  const busy = phase !== 'ready'

  useEffect(() => {
    if (!open || draft.agent !== 'codex') return
    let canceled = false
    let reading = false
    setLocalSettings(null)
    setSettingsError(false)
    const refresh = async () => {
      if (reading || document.visibilityState === 'hidden') return
      reading = true
      try {
        const value = await api.runtimeSettings(draft.agent, draft.workspace.trim() || undefined)
        if (!canceled) { setLocalSettings(value); setSettingsError(false) }
      } catch { if (!canceled) { setLocalSettings(null); setSettingsError(true) } }
      finally { reading = false }
    }
    const initial = window.setTimeout(() => { void refresh() }, 350)
    const interval = window.setInterval(() => { void refresh() }, 15_000)
    const focus = () => { void refresh() }
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    return () => {
      canceled = true
      window.clearTimeout(initial)
      window.clearInterval(interval)
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', focus)
    }
  }, [api, open, draft.agent, draft.workspace])

  const localCompact = localSettings?.auto_compact_token_limit
  const localCompactLabel = settingsError ? '暂时无法读取' : !localCompact ? '读取中…'
    : localCompact.configured_tokens == null ? '未设置，使用模型默认'
      : `${localCompact.configured_tokens.toLocaleString()} tokens`

  useEffect(() => {
    if (!open) return undefined
    let canceled = false
    const request = ++catalogRequest.current
    setPhase(schedule ? 'loading' : 'ready')
    setDraft(defaultScheduleDraft())
    setEtag(null)
    setError('')
    setDeleteArmed(false)
    setCatalog([])
    setCatalogState('loading')

    void (async () => {
      let nextDraft = defaultScheduleDraft()
      let nextRuntimes: RuntimeStatus[]
      try {
        const [runtimeResponse, scheduleResponse] = await Promise.all([
          api.runtimes(),
          schedule ? api.schedule(schedule.id) : Promise.resolve(null),
        ])
        nextRuntimes = runtimeResponse.runtimes
        if (!Array.isArray(nextRuntimes) || !nextRuntimes.length) throw new TypeError('Runtime registry 为空')
        if (scheduleResponse) {
          nextDraft = scheduleToDraft(scheduleResponse.job)
          if (!/^[0-9a-f]{64}$/.test(scheduleResponse.job.etag)) throw new TypeError('Schedule etag 无效')
          if (!canceled) setEtag(scheduleResponse.job.etag)
        } else if (!nextRuntimes.some(({ id }) => id === nextDraft.agent)) {
          nextDraft = changeDraftAgent(nextDraft, nextRuntimes[0].id)
        }
      } catch (caught) {
        if (canceled) return
        if (schedule) {
          setPhase('ready')
          setError(caught instanceof Error ? caught.message : '无法读取 Schedule')
          setCatalogState('error')
          return
        }
        nextRuntimes = [{ id: 'codex', display_name: 'Codex', state: 'unavailable' }]
      }
      if (canceled) return
      if (!nextRuntimes.some(({ id }) => id === nextDraft.agent)) {
        nextRuntimes = [...nextRuntimes, {
          id: nextDraft.agent,
          display_name: `${nextDraft.agent} · unavailable`,
          state: 'unavailable',
        }]
      }
      setRuntimes(nextRuntimes)
      setDraft((current) => {
        if (schedule) return nextDraft
        if (current.agent !== nextDraft.agent) return changeDraftAgent(current, nextDraft.agent)
        return current
      })
      setPhase('ready')
      try {
        const response = await api.runtimeModels(nextDraft.agent)
        const models = normalizeModelCatalog(response.models, nextDraft.agent)
        if (!canceled && request === catalogRequest.current) {
          setCatalog(models)
          setCatalogState('ready')
        }
      } catch {
        if (!canceled && request === catalogRequest.current) setCatalogState('error')
      }
    })()
    return () => { canceled = true; catalogRequest.current += 1 }
  }, [api, open, schedule?.id])

  const reasoningLevels = useMemo(() => {
    const selected = catalog.find(({ slug }) => slug === draft.model)
    return selected
      ? selected.reasoningLevels
      : [...new Set(catalog.flatMap(({ reasoningLevels: levels }) => levels))]
  }, [catalog, draft.model])
  const selectedRuntime = runtimes.find(({ id }) => id === draft.agent)
  const isolation = selectedRuntime?.capabilities?.contextIsolation as {
    skills?: boolean
    integrations?: boolean
  } | undefined

  function update<K extends keyof ScheduleDraft>(key: K, value: ScheduleDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    setError('')
    setDeleteArmed(false)
  }

  async function changeAgent(agent: string) {
    const request = ++catalogRequest.current
    setError('')
    setDeleteArmed(false)
    setDraft((current) => changeDraftAgent(current, agent))
    setCatalog([])
    setCatalogState('loading')
    try {
      const response = await api.runtimeModels(agent)
      if (request !== catalogRequest.current) return
      setCatalog(normalizeModelCatalog(response.models, agent))
      setCatalogState('ready')
    } catch {
      if (request !== catalogRequest.current) return
      setCatalogState('error')
    }
  }

  async function save() {
    if (busy) return
    let payload
    try {
      payload = draftToScheduleInput(draft, { modelCatalog: catalog })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '输入无效')
      return
    }
    setPhase('saving')
    setError('')
    try {
      if (schedule) {
        if (!etag) throw new TypeError('Schedule etag 不可用')
        await api.updateSchedule(schedule.id, etag, payload)
      } else {
        await api.createSchedule(payload)
      }
      await onSaved()
      onOpenChange(false)
    } catch (caught) {
      setError(editorError(caught))
      setPhase('ready')
    }
  }

  async function remove() {
    if (!schedule || !etag || busy) return
    if (!deleteArmed) {
      setDeleteArmed(true)
      return
    }
    setPhase('deleting')
    setError('')
    try {
      await api.deleteSchedule(schedule.id, etag)
      await onSaved()
      onOpenChange(false)
    } catch (caught) {
      setError(editorError(caught))
      setPhase('ready')
    }
  }

  const catalogNote = catalogState === 'loading'
    ? '正在读取本机 Runtime model catalog…'
    : catalogState === 'error'
      ? 'Model catalog 当前不可用；可以使用 Runtime default。'
      : ''

  return (
    <Dialog open={open} disablePointerDismissal={busy} onOpenChange={(nextOpen, details) => { if (busy) details.cancel(); else onOpenChange(nextOpen) }}>
        <DialogContent className="schedule-editor-dialog schedule-editor-modal" showCloseButton={!busy}>
          <DialogHeader className="schedule-editor__header">
            <DialogTitle>{editing ? '编辑计划' : '新建计划'}</DialogTitle>
          </DialogHeader>

          <DialogBody className="schedule-editor__body">
            {phase === 'loading' ? <div className="schedule-editor__loading" aria-busy="true">正在读取 Schedule…</div> : (
              <form id="schedule-editor-form" className="schedule-editor__form" onSubmit={(event) => {
                event.preventDefault()
                void save()
              }}>
                {error ? <div className="schedule-editor__error" role="alert">{error}</div> : null}

                <section className="schedule-editor__section">
                  <h3>任务内容</h3>
                  <div className="schedule-editor__field">
                    <FieldLabel htmlFor="schedule-title">任务名称</FieldLabel>
                    <Input autoFocus disabled={busy} id="schedule-title" maxLength={200} required placeholder="例如：工作日采集云效缺陷" size="sm" value={draft.title} onChange={(event) => update('title', event.currentTarget.value)} />
                  </div>
                  <div className="schedule-editor__field">
                    <FieldLabel htmlFor="schedule-prompt">任务指令</FieldLabel>
                    <TextArea disabled={busy} id="schedule-prompt" maxLength={20_000} required placeholder="描述 Agent 每次需要完成的任务…" value={draft.prompt} onChange={(event) => update('prompt', event.currentTarget.value)} />
                  </div>
                  <div className="schedule-editor__workspace">
                    <div className="schedule-editor__field">
                      <FieldLabel htmlFor="schedule-workspace">工作目录</FieldLabel>
                      <Input disabled={busy} id="schedule-workspace" maxLength={4_096} required placeholder="任务在服务本机的工作目录" size="sm" value={draft.workspace} onChange={(event) => update('workspace', event.currentTarget.value)} />
                    </div>
                    <div className="schedule-editor__field"><FieldLabel>Agent</FieldLabel><Select aria-label="Agent" disabled={busy} value={draft.agent} onValueChange={(key) => void changeAgent(String(key))}><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent>{runtimes.map((runtime) => <SelectItem value={runtime.id} key={runtime.id}>{runtime.display_name}</SelectItem>)}</SelectContent></Select></div>
                  </div>
                </section>

                <section className="schedule-editor__section">
                  <div className="schedule-editor__section-title">
                    <h3>执行时间</h3><span>服务所在时区</span>
                  </div>
                  <div className="schedule-editor__cadence">
                    <div className="schedule-editor__field">
                      <FieldLabel>执行频率</FieldLabel>
                      <Select aria-label="执行频率" disabled={busy} value={draft.cadenceKind} onValueChange={(key) => update('cadenceKind', String(key) as CadenceKind)}>
                        <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="once">仅一次</SelectItem><SelectItem value="hourly">每小时</SelectItem>
                          <SelectItem value="interval">每隔 N 分钟</SelectItem>
                          <SelectItem value="daily">每天</SelectItem><SelectItem value="weekly">每周</SelectItem>
                          <SelectItem value="monthly">每月</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {draft.cadenceKind === 'once' ? (
                      <div className="schedule-editor__field"><FieldLabel htmlFor="schedule-once">执行日期与时间</FieldLabel><Input disabled={busy} id="schedule-once" type="datetime-local" value={draft.onceAt} onChange={(event) => update('onceAt', event.currentTarget.value)} /></div>
                    ) : null}
                    {draft.cadenceKind === 'hourly' ? (
                      <div className="schedule-editor__field"><FieldLabel htmlFor="schedule-minute">每小时第几分钟</FieldLabel><Input disabled={busy} id="schedule-minute" max={59} min={0} type="number" value={draft.minute} onChange={(event) => update('minute', event.currentTarget.value)} /></div>
                    ) : null}
                    {draft.cadenceKind === 'interval' ? (
                      <div className="schedule-editor__field">
                        <FieldLabel htmlFor="schedule-interval">间隔（分钟）</FieldLabel>
                        <Input disabled={busy} id="schedule-interval" min={1} max={1440} step={1} type="number" value={draft.intervalMinutes} onChange={(event) => update('intervalMinutes', event.currentTarget.value)} />
                      </div>
                    ) : null}
                    {['daily', 'weekly', 'monthly'].includes(draft.cadenceKind) ? (
                      <div className="schedule-editor__inline">
                        <div className="schedule-editor__field"><FieldLabel htmlFor="schedule-hour">时</FieldLabel><Input disabled={busy} id="schedule-hour" max={23} min={0} type="number" value={draft.hour} onChange={(event) => update('hour', event.currentTarget.value)} /></div>
                        <div className="schedule-editor__field"><FieldLabel htmlFor="schedule-clock-minute">分</FieldLabel><Input disabled={busy} id="schedule-clock-minute" max={59} min={0} type="number" value={draft.minute} onChange={(event) => update('minute', event.currentTarget.value)} /></div>
                      </div>
                    ) : null}
                    {draft.cadenceKind === 'weekly' ? (
                      <div className="schedule-editor__weekdays" role="group" aria-label="Weekly days">
                        {WEEKDAYS.map(([day, label]) => <label key={day}><input checked={draft.weekdays.includes(day)} disabled={busy} type="checkbox" onChange={(event) => update('weekdays', event.currentTarget.checked ? [...draft.weekdays, day] : draft.weekdays.filter((value) => value !== day))} /><span>{label}</span></label>)}
                      </div>
                    ) : null}
                    {draft.cadenceKind === 'monthly' ? (
                      <div className="schedule-editor__field"><FieldLabel htmlFor="schedule-day">每月第几天</FieldLabel><Input disabled={busy} id="schedule-day" max={31} min={1} type="number" value={draft.day} onChange={(event) => update('day', event.currentTarget.value)} /></div>
                    ) : null}
                  </div>
                  {draft.cadenceKind !== 'once' ? (
                    <fieldset className="schedule-editor__work-hours">
                      <legend>工作时段</legend>
                      <Switch aria-label="限制工作时段" disabled={busy} checked={draft.workHoursEnabled} onCheckedChange={(selected) => update('workHoursEnabled', selected)}>仅在指定时段自动运行</Switch>
                      <fieldset className="schedule-editor__work-hours-fields" aria-label="工作时段设置" disabled={busy || !draft.workHoursEnabled}>
                        <div className="schedule-editor__weekdays" role="group" aria-label="工作时段适用星期">
                          {WEEKDAYS.map(([day, label]) => <label key={day}><input checked={draft.workWeekdays.includes(day)} disabled={busy} type="checkbox" onChange={(event) => update('workWeekdays', event.currentTarget.checked ? [...draft.workWeekdays, day] : draft.workWeekdays.filter((value) => value !== day))} /><span>{label}</span></label>)}
                        </div>
                        {draft.workWindows.map((window, index) => (
                          <div className="schedule-editor__work-window" key={index}>
                            <div className="schedule-editor__field"><FieldLabel htmlFor={`work-start-${index}`}>{`开始 ${index + 1}`}</FieldLabel><Input id={`work-start-${index}`} disabled={busy} inputMode="numeric" maxLength={5} placeholder="09:00" value={window.start} onChange={(event) => update('workWindows', draft.workWindows.map((item, itemIndex) => itemIndex === index ? { ...item, start: event.currentTarget.value } : item))} /></div>
                            <div className="schedule-editor__field"><FieldLabel htmlFor={`work-end-${index}`}>{`结束 ${index + 1}`}</FieldLabel><Input id={`work-end-${index}`} disabled={busy} inputMode="numeric" maxLength={5} placeholder="18:00" value={window.end} onChange={(event) => update('workWindows', draft.workWindows.map((item, itemIndex) => itemIndex === index ? { ...item, end: event.currentTarget.value } : item))} /></div>
                            <Button isIconOnly aria-label={`删除时段 ${index + 1}`} disabled={busy || draft.workWindows.length === 1} size="sm" type="button" variant="quiet" onClick={() => update('workWindows', draft.workWindows.filter((_, itemIndex) => itemIndex !== index))}><Trash2 /></Button>
                          </div>
                        ))}
                        <Button disabled={busy || draft.workWindows.length >= 24} size="sm" type="button" variant="secondary" onClick={() => update('workWindows', [...draft.workWindows, { start: '', end: '' }])}>添加时段</Button>
                      </fieldset>
                    </fieldset>
                  ) : null}
                </section>

                <section className="schedule-editor__section">
                  <h3>会话与上下文</h3>
                  <div className="schedule-editor__grid">
                    <div className="schedule-editor__field">
                      <div className="schedule-editor__field-label">
                        <FieldLabel>会话方式</FieldLabel>
                        <FieldHelp label="会话方式">{draft.thread_mode === 'auto'
                          ? '请在定时任务文档中写明何时新建、何时继承。首次新建，未作选择时默认继承。'
                          : '新建会话不带上轮上下文；继承会话首次新建，以后复用。恢复失败会报错。'}</FieldHelp>
                      </div>
                      <Select aria-label="会话方式" disabled={busy} value={draft.thread_mode} onValueChange={(value) => update('thread_mode', value as ScheduleDraft['thread_mode'])}>
                        <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="new">新建 · 每轮独立会话</SelectItem>
                          <SelectItem value="reuse">继承 · 首次新建，以后复用</SelectItem>
                          <SelectItem value="auto">自动 · 按任务文档规则选择</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {draft.thread_mode !== 'new' ? <div className="schedule-editor__field">
                        <FieldLabel htmlFor="schedule-inherit-limit">最大继承轮数（不含首次，满额新建）</FieldLabel>
                        <Input id="schedule-inherit-limit" disabled={busy} type="number" min={1} max={10000} required value={draft.maxInheritRuns} onChange={(event) => update('maxInheritRuns', event.currentTarget.value)} />
                    </div> : null}
                    {draft.agent === 'codex' ? <>
                      <div className="schedule-editor__field">
                        <div className="schedule-editor__field-label">
                          <FieldLabel>自动压缩触发阈值</FieldLabel>
                          <FieldHelp label="自动压缩">按上下文 token 用量触发压缩。跟随模式读取最新本地配置，自定义值仅对本任务生效。</FieldHelp>
                        </div>
                        <Select aria-label="自动压缩触发阈值" disabled={busy} value={draft.compactMode} onValueChange={(value) => update('compactMode', value as ScheduleDraft['compactMode'])}>
                          <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="inherit">{`跟随本地配置（${localCompactLabel}）`}</SelectItem>
                            <SelectItem value="custom">自定义 token 阈值</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {draft.compactMode === 'custom' ? <div className="schedule-editor__field">
                        <FieldLabel htmlFor="schedule-compact-tokens">自定义阈值（tokens）</FieldLabel>
                        <Input id="schedule-compact-tokens" disabled={busy} type="number" min={1000} max={10000000} required value={draft.autoCompactTokenLimit} onChange={(event) => update('autoCompactTokenLimit', event.currentTarget.value)} />
                      </div> : null}
                    </> : <p className="schedule-editor__hint">当前 Agent 的自动压缩跟随其本地配置，暂不支持自定义 token 阈值。</p>}
                  </div>
                </section>

                <section className="schedule-editor__section schedule-editor__advanced">
                  <h3>高级设置</h3>
                  <div className="schedule-editor__advanced-body">
                    <div className="schedule-editor__grid">
                      <div className="schedule-editor__field"><FieldLabel>Model</FieldLabel><Select aria-label="Model" disabled={busy || catalogState !== 'ready'} value={draft.model || 'default'} onValueChange={(key) => { const model = String(key) === 'default' ? '' : String(key); const selected = catalog.find(({ slug }) => slug === model); setDraft((current) => ({ ...current, model, reasoning_effort: selected && current.reasoning_effort && !selected.reasoningLevels.includes(current.reasoning_effort) ? '' : current.reasoning_effort })); setError('') }}><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="default">跟随本地默认</SelectItem>{catalog.map((model) => <SelectItem value={model.slug} key={model.slug}>{model.displayName} · {model.slug}</SelectItem>)}</SelectContent></Select></div>
                      <div className="schedule-editor__field"><FieldLabel>{draft.agent === 'opencode' ? 'Variant' : 'Reasoning'}</FieldLabel><Select aria-label={draft.agent === 'opencode' ? 'Variant' : 'Reasoning'} disabled={busy || catalogState !== 'ready'} value={draft.reasoning_effort || 'default'} onValueChange={(key) => update('reasoning_effort', String(key) === 'default' ? '' : String(key))}><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="default">跟随本地默认</SelectItem>{reasoningLevels.map((level) => <SelectItem value={level} key={level}>{level}</SelectItem>)}</SelectContent></Select></div>
                      {draft.agent === 'codex' && <div className="schedule-editor__field"><FieldLabel>Fast mode</FieldLabel><Select aria-label="Fast mode" disabled={busy} value={draft.fast_mode || 'inherit'} onValueChange={(key) => update('fast_mode', String(key) === 'inherit' ? '' : String(key) as 'on' | 'off')}><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="inherit">跟随 Codex 默认</SelectItem><SelectItem value="on">开启</SelectItem><SelectItem value="off">关闭（普通速度）</SelectItem></SelectContent></Select></div>}
                      <div className="schedule-editor__field"><FieldLabel htmlFor="schedule-timeout">Timeout (seconds)</FieldLabel><Input disabled={busy} id="schedule-timeout" max={86_400} min={60} type="number" value={draft.timeout_seconds} onChange={(event) => update('timeout_seconds', event.currentTarget.value)} /></div>
                    </div>
                    {catalogNote ? <p className="schedule-editor__catalog-note" data-state={catalogState}>{catalogNote}</p> : null}
                    <div className="schedule-editor__grid">
                      <div className="schedule-editor__field"><FieldLabel>Sandbox</FieldLabel><Select aria-label="Sandbox" disabled={busy} value={draft.sandbox_mode} onValueChange={(key) => update('sandbox_mode', String(key) as ScheduleRecord['sandbox_mode'])}><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent>{draft.agent !== 'opencode' && <SelectItem value="read-only">read-only</SelectItem>}{draft.agent !== 'opencode' && <SelectItem value="workspace-write">workspace-write</SelectItem>}<SelectItem value="danger-full-access">danger-full-access</SelectItem></SelectContent></Select></div>
                      {draft.agent === 'codex' && <div className="schedule-editor__field"><div className="schedule-editor__field-label"><FieldLabel>沙箱网络访问</FieldLabel><FieldHelp label="沙箱网络访问">仅适用于 workspace-write。联网任务需允许网络访问，后台运行不会弹出授权。</FieldHelp></div><Select aria-label="沙箱网络访问" disabled={busy} value={draft.network_access || 'inherit'} onValueChange={(key) => update('network_access', String(key) === 'inherit' ? '' : String(key) as 'on' | 'off')}><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="inherit">跟随 Codex 默认</SelectItem><SelectItem value="on">允许</SelectItem><SelectItem value="off">禁止</SelectItem></SelectContent></Select></div>}
                    </div>
                    <div className="schedule-editor__context" aria-label="Agent context">
                      <div className="schedule-editor__context-heading">
                        <strong>Context</strong>
                        <FieldHelp label="扩展能力">控制 Skills、MCP、Apps 和 plugin tools 的加载，不影响 Web Search 和 Codex 内置工具。</FieldHelp>
                      </div>
                      <Switch
                        aria-label="Load Skills"
                        disabled={busy || draft.agent === 'opencode' || isolation?.skills !== true}
                        checked={draft.loadSkills}
                        onCheckedChange={(selected) => update('loadSkills', selected)}
                      >
                        <span>Load Skills</span>
                      </Switch>
                      <Switch
                        aria-label="Load integrations"
                        disabled={busy || draft.agent === 'opencode' || isolation?.integrations !== true}
                        checked={draft.loadIntegrations}
                        onCheckedChange={(selected) => update('loadIntegrations', selected)}
                      >
                        <span>Load integrations</span>
                      </Switch>
                      {draft.agent === 'opencode' ? <p>OpenCode 当前继承本机 Skills 和 MCP 配置，暂不支持单独禁用；执行没有操作系统沙箱，文件和网络访问不受隔离。</p> : null}
                    </div>
                  </div>
                  {draft.sandbox_mode === 'workspace-write' ? <p className="schedule-editor__warning"><AlertTriangle aria-hidden="true" />Agent 可以修改 Workspace 内的文件。</p> : null}
                  {draft.sandbox_mode === 'danger-full-access' ? <label className="schedule-editor__danger"><input checked={draft.dangerConfirmed} disabled={busy} type="checkbox" onChange={(event) => update('dangerConfirmed', event.currentTarget.checked)} /><span>我理解 Agent 将不受文件系统 sandbox 限制。</span></label> : null}
                </section>
              </form>
            )}
          </DialogBody>

          <DialogFooter className="schedule-editor__footer">
            {schedule ? <Button disabled={busy} isPending={phase === 'deleting'} size="sm" variant={deleteArmed ? 'danger' : 'quiet'} onClick={() => void remove()}><Trash2 aria-hidden="true" />{deleteArmed ? '确认删除' : '删除'}</Button> : <span />}
            <div />
            <Button disabled={busy} size="sm" variant="quiet" onClick={() => onOpenChange(false)}>取消</Button>
            <Button form="schedule-editor-form" disabled={busy} isPending={phase === 'saving'} size="sm" type="submit" variant="primary">保存计划</Button>
          </DialogFooter>
        </DialogContent>
    </Dialog>
  )
}
