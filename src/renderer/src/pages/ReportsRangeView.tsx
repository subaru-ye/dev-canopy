import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, ClipboardCopy } from 'lucide-react'
import type { DailyReport, Task } from '../../../shared/types'
import { ErrorBanner } from '../components/ErrorBanner'
import { localRangeUtc, monthRangeOf, shiftDate, weekRangeOf, weekdayLabel } from '../utils/dates'
import { buildRangeMarkdown, completedStamp, groupByProject, type RangeView } from '../utils/reportMarkdown'

export type { RangeView }

export function ReportsRangeView({
  view,
  anchor,
  today,
  onAnchorChange
}: {
  view: RangeView
  anchor: string
  today: string
  onAnchorChange: (next: string) => void
}) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [reports, setReports] = useState<DailyReport[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  const range = useMemo(() => (view === 'week' ? weekRangeOf(anchor) : monthRangeOf(anchor)), [view, anchor])
  const groups = useMemo(() => groupByProject(tasks), [tasks])
  const rangeLabel = view === 'week' ? `${range.start} ~ ${range.end}` : range.start.slice(0, 7)
  const containsToday = range.start <= today && today <= range.end

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const utc = localRangeUtc(range.start, range.end)
    Promise.all([
      window.devcanopy.tasks.completedBetween(utc.startIso, utc.endIso),
      window.devcanopy.reports.range(range.start, range.end)
    ])
      .then(([completedTasks, rangeReports]) => {
        if (cancelled) return
        setTasks(completedTasks)
        setReports(rangeReports)
        setError('')
        setLoading(false)
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => { cancelled = true }
  }, [range.start, range.end])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1_600)
    return () => window.clearTimeout(timer)
  }, [copied])

  // 周导航按整周平移;月导航跳到相邻月 1 号,避免 31 号平移进短月时溢出。
  const goPrev = (): void => {
    onAnchorChange(view === 'week' ? shiftDate(range.start, -7) : monthRangeOf(shiftDate(range.start, -1)).start)
  }
  const goNext = (): void => {
    onAnchorChange(view === 'week' ? shiftDate(range.start, 7) : shiftDate(range.end, 1))
  }

  const copyMarkdown = (): void => {
    navigator.clipboard.writeText(buildRangeMarkdown(view, range, tasks, reports))
    setCopied(true)
  }

  return (
    <>
      <div className="toolbar report-toolbar">
        <button className="button ghost" type="button" aria-label={view === 'week' ? '上一周' : '上一月'} onClick={goPrev}>
          <ChevronLeft size={16} />
        </button>
        <span className="report-range-label">{rangeLabel}</span>
        <button
          className="button ghost"
          type="button"
          aria-label={view === 'week' ? '下一周' : '下一月'}
          disabled={range.end >= today}
          onClick={goNext}
        >
          <ChevronRight size={16} />
        </button>
        <button className="button secondary" type="button" disabled={containsToday} onClick={() => onAnchorChange(today)}>
          {view === 'week' ? '本周' : '本月'}
        </button>
        <button className="button secondary report-range-copy" type="button" disabled={loading} onClick={copyMarkdown}>
          {copied ? <Check size={15} /> : <ClipboardCopy size={15} />}
          {copied ? '已复制' : '复制为 Markdown'}
        </button>
      </div>

      <ErrorBanner message={error} onClose={() => setError('')} />

      <div className="report-range-layout">
        <section className="panel report-done">
          <header className="report-panel-head">完成任务 <em>{tasks.length}</em></header>
          {loading ? (
            <p className="report-done-empty">正在读取…</p>
          ) : tasks.length === 0 ? (
            <p className="report-done-empty">这段时间没有完成的任务。</p>
          ) : groups.map((group) => (
            <div key={group.name}>
              <h3 className="report-group-head">
                {group.name} <em>{group.tasks.length}</em>
              </h3>
              {group.tasks.map((task) => (
                <div className="report-task-row" key={task.id}>
                  <span className="report-task-check"><Check size={14} /></span>
                  <div>
                    <h3>{task.title}</h3>
                    <div className="report-task-meta">
                      {task.completedAt ? <span>{completedStamp(task.completedAt)} 完成</span> : null}
                      {task.completionNote ? <span>{task.completionNote}</span> : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </section>
        <section className="panel report-done">
          <header className="report-panel-head">每日日报 <em>{reports.length}</em></header>
          {loading ? (
            <p className="report-done-empty">正在读取…</p>
          ) : reports.length === 0 ? (
            <p className="report-done-empty">这段时间没有写过日报。</p>
          ) : reports.map((report) => (
            <article className="report-range-entry" key={report.id}>
              <h3>
                {report.reportDate} <em>{weekdayLabel(report.reportDate)}</em>
              </h3>
              <pre>{report.content}</pre>
            </article>
          ))}
        </section>
      </div>
    </>
  )
}
