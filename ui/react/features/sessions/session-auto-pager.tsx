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
  useEffect(() => {
    if (!anchor.current || typeof IntersectionObserver === 'undefined') return
    const options = observeLastWithin?.current?.querySelectorAll('[role="option"]')
    const target = options?.length ? options[options.length - 1] : anchor.current
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '160px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [enabled, loading, observeLastWithin])
  useEffect(() => {
    if (!visible || !enabled || loading || busy) return
    setBusy(true)
    Promise.resolve().then(() => callback.current()).catch(() => {}).finally(() => setBusy(false))
  }, [visible, enabled, loading, busy])
  return <span ref={anchor} className="session-auto-pager" data-auto-pager aria-hidden="true" />
}
