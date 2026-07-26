import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarDays, Check, ChevronLeft, ChevronRight, ListPlus, ScrollText } from 'lucide-react'
import type { Task } from '../../../shared/types'
import { ErrorBanner } from '../components/ErrorBanner'
import { localDayUtcRange, reportDayLabel, shiftDate, timeLabel, todayLocal } from '../utils/dates'

const saveStateLabels = {
  idle: '',
  saving: '保存中…',
  saved: '已保存',
  error: '保存失败'
} as const

// 先做模块常量,将来迁 settings 表做成可配置模板。
const REPORT_TEMPLATE = `## 今日进展
-

## 问题与阻塞
-

## 明日计划
-
`

function completedTaskMarkdown(task: Task): string {
  const meta = [task.projectName ?? '个人待办', task.completedAt ? `${timeLabel(task.completedAt)} 完成` : '']
    .filter(Boolean)
    .join(' · ')
  const lines = [`- [x] ${task.title}（${meta}）`]
  if (task.completionNote) lines.push(`  - ${task.completionNote}`)
  return lines.join('\n')
}

export function ReportsPage() {
  const [date, setDate] = useState<string>(todayLocal())
  const [today, setToday] = useState<string>(todayLocal())
  const [draft, setDraft] = useState('')
  const [completedTasks, setCompletedTasks] = useState<Task[]>([])
  const [reportDates, setReportDates] = useState<string[]>([])
  const [saveState, setSaveState] = useState<keyof typeof saveStateLabels>('idle')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const draftRef = useRef('')
  const savedRef = useRef('')
  const dateRef = useRef(date)
  const timerRef = useRef<number | null>(null)

  const refreshDates = useCallback(async () => {
    setReportDates(await window.devcanopy.reports.dates())
  }, [])

  const persist = useCallback(async (targetDate: string): Promise<boolean> => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const content = draftRef.current
    if (content === savedRef.current) {
      setSaveState((current) => (current === 'saving' ? 'saved' : current))
      return true
    }
    setSaveState('saving')
    try {
      await window.devcanopy.reports.save(targetDate, content)
      savedRef.current = content
      setSaveState('saved')
      setError('')
      void refreshDates()
      return true
    } catch (reason) {
      setSaveState('error')
      setError(reason instanceof Error ? reason.message : String(reason))
      return false
    }
  }, [refreshDates])

  useEffect(() => {
    let cancelled = false
    dateRef.current = date
    setLoading(true)
    const range = localDayUtcRange(date)
    Promise.all([
      window.devcanopy.reports.get(date),
      window.devcanopy.tasks.completedBetween(range.startIso, range.endIso)
    ])
      .then(([report, tasks]) => {
        if (cancelled) return
        const content = report?.content ?? ''
        setDraft(content)
        draftRef.current = content
        savedRef.current = content
        setSaveState('idle')
        setCompletedTasks(tasks)
        setLoading(false)
      })
      .catch((reason) => {
        // 加载失败时保持禁用:此刻 textarea 里还是上一个日期的内容,
        // 放开编辑会把旧日正文经自动保存写进当前日期。
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => { cancelled = true }
  }, [date])

  useEffect(() => { void refreshDates() }, [refreshDates])

  useEffect(() => {
    const update = (): void => setToday(todayLocal())
    window.addEventListener('focus', update)
    const interval = window.setInterval(update, 60_000)
    return () => {
      window.removeEventListener('focus', update)
      window.clearInterval(interval)
    }
  }, [])

  // 卸载（切换到其他页面）时抢救未落库的草稿。
  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    if (draftRef.current !== savedRef.current) {
      void window.devcanopy.reports.save(dateRef.current, draftRef.current)
    }
  }, [])

  const goToDate = useCallback(async (next: string): Promise<void> => {
    if (!next || next === date || next > today) return
    // 旧日期保存失败就留在原地,否则未保存内容会被新日期的加载覆盖而永久丢失。
    if (!(await persist(date))) return
    // 先禁用编辑再切日期,堵住"新内容加载完成前编辑旧草稿被写进新日期"的窗口。
    setLoading(true)
    setDate(next)
  }, [date, today, persist])

  const onDraftChange = (value: string): void => {
    setDraft(value)
    draftRef.current = value
    setSaveState('saving')
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    const target = date
    timerRef.current = window.setTimeout(() => { void persist(target) }, 800)
  }

  // 把完成任务清单转 Markdown 追加进正文,走 onDraftChange 触发既有自动保存。
  const insertCompletedTasks = (): void => {
    if (loading || completedTasks.length === 0) return
    const block = completedTasks.map(completedTaskMarkdown).join('\n')
    const base = draftRef.current
    onDraftChange(base.trim() === '' ? `${block}\n` : `${base.replace(/\s*$/, '')}\n\n${block}\n`)
  }

  return (
    <section className="page route-enter">
      <header className="page-header">
        <div>
          <p className="eyebrow">DAILY REPORT</p>
          <h1>日报</h1>
          <p>{reportDayLabel(date)} · 手写正文与当日完成任务</p>
        </div>
      </header>

      <div className="toolbar report-toolbar">
        <button className="button ghost" type="button" aria-label="前一天" onClick={() => void goToDate(shiftDate(date, -1))}>
          <ChevronLeft size={16} />
        </button>
        <input
          className="report-date-input"
          type="date"
          value={date}
          max={today}
          aria-label="选择日期"
          onChange={(event) => { if (event.target.value) void goToDate(event.target.value) }}
        />
        <button
          className="button ghost"
          type="button"
          aria-label="后一天"
          disabled={date >= today}
          onClick={() => void goToDate(shiftDate(date, 1))}
        >
          <ChevronRight size={16} />
        </button>
        <button className="button secondary" type="button" disabled={date === today} onClick={() => void goToDate(today)}>
          今天
        </button>
        <span className={`report-save-state ${saveState === 'error' ? 'is-error' : ''}`} aria-live="polite">
          {saveStateLabels[saveState]}
        </span>
      </div>

      <ErrorBanner message={error} onClose={() => setError('')} />

      <div className="report-layout">
        <div className="report-main">
          <section className="panel report-editor">
            <header className="report-panel-head">
              正文
              {!loading && draft.trim() === '' ? (
                <button
                  type="button"
                  className="report-head-action"
                  onClick={() => onDraftChange(REPORT_TEMPLATE)}
                >
                  <ScrollText size={13} />使用模板
                </button>
              ) : null}
            </header>
            <textarea
              className="report-textarea"
              value={draft}
              disabled={loading}
              onChange={(event) => onDraftChange(event.target.value)}
              onBlur={() => void persist(date)}
              placeholder={loading ? '正在读取…' : '今天做了什么、卡在哪里、明天计划…'}
              aria-label="日报正文"
            />
          </section>
          <section className="panel report-done">
            <header className="report-panel-head">
              当日完成任务 <em>{completedTasks.length}</em>
              {completedTasks.length > 0 ? (
                <button
                  type="button"
                  className="report-head-action"
                  disabled={loading}
                  onClick={insertCompletedTasks}
                >
                  <ListPlus size={13} />插入到正文
                </button>
              ) : null}
            </header>
            {completedTasks.length === 0 ? (
              <p className="report-done-empty">这一天没有完成的任务。</p>
            ) : completedTasks.map((task) => (
              <div className="report-task-row" key={task.id}>
                <span className="report-task-check"><Check size={14} /></span>
                <div>
                  <h3>{task.title}</h3>
                  <div className="report-task-meta">
                    <span>{task.projectName ?? '个人待办'}</span>
                    {task.completedAt ? <span>{timeLabel(task.completedAt)} 完成</span> : null}
                    {task.completionNote ? <span>{task.completionNote}</span> : null}
                  </div>
                </div>
              </div>
            ))}
          </section>
        </div>
        <aside className="panel report-history">
          <header className="report-panel-head"><CalendarDays size={14} /> 写过的日报</header>
          {reportDates.length === 0 ? (
            <p className="report-history-empty">还没有历史日报。写下第一篇，它会出现在这里。</p>
          ) : reportDates.map((entry) => (
            <button
              key={entry}
              type="button"
              className={`report-history-item ${entry === date ? 'is-active' : ''}`}
              onClick={() => void goToDate(entry)}
            >
              <span>{entry}</span>
              <em>{reportDayLabel(entry)}</em>
            </button>
          ))}
        </aside>
      </div>
    </section>
  )
}
