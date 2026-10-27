import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { DashboardApi } from '@/lib/api/dashboard-api'
import type { BrowserSession, SessionPage, SessionRef } from '@/lib/api/types'
import { queryKeys } from '@/lib/query/keys'
import { sessionKey } from './session-format'
import { sessionReadRequests } from './session-timeline-queue'

export function useNearViewport() {
  const anchor = useRef<HTMLSpanElement>(null)
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (!anchor.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setSeen(entry.isIntersecting), { rootMargin: '120px' })
    observer.observe(anchor.current)
    return () => observer.disconnect()
  }, [])
  return { anchor, seen }
}

export function SessionChildrenSource({ api, session, onData, expanded }: { api: DashboardApi; session: BrowserSession; expanded: boolean; onData: (key: string, pages: SessionPage[]) => void }) {
  const client = useQueryClient()
  const { anchor, seen } = useNearViewport()
  const children = useInfiniteQuery({
    queryKey: queryKeys.sessionChildren(session), initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => sessionReadRequests.run(() => api.sessionChildren(session, { cursor: pageParam }, signal), signal, expanded ? 'foreground' : 'background'),
    getNextPageParam: (page) => page.next_cursor ?? undefined, retry: false, enabled: seen || expanded, staleTime: 60_000, gcTime: 300_000, refetchOnWindowFocus: false,
  })
  useEffect(() => { if (!seen && !expanded) void client.cancelQueries({ queryKey: queryKeys.sessionChildren(session), exact: true }) }, [seen, expanded, client, session])
  useLayoutEffect(() => { if (children.data) onData(sessionKey(session), children.data.pages) }, [children.data, session, onData])
  useEffect(() => { if ((seen || expanded) && children.hasNextPage && !children.isFetching && !children.isError) void children.fetchNextPage() }, [seen, expanded, children.hasNextPage, children.isFetching, children.isError, children.fetchNextPage])
  return <span ref={anchor} className="session-tree__loading" aria-busy={children.isFetching || undefined}>{children.isError ? <span className="session-source-error" role="img" aria-label="子会话暂不可用" title={children.error.message}>!</span> : null}</span>
}


export function SessionAncestorSource({ api, reference, onData, onUnavailable }: { api: DashboardApi; reference: SessionRef; onData: (session: BrowserSession) => void; onUnavailable: (key: string) => void }) {
  const ancestor = useQuery({
    queryKey: queryKeys.sessionRead(reference),
    queryFn: ({ signal }) => sessionReadRequests.run(() => api.readSession(reference, signal), signal, 'background'),
    retry: false, staleTime: 60_000, gcTime: 300_000,
  })
  useLayoutEffect(() => { if (ancestor.data) onData(ancestor.data.session) }, [ancestor.data, onData])
  useEffect(() => { if (ancestor.isError) onUnavailable(sessionKey(reference)) }, [ancestor.isError, reference, onUnavailable])
  return null
}
