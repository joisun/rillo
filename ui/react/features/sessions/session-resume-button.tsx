import { useMutation } from '@tanstack/react-query'
import { Check, Terminal } from 'lucide-react'
import { useEffect } from 'react'

import { Button } from '@/components/ui/button'
import type { DashboardApi } from '@/lib/api/dashboard-api'
import type { BrowserSession } from '@/lib/api/types'

export function SessionResumeButton({ api, session }: { api: DashboardApi; session: BrowserSession }) {
  const resume = useMutation({ mutationFn: () => api.resumeSession(session) })
  useEffect(() => {
    if (!resume.isSuccess) return
    const timer = window.setTimeout(() => resume.reset(), 2500)
    return () => window.clearTimeout(timer)
  }, [resume.isSuccess, resume.reset])
  return <span className="session-row-resume" title={session.state === 'active' ? '正在执行，请返回已有终端' : '在终端继续会话'}>
    <Button size="xs" variant="secondary" isIconOnly aria-label={`在终端继续：${session.title}`}
      isDisabled={session.state === 'active' || session.state === 'unavailable'} isPending={resume.isPending} onPress={() => resume.mutate()}>
      {resume.isSuccess ? <Check /> : <Terminal />}
    </Button>
    {resume.isSuccess ? <span className="session-row-resume__feedback" role="status">已在 {resume.data.terminal_label} 打开</span> : null}
    {resume.isError ? <span className="session-row-resume__feedback session-error" role="alert">{resume.error.message}</span> : null}
  </span>
}
