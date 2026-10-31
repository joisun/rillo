import { Status, StatusIndicator, StatusLabel } from '@/components/kibo-ui/status'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { DashboardConnectionState } from '@/lib/events/dashboard-event-source'

const PRESENTATION = {
  open: {
    label: '实时连接正常',
    shortLabel: '实时',
    detail: 'Dashboard 会在 daemon 数据变化后自动刷新。',
  },
  connecting: {
    label: '正在恢复实时连接',
    shortLabel: '重连中',
    detail: '继续显示上一次数据，连接恢复后会自动同步。',
  },
  closed: {
    label: '实时连接已断开',
    shortLabel: '离线',
    detail: '当前页面不会自动刷新；请确认 daemon 和浏览器连接状态。',
  },
} satisfies Record<DashboardConnectionState, {
  label: string
  shortLabel: string
  detail: string
}>

export function ConnectionStatus({ state }: { state: DashboardConnectionState }) {
  const presentation = PRESENTATION[state]
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} />}>
      <Status status={state === 'open' ? 'online' : state === 'connecting' ? 'degraded' : 'offline'}
            className="connection-status"
            data-state={state}
            role="status"
            aria-label={presentation.label}
          >
            <StatusIndicator />
            <StatusLabel>{presentation.shortLabel}</StatusLabel>
      </Status>
      </TooltipTrigger>
      <TooltipContent>
        {presentation.detail}
      </TooltipContent>
    </Tooltip>
  )
}
