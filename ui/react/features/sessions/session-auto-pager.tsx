import { useEffect, useRef, useState, type RefObject } from 'react'

export function AutoPager({ enabled, loading, onMore, observeLastWithin }: {
  enabled: boolean; loading: boolean; onMore: () => unknown
  observeLastWithin?: RefObject<HTMLElement | null>
}) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [busy, setBusy] = useState(false)
  const callback = useRef(onMore)
  callback.current = onMore
  const [visible, setVisible] = useState(false)
  const visibility = useRef(false)
  useEffect(() => {
    if (!anchor.current || typeof IntersectionObserver === 'undefined') return
    const options = observeLastWithin?.current?.querySelectorAll('[role="option"]')
    // React Aria's empty-state option uses display:contents and has no observable box.
    const target = [...(options ?? [])].filter(option => option.getClientRects().length).at(-1) ?? anchor.current
    visibility.current = false
    setVisible(false)
    const observer = new IntersectionObserver(([entry]) => { visibility.current = entry.isIntersecting; setVisible(entry.isIntersecting) }, { rootMargin: '160px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [enabled, loading, observeLastWithin])
  useEffect(() => {
    if (!visible || !visibility.current || !enabled || loading || busy) return
    setBusy(true)
    Promise.resolve().then(() => callback.current()).catch(() => {}).finally(() => setBusy(false))
  }, [visible, enabled, loading, busy])
  return <span ref={anchor} className="session-auto-pager" data-auto-pager aria-hidden="true" />
}
