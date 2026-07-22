import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, ChevronDown, ClipboardList, Edit3, Plus, Trash2 } from 'lucide-react'
import type { Project, Task, TaskDraft, TaskPriority, TaskStatus } from '../../../shared/types'
import { Modal } from '../components/Modal'

interface TasksPageProps {
  projects: Project[]
  fixedProjectId?: number
}

const emptyDraft: TaskDraft = {
  projectId: null,
  title: '',
  description: '',
  status: 'todo',
  priority: 'normal',
  completionNote: ''
}

const statusLabels: Record<TaskStatus, string> = {
  todo: '待处理',
  doing: '进行中',
  done: '已完成'
}

const priorityLabels: Record<TaskPriority, string> = {
  low: '低优先级',
  normal: '普通',
  high: '高优先级'
}

export function TasksPage({ projects, fixedProjectId }: TasksPageProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [scope, setScope] = useState<string>(fixedProjectId ? String(fixedProjectId) : 'all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [draft, setDraft] = useState<TaskDraft>({ ...emptyDraft, projectId: fixedProjectId ?? null })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const projectFilter = fixedProjectId ?? (scope === 'all' ? undefined : scope === 'personal' ? null : Number(scope))
    setTasks(await window.devdesk.tasks.list(projectFilter))
  }, [fixedProjectId, scope])

  useEffect(() => { void load() }, [load])

  const counts = useMemo(() => ({
    active: tasks.filter((task) => task.status !== 'done').length,
    done: tasks.filter((task) => task.status === 'done').length
  }), [tasks])

  const openCreate = (): void => {
    setEditing(null)
    setDraft({ ...emptyDraft, projectId: fixedProjectId ?? null })
    setError('')
    setDialogOpen(true)
  }

  const openEdit = (task: Task): void => {
    setEditing(task)
    setDraft({
      projectId: task.projectId,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      completionNote: task.completionNote
    })
    setError('')
    setDialogOpen(true)
  }

  const saveTask = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!draft.title.trim()) {
      setError('请输入任务标题。')
      return
    }
    setBusy(true)
    setError('')
    try {
      if (editing) await window.devdesk.tasks.update(editing.id, draft)
      else await window.devdesk.tasks.create(draft)
      setDialogOpen(false)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const setStatus = async (task: Task, status: TaskStatus): Promise<void> => {
    await window.devdesk.tasks.update(task.id, { status })
    await load()
  }

  const removeTask = async (task: Task): Promise<void> => {
    if (!window.confirm(`删除任务“${task.title}”？`)) return
    await window.devdesk.tasks.remove(task.id)
    await load()
  }

  return (
    <section className={fixedProjectId ? 'embedded-workspace' : 'page route-enter'}>
      <header className="page-header">
        <div>
          <p className="eyebrow">{fixedProjectId ? 'PROJECT TASKS' : 'TASKS'}</p>
          <h1>{fixedProjectId ? '项目任务' : '任务'}</h1>
          <p>{counts.active} 项待处理，{counts.done} 项已完成</p>
        </div>
        <button className="button primary" type="button" onClick={openCreate}>
          <Plus size={17} /> 新建任务
        </button>
      </header>

      {!fixedProjectId ? (
        <div className="toolbar">
          <label className="select-wrap">
            <span className="sr-only">任务范围</span>
            <select value={scope} onChange={(event) => setScope(event.target.value)}>
              <option value="all">全部任务</option>
              <option value="personal">个人待办</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <ChevronDown size={15} />
          </label>
        </div>
      ) : null}

      <div className="task-list" aria-live="polite">
        {tasks.length === 0 ? (
          <div className="empty-state">
            <ClipboardList size={30} />
            <h2>还没有任务</h2>
            <p>{fixedProjectId ? '记录这个项目下一步要完成的事情。' : '把临时想法记下来，稍后再分配给项目。'}</p>
            <button className="button secondary" type="button" onClick={openCreate}>创建第一项任务</button>
          </div>
        ) : tasks.map((task) => (
          <article className={`task-row ${task.status === 'done' ? 'is-done' : ''}`} key={task.id}>
            <button
              className="task-check"
              type="button"
              aria-label={task.status === 'done' ? '标记为待处理' : '标记为已完成'}
              onClick={() => void setStatus(task, task.status === 'done' ? 'todo' : 'done')}
            >
              {task.status === 'done' ? <Check size={16} /> : null}
            </button>
            <div className="task-copy">
              <div className="task-title-line">
                <h3>{task.title}</h3>
                <span className={`priority ${task.priority}`}>{priorityLabels[task.priority]}</span>
              </div>
              {task.description ? <p>{task.description}</p> : null}
              <div className="task-meta">
                <span>{task.projectName ?? '个人待办'}</span>
                {task.completionNote ? <span>完成说明：{task.completionNote}</span> : null}
              </div>
            </div>
            <label className="inline-select">
              <span className="sr-only">任务状态</span>
              <select value={task.status} onChange={(event) => void setStatus(task, event.target.value as TaskStatus)}>
                {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <button className="icon-button" type="button" onClick={() => openEdit(task)} aria-label={`编辑 ${task.title}`}><Edit3 size={16} /></button>
            <button className="icon-button danger" type="button" onClick={() => void removeTask(task)} aria-label={`删除 ${task.title}`}><Trash2 size={16} /></button>
          </article>
        ))}
      </div>

      <Modal
        open={dialogOpen}
        title={editing ? '编辑任务' : '新建任务'}
        description="个人待办与项目需求使用同一套任务记录。"
        submitLabel={editing ? '保存修改' : '创建任务'}
        busy={busy}
        onClose={() => setDialogOpen(false)}
        onSubmit={(event) => void saveTask(event)}
      >
        <div className="form-grid">
          <label className="field span-2">
            <span>标题</span>
            <input autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          </label>
          <label className="field span-2">
            <span>描述</span>
            <textarea rows={3} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
          </label>
          {!fixedProjectId ? (
            <label className="field">
              <span>归属</span>
              <select value={draft.projectId ?? ''} onChange={(event) => setDraft({ ...draft, projectId: event.target.value ? Number(event.target.value) : null })}>
                <option value="">个人待办</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
          ) : null}
          <label className="field">
            <span>优先级</span>
            <select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as TaskPriority })}>
              {Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>状态</span>
            <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as TaskStatus })}>
              {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field span-2">
            <span>完成说明</span>
            <textarea rows={2} value={draft.completionNote} onChange={(event) => setDraft({ ...draft, completionNote: event.target.value })} placeholder="完成后记录处理结果或关键决定" />
          </label>
          {error ? <p className="form-error span-2" role="alert">{error}</p> : null}
        </div>
      </Modal>
    </section>
  )
}
