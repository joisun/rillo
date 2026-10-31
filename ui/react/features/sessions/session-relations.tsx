import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { DashboardApi } from '@/lib/api/dashboard-api'
import type { BrowserSession, SessionRef, SessionRelation } from '@/lib/api/types'
import { isSessionMetadataQuery, queryKeys } from '@/lib/query/keys'
import { sessionKey } from './session-format'
import { collectSessionRelations } from './session-projection'

export function SessionRelations({ api, session, knownSessions, knownRelations = [], onReadSession }: { knownSessions?: Map<string, BrowserSession>; knownRelations?: SessionRelation[]; api: DashboardApi; session: BrowserSession; onReadSession: (ref: SessionRef) => void }) {
  const element = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (element.current && !element.current.contains(event.target as Node)) element.current.open = false }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && element.current?.open) { element.current.open = false; element.current.querySelector('summary')?.focus() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [])
  const client = useQueryClient()
  const [childId, setChildId] = useState('')
  const [sourceKey, setSourceKey] = useState(JSON.stringify([session.provider, session.store_id]))
  const providers = useQuery({ queryKey: queryKeys.sessionProviders, queryFn: () => api.sessionProviders(), retry: false, staleTime: 60_000 })
  const sources = providers.data?.providers ?? []
  const source = sources.find((item) => JSON.stringify([item.id, item.store_id]) === sourceKey) ?? sources[0]
  const relations = useQuery({ queryKey: queryKeys.sessionRelations(session), queryFn: () => api.sessionRelations(session), retry: false })
  function refreshRelations() {
    void client.invalidateQueries({ queryKey: queryKeys.sessionBrowser, predicate: (query) => isSessionMetadataQuery(query.queryKey) })
  }
  const link = useMutation({ mutationFn: () => api.linkSessions({ parent: { provider: session.provider, store_id: session.store_id, session_id: session.session_id }, child: { provider: source!.id, store_id: source!.store_id, session_id: childId.trim() }, source: 'session-browser' }),
    onSuccess: () => { setChildId(''); refreshRelations() } })
  const unlink = useMutation({ mutationFn: (relation: SessionRelation) => api.unlinkSessions({ parent: relation.parent, child: relation.child }), onSuccess: refreshRelations })
  const items = collectSessionRelations([session], [...knownRelations, ...(relations.data?.relations ?? [])])
    .filter(relation => sessionKey(relation.parent) === sessionKey(session) || sessionKey(relation.child) === sessionKey(session))
  return <details className="session-relations" ref={element}>
    <summary>会话关系{items.length ? ` · ${items.length}` : ''}</summary>
    <div className="session-relations__content">
    {relations.isError ? <p role="alert" className="session-error">{relations.error.message}</p> : null}
    {items.map((relation) => {
      const isChild = sessionKey(relation.child) === sessionKey(session)
      const target = isChild ? relation.parent : relation.child
      const label = relation.kind === 'fork' ? (isChild ? 'Fork 来源' : '派生 Fork') : relation.kind === 'subagent' ? (isChild ? 'Subagent 父会话' : 'Subagent 子会话') : (isChild ? '协作父会话' : '协作子会话')
      return <div className="session-relations__row" key={relation.id}><span>{label}</span><button type="button" onClick={() => onReadSession(target)} title={sessionKey(target)}>{knownSessions?.get(sessionKey(target))?.title ?? target.session_id}</button>
        {relation.origin === 'registered' ? <Button size="xs" variant="quiet" isPending={unlink.isPending && unlink.variables?.id === relation.id} onClick={() => unlink.mutate(relation)}>解除登记</Button> : null}</div>
    })}
    <form className="session-relations__form" onSubmit={(event) => { event.preventDefault(); link.mutate() }}>
      <span>登记子会话（每个子会话只允许一个父会话）</span>
      {sources.length > 1 ? <Select aria-label="子会话来源" value={source ? JSON.stringify([source.id, source.store_id]) : null} onValueChange={(key) => setSourceKey(String(key))}><SelectTrigger size="sm" aria-label="子会话来源"><SelectValue /></SelectTrigger><SelectContent>{sources.map((item, index) => <SelectItem key={JSON.stringify([item.id, item.store_id])} value={JSON.stringify([item.id, item.store_id])}><span title={item.store_id}>{item.name}{sources.filter((candidate) => candidate.name === item.name).length > 1 ? ` · 来源 ${index + 1}` : ''}</span></SelectItem>)}</SelectContent></Select>
        : <span className="session-source" title={source?.store_id}>来源：{source?.name ?? '正在读取…'}</span>}
      <label className="session-relations__input-label">子会话 Session ID<Input size="sm" placeholder="输入完整会话 ID" value={childId} onChange={(event) => setChildId(event.currentTarget.value)} /></label>
      <Button size="xs" variant="secondary" type="submit" disabled={!source || !childId.trim()} isPending={link.isPending}>登记子会话</Button>
    </form>
    {link.isError || unlink.isError ? <p role="alert" className="session-error">{(link.error ?? unlink.error)?.message}</p> : null}
    {providers.isError ? <p role="alert" className="session-error">无法读取来源：{providers.error.message}</p> : null}
    </div>
  </details>
}
