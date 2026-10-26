import { useInfiniteQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ComboBox } from 'react-aria-components/ComboBox'

import { Input, InputGroup, InputGroupAddon } from '@/components/ui/input'
import { ListBox, ListBoxItem } from '@/components/ui/list-box'
import { Popover } from '@/components/ui/popover'
import type { DashboardApi } from '@/lib/api/dashboard-api'
import type { BrowserSession, SessionPage } from '@/lib/api/types'
import { queryKeys } from '@/lib/query/keys'
import { SessionActivity } from './session-activity'
import { Highlight, sessionKey } from './session-format'
import { SessionOrigin } from './session-origin'
import { AutoPager } from './session-auto-pager'

export function SessionSearch({ api, provider, workspace, branch = '', enabled, openIds, onSelect }: {
  api: DashboardApi; provider: string; workspace: string; enabled: boolean
  branch?: string
  openIds: Set<string>; onSelect: (session: BrowserSession, query: string) => void
}) {
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(draft.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [draft])
  const results = useInfiniteQuery({
    queryKey: queryKeys.sessionSearch(provider, workspace, query, false, branch),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.sessions(provider, { workspace, branch, query, cursor: pageParam }),
    getNextPageParam: (page: SessionPage) => page.next_cursor ?? undefined,
    enabled: enabled && Boolean(query), retry: false, gcTime: 0,
  })
  const sessions = useMemo(() => [...new Map((results.data?.pages ?? []).flatMap((page) => page.sessions)
    .map((session) => [sessionKey(session), session])).values()], [results.data])
  const waiting = draft.trim() !== query || results.isPending
  // React Aria caches each option by item identity, including its activity badge.
  const items = useMemo(() => waiting ? [] : sessions.map((session) => ({
    ...session, isOpen: openIds.has(session.session_id),
  })), [waiting, sessions, openIds])
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
        <div ref={list} className="session-search__collection">
        <ListBox className="session-search__results" items={items} renderEmptyState={() => (
          <div className="session-search__state" role={results.isError ? 'alert' : 'status'}>
            {results.isError ? results.error.message : waiting || results.hasNextPage ? <span className="session-spinner" aria-label="搜索中" /> : '没有找到匹配的会话'}
          </div>
        )}>
          {(session) => <ListBoxItem id={sessionKey(session)} textValue={session.title} className="session-search__item">
            <div className="session-search__result">
              <div className="session-search__title"><strong title={session.title}><Highlight text={session.title} query={query} /></strong><SessionActivity state={session.state} isOpen={session.isOpen} /><SessionOrigin workspace={session.workspace} branch={session.branch} /></div>
              <span className="session-row__preview"><Highlight text={session.snippet || session.preview} query={query} /></span>
            </div>
          </ListBoxItem>}
        </ListBox>
        <AutoPager observeLastWithin={list} enabled={Boolean(results.hasNextPage) && !results.isError && !waiting} loading={results.isFetching} onMore={() => results.fetchNextPage()} />
        </div>
      </Popover>
    </ComboBox>
  )
}
