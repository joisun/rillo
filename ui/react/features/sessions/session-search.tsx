import { useInfiniteQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ComboBox } from 'react-aria-components/ComboBox'

import { Input, InputGroup, InputGroupAddon } from '@/components/ui/input'
import { ListBox, ListBoxItem } from '@/components/ui/list-box'
import { Popover } from '@/components/ui/popover'
import type { DashboardApi } from '@/lib/api/dashboard-api'
import type { BrowserSession, SessionActivityPage, SessionPage } from '@/lib/api/types'
import { queryKeys } from '@/lib/query/keys'
import { SessionActivity } from './session-activity'
import { Highlight, sessionKey } from './session-format'
import { SessionOrigin } from './session-origin'
import { sessionWithStatus } from './session-status'

export function SessionSearch({ api, provider, workspace, branch = '', enabled, activity, statuses, onSelect }: {
  api: DashboardApi; provider: string; workspace: string; enabled: boolean
  branch?: string
  activity: SessionActivityPage | undefined; statuses: Map<string, BrowserSession>; onSelect: (session: BrowserSession, query: string) => void
}) {
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(draft.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [draft])
  const results = useInfiniteQuery({
    queryKey: queryKeys.sessionSearch(provider, workspace, query, false, branch),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => api.sessions(provider, { workspace, branch, query, cursor: pageParam }, signal),
    getNextPageParam: (page: SessionPage) => page.next_cursor ?? undefined,
    enabled: enabled && Boolean(query), retry: false, gcTime: 0,
  })
  const sessions = useMemo(() => [...new Map((results.data?.pages ?? []).flatMap((page) => page.sessions)
    .map((session) => [sessionKey(session), session])).values()], [results.data])
  const waiting = draft.trim() !== query || results.isPending
  const { hasNextPage, isFetching, isError, fetchNextPage } = results
  useEffect(() => {
    if (!enabled || waiting || !hasNextPage || isFetching || isError) return
    void fetchNextPage({ cancelRefetch: false })
  }, [enabled, waiting, hasNextPage, isFetching, isError, fetchNextPage])
  const loading = waiting || (!results.isError && results.hasNextPage)
  const emptyMessage = results.isError ? results.error.message : '没有找到匹配的会话'
  // React Aria caches each option by item identity, including its activity badge.
  const items = useMemo(() => waiting ? [] : sessions.map(session => sessionWithStatus(session, activity, statuses)), [waiting, sessions, activity, statuses])
  return (
    <ComboBox className="session-search" aria-label="搜索会话正文" inputValue={draft} onInputChange={(value) => { setDraft(value); setSelectedKey(null) }}
      value={selectedKey} allowsCustomValue allowsEmptyCollection={Boolean(draft.trim())} items={items}
      isDisabled={!enabled} onChange={(key) => {
        setSelectedKey(key == null ? null : String(key))
        const selected = sessions.find((session) => sessionKey(session) === key)
        if (selected) onSelect(selected, query)
      }}>
      <InputGroup size="sm"><InputGroupAddon><Search /></InputGroupAddon><Input placeholder="搜索讨论过的内容…" maxLength={256} /></InputGroup>
      <Popover className="session-search__popover" placement="bottom start" offset={8}>
        <div className="session-search__collection">
        <ListBox className="session-search__results" items={items} renderEmptyState={() => (
          <div className="session-search__state" role={!waiting && results.isError ? 'alert' : 'status'}>
            {loading ? <span className="session-spinner" aria-label="搜索中" /> : emptyMessage}
          </div>
        )}>
          {(session) => <ListBoxItem id={sessionKey(session)} textValue={session.title} className="session-search__item">
            <div className="session-search__result">
              <div className="session-search__title"><SessionActivity session={session} /><strong title={session.title}><Highlight text={session.title} query={query} /></strong><SessionOrigin workspace={session.workspace} branch={session.branch} /></div>
              <span className="session-row__preview"><Highlight text={session.snippet || session.preview} query={query} /></span>
            </div>
          </ListBoxItem>}
        </ListBox>
        </div>
      </Popover>
    </ComboBox>
  )
}
