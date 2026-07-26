import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarDays, Check, ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { Task } from '../../../shared/types'
import { localDayUtcRange, reportDayLabel, shiftDate, timeLabel, todayLocal } from '../utils/dates'

const saveStateLabels = {
  idle: '',
  saving: '保存中…',
  saved: '已保存',
  error: '保存失败'
} as const

export function ReportsPage() {
  const [date, setDate] = useState<string>(todayLocal())
  const [today, setToday] = useState<string>(todayLocal())
  const [draft, setDraft] = useState('')
  const [completedTasks, setCompletedTasks] = useState<Task[]>([])
  const [reportDates, setReportDates] = useState<string[]>([])
  const [saveState, setSaveState] = useState<keyof typeof saveStateLabels>('idle')
  const [error, setError] = useState('')
  const draftRef = useRef('')
  const savedRef = useRef('')
  const dateRef = useRef(date)
  const timerRef = useRef<number | null>(null)

  const refreshDates = useCallback(async () => {
    setReportDates(await window.devcanopy.reports.dates())
  }, [])

  const persist = useCallback(async (targetDate: string): Promise<void> => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const content = draftRef.current
    if (content === savedRef.current) {
      setSaveState((current) => (current === 'saving' ? 'saved' : current))
      return
    }
    setSaveState('saving')
    try {
      await window.devcanopy.reports.save(targetDate, content)
      savedRef.current = content
      setSaveState('saved')
      setError('')
      void refreshDates()
    } catch (reason) {
      setSaveState('error')
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [refreshDates])

  useEffect(() => {
    let cancelled = false
    dateRef.current = date
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
      })
      .catch((reason) => {
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
    await persist(date)
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

      {error ? (
        <div className="error-banner" role="alert">
          {error}
          <button type="button" onClick={() => setError('')} aria-label="关闭错误"><X size={15} /></button>
        </div>
      ) : null}

      <div className="report-layout">
        <div className="report-main">
          <section className="panel report-editor">
            <header className="report-panel-head">正文</header>
            <textarea
              className="report-textarea"
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              onBlur={() => void persist(date)}
              placeholder="今天做了什么、卡在哪里、明天计划…"
              aria-label="日报正文"
            />
          </section>
          <section className="panel report-done">
            <header className="report-panel-head">当日完成任务 <em>{completedTasks.length}</em></header>
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
