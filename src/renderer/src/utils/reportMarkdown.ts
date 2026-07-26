import type { DailyReport, Task } from '../../../shared/types'
import { weekdayLabel } from './dates'

export type RangeView = 'week' | 'month'

export interface TaskGroup {
  name: string
  tasks: Task[]
}

// 按项目名分组,顺序跟随组内最早完成时间(completedBetween 已按 completed_at 升序)。
export function groupByProject(tasks: Task[]): TaskGroup[] {
  const groups = new Map<string, Task[]>()
  for (const task of tasks) {
    const name = task.projectName ?? '个人待办'
    const bucket = groups.get(name)
    if (bucket) bucket.push(task)
    else groups.set(name, [task])
  }
  return [...groups.entries()].map(([name, grouped]) => ({ name, tasks: grouped }))
}

// completed_at 是 UTC ISO,展示与导出都要落回本地时间。
export function completedStamp(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function buildRangeMarkdown(
  view: RangeView,
  range: { start: string; end: string },
  tasks: Task[],
  reports: DailyReport[]
): string {
  const lines = [view === 'week' ? `# 周报（${range.start} ~ ${range.end}）` : `# 月报（${range.start.slice(0, 7)}）`, '']
  lines.push(`## 完成任务（${tasks.length}）`, '')
  if (tasks.length === 0) {
    lines.push('（这段时间没有完成的任务）', '')
  } else {
    for (const group of groupByProject(tasks)) {
      lines.push(`### ${group.name}（${group.tasks.length}）`, '')
      for (const task of group.tasks) {
        lines.push(`- [x] ${task.title}${task.completedAt ? `（${completedStamp(task.completedAt)} 完成）` : ''}`)
        if (task.completionNote) lines.push(`  - ${task.completionNote}`)
      }
      lines.push('')
    }
  }
  lines.push('## 每日日报', '')
  if (reports.length === 0) {
    lines.push('（这段时间没有写过日报）', '')
  } else {
    for (const report of reports) {
      lines.push(`### ${report.reportDate}（${weekdayLabel(report.reportDate)}）`, '', report.content.trim(), '')
    }
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}
