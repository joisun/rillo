import { useInfiniteQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Combobox } from '@base-ui/react/combobox'

import { Input, InputGroup, InputGroupAddon } from '@/components/ui/input'
import type { DashboardApi } from '@/lib/api/dashboard-api'
import type { BrowserSession, SessionActivityPage, SessionPage } from '@/lib/api/types'
import { queryKeys } from '@/lib/query/keys'
import { SessionActivity } from './session-activity'
import { Highlight, sessionKey } from './session-format'
import { SessionOrigin } from './session-origin'
import { sessionWithStatus } from './session-status'

export function SessionSearch({ api, provider, enabled, activity, statuses, onSelect }: {
  api: DashboardApi; provider: string; enabled: boolean
  activity: SessionActivityPage | undefined; statuses: Map<string, BrowserSession>; onSelect: (session: BrowserSession, query: string) => void
}) {
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(draft.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [draft])
  const results = useInfiniteQuery({
    queryKey: queryKeys.sessionSearch(provider, query, false),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => api.sessions(provider, { query, cursor: pageParam }, signal),
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
  const items = useMemo(() => waiting ? [] : sessions.map(session => sessionWithStatus(session, activity, statuses)), [waiting, sessions, activity, statuses])
  return (
    <div className="session-search">
    <Combobox.Root<BrowserSession> items={items} itemToStringLabel={session => session.title} itemToStringValue={sessionKey} filter={null} value={null} inputValue={draft}
      onInputValueChange={(value, details) => {
        if (details.reason === 'input-change' || details.reason === 'clear-press') setDraft(value)
      }}
      disabled={!enabled} onValueChange={(selected) => { if (selected) onSelect(selected, query) }}>
      <InputGroup size="sm"><InputGroupAddon><Search /></InputGroupAddon>
        <Combobox.Input render={<Input placeholder="全局搜索会话内容…" maxLength={256} aria-label="搜索会话正文" />} />
      </InputGroup>
      <Combobox.Portal><Combobox.Positioner className="ui-positioner" sideOffset={8} align="start">
      <Combobox.Popup className="session-search__popover ui-popover">
        <div className="session-search__collection">
          <Combobox.List className="session-search__results">
            {items.map(session => <Combobox.Item value={session} key={sessionKey(session)} className="session-search__item ui-option">
              <div className="session-search__result">
                <div className="session-search__title"><SessionActivity session={session} /><strong title={session.title}><Highlight text={session.title} query={query} /></strong><SessionOrigin workspace={session.workspace} branch={session.branch} /></div>
                <span className="session-row__preview"><Highlight text={session.snippet || session.preview} query={query} /></span>
              </div>
            </Combobox.Item>)}
            {!items.length ? <div className="session-search__state" role={!waiting && results.isError ? 'alert' : 'status'}>
              {loading ? <span className="session-spinner" aria-label="搜索中" /> : emptyMessage}
            </div> : null}
          </Combobox.List>
        </div>
      </Combobox.Popup>
      </Combobox.Positioner></Combobox.Portal>
    </Combobox.Root>
    </div>
  )
}
