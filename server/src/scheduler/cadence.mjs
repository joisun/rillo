const KINDS = new Set(['once', 'interval', 'hourly', 'daily', 'weekly', 'monthly'])
const MINUTE_MS = 60_000

function workMinute(value, { end = false } = {}) {
  if (end && value === '24:00') return 1440
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new RangeError('work_hours times must be HH:mm; only an end may be 24:00')
  }
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

function validateWorkHours(input) {
  assertObject(input)
  assertKeys(input, new Set(['weekdays', 'windows']))
  if (!Array.isArray(input.weekdays) || input.weekdays.length === 0 || input.weekdays.length > 7) {
    throw new RangeError('work_hours.weekdays must contain 1 to 7 days')
  }
  const weekdays = [...new Set(input.weekdays)].sort((a, b) => a - b)
  weekdays.forEach((day) => assertInteger(day, 'work_hours weekday', 1, 7))
  if (!Array.isArray(input.windows) || input.windows.length === 0 || input.windows.length > 24) {
    throw new RangeError('work_hours.windows must contain 1 to 24 windows')
  }
  const windows = input.windows.map((window) => {
    assertObject(window)
    assertKeys(window, new Set(['start', 'end']))
    if (workMinute(window.start) >= workMinute(window.end, { end: true })) {
      throw new RangeError('work_hours end must be after start; split overnight windows at 24:00')
    }
    return { start: window.start, end: window.end }
  }).sort((a, b) => a.start.localeCompare(b.start))
  for (let index = 1; index < windows.length; index += 1) {
    if (workMinute(windows[index].start) < workMinute(windows[index - 1].end, { end: true })) {
      throw new RangeError('work_hours windows must not overlap')
    }
  }
  return { weekdays, windows }
}

function datedWindow(date, window) {
  const start = workMinute(window.start)
  const end = workMinute(window.end, { end: true })
  const at = (minute) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(minute / 60), minute % 60)
  return { start: at(start), end: at(end) }
}

function currentWorkWindow(cadence, date) {
  const hours = cadence.work_hours
  if (!hours?.weekdays.includes(date.getDay() || 7)) return null
  const minute = date.getHours() * 60 + date.getMinutes()
  const window = hours.windows.find((item) => minute >= workMinute(item.start) && minute < workMinute(item.end, { end: true }))
  return window ? datedWindow(date, window) : null
}

function isWithinWorkHours(cadence, at) {
  return !cadence.work_hours || currentWorkWindow(cadence, new Date(at)) !== null
}

function assertObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('cadence must be an object')
}

function assertInteger(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} must be an integer from ${min} to ${max}`)
}

function assertKeys(input, allowed) {
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new TypeError(`unknown cadence key: ${key}`)
}

function parseStrictDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value)
  if (!match) throw new RangeError('at must be a valid ISO date')
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '00', fractionText = ''] = match
  const year = Number(yearText); const month = Number(monthText); const day = Number(dayText)
  const hour = Number(hourText); const minute = Number(minuteText); const second = Number(secondText)
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59) throw new RangeError('at must be a valid ISO date')
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new RangeError('at must be a valid ISO date')
  return date
}

export function validateCadence(input, { now = new Date(), allowPastOnce = false } = {}) {
  assertObject(input)
  if (!KINDS.has(input.kind)) throw new TypeError('invalid cadence kind')
  const allowed = new Set(['kind', 'timezone_mode'])
  if (input.kind !== 'once') allowed.add('work_hours')
  if (input.kind === 'once') allowed.add('at')
  if (input.kind === 'interval') allowed.add('minutes')
  if (input.kind === 'hourly') allowed.add('minute')
  if (input.kind === 'daily') { allowed.add('hour'); allowed.add('minute') }
  if (input.kind === 'weekly') { allowed.add('weekdays'); allowed.add('hour'); allowed.add('minute') }
  if (input.kind === 'monthly') { allowed.add('day'); allowed.add('hour'); allowed.add('minute') }
  assertKeys(input, allowed)
  if (input.timezone_mode !== undefined && input.timezone_mode !== 'system') throw new RangeError('timezone_mode must be system')

  const result = { kind: input.kind }
  if (input.kind === 'once') {
    if (typeof input.at !== 'string') throw new TypeError('at must be an ISO date string')
    const at = parseStrictDate(input.at)
    const current = new Date(now).getTime()
    if (!Number.isFinite(current)) throw new RangeError('now must be a valid date')
    if (!allowPastOnce && at.getTime() <= current) throw new RangeError('once cadence must be in the future')
    if (at.getTime() > current + 366 * 24 * 60 * 60 * 1000) throw new RangeError('once cadence must be within 366 days')
    result.at = input.at
  } else if (input.kind === 'interval') {
    assertInteger(input.minutes, 'minutes', 1, 1440); result.minutes = input.minutes
  } else if (input.kind === 'hourly') {
    assertInteger(input.minute, 'minute', 0, 59); result.minute = input.minute
  } else {
    if (input.kind === 'monthly') { assertInteger(input.day, 'day', 1, 31); result.day = input.day }
    if (input.kind === 'weekly') {
      if (!Array.isArray(input.weekdays) || input.weekdays.length === 0) throw new RangeError('weekdays must not be empty')
      const weekdays = [...new Set(input.weekdays)]
      weekdays.forEach((day) => assertInteger(day, 'weekday', 1, 7))
      weekdays.sort((a, b) => a - b); result.weekdays = weekdays
    }
    assertInteger(input.hour, 'hour', 0, 23); assertInteger(input.minute, 'minute', 0, 59)
    result.hour = input.hour; result.minute = input.minute
  }
  if (input.work_hours !== undefined) {
    result.work_hours = validateWorkHours(input.work_hours)
    if (input.kind === 'weekly' && !result.weekdays.some((day) => result.work_hours.weekdays.includes(day))) {
      throw new RangeError('weekly cadence and work_hours must share at least one weekday')
    }
    let slots = []
    if (input.kind === 'hourly') slots = Array.from({ length: 24 }, (_, hour) => hour * 60 + result.minute)
    else if (input.kind !== 'interval') slots = [result.hour * 60 + result.minute]
    if (input.kind !== 'interval' && !slots.some((minute) => result.work_hours.windows.some((window) => (
      minute >= workMinute(window.start) && minute < workMinute(window.end, { end: true })
    )))) throw new RangeError('cadence has no execution time inside work_hours')
  }
  result.timezone_mode = 'system'
  return result
}

function matches(cadence, date) {
  if (cadence.kind === 'hourly') return date.getMinutes() === cadence.minute
  if (date.getHours() !== cadence.hour || date.getMinutes() !== cadence.minute) return false
  if (cadence.kind === 'daily') return true
  if (cadence.kind === 'weekly') return cadence.weekdays.includes(date.getDay() || 7)
  return date.getDate() === cadence.day
}

export function nextOccurrence(cadence, after, { inclusive = false } = {}) {
  const base = new Date(after)
  if (!Number.isFinite(base.getTime())) throw new RangeError('after must be a valid date')
  if (cadence.kind === 'once') {
    const at = new Date(cadence.at)
    return (inclusive ? at >= base : at > base) ? at : null
  }
  if (cadence.kind === 'interval') return nextInterval(cadence, base, inclusive)
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  const limit = new Date(start); limit.setFullYear(limit.getFullYear() + 8)
  for (let date = new Date(start); date <= limit; date.setDate(date.getDate() + 1)) {
    const year = date.getFullYear(); const month = date.getMonth(); const day = date.getDate()
    const hours = cadence.kind === 'hourly' ? Array.from({ length: 24 }, (_, hour) => hour) : [cadence.hour]
    for (const hour of hours) {
      const candidate = new Date(year, month, day, hour, cadence.minute, 0, 0)
      if (cadence.kind === 'monthly' && candidate.getDate() !== cadence.day) continue
      if (cadence.kind === 'weekly' && !cadence.weekdays.includes(candidate.getDay() || 7)) continue
      if (!isWithinWorkHours(cadence, candidate)) continue
      if (candidate.getTime() >= base.getTime() && (inclusive || candidate.getTime() > base.getTime())) return candidate
    }
  }
  return null
}

function nextInterval(cadence, base, inclusive) {
  const step = cadence.minutes * MINUTE_MS
  if (!cadence.work_hours) {
    let next = Math.ceil(base.getTime() / step) * step
    if (!inclusive && next === base.getTime()) next += step
    return new Date(next)
  }
  // A weekly window can disappear in a DST gap; include the following week.
  for (let offset = 0; offset <= 14; offset += 1) {
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset)
    if (!cadence.work_hours.weekdays.includes(day.getDay() || 7)) continue
    for (const window of cadence.work_hours.windows) {
      const bounds = datedWindow(day, window)
      let next = bounds.start.getTime() + Math.max(0, Math.ceil((base - bounds.start) / step)) * step
      if (!inclusive && next === base.getTime()) next += step
      for (; next < bounds.end.getTime(); next += step) {
        const candidate = new Date(next)
        if (isWithinWorkHours(cadence, candidate)) return candidate
      }
    }
  }
  return null
}

export function latestDueOccurrence(cadence, { after, at } = {}) {
  let lowerBound = new Date(after)
  const upperBound = new Date(at)
  if (!Number.isFinite(lowerBound.getTime()) || !Number.isFinite(upperBound.getTime())) {
    throw new RangeError('after and at must be valid dates')
  }
  if (upperBound <= lowerBound) return null

  let workWindow = null
  if (cadence.work_hours) {
    workWindow = currentWorkWindow(cadence, upperBound)
    if (!workWindow) return null
    lowerBound = new Date(Math.max(lowerBound.getTime(), workWindow.start.getTime() - 1))
  }

  if (cadence.kind === 'interval') {
    const step = cadence.minutes * MINUTE_MS
    const anchor = workWindow?.start.getTime() ?? 0
    const candidate = new Date(anchor + Math.floor((upperBound.getTime() - anchor) / step) * step)
    return candidate > lowerBound && isWithinWorkHours(cadence, candidate) ? candidate : null
  }

  if (cadence.kind === 'once') {
    const occurrence = new Date(cadence.at)
    return occurrence > lowerBound && occurrence <= upperBound ? occurrence : null
  }

  const accept = (candidate) => candidate > lowerBound && candidate <= upperBound && isWithinWorkHours(cadence, candidate)
    ? candidate
    : null
  if (cadence.kind === 'hourly') {
    for (let offset = 0; offset < 3; offset += 1) {
      const hour = new Date(upperBound)
      hour.setHours(hour.getHours() - offset, cadence.minute, 0, 0)
      const accepted = accept(hour)
      if (accepted) return accepted
    }
    return null
  }

  if (cadence.kind === 'daily' || cadence.kind === 'weekly') {
    const maximumDays = cadence.kind === 'daily' ? 3 : 8
    for (let offset = 0; offset < maximumDays; offset += 1) {
      const day = new Date(
        upperBound.getFullYear(),
        upperBound.getMonth(),
        upperBound.getDate() - offset,
        cadence.hour,
        cadence.minute,
        0,
        0,
      )
      if (cadence.kind === 'weekly'
        && !cadence.weekdays.includes(day.getDay() || 7)) continue
      const accepted = accept(day)
      if (accepted) return accepted
    }
    return null
  }

  for (let offset = 0; offset < 24; offset += 1) {
    const first = new Date(
      upperBound.getFullYear(),
      upperBound.getMonth() - offset,
      1,
      cadence.hour,
      cadence.minute,
      0,
      0,
    )
    const candidate = new Date(
      first.getFullYear(),
      first.getMonth(),
      cadence.day,
      cadence.hour,
      cadence.minute,
      0,
      0,
    )
    if (candidate.getMonth() !== first.getMonth()) continue
    const accepted = accept(candidate)
    if (accepted) return accepted
  }
  return null
}

function baseCadenceSummary(cadence, { locale = 'zh-CN' } = {}) {
  const time = (hour, minute) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  if (cadence.kind === 'once') return locale.startsWith('zh') ? `一次性：${new Date(cadence.at).toLocaleString(locale)}` : `Once: ${new Date(cadence.at).toLocaleString(locale)}`
  if (cadence.kind === 'interval') return locale.startsWith('zh') ? `每 ${cadence.minutes} 分钟` : `Every ${cadence.minutes} minutes`
  if (cadence.kind === 'hourly') return locale.startsWith('zh') ? `每小时第 ${String(cadence.minute).padStart(2, '0')} 分钟` : `Hourly at :${String(cadence.minute).padStart(2, '0')}`
  if (cadence.kind === 'daily') return locale.startsWith('zh') ? `每天 ${time(cadence.hour, cadence.minute)}` : `Daily at ${time(cadence.hour, cadence.minute)}`
  if (cadence.kind === 'weekly') return locale.startsWith('zh') ? `每周 ${cadence.weekdays.join('、')} ${time(cadence.hour, cadence.minute)}` : `Weekly (${cadence.weekdays.join(', ')}) at ${time(cadence.hour, cadence.minute)}`
  return locale.startsWith('zh') ? `每月 ${cadence.day} 日 ${time(cadence.hour, cadence.minute)}` : `Monthly on day ${cadence.day} at ${time(cadence.hour, cadence.minute)}`
}

export function cadenceSummary(cadence, { locale = 'zh-CN' } = {}) {
  const summary = baseCadenceSummary(cadence, { locale })
  if (!cadence.work_hours) return summary
  const days = cadence.work_hours.weekdays.join('、')
  const windows = cadence.work_hours.windows.map(({ start, end }) => `${start}–${end}`).join(' / ')
  return `${summary} · ${locale.startsWith('zh') ? '周' : 'Days '}${days} ${windows}`
}

export function launchdCalendars(cadence) {
  if (cadence.kind === 'interval' || cadence.work_hours) throw new RangeError('interval and work_hours require the internal scheduler')
  if (cadence.kind === 'once') {
    const at = new Date(cadence.at)
    return [{ Month: at.getMonth() + 1, Day: at.getDate(), Hour: at.getHours(), Minute: at.getMinutes() }]
  }
  if (cadence.kind === 'hourly') return [{ Minute: cadence.minute }]
  if (cadence.kind === 'daily') return [{ Hour: cadence.hour, Minute: cadence.minute }]
  if (cadence.kind === 'weekly') return cadence.weekdays.map((day) => ({ Weekday: day === 7 ? 0 : day, Hour: cadence.hour, Minute: cadence.minute }))
  return [{ Day: cadence.day, Hour: cadence.hour, Minute: cadence.minute }]
}
