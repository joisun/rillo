import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Folder, FolderOpen, GitBranch, MessagesSquare, RefreshCw, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tab, TabList, TabPanel, Tabs } from '@/components/ui/tabs'
import type { DashboardApi } from '@/lib/api/dashboard-api'
import type { BrowserSession, SessionBranchPage, SessionPage, SessionRef, SessionWorkspacePage } from '@/lib/api/types'
import { queryKeys } from '@/lib/query/keys'
import { persistSessionsGroup, persistSessionsView, readSessionsGroup, readSessionsView, type SessionGroupMode } from '@/lib/preferences/dashboard-preferences'
import { SessionDetail } from './session-detail'
import { AutoPager } from './session-auto-pager'
import { isSessionBlockingError, useSessionConnectionError } from './session-health'
import { SessionActivity } from './session-activity'
import { SessionSearch } from './session-search'
import { SessionOrigin } from './session-origin'
import { activityDay, activityTime, sessionKey } from './session-format'
import { SessionActivityView } from './session-activity-view'
import { SessionResumeButton } from './session-resume-button'
import './sessions.css'
import type { TimelineLoadRequest } from './session-timeline-queue'

export function SessionsView({ api }: { api: DashboardApi }) {
  const client = useQueryClient()
  const connectionError = useSessionConnectionError()
  const reconnect = () => client.refetchQueries({ queryKey: queryKeys.sessionBrowser, type: 'active', predicate: query => isSessionBlockingError(query.queryKey, query.state.error) && query.state.fetchStatus === 'idle' }, { cancelRefetch: false })
  useEffect(() => {
    if (!connectionError) return
    const timer = window.setInterval(() => void reconnect(), 3000)
    return () => window.clearInterval(timer)
  }, [connectionError, client])
  const [sourceId, setSourceId] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [branch, setBranch] = useState('')
  const [groupPreference, setGroupPreference] = useState(readSessionsGroup)
  const [directoryQuery, setDirectoryQuery] = useState('')
  const [catalogPickerOpen, setCatalogPickerOpen] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const [selection, setSelection] = useState<{ session: BrowserSession; query: string; at: string | null; itemId?: string; followRequest?: number } | null>(null)
  const [readingPosition, setReadingPosition] = useState<{ key: string; at: string; itemId: string } | null>(null)
  const followRequestSequence = useRef(0)
  const [mode, setMode] = useState(readSessionsView)
  const [readerExpanded, setReaderExpanded] = useState(false)
  const [activityVisited, setActivityVisited] = useState(mode === 'activity')
  const [timelineRequest, setTimelineRequest] = useState<TimelineLoadRequest | null>(null)
  const timelineRequestSequence = useRef(0)
  const initialPreview = useRef('')
  const [readError, setReadError] = useState('')
  const [reading, setReading] = useState(false)
  const readRequest = useRef<AbortController | null>(null)
  useEffect(() => persistSessionsView(mode), [mode])
  useEffect(() => persistSessionsGroup(groupPreference), [groupPreference])
  useEffect(() => () => readRequest.current?.abort(), [])
  const providers = useQuery({ queryKey: queryKeys.sessionProviders, queryFn: () => api.sessionProviders(), retry: false })
  const provider = providers.data?.providers.find((item) => item.id === sourceId) ?? providers.data?.providers[0]
  const providerId = provider?.id ?? ''
  const groupMode = groupPreference === 'branch' && provider?.capabilities.branch_groups ? 'branch' : 'workspace'
  const isBranch = groupMode === 'branch'
  const scope = isBranch ? branch : workspace
  const activity = useQuery({
    queryKey: queryKeys.sessionActivity(providerId, provider?.store_id ?? ''),
    queryFn: () => api.sessionActivity(providerId),
    enabled: Boolean(provider?.capabilities.live_presence),
    refetchInterval: 5000, retry: false, gcTime: 0,
  })
  const openIds = useMemo(() => new Set(!activity.isError && activity.data?.available
    && activity.data.store_id === provider?.store_id ? activity.data.open_session_ids : []), [activity.data, activity.isError, provider?.store_id])
  const directories = useInfiniteQuery({
    queryKey: queryKeys.sessionWorkspaces(providerId, false),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.sessionWorkspaces(providerId, { cursor: pageParam }),
    getNextPageParam: (page: SessionWorkspacePage) => page.next_cursor ?? undefined,
    enabled: Boolean(provider) && !isBranch,
    retry: false,
    staleTime: 3000, refetchInterval: 15_000, refetchOnWindowFocus: true,
  })
  const branches = useInfiniteQuery({
    queryKey: queryKeys.sessionBranches(providerId, false),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.sessionBranches(providerId, { cursor: pageParam }),
    getNextPageParam: (page: SessionBranchPage) => page.next_cursor ?? undefined,
    enabled: Boolean(provider) && isBranch, retry: false,
    staleTime: 3000, refetchInterval: 15_000, refetchOnWindowFocus: true,
  })
  const catalog = isBranch ? branches : directories
  const results = useInfiniteQuery({
    queryKey: queryKeys.sessionList(providerId, workspace, '', false, branch),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.sessions(providerId, { workspace, branch, cursor: pageParam, limit: 100 }),
    getNextPageParam: (page: SessionPage) => page.next_cursor ?? undefined,
    enabled: Boolean(provider),
    retry: false,
    gcTime: 60_000,
    staleTime: 3000, refetchInterval: 15_000, refetchOnWindowFocus: true,
  })
  const sessions = useMemo(() => [...new Map((results.data?.pages ?? []).flatMap((page) => page.sessions)
    .map((session) => [sessionKey(session), session])).values()], [results.data])
  const activeWorkspaces = useMemo(() => new Set([
    ...(!activity.isError && activity.data?.available && activity.data.store_id === provider?.store_id ? activity.data.active_workspaces ?? [] : []),
    ...sessions.filter(session => openIds.has(session.session_id) || session.state === 'active').map(session => session.workspace).filter((path): path is string => Boolean(path)),
  ]), [activity.data, activity.isError, provider?.store_id, sessions, openIds])
  useEffect(() => {
    if ((directoryQuery || catalogPickerOpen) && catalog.hasNextPage && !catalog.isFetching && !catalog.isError) void catalog.fetchNextPage()
  }, [directoryQuery, catalogPickerOpen, catalog.hasNextPage, catalog.isFetching, catalog.isError, catalog.fetchNextPage])
  useEffect(() => {
    if (branch && !sessions.length && results.hasNextPage && !results.isFetching && !results.isError) void results.fetchNextPage()
  }, [branch, sessions.length, results.hasNextPage, results.isFetching, results.isError, results.fetchNextPage])
  useEffect(() => {
    if (mode !== 'activity' || !provider || !sessions.length || !window.matchMedia('(min-width: 981px)').matches) return
    const key = `${provider.id}:${provider.store_id}:${workspace}:${branch}`
    if (initialPreview.current === key) return
    initialPreview.current = key
    setSelection((current) => current ?? { session: sessions[0], query: '', at: null })
  }, [mode, provider, workspace, branch, sessions])
  const relations = useMemo(() => (results.data?.pages ?? []).flatMap((page) => page.relations), [results.data])
  const groups = useMemo(() => {
    if (isBranch) {
      const byName = new Map<string, { name: string; ids: Set<string>; paths: Set<string>; latest: string }>()
      for (const group of (branches.data?.pages ?? []).flatMap(page => page.branches)) {
        const merged = byName.get(group.name) ?? { name: group.name, ids: new Set<string>(), paths: new Set<string>(), latest: '' }
        for (const id of group.session_ids) merged.ids.add(id)
        for (const path of group.workspace_paths) merged.paths.add(path)
        if ((group.last_active_at ?? '') > merged.latest) merged.latest = group.last_active_at ?? ''
        byName.set(group.name, merged)
      }
      return [...byName.values()].sort((left, right) => right.latest.localeCompare(left.latest))
        .filter(group => group.name.toLocaleLowerCase().includes(directoryQuery.toLocaleLowerCase()))
        .map(group => ({ key: group.name, label: group.name, children: [...group.paths], count: group.ids.size, active: [...group.ids].some(id => openIds.has(id)) }))
    }
    const byPath = new Map<string, { path: string; count: number; branches: Set<string>; latest: string }>()
    for (const group of (directories.data?.pages ?? []).flatMap((page) => page.workspaces)) {
      const previous = byPath.get(group.path)
      const latest = group.last_active_at ?? ''
      byPath.set(group.path, { path: group.path, count: (previous?.count ?? 0) + group.observed_count, branches: new Set([...(previous?.branches ?? []), ...(group.branch_names ?? [])]), latest: previous && previous.latest > latest ? previous.latest : latest })
    }
    return [...byPath.values()].sort((left, right) => right.latest.localeCompare(left.latest))
      .filter((group) => group.path.toLocaleLowerCase().includes(directoryQuery.toLocaleLowerCase()))
      .map(group => ({ key: group.path, label: group.path, children: [...group.branches].sort(), count: group.count, active: activeWorkspaces.has(group.path) }))
  }, [isBranch, branches.data, directories.data, directoryQuery, openIds, activeWorkspaces])
  const pickerItems = groups.flatMap(group => [
    { key: group.key, label: group.label, parent: group.label, branch: isBranch ? group.key : '', path: isBranch ? '' : group.key, child: false, isPath: !isBranch },
    ...group.children.map(child => ({ key: JSON.stringify(isBranch ? [group.key, child] : [child, group.key]), label: child, parent: group.label, branch: isBranch ? group.key : child, path: isBranch ? child : group.key, child: true, isPath: isBranch })),
  ])
  const pickerScope = branch && workspace ? JSON.stringify([branch, workspace]) : scope

  function chooseWorkspace(path: string) {
    readRequest.current?.abort()
    setReading(false)
    setReadError('')
    setWorkspace(path)
    setBranch('')
    setSelection(null)
    setTimelineRequest(null)
  }

  function chooseScope(value: string, child = '') {
    chooseWorkspace(isBranch ? child : value)
    setBranch(isBranch ? value : child)
  }

  function toggleGroup(key: string) {
    setCollapsedGroups(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function chooseGrouping(value: SessionGroupMode) {
    setCollapsedGroups(current => {
      const next = new Set(current)
      next.delete(`${value}:${value === 'workspace' ? workspace : branch}`)
      return next
    })
    setDirectoryQuery('')
    setGroupPreference(value)
  }

  function selectSession(session: BrowserSession, query = '') {
    readRequest.current?.abort()
    setReading(false)
    setReadError('')
    setTimelineRequest(null)
    setSelection({ session, query, at: null, followRequest: ++followRequestSequence.current })
  }

  async function onReadSession(ref: SessionRef) {
    readRequest.current?.abort()
    const controller = new AbortController()
    readRequest.current = controller
    setReading(true)
    setTimelineRequest(null)
    setReadError('')
    try {
      const result = await api.readSession(ref, controller.signal)
      if (!controller.signal.aborted) setSelection({ session: result.session, query: '', at: null })
    } catch (error) {
      if (!controller.signal.aborted) setReadError(`会话不可用：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (!controller.signal.aborted) setReading(false)
    }
  }

  return (
    <Tabs className="sessions-workspace" aria-label="会话浏览器" data-detail-open={Boolean(selection)} data-seeking={Boolean(selection?.at)} data-reader-expanded={readerExpanded} data-mode={mode} selectedKey={mode} onSelectionChange={(key) => { const next = key === 'list' ? 'list' : 'activity'; setMode(next); if (next === 'activity') setActivityVisited(true) }}>
      <header className="sessions-toolbar" inert={Boolean(connectionError)}>
        <div className="sessions-toolbar__search">
          <SessionSearch key={providerId + ':' + workspace + ':' + branch} api={api} provider={providerId} workspace={workspace} branch={branch}
            enabled={Boolean(provider?.capabilities.full_text_search)} openIds={openIds}
            onSelect={selectSession} />
        </div>
        <div className="sessions-toolbar__controls">
        <Select className="session-group-picker" aria-label="侧栏分组" selectedKey={groupMode} onSelectionChange={key => chooseGrouping(key === 'branch' ? 'branch' : 'workspace')} disabledKeys={provider?.capabilities.branch_groups ? [] : ['branch']}><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem id="workspace">Workspace</SelectItem><SelectItem id="branch">Branch</SelectItem></SelectContent></Select>
        <Select className="session-workspace-picker" aria-label={isBranch ? '筛选 Branch' : '筛选 Workspace'} selectedKey={pickerScope || '__all__'} onOpenChange={setCatalogPickerOpen} onSelectionChange={(key) => { const item = pickerItems.find(item => item.key === key); chooseScope(isBranch ? item?.branch ?? '' : item?.path ?? '', isBranch ? item?.path : item?.branch) }}><SelectTrigger size="sm" aria-label={isBranch ? '筛选 Branch' : '筛选 Workspace'}><SelectValue>{workspace ? <span className="session-path" title={`${branch}\n${workspace}`}><bdi dir="ltr">{workspace}</bdi></span> : undefined}</SelectValue></SelectTrigger><SelectContent className="session-scope-options"><SelectItem id="__all__">{isBranch ? '全部分支' : '全部项目'}</SelectItem>{pickerItems.map(item => <SelectItem id={item.key} key={item.key} aria-label={item.child ? `${item.parent} · ${item.label}` : item.label} textValue={item.child ? `${item.parent} · ${item.label}` : item.label} className={item.child ? 'session-scope-child' : undefined}><span className={item.isPath ? 'session-path' : undefined} title={item.label}><bdi dir="ltr">{item.label}</bdi></span></SelectItem>)}</SelectContent></Select>
          {(providers.data?.providers.length ?? 0) > 1 ? (
            <Select aria-label="会话来源" selectedKey={providerId} onSelectionChange={(key) => { setSourceId(String(key)); chooseWorkspace('') }}><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent>{providers.data?.providers.map((item) => <SelectItem id={item.id} key={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
          ) : provider?.name ? <span className="session-source">{provider.name}</span> : null}
          <Button aria-label="刷新会话" isIconOnly size="xs" variant="quiet" isDisabled={!provider || results.isFetching || catalog.isFetching} onPress={() => { void Promise.all([results.refetch(), catalog.refetch(), activity.refetch(), client.invalidateQueries({ queryKey: queryKeys.sessionBrowser, predicate: (query) => ['timeline', 'children', 'relations'].some((key) => query.queryKey.includes(key)) })]) }}><RefreshCw /></Button>
        </div>
      </header>
      {connectionError ? <div className="sessions-connection" role="alert"><MessagesSquare /><strong>暂时无法连接本机会话</strong><span>正在自动重连</span><Button size="sm" variant="secondary" onPress={() => void reconnect()}>立即重试</Button></div> : null}
      {readError ? <p className="session-error" role="alert">{readError}</p> : null}
      {!providers.isPending && !provider ? <div className="session-state">没有已接入的会话来源</div> : null}
      <div className="sessions-layout" inert={Boolean(connectionError)} aria-busy={reading || undefined}>
        <aside className="session-workspaces" aria-label={isBranch ? '分支分组' : '项目目录'}>
          <div className="session-workspaces__heading"><div className="session-group-switch segmented-control" role="group" aria-label="侧栏分组"><Button size="xs" variant="quiet" aria-pressed={!isBranch} onPress={() => chooseGrouping('workspace')}><Folder />Workspace</Button><Button size="xs" variant="quiet" aria-pressed={isBranch} isDisabled={!provider?.capabilities.branch_groups} onPress={() => chooseGrouping('branch')}><GitBranch />Branch</Button></div><Input aria-label={isBranch ? '筛选分支名称' : '筛选项目目录'} placeholder={isBranch ? '筛选分支…' : '筛选目录…'} size="sm" value={directoryQuery} onChange={(event) => setDirectoryQuery(event.currentTarget.value)} /></div>
          <button type="button" className="session-directory" aria-pressed={!scope} onClick={() => chooseScope('')}>{isBranch ? <GitBranch /> : <FolderOpen />}<span><strong>{isBranch ? '全部分支' : '全部项目'}</strong></span></button>
          <div className="session-workspaces__list" key={groupMode}>
            <ul className="session-directory-tree" aria-label={isBranch ? '分支目录' : 'Workspace'}>
              {groups.map(group => {
                const key = `${groupMode}:${group.key}`
                const collapsed = collapsedGroups.has(key)
                const childScope = isBranch ? workspace : branch
                const childrenLabel = isBranch ? '项目目录' : '分支'
                return <li key={group.key}>
                <div className="session-directory-tree__heading" data-selected={scope === group.key || undefined}>
                  {group.children.length ? <button type="button" className="session-directory-tree__toggle" aria-label={`${collapsed ? '展开' : '折叠'}${isBranch ? '分支目录' : '项目分支'}`} aria-expanded={!collapsed} onClick={() => toggleGroup(key)}>{collapsed ? <ChevronRight /> : <ChevronDown />}</button> : null}
                  <button type="button" className="session-directory" aria-pressed={scope === group.key && !childScope} onClick={() => chooseScope(group.key)}>
                    {isBranch ? <GitBranch /> : <Folder />}<span title={group.label}><strong className={isBranch ? undefined : 'session-path'}><bdi dir="ltr">{group.label}</bdi></strong></span>{group.active ? <span className="session-directory__active" role="img" aria-label={isBranch ? '分支活跃' : '项目活跃'} /> : null}<span className="session-directory__count" title={`${group.count} 个已载入会话`}>{group.count}</span>
                  </button>
                </div>
                {group.children.length ? <ul className="session-directory-tree__children" aria-label={`${group.label} ${childrenLabel}`} hidden={collapsed}>
                  {group.children.map(child => <li key={child}><button type="button" className="session-directory" aria-pressed={scope === group.key && childScope === child} onClick={() => chooseScope(group.key, child)}>
                    {isBranch ? <Folder /> : <GitBranch />}<span title={child}><strong className={isBranch ? 'session-path' : undefined}><bdi dir="ltr">{child}</bdi></strong></span>{isBranch && activeWorkspaces.has(child) ? <span className="session-directory__active" role="img" aria-label="项目活跃" /> : null}
                  </button></li>)}
                </ul> : null}
              </li>})}
            </ul>
            <AutoPager enabled={Boolean(catalog.hasNextPage) && !catalog.isError} loading={catalog.isFetching} onMore={() => catalog.fetchNextPage()} />
          </div>
        </aside>
        <div className="sessions-main">
          <header className="sessions-main__toolbar"><TabList className="sessions-view-tabs segmented-control" aria-label="会话视图"><Tab id="list">List</Tab><Tab id="activity">Tree</Tab></TabList></header>
        <TabPanel className="session-timeline" id="list" shouldForceMount hidden={mode !== 'list'}>
          <div className="session-timeline__list">
            {!results.isPending && !results.isError && !results.hasNextPage && sessions.length === 0 ? <div className="session-state"><Search /><strong>这里还没有会话</strong></div> : null}
            {sessions.map((session, index) => {
              const day = activityDay(session.last_active_at)
              const showDay = index === 0 || activityDay(sessions[index - 1].last_active_at) !== day
              return <div key={sessionKey(session)}>
                {showDay ? <h3 className="session-timeline__day">{day}</h3> : null}
                <div className="session-row" data-selected={selection ? sessionKey(selection.session) === sessionKey(session) : false}>
                <button type="button" className="session-row__select" aria-label={`查看会话：${session.title}`} aria-pressed={selection ? sessionKey(selection.session) === sessionKey(session) : false} onClick={() => selectSession(session)}>
                  <span className="session-row__time">{activityTime(session.last_active_at)}</span>
                  <div className="session-row__body"><div className="session-row__title"><strong title={session.title}>{session.title}</strong><SessionActivity state={session.state} isOpen={openIds.has(session.session_id)} /><SessionOrigin workspace={null} branch={session.branch} /></div><div className="session-row__workspace-row"><SessionOrigin workspace={session.workspace} branch={null} /></div><span className="session-row__preview">{session.preview || '打开查看对话'}</span></div>
                </button>
                <SessionResumeButton api={api} session={session} />
                </div>
              </div>
            })}
            <AutoPager enabled={mode === 'list' && Boolean(results.hasNextPage) && !results.isError} loading={results.isFetching} onMore={() => results.fetchNextPage()} />
          </div>
        </TabPanel>
        <TabPanel className="sessions-activity-panel" id="activity" shouldForceMount hidden={mode !== 'activity'}>
          {activityVisited ? <SessionActivityView key={`${providerId}:${workspace}:${branch}`} api={api} sessions={sessions} relations={relations} openIds={openIds} presenceSource={{ provider: providerId, store_id: provider?.store_id ?? '' }} selection={selection?.session ?? null} at={selection?.at ?? null} itemId={selection?.itemId} readingPosition={readingPosition} timelineRequest={timelineRequest} hasMore={mode === 'activity' && Boolean(results.hasNextPage) && !results.isError} loadingMore={results.isFetching} onMore={() => results.fetchNextPage()}
            onSelect={selectSession} onReadSession={(ref) => void onReadSession(ref)} onSeek={(session, at, resumeFollowing, itemId) => {
              readRequest.current?.abort(); setReading(false); setReadError(''); setReaderExpanded(false)
              const followRequest = resumeFollowing ? ++followRequestSequence.current : undefined
              setSelection((current) => current && sessionKey(current.session) === sessionKey(session) && current.at === at && current.itemId === itemId && !current.query && !resumeFollowing ? current : { session, query: '', at, itemId, followRequest: followRequest ?? current?.followRequest })
            }} /> : null}
        </TabPanel>
        </div>
        {selection ? <SessionDetail key={sessionKey(selection.session)} api={api} session={selection.session} query={selection.query} at={selection.at} itemId={selection.itemId} followRequest={selection.followRequest} isOpen={selection.session.provider === providerId && selection.session.store_id === provider?.store_id && openIds.has(selection.session.session_id)} onReadingPosition={(at, itemId) => { const key = sessionKey(selection.session); setReadingPosition(current => current?.key === key && current.at === at && current.itemId === itemId ? current : { key, at, itemId }) }} onReadSession={(ref) => void onReadSession(ref)} onLoadTimeline={() => { setMode('activity'); setActivityVisited(true); setTimelineRequest({ session: selection.session, sequence: ++timelineRequestSequence.current }) }} onExpand={() => setReaderExpanded(true)} onBack={() => setSelection(null)} /> : (
          <section className="session-detail session-detail--empty" aria-label="会话预览"><MessagesSquare /><p>悬停时间轴，浏览对应消息</p></section>
        )}
      </div>
    </Tabs>
  )
}
