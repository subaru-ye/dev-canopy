export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function dayLabel(iso: string): string {
  const date = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (sameDay(date, today)) return '今天'
  if (sameDay(date, yesterday)) return '昨天'
  return date.toLocaleDateString('zh-CN', {
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function todayLocal(): string {
  return formatLocalDate(new Date())
}

// new Date('YYYY-MM-DD') 按 UTC 解析，负时区会偏移一天，必须手动拆分构造。
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function shiftDate(dateStr: string, delta: number): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  return formatLocalDate(new Date(year, month - 1, day + delta))
}

// 本地日历日对应的 UTC ISO 半开区间 [startIso, endIso)，供 completed_at 范围查询。
export function localDayUtcRange(dateStr: string): { startIso: string; endIso: string } {
  const [year, month, day] = dateStr.split('-').map(Number)
  return {
    startIso: new Date(year, month - 1, day).toISOString(),
    endIso: new Date(year, month - 1, day + 1).toISOString()
  }
}

// 所在周的 [周一, 周日] 本地日期闭区间;getDay() 周日返回 0,需折算成"距周一的天数"。
export function weekRangeOf(dateStr: string): { start: string; end: string } {
  const date = parseLocalDate(dateStr)
  const sinceMonday = (date.getDay() + 6) % 7
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - sinceMonday)
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
  return { start: formatLocalDate(monday), end: formatLocalDate(sunday) }
}

// 所在月的 [1 号, 月末] 本地日期闭区间;new Date(y, m, 0) 即上一个月最后一天。
export function monthRangeOf(dateStr: string): { start: string; end: string } {
  const [year, month] = dateStr.split('-').map(Number)
  return {
    start: formatLocalDate(new Date(year, month - 1, 1)),
    end: formatLocalDate(new Date(year, month, 0))
  }
}

// 本地日期闭区间 [startDate, endDate] 对应的 UTC ISO 半开区间。
export function localRangeUtc(startDate: string, endDate: string): { startIso: string; endIso: string } {
  return {
    startIso: parseLocalDate(startDate).toISOString(),
    endIso: parseLocalDate(shiftDate(endDate, 1)).toISOString()
  }
}

export function weekdayLabel(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString('zh-CN', { weekday: 'short' })
}

export function reportDayLabel(dateStr: string): string {
  const date = parseLocalDate(dateStr)
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (sameDay(date, today)) return '今天'
  if (sameDay(date, yesterday)) return '昨天'
  return date.toLocaleDateString('zh-CN', {
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
    month: 'long',
    day: 'numeric'
  })
}
