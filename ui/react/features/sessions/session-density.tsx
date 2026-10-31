import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react'

import { nearestMessage, secondHeatCells, timeAtPosition, type Interval, type MessagePoint } from './session-projection'

export function SessionDensity({ title, intervals, points, from, to, selectedAt, selectedItemId, readingAt, onSeek, pending = false, complete = false, indexedFrom = null, viewport = null }: {
  title: string; intervals: Interval[]; points?: MessagePoint[]; from: number; to: number; count: number; maximum?: number
  selectedAt?: string | null; selectedItemId?: string; onSeek?: (at: string, itemId?: string) => void; pending?: boolean; complete?: boolean
  readingAt?: string | null
  indexedFrom?: number | null
  viewport?: { from: string; to: string } | null
}) {
  const hintId = useId()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [hoverAt, setHoverAt] = useState<number | null>(null)
  const [hoverItemId, setHoverItemId] = useState<string | undefined>()
  const [focused, setFocused] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const captured = useRef<number | null>(null)
  const bounds = useRef<{ top: number; height: number } | null>(null)
  const frame = useRef<number | null>(null)
  const lastSeek = useRef('')
  const pendingHover = useRef(false)
  const callback = useRef(onSeek)
  callback.current = onSeek
  const visiblePoints = useMemo(() => points?.filter(point => Date.parse(point.at) >= from && Date.parse(point.at) < to), [points, from, to])
  const events = useMemo(() => visiblePoints ?? intervals.map(interval => ({ at: new Date(interval.start).toISOString() })), [visiblePoints, intervals])
  const cells = useMemo(() => secondHeatCells(events, from, to), [events, from, to])
  const selected = selectedItemId ? points?.find(point => point.item_id === selectedItemId) : null
  const selectedTime = selected ? Date.parse(selected.at) : selectedAt ? Date.parse(selectedAt) : null
  const readingTime = readingAt ? Date.parse(readingAt) : null
  const cursor = previewing ? hoverAt ?? readingTime ?? selectedTime : readingTime ?? selectedTime ?? hoverAt
  const instant = to - from <= 1
  const position = instant ? 50 : cursor === null ? 0 : (cursor - from) / (to - from) * 100
  const readingPosition = instant ? 50 : readingTime === null ? 0 : Math.max(0, Math.min(100, (readingTime - from) / (to - from) * 100))
  const cell = cursor === null ? null : cells.find(entry => entry.start === Math.floor(cursor / 1000) * 1000)
  const countLabel = complete ? `${cell?.count ?? 0} 条消息` : cell?.count ? `${cell.count}+ 条消息` : ''
  const roleLabel = cell ? [cell.user ? `用户 ${cell.user}` : '', cell.assistant ? `Agent ${cell.assistant}` : ''].filter(Boolean).join(' · ') : ''
  const timeLabel = cursor === null ? '' : new Date(cursor).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const disabled = pending || (points !== undefined && events.length === 0)
  const hoverTarget = useRef<number | null>(null)
  const hoverOptions = useRef({ visiblePoints, disabled, indexedFrom })
  hoverOptions.current = { visiblePoints, disabled, indexedFrom }

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    function draw() {
      if (!element) return
      const { width, height } = element.getBoundingClientRect()
      if (!width || !height) return
      const ratio = window.devicePixelRatio || 1
      element.width = Math.round(width * ratio); element.height = Math.round(height * ratio)
      const context = element.getContext('2d')
      if (!context) return
      context.scale(ratio, ratio)
      const maximum = Math.max(1, ...cells.map(entry => entry.count))
      // Multiple logical seconds can share an overview pixel. Keep its strongest
      // second rather than accumulating opacity into a fictitious message count.
      const pixels = new Map<number, { height: number; user: number; assistant: number; unknown: number }>()
      for (const entry of cells) {
        const top = instant ? height / 2 - 1 : Math.max(0, (Math.max(from, entry.start) - from) / (to - from) * height)
        const bottom = instant ? top + 2 : Math.min(height, (entry.start + 1000 - from) / (to - from) * height)
        const y = Math.min(Math.floor(top * ratio) / ratio, height - 1 / ratio)
        const previous = pixels.get(y)
        pixels.set(y, {
          height: Math.max(1 / ratio, bottom - top - (bottom - top > 2 ? 1 : 0)),
          user: Math.max(entry.user, previous?.user ?? 0),
          assistant: Math.max(entry.assistant, previous?.assistant ?? 0),
          unknown: Math.max(entry.unknown, previous?.unknown ?? 0),
        })
      }
      const style = getComputedStyle(element)
      const colors = { user: style.getPropertyValue('--timeline-user-color').trim(), assistant: style.getPropertyValue('--timeline-agent-color').trim(), unknown: style.color }
      for (const [top, entry] of pixels) {
        const roles = (['user', 'assistant', 'unknown'] as const).filter(role => entry[role] > 0)
        const laneWidth = Math.max(1, width - 2) / roles.length
        roles.forEach((role, index) => {
          context.fillStyle = colors[role]
          context.globalAlpha = .3 + .7 * Math.log1p(entry[role]) / Math.log1p(maximum)
          context.fillRect(1 + index * laneWidth, top, laneWidth, entry.height)
        })
      }
    }
    draw()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(draw) : null
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [cells, from, to, instant])

  useEffect(() => {
    if (pendingHover.current && hoverTarget.current !== null) queueHover(hoverTarget.current)
  }, [visiblePoints, indexedFrom, disabled])
  useEffect(() => () => { if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null } }, [])

  function queueHover(value: number) {
    hoverTarget.current = value
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const target = hoverTarget.current
      const options = hoverOptions.current
      if (!pendingHover.current || target === null || options.disabled || options.indexedFrom !== null && target < options.indexedFrom) return
      const point = options.visiblePoints ? nearestMessage(options.visiblePoints, target) : null
      const at = point?.at ?? new Date(target).toISOString()
      const key = `${at}:${point?.item_id ?? ''}`
      if (lastSeek.current === key) return
      lastSeek.current = key
      callback.current?.(at, point?.item_id)
    })
  }

  function seek(value: number, exact?: MessagePoint) {
    pendingHover.current = false
    setHoverAt(value)
    const point = exact ?? (visiblePoints ? nearestMessage(visiblePoints, value) : null)
    setHoverItemId(point?.item_id)
    if (disabled || (indexedFrom !== null && value < indexedFrom)) return
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    lastSeek.current = `${point?.at ?? new Date(value).toISOString()}:${point?.item_id ?? ''}`
    if (point) callback.current?.(point.at, point.item_id)
    else callback.current?.(new Date(value).toISOString())
  }
  function pointerAt(event: PointerEvent<HTMLDivElement>) {
    const box = bounds.current ?? event.currentTarget.getBoundingClientRect()
    return timeAtPosition(event.clientY, box.top, box.height, from, to)
  }
  function leave() { if (captured.current === null) { pendingHover.current = false; if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }; lastSeek.current = ''; hoverTarget.current = null; bounds.current = null; setPreviewing(false); setHoverAt(null); setHoverItemId(undefined) } }

  return <div className="session-density" data-pending={pending || undefined} data-second-cells={cells.length}
    role={onSeek ? 'slider' : 'img'} aria-orientation={onSeek ? 'vertical' : undefined} aria-label={onSeek ? `定位 ${title} 的消息` : `${title}，${events.length} 条消息`}
    aria-disabled={onSeek ? disabled : undefined} aria-busy={pending || undefined}
    aria-describedby={onSeek ? hintId : undefined} tabIndex={onSeek ? 0 : undefined}
    aria-valuemin={onSeek ? from : undefined} aria-valuemax={onSeek ? to - 1 : undefined} aria-valuenow={onSeek ? cursor ?? from : undefined}
    aria-valuetext={onSeek ? `${timeLabel}${countLabel ? `，${countLabel}` : ''}${roleLabel ? `，${roleLabel}` : ''}` : undefined}
    onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); leave() }}
    onPointerMove={event => {
      if (!onSeek) return
      if (captured.current === event.pointerId) { setPreviewing(true); seek(pointerAt(event)) }
      else if (event.pointerType !== 'touch') { const value = pointerAt(event); setPreviewing(true); pendingHover.current = true; setHoverAt(value); setHoverItemId(undefined); queueHover(value) }
    }} onPointerLeave={leave}
    onPointerDown={event => {
      if (!onSeek || disabled || event.button !== 0) return
      event.preventDefault(); captured.current = event.pointerId
      setPreviewing(true)
      bounds.current = event.currentTarget.getBoundingClientRect()
      event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus(); seek(pointerAt(event))
    }} onPointerUp={event => {
      if (captured.current !== event.pointerId) return
      seek(pointerAt(event)); captured.current = null; setPreviewing(false); event.currentTarget.releasePointerCapture(event.pointerId)
    }} onPointerCancel={() => { captured.current = null; leave() }} onLostPointerCapture={() => { captured.current = null; setPreviewing(false) }}
    onKeyDown={event => {
      if (!onSeek || disabled || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      setPreviewing(false)
      const ordered = visiblePoints?.toSorted((a, b) => a.at.localeCompare(b.at))
      if (ordered?.length) {
        const identity = hoverItemId ?? selectedItemId
        const current = identity ? ordered.findIndex(point => point.item_id === identity) : cursor === null ? -1 : ordered.findIndex(point => Date.parse(point.at) === cursor)
        let index = current + (event.key === 'ArrowUp' ? -1 : 1) * (event.shiftKey ? 10 : 1)
        if (event.key === 'Home') index = 0
        if (event.key === 'End') index = ordered.length - 1
        const point = ordered[Math.max(0, Math.min(ordered.length - 1, index))]
        seek(Date.parse(point.at), point)
      } else seek(event.key === 'Home' ? from : event.key === 'End' ? to - 1 : Math.max(from, Math.min(to - 1, (cursor ?? from) + (event.key === 'ArrowUp' ? -1000 : 1000))))
    }}>
    {onSeek ? <span className="sr-only" id={hintId}>上下移动浏览消息；上下方向键切换消息，Home 和 End 跳到首尾。触屏点击或滑动。</span> : null}
    {viewport ? <span className="session-density__viewport" aria-hidden="true" style={{ top: `${Math.max(0, Math.min(100, (Date.parse(viewport.from) - from) / (to - from) * 100))}%`, height: `${Math.max(1, Math.min(100, (Date.parse(viewport.to) - Date.parse(viewport.from)) / (to - from) * 100))}%` }} /> : null}
    <canvas ref={canvas} className="session-density__cells" aria-hidden="true" />
    {readingTime !== null && Number.isFinite(readingTime) ? <span className="session-density__reading" role="img" aria-label="当前阅读位置" data-at={readingAt} style={{ top: `${readingPosition}%` }} /> : null}
    {onSeek && cursor !== null && cursor >= from && cursor < to ? <>
      <span className="session-density__cursor" aria-hidden="true" style={{ top: `${position}%` }} />
      {hoverAt !== null || focused ? <span className="session-density__tooltip" aria-hidden="true" style={{ top: `clamp(24px, ${position}%, calc(100% - 24px))` }}>{timeLabel}{countLabel ? ` · ${countLabel}` : ''}{roleLabel ? ` · ${roleLabel}` : ''}</span> : null}
    </> : null}
  </div>
}
