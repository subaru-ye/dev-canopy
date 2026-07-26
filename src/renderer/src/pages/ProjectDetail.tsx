import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  CircleStop,
  Clock3,
  ExternalLink,
  FileCode2,
  Folder,
  ListRestart,
  Pencil,
  Play,
  Plus,
  ScrollText,
  SquareTerminal,
  Trash2,
  X
} from 'lucide-react'
import type {
  CommandConfig,
  CommandDraft,
  CommandRuntime,
  DetectionType,
  Project
} from '../../../shared/types'
import { ErrorBanner } from '../components/ErrorBanner'
import { Modal } from '../components/Modal'
import { StatusBadge } from '../components/StatusBadge'
import { useEditDialog } from '../hooks/useEditDialog'
import { useNewItemShortcut } from '../hooks/useNewItemShortcut'
import { TasksPage } from './TasksPage'

interface ProjectDetailProps {
  project: Project
  projects: Project[]
  reloadProjects: () => Promise<void>
  onBack: () => void
}

type ProjectTab = 'commands' | 'tasks' | 'settings'

const emptyCommand = (projectId: number): CommandDraft => ({
  projectId,
  name: '',
  command: '',
  workingDirectory: '',
  shell: '',
  detectionType: 'none',
  detectionValue: ''
})

function formatDuration(startedAt: string | null): string {
  if (!startedAt) return '—'
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return [hours, minutes, rest].map((part) => String(part).padStart(2, '0')).join(':')
}

export function ProjectDetail({ project, projects, reloadProjects, onBack }: ProjectDetailProps) {
  const [tab, setTab] = useState<ProjectTab>('commands')
  const [commands, setCommands] = useState<CommandConfig[]>([])
  const [runtimes, setRuntimes] = useState<Record<number, CommandRuntime>>({})
  const [actionIds, setActionIds] = useState<Set<number>>(new Set())
  const [error, setError] = useState('')
  const [logCommand, setLogCommand] = useState<CommandConfig | null>(null)
  const [logText, setLogText] = useState('')
  const dialog = useEditDialog<CommandConfig, CommandDraft>(emptyCommand(project.id))

  // 任务 tab 的 Ctrl+N 由内嵌 TasksPage 响应,这里只接管命令 tab。
  useNewItemShortcut(() => {
    if (tab === 'commands' && !dialog.open && !logCommand) dialog.openCreate(emptyCommand(project.id))
  })

  const loadCommands = useCallback(async () => {
    const [nextCommands, statuses] = await Promise.all([
      window.devcanopy.commands.list(project.id),
      window.devcanopy.commands.statuses(project.id)
    ])
    setCommands(nextCommands)
    setRuntimes(Object.fromEntries(statuses.map((runtime) => [runtime.commandId, runtime])))
  }, [project.id])

  useEffect(() => {
    void loadCommands()
    const interval = window.setInterval(() => void loadCommands(), 5_000)
    return () => window.clearInterval(interval)
  }, [loadCommands])

  useEffect(() => window.devcanopy.commands.onLog(({ commandId, chunk }) => {
    if (logCommand?.id === commandId) setLogText((previous) => (previous + chunk).slice(-200_000))
  }), [logCommand])

  const runningCount = useMemo(
    () => Object.values(runtimes).filter((runtime) => runtime.state === 'running').length,
    [runtimes]
  )

  const saveCommand = (event: React.FormEvent<HTMLFormElement>): void => {
    void dialog.submit(event, async () => {
      if (dialog.editing) await window.devcanopy.commands.update(dialog.editing.id, dialog.draft)
      else await window.devcanopy.commands.create(dialog.draft)
      await loadCommands()
      await reloadProjects()
    })
  }

  const runAction = async (command: CommandConfig, action: 'start' | 'stop' | 'restart'): Promise<void> => {
    setActionIds((current) => new Set(current).add(command.id))
    setError('')
    try {
      let runtime: CommandRuntime
      if (action === 'restart') {
        await window.devcanopy.commands.stop(command.id)
        runtime = await window.devcanopy.commands.start(command.id)
      } else {
        runtime = action === 'start'
          ? await window.devcanopy.commands.start(command.id)
          : await window.devcanopy.commands.stop(command.id)
      }
      setRuntimes((current) => ({ ...current, [command.id]: runtime }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setActionIds((current) => {
        const next = new Set(current)
        next.delete(command.id)
        return next
      })
      await loadCommands()
    }
  }

  const runAll = async (action: 'start' | 'stop'): Promise<void> => {
    for (const command of commands) {
      const runtime = runtimes[command.id]
      if (action === 'start' && runtime?.state === 'running') continue
      if (action === 'stop' && runtime?.state !== 'running') continue
      await runAction(command, action)
    }
  }

  const openLogs = async (command: CommandConfig): Promise<void> => {
    setLogCommand(command)
    setLogText(await window.devcanopy.commands.logs(command.id))
  }

  const editCommand = (command: CommandConfig): void => {
    dialog.openEdit(command, {
      projectId: command.projectId,
      name: command.name,
      command: command.command,
      workingDirectory: command.workingDirectory,
      shell: command.shell,
      detectionType: command.detectionType,
      detectionValue: command.detectionValue
    })
  }

  const removeCommand = async (command: CommandConfig): Promise<void> => {
    const runtime = runtimes[command.id]
    if (runtime?.state === 'running') {
      setError('请先停止命令，再删除配置。')
      return
    }
    if (!window.confirm(`删除命令“${command.name}”？`)) return
    await window.devcanopy.commands.remove(command.id)
    await loadCommands()
    await reloadProjects()
  }

  const openWith = async (target: 'editor' | 'terminal'): Promise<void> => {
    try {
      if (target === 'editor') await window.devcanopy.projects.openEditor(project.path)
      else await window.devcanopy.projects.openTerminal(project.path)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const removeProject = async (): Promise<void> => {
    if (!window.confirm(`从 DevCanopy 移除“${project.name}”？项目文件不会被删除。`)) return
    await window.devcanopy.projects.remove(project.id)
    await reloadProjects()
    onBack()
  }

  return (
    <section className="page project-detail route-enter">
      <header className="project-detail-header">
        <button className="back-button" type="button" onClick={onBack}><ArrowLeft size={17} /> 项目</button>
        <div className="project-heading">
          <span className="project-mark large"><Folder size={21} /></span>
          <div><h1>{project.name}</h1><code>{project.path}</code></div>
        </div>
        <div className="project-summary">
          <span className={runningCount > 0 ? 'summary-live' : undefined}>
            {runningCount > 0 ? <span className="live-dot" aria-hidden="true" /> : null}
            <b>{runningCount}</b> 正在运行
          </span>
          <span><b>{commands.length}</b> 条命令</span>
        </div>
        <div className="button-group">
          <button className="button ghost" type="button" onClick={() => void window.devcanopy.projects.reveal(project.path)}><ExternalLink size={15} /> 打开目录</button>
          <button className="button ghost" type="button" onClick={() => void openWith('editor')}><FileCode2 size={15} /> VS Code</button>
          <button className="button ghost" type="button" onClick={() => void openWith('terminal')}><SquareTerminal size={15} /> 终端</button>
        </div>
      </header>

      <nav className="project-tabs" aria-label="项目页面">
        <button className={tab === 'commands' ? 'active' : ''} type="button" onClick={() => setTab('commands')}>命令与进程</button>
        <button className={tab === 'tasks' ? 'active' : ''} type="button" onClick={() => setTab('tasks')}>项目任务</button>
        <button className={tab === 'settings' ? 'active' : ''} type="button" onClick={() => setTab('settings')}>项目设置</button>
      </nav>

      <ErrorBanner message={error} onClose={() => setError('')} />

      {tab === 'commands' ? (
        <div className="project-workspace">
          <div className="workspace-heading">
            <div><p className="eyebrow">SERVICES</p><h2>命令与进程</h2><p>每 5 秒识别 DevCanopy 与外部终端启动的项目命令。</p></div>
            <div className="button-group">
              <button className="button ghost" type="button" onClick={() => void runAll('start')} disabled={commands.length === 0}><Play size={15} /> 全部启动</button>
              <button className="button ghost" type="button" onClick={() => void runAll('stop')} disabled={runningCount === 0}><CircleStop size={15} /> 全部停止</button>
              <button className="button primary" type="button" onClick={() => dialog.openCreate(emptyCommand(project.id))}><Plus size={16} /> 添加命令</button>
            </div>
          </div>

          {commands.length === 0 ? (
            <div className="empty-state"><SquareTerminal size={31} /><h2>还没有命令</h2><p>添加前端、后端或桌面端的长期运行命令。</p><button className="button secondary" type="button" onClick={() => dialog.openCreate(emptyCommand(project.id))}>添加第一条命令</button></div>
          ) : (
            <div className="command-table">
              <div className="command-table-head"><span>命令</span><span>状态</span><span>PID / 检测</span><span>持续时间</span><span>操作</span></div>
              {commands.map((command) => {
                const runtime = runtimes[command.id] ?? { commandId: command.id, state: 'unknown', pid: null, startedAt: null, source: null, detail: null }
                const busy = actionIds.has(command.id)
                return (
                  <article className={`command-row${runtime.state === 'running' ? ' is-running' : ''}`} key={command.id}>
                    <div className="command-copy"><strong>{command.name}</strong><code>{command.command}</code>{command.workingDirectory ? <span>cwd: {command.workingDirectory}</span> : null}</div>
                    <StatusBadge state={busy ? (runtime.state === 'running' ? 'stopping' : 'starting') : runtime.state} />
                    <div className="runtime-detail"><code>{runtime.pid ? `PID ${runtime.pid}` : runtime.detail ?? '—'}</code>{command.detectionType !== 'none' ? <span>{command.detectionType}: {command.detectionValue}</span> : null}</div>
                    <div className="duration"><Clock3 size={14} /><span>{formatDuration(runtime.startedAt)}</span></div>
                    <div className="row-actions">
                      {runtime.state === 'running' ? (
                        <button className="icon-button" type="button" onClick={() => void runAction(command, 'stop')} disabled={busy || !runtime.pid} aria-label={`停止 ${command.name}`} title={!runtime.pid ? '此检测方式无法定位 PID' : '停止'}><CircleStop size={17} /></button>
                      ) : (
                        <button className="icon-button accent" type="button" onClick={() => void runAction(command, 'start')} disabled={busy} aria-label={`启动 ${command.name}`}><Play size={17} /></button>
                      )}
                      {runtime.state === 'running' && runtime.pid ? <button className="icon-button" type="button" onClick={() => void runAction(command, 'restart')} disabled={busy} aria-label={`重启 ${command.name}`}><ListRestart size={17} /></button> : null}
                      <button className="icon-button" type="button" onClick={() => void openLogs(command)} aria-label={`查看 ${command.name} 日志`}><ScrollText size={17} /></button>
                      <button className="icon-button" type="button" onClick={() => editCommand(command)} disabled={runtime.state === 'running'} aria-label={`编辑 ${command.name}`}><Pencil size={16} /></button>
                      <button className="icon-button danger" type="button" onClick={() => void removeCommand(command)} aria-label={`删除 ${command.name}`}><Trash2 size={16} /></button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      ) : null}

      {tab === 'tasks' ? <TasksPage projects={projects} fixedProjectId={project.id} /> : null}

      {tab === 'settings' ? (
        <div className="project-workspace settings-panel">
          <div className="workspace-heading"><div><p className="eyebrow">PROJECT SETTINGS</p><h2>项目设置</h2><p>DevCanopy 只保存目录引用，不会修改或删除项目文件。</p></div></div>
          <div className="setting-row"><FileCode2 size={19} /><div><h2>项目目录</h2><p>命令的默认工作目录。</p></div><code>{project.path}</code></div>
          <div className="danger-zone"><div><h3>从 DevCanopy 移除</h3><p>删除命令和项目任务记录，保留本地项目文件。</p></div><button className="button danger" type="button" onClick={() => void removeProject()}><Trash2 size={15} /> 移除项目</button></div>
        </div>
      ) : null}

      <Modal open={dialog.open} title={dialog.editing ? '编辑命令' : '添加命令'} description="保存一个需要长期运行或持续检测的开发命令。" submitLabel={dialog.editing ? '保存修改' : '添加命令'} busy={dialog.busy} onClose={dialog.close} onSubmit={saveCommand}>
        <div className="form-grid">
          <label className="field"><span>显示名称</span><input autoFocus value={dialog.draft.name} onChange={(event) => dialog.setDraft({ ...dialog.draft, name: event.target.value })} placeholder="例如：前端" /></label>
          <label className="field"><span>相对工作目录</span><input value={dialog.draft.workingDirectory} onChange={(event) => dialog.setDraft({ ...dialog.draft, workingDirectory: event.target.value })} placeholder="留空使用项目根目录" /></label>
          <label className="field span-2"><span>命令</span><input className="mono-input" value={dialog.draft.command} onChange={(event) => dialog.setDraft({ ...dialog.draft, command: event.target.value })} placeholder="pnpm dev" /></label>
          <label className="field"><span>运行检测</span><select value={dialog.draft.detectionType} onChange={(event) => dialog.setDraft({ ...dialog.draft, detectionType: event.target.value as DetectionType, detectionValue: '' })}><option value="none">自动识别项目命令（推荐）</option><option value="port">监听端口</option><option value="health">健康检查 URL</option><option value="process">进程关键词</option></select></label>
          <label className="field"><span>检测值</span><input value={dialog.draft.detectionValue} onChange={(event) => dialog.setDraft({ ...dialog.draft, detectionValue: event.target.value })} disabled={dialog.draft.detectionType === 'none'} placeholder={dialog.draft.detectionType === 'port' ? '5173' : dialog.draft.detectionType === 'health' ? 'http://localhost:3000/health' : dialog.draft.detectionType === 'process' ? 'vite' : '无需填写'} /></label>
          {dialog.error ? <p className="form-error span-2" role="alert">{dialog.error}</p> : null}
        </div>
      </Modal>

      {logCommand ? (
        <aside className="log-panel" aria-label={`${logCommand.name} 日志`}>
          <header><div><span>LIVE LOG</span><strong>{logCommand.name}</strong></div><button className="icon-button" type="button" onClick={() => setLogCommand(null)} aria-label="关闭日志"><X size={18} /></button></header>
          <pre>{logText || '暂无由 DevCanopy 捕获的日志。外部终端启动的进程无法接管此前输出。'}</pre>
        </aside>
      ) : null}
    </section>
  )
}
