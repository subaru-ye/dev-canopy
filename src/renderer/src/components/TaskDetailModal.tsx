import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Check, ListChecks, NotebookPen, Pencil, Trash2 } from 'lucide-react'
import type { Task, TaskChecklistItem, TaskNote, TaskStatus } from '../../../shared/types'
import { dayLabel, timeLabel } from '../utils/dates'
import { priorityLabels, statusLabels } from '../utils/taskLabels'
import { Modal } from './Modal'

interface TaskDetailModalProps {
  task: Task
  onClose: () => void
  onEdit: (task: Task) => void
  onTaskChange: (task: Task) => void
  onMutated: () => void
}

export function TaskDetailModal({ task, onClose, onEdit, onTaskChange, onMutated }: TaskDetailModalProps) {
  const [notes, setNotes] = useState<TaskNote[]>([])
  const [checklist, setChecklist] = useState<TaskChecklistItem[]>([])
  const [noteDraft, setNoteDraft] = useState('')
  const [itemDraft, setItemDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      window.devcanopy.tasks.notes(task.id),
      window.devcanopy.tasks.checklist(task.id)
    ])
      .then(([nextNotes, nextChecklist]) => {
        if (cancelled) return
        setNotes(nextNotes)
        setChecklist(nextChecklist)
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [task.id])

  const run = async (action: () => Promise<void>): Promise<void> => {
    setError('')
    try {
      await action()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const addNote = (): Promise<void> => run(async () => {
    if (!noteDraft.trim()) return
    const note = await window.devcanopy.tasks.addNote(task.id, noteDraft)
    setNotes((current) => [note, ...current])
    setNoteDraft('')
    onMutated()
  })

  const removeNote = (note: TaskNote): Promise<void> => run(async () => {
    await window.devcanopy.tasks.removeNote(note.id)
    setNotes((current) => current.filter((entry) => entry.id !== note.id))
    onMutated()
  })

  const addChecklistItem = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void run(async () => {
      if (!itemDraft.trim()) return
      const item = await window.devcanopy.tasks.addChecklistItem(task.id, itemDraft)
      setChecklist((current) => [...current, item])
      setItemDraft('')
      onMutated()
    })
  }

  const toggleItem = (item: TaskChecklistItem): Promise<void> => run(async () => {
    const updated = await window.devcanopy.tasks.toggleChecklistItem(item.id, !item.done)
    setChecklist((current) => current.map((entry) => entry.id === updated.id ? updated : entry))
    onMutated()
  })

  const removeItem = (item: TaskChecklistItem): Promise<void> => run(async () => {
    await window.devcanopy.tasks.removeChecklistItem(item.id)
    setChecklist((current) => current.filter((entry) => entry.id !== item.id))
    onMutated()
  })

  const changeStatus = (status: TaskStatus): Promise<void> => run(async () => {
    const updated = await window.devcanopy.tasks.update(task.id, { status })
    onTaskChange(updated)
  })

  const onNoteKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      void addNote()
    }
  }

  const doneCount = checklist.filter((item) => item.done).length
  const noteGroups: Array<{ label: string; notes: TaskNote[] }> = []
  for (const note of notes) {
    const label = dayLabel(note.createdAt)
    const last = noteGroups[noteGroups.length - 1]
    if (last?.label === label) last.notes.push(note)
    else noteGroups.push({ label, notes: [note] })
  }

  return (
    <Modal
      open
      wide
      title={task.title}
      description={`${task.projectName ?? '个人待办'} · ${priorityLabels[task.priority]}${task.dueDate ? ` · 截止 ${task.dueDate}` : ''} · 创建于 ${dayLabel(task.createdAt)}`}
      headerActions={(
        <button className="icon-button" type="button" onClick={() => onEdit(task)} aria-label="编辑任务字段">
          <Pencil size={16} />
        </button>
      )}
      onClose={onClose}
    >
      <div className="task-detail">
        <div className="task-detail-status">
          <label className="inline-select">
            <span className="sr-only">任务状态</span>
            <select value={task.status} onChange={(event) => void changeStatus(event.target.value as TaskStatus)}>
              {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {task.status === 'done' && task.completedAt ? <span>完成于 {dayLabel(task.completedAt)} {timeLabel(task.completedAt)}</span> : null}
        </div>

        {task.description ? <p className="task-detail-description">{task.description}</p> : null}
        {task.status === 'done' && task.completionNote ? <p className="task-detail-completion">完成说明：{task.completionNote}</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}

        <section className="detail-section">
          <header>
            <ListChecks size={14} />
            <span>子任务</span>
            {checklist.length > 0 ? <em>{doneCount}/{checklist.length}</em> : null}
          </header>
          <div className="checklist">
            {checklist.map((item) => (
              <div className={`checklist-item ${item.done ? 'is-done' : ''}`} key={item.id}>
                <button
                  className="task-check small"
                  type="button"
                  aria-label={item.done ? `标记未完成 ${item.title}` : `标记完成 ${item.title}`}
                  onClick={() => void toggleItem(item)}
                >
                  {item.done ? <Check size={12} /> : null}
                </button>
                <span>{item.title}</span>
                <button className="icon-button ghost-mini danger" type="button" onClick={() => void removeItem(item)} aria-label={`删除子任务 ${item.title}`}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <form className="checklist-add" onSubmit={addChecklistItem}>
              <input
                value={itemDraft}
                onChange={(event) => setItemDraft(event.target.value)}
                placeholder="添加子任务，回车确认"
                aria-label="新子任务标题"
              />
            </form>
          </div>
        </section>

        <section className="detail-section">
          <header>
            <NotebookPen size={14} />
            <span>进展记录</span>
            {notes.length > 0 ? <em>{notes.length}</em> : null}
          </header>
          <div className="note-editor">
            <textarea
              rows={2}
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              onKeyDown={onNoteKeyDown}
              placeholder="记录今天推进了什么…（Ctrl+Enter 提交）"
              aria-label="新的进展记录"
            />
            <button className="button secondary" type="button" onClick={() => void addNote()} disabled={!noteDraft.trim()}>
              添加记录
            </button>
          </div>
          <div className="note-timeline">
            {loading ? <p className="note-empty">正在读取…</p> : null}
            {!loading && notes.length === 0 ? <p className="note-empty">还没有进展记录。做了什么随手记一条，回看时就是这个任务的完整脉络。</p> : null}
            {noteGroups.map((group) => (
              <div className="note-day" key={group.label}>
                <span className="note-day-label">{group.label}</span>
                {group.notes.map((note) => (
                  <article className="note-item" key={note.id}>
                    <span className="note-time">{timeLabel(note.createdAt)}</span>
                    <p>{note.content}</p>
                    <button className="icon-button ghost-mini danger" type="button" onClick={() => void removeNote(note)} aria-label="删除这条记录">
                      <Trash2 size={14} />
                    </button>
                  </article>
                ))}
              </div>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  )
}
