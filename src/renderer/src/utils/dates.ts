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
