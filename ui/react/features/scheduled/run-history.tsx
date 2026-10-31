import { m } from 'motion/react'
import { transition } from '@/lib/motion'
import { Pill } from '@/components/kibo-ui/pill'
import type { RunDispatchRecord, RunRecord } from '@/lib/api/types'
import {
  compactDateTime,
  runDuration,
  runStatusLabel,
  triggerLabel,
} from './schedule-format'

function runTimestamp(run: RunRecord) {
  return Date.parse(run.finished_at ?? run.started_at ?? run.created_at) || 0
}

function sessionModeLabel(run: RunRecord) {
  if (run.session_mode === 'reuse') return `继承 ${run.inherit_run_number ?? 1}/${run.max_inherit_runs ?? 20}`
  if (run.session_mode_reason === 'inherit_limit') return '新建 · 上限'
  if (run.session_mode_reason === 'agent_choice') return '新建 · 自动'
  if (run.session_mode_reason === 'first_run') return '新建 · 首轮'
  return '新建'
}

function dispatchTimestamp(dispatch: RunDispatchRecord) {
  return Date.parse(dispatch.last_attempted_at ?? dispatch.requested_at ?? '') || 0
}

export function RunHistory({
  runs,
  dispatches,
  selectedRunId,
  onSelect,
}: {
  runs: RunRecord[]
  dispatches: RunDispatchRecord[]
  selectedRunId: string | null
  onSelect: (runId: string) => void
}) {
  const rows = [
    ...runs.map((run) => ({ kind: 'run' as const, timestamp: runTimestamp(run), run })),
    ...dispatches.map((dispatch) => ({
      kind: 'dispatch' as const,
      timestamp: dispatchTimestamp(dispatch),
      dispatch,
    })),
  ].sort((left, right) => right.timestamp - left.timestamp)

  if (!rows.length) {
    return <div className="run-history__empty">还没有执行记录</div>
  }

  return (
    <div className="run-history">
      <table role="grid" aria-label="执行历史">
        <thead>
          <tr>
            <th>状态</th>
            <th>开始</th>
            <th>耗时</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            if (row.kind === 'dispatch') {
              const { dispatch } = row
              return (
                <tr key={`dispatch-${dispatch.id}`} data-kind="dispatch">
                  <td>
                    <span className="run-history__status">
                      <i data-status={dispatch.status} aria-hidden="true" />
                      {runStatusLabel(dispatch.status)}
                    </span>
                    <small>{triggerLabel(dispatch.trigger)} · 未创建 Run</small>
                  </td>
                  <td>{compactDateTime(dispatch.last_attempted_at ?? dispatch.requested_at)}</td>
                  <td>—</td>
                </tr>
              )
            }

            const { run } = row
            return (
              <m.tr
                initial={false} animate={{ opacity: 1 }} transition={transition.fast}
                key={run.id}
                aria-label={`${runStatusLabel(run.status)}，${compactDateTime(run.started_at ?? run.created_at)}，${runDuration(run.started_at, run.finished_at)}`}
                aria-selected={run.id === selectedRunId}
                data-selected={run.id === selectedRunId || undefined}
                tabIndex={0}
                onClick={() => onSelect(run.id)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  onSelect(run.id)
                }}
              >
                <td>
                  <span className="run-history__status">
                    <i data-status={run.status} aria-hidden="true" />
                    {runStatusLabel(run.status)}
                    <Pill title={run.session_mode_reason === 'inherit_limit'
                      ? `已达到 ${run.max_inherit_runs ?? 20} 轮继承上限，本轮新建会话`
                      : run.thread_mode === 'auto' ? '配置为自动；此标签显示本轮实际使用的方式' : '本轮执行的会话方式'}>{sessionModeLabel(run)}</Pill>
                  </span>
                  <small>{triggerLabel(run.trigger)}{run.reviewed_at ? '' : ' · 未读'}</small>
                </td>
                <td>{compactDateTime(run.started_at ?? run.created_at)}</td>
                <td>{runDuration(run.started_at, run.finished_at)}</td>
              </m.tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
