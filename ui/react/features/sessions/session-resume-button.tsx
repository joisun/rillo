import { useMutation } from '@tanstack/react-query'
import { Check, Terminal } from 'lucide-react'
import { useEffect } from 'react'

import { Button } from '@/components/ui/button'
import type { DashboardApi } from '@/lib/api/dashboard-api'
import type { BrowserSession } from '@/lib/api/types'

const resumeFeedback = {
  focused: (terminal: string) => `已切换到 ${terminal} 会话`,
  new_tab: (terminal: string) => `已在 ${terminal} 新建标签页`,
  new_window: (terminal: string) => `已在 ${terminal} 新建窗口`,
}

export function SessionResumeButton({ api, session }: { api: DashboardApi; session: BrowserSession }) {
  const resume = useMutation({ mutationFn: () => api.resumeSession(session) })
  useEffect(() => {
    if (!resume.isSuccess) return
    const timer = window.setTimeout(() => resume.reset(), 2500)
    return () => window.clearTimeout(timer)
  }, [resume.isSuccess, resume.reset])
  return <span className="session-row-resume" title={session.state === 'active' ? '定位正在执行的会话' : '在终端继续会话'}>
    <Button size="xs" variant="secondary" isIconOnly aria-label={`在终端继续：${session.title}`}
      disabled={session.state === 'unavailable'} isPending={resume.isPending} onClick={() => resume.mutate()}>
      {resume.isSuccess ? <Check /> : <Terminal />}
    </Button>
    {resume.isSuccess ? <span className="session-row-resume__feedback" role="status">{resume.data.action ? resumeFeedback[resume.data.action](resume.data.terminal_label) : `已在 ${resume.data.terminal_label} 打开`}</span> : null}
    {resume.isError ? <span className="session-row-resume__feedback session-error" role="alert">{resume.error.message}</span> : null}
  </span>
}
