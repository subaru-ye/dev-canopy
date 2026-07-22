import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  ChevronRight,
  CircleStop,
  Clock3,
  ExternalLink,
  FileCode2,
  Folder,
  FolderOpen,
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
  FolderInspection,
  Project
} from '../../../shared/types'
import { Modal } from '../components/Modal'
import { StatusBadge } from '../components/StatusBadge'
import { TasksPage } from './TasksPage'

interface ProjectsPageProps {
  projects: Project[]
  reloadProjects: () => Promise<void>
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

export function ProjectsPage({ projects, reloadProjects }: ProjectsPageProps) {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [tab, setTab] = useState<ProjectTab>('commands')
  const [inspection, setInspection] = useState<FolderInspection | null>(null)
  const [importName, setImportName] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [commandDialog, setCommandDialog] = useState(false)
  const [commandDraft, setCommandDraft] = useState<CommandDraft | null>(null)
  const [editingCommand, setEditingCommand] = useState<CommandConfig | null>(null)
  const [commands, setCommands] = useState<CommandConfig[]>([])
  const [runtimes, setRuntimes] = useState<Record<number, CommandRuntime>>({})
  const [actionIds, setActionIds] = useState<Set<number>>(new Set())
  const [error, setError] = useState('')
  const [logCommand, setLogCommand] = useState<CommandConfig | null>(null)
  const [logText, setLogText] = useState('')

  const loadCommands = useCallback(async () => {
    if (!selectedProject) return
    const [nextCommands, statuses] = await Promise.all([
      window.devdesk.commands.list(selectedProject.id),
      window.devdesk.commands.statuses(selectedProject.id)
    ])
    setCommands(nextCommands)
    setRuntimes(Object.fromEntries(statuses.map((runtime) => [runtime.commandId, runtime])))
  }, [selectedProject])

  useEffect(() => {
    if (!selectedProject) return
    void loadCommands()
    const interval = window.setInterval(() => void loadCommands(), 2_500)
    return () => window.clearInterval(interval)
  }, [selectedProject, loadCommands])

  useEffect(() => window.devdesk.commands.onLog(({ commandId, chunk }) => {
    if (logCommand?.id === commandId) setLogText((previous) => (previous + chunk).slice(-200_000))
  }), [logCommand])

  const runningCount = useMemo(
    () => Object.values(runtimes).filter((runtime) => runtime.state === 'running').length,
    [runtimes]
  )

  const beginImport = async (): Promise<void> => {
    setError('')
    try {
      const result = await window.devdesk.projects.selectFolder()
      if (!result) return
      setInspection(result)
      setImportName(result.name)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const toggleScript = (name: string): void => {
    if (!inspection) return
    setInspection({
      ...inspection,
      scripts: inspection.scripts.map((script) => script.name === name ? { ...script, selected: !script.selected } : script)
    })
  }

  const importProject = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!inspection || !importName.trim()) return
    setImportBusy(true)
    setError('')
    try {
      const project = await window.devdesk.projects.create({
        name: importName,
        path: inspection.path,
        commands: inspection.scripts
          .filter((script) => script.selected)
          .map((script) => ({ name: script.name, command: script.command, workingDirectory: '' }))
      })
      setInspection(null)
      await reloadProjects()
      setSelectedProject(project)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setImportBusy(false)
    }
  }

  const createCommand = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!commandDraft) return
    setError('')
    try {
      if (editingCommand) await window.devdesk.commands.update(editingCommand.id, commandDraft)
      else await window.devdesk.commands.create(commandDraft)
      setCommandDialog(false)
      setEditingCommand(null)
      await loadCommands()
      await reloadProjects()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const runAction = async (command: CommandConfig, action: 'start' | 'stop' | 'restart'): Promise<void> => {
    setActionIds((current) => new Set(current).add(command.id))
    setError('')
    try {
      let runtime: CommandRuntime
      if (action === 'restart') {
        await window.devdesk.commands.stop(command.id)
        runtime = await window.devdesk.commands.start(command.id)
      } else {
        runtime = action === 'start'
          ? await window.devdesk.commands.start(command.id)
          : await window.devdesk.commands.stop(command.id)
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
    setLogText(await window.devdesk.commands.logs(command.id))
  }

  const editCommand = (command: CommandConfig): void => {
    setEditingCommand(command)
    setCommandDraft({
      projectId: command.projectId,
      name: command.name,
      command: command.command,
      workingDirectory: command.workingDirectory,
      shell: command.shell,
      detectionType: command.detectionType,
      detectionValue: command.detectionValue
    })
    setCommandDialog(true)
  }

  const removeCommand = async (command: CommandConfig): Promise<void> => {
    const runtime = runtimes[command.id]
    if (runtime?.state === 'running') {
      setError('请先停止命令，再删除配置。')
      return
    }
    if (!window.confirm(`删除命令“${command.name}”？`)) return
    await window.devdesk.commands.remove(command.id)
    await loadCommands()
    await reloadProjects()
  }

  const removeProject = async (): Promise<void> => {
    if (!selectedProject || !window.confirm(`从 DevDesk 移除“${selectedProject.name}”？项目文件不会被删除。`)) return
    await window.devdesk.projects.remove(selectedProject.id)
    setSelectedProject(null)
    await reloadProjects()
  }

  if (!selectedProject) {
    return (
      <section className="page route-enter">
        <header className="page-header">
          <div>
            <p className="eyebrow">LOCAL PROJECTS</p>
            <h1>项目</h1>
            <p>导入本地目录，集中管理长期运行的开发命令。</p>
          </div>
          <button className="button primary" type="button" onClick={() => void beginImport()}>
            <FolderOpen size={17} /> 导入项目
          </button>
        </header>

        {error ? <div className="error-banner" role="alert">{error}<button type="button" onClick={() => setError('')} aria-label="关闭错误"><X size={15} /></button></div> : null}

        {projects.length === 0 ? (
          <div className="empty-state project-empty">
            <Folder size={34} />
            <h2>从一个本地项目开始</h2>
            <p>DevDesk 会读取 package.json，帮助你选择需要长期管理的开发命令。</p>
            <button className="button secondary" type="button" onClick={() => void beginImport()}>选择目录</button>
          </div>
        ) : (
          <div className="project-list">
            {projects.map((project, index) => (
              <button
                className="project-row"
                type="button"
                key={project.id}
                onClick={() => { setSelectedProject(project); setTab('commands'); setError('') }}
                style={{ '--row-index': index } as React.CSSProperties}
              >
                <span className="project-mark"><Folder size={19} /></span>
                <span className="project-main">
                  <strong>{project.name}</strong>
                  <code>{project.path}</code>
                </span>
                <span className="project-count"><b>{project.commandCount}</b> 条命令</span>
                <span className="project-count"><b>{project.taskCount}</b> 项待办</span>
                <ChevronRight size={18} />
              </button>
            ))}
          </div>
        )}

        <Modal
          open={Boolean(inspection)}
          title="导入项目"
          description="选择需要在项目内长期记录和管理的命令。"
          submitLabel="导入项目"
          busy={importBusy}
          onClose={() => setInspection(null)}
          onSubmit={(event) => void importProject(event)}
        >
          {inspection ? (
            <div className="form-grid">
              <label className="field span-2"><span>项目名称</span><input autoFocus value={importName} onChange={(event) => setImportName(event.target.value)} /></label>
              <label className="field span-2"><span>本地目录</span><input value={inspection.path} readOnly /></label>
              <div className="field span-2">
                <span>检测到的命令</span>
                <div className="script-picker">
                  {inspection.scripts.length === 0 ? <p>未检测到 package.json scripts，可以导入后手动添加命令。</p> : inspection.scripts.map((script) => (
                    <label key={script.name}>
                      <input type="checkbox" checked={script.selected} onChange={() => toggleScript(script.name)} />
                      <strong>{script.name}</strong>
                      <code>{script.command}</code>
                    </label>
                  ))}
                </div>
              </div>
              {error ? <p className="form-error span-2" role="alert">{error}</p> : null}
            </div>
          ) : null}
        </Modal>
      </section>
    )
  }

  return (
    <section className="page project-detail route-enter">
      <header className="project-detail-header">
        <button className="back-button" type="button" onClick={() => setSelectedProject(null)}><ArrowLeft size={17} /> 项目</button>
        <div className="project-heading">
          <span className="project-mark large"><Folder size={21} /></span>
          <div><h1>{selectedProject.name}</h1><code>{selectedProject.path}</code></div>
        </div>
        <div className="project-summary">
          <span><b>{runningCount}</b> 正在运行</span>
          <span><b>{commands.length}</b> 条命令</span>
        </div>
        <button className="button ghost" type="button" onClick={() => void window.devdesk.projects.reveal(selectedProject.path)}><ExternalLink size={15} /> 打开目录</button>
      </header>

      <nav className="project-tabs" aria-label="项目页面">
        <button className={tab === 'commands' ? 'active' : ''} type="button" onClick={() => setTab('commands')}>命令与进程</button>
        <button className={tab === 'tasks' ? 'active' : ''} type="button" onClick={() => setTab('tasks')}>项目任务</button>
        <button className={tab === 'settings' ? 'active' : ''} type="button" onClick={() => setTab('settings')}>项目设置</button>
      </nav>

      {error ? <div className="error-banner" role="alert">{error}<button type="button" onClick={() => setError('')} aria-label="关闭错误"><X size={15} /></button></div> : null}

      {tab === 'commands' ? (
        <div className="project-workspace">
          <div className="workspace-heading">
            <div><p className="eyebrow">SERVICES</p><h2>命令与进程</h2><p>每 2.5 秒识别 DevDesk 与外部终端启动的项目命令。</p></div>
            <div className="button-group">
              <button className="button ghost" type="button" onClick={() => void runAll('start')} disabled={commands.length === 0}><Play size={15} /> 全部启动</button>
              <button className="button ghost" type="button" onClick={() => void runAll('stop')} disabled={runningCount === 0}><CircleStop size={15} /> 全部停止</button>
              <button className="button primary" type="button" onClick={() => { setEditingCommand(null); setCommandDraft(emptyCommand(selectedProject.id)); setCommandDialog(true) }}><Plus size={16} /> 添加命令</button>
            </div>
          </div>

          {commands.length === 0 ? (
            <div className="empty-state"><SquareTerminal size={31} /><h2>还没有命令</h2><p>添加前端、后端或桌面端的长期运行命令。</p><button className="button secondary" type="button" onClick={() => { setEditingCommand(null); setCommandDraft(emptyCommand(selectedProject.id)); setCommandDialog(true) }}>添加第一条命令</button></div>
          ) : (
            <div className="command-table">
              <div className="command-table-head"><span>命令</span><span>状态</span><span>PID / 检测</span><span>持续时间</span><span>操作</span></div>
              {commands.map((command) => {
                const runtime = runtimes[command.id] ?? { commandId: command.id, state: 'unknown', pid: null, startedAt: null, source: null, detail: null }
                const busy = actionIds.has(command.id)
                return (
                  <article className="command-row" key={command.id}>
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

      {tab === 'tasks' ? <TasksPage projects={projects} fixedProjectId={selectedProject.id} /> : null}

      {tab === 'settings' ? (
        <div className="project-workspace settings-panel">
          <div className="workspace-heading"><div><p className="eyebrow">PROJECT SETTINGS</p><h2>项目设置</h2><p>DevDesk 只保存目录引用，不会修改或删除项目文件。</p></div></div>
          <div className="setting-row"><FileCode2 size={19} /><div><h2>项目目录</h2><p>命令的默认工作目录。</p></div><code>{selectedProject.path}</code></div>
          <div className="danger-zone"><div><h3>从 DevDesk 移除</h3><p>删除命令和项目任务记录，保留本地项目文件。</p></div><button className="button danger" type="button" onClick={() => void removeProject()}><Trash2 size={15} /> 移除项目</button></div>
        </div>
      ) : null}

      <Modal open={commandDialog} title={editingCommand ? '编辑命令' : '添加命令'} description="保存一个需要长期运行或持续检测的开发命令。" submitLabel={editingCommand ? '保存修改' : '添加命令'} onClose={() => { setCommandDialog(false); setEditingCommand(null) }} onSubmit={(event) => void createCommand(event)}>
        {commandDraft ? (
          <div className="form-grid">
            <label className="field"><span>显示名称</span><input autoFocus value={commandDraft.name} onChange={(event) => setCommandDraft({ ...commandDraft, name: event.target.value })} placeholder="例如：前端" /></label>
            <label className="field"><span>相对工作目录</span><input value={commandDraft.workingDirectory} onChange={(event) => setCommandDraft({ ...commandDraft, workingDirectory: event.target.value })} placeholder="留空使用项目根目录" /></label>
            <label className="field span-2"><span>命令</span><input className="mono-input" value={commandDraft.command} onChange={(event) => setCommandDraft({ ...commandDraft, command: event.target.value })} placeholder="pnpm dev" /></label>
            <label className="field"><span>运行检测</span><select value={commandDraft.detectionType} onChange={(event) => setCommandDraft({ ...commandDraft, detectionType: event.target.value as DetectionType, detectionValue: '' })}><option value="none">自动识别项目命令（推荐）</option><option value="port">监听端口</option><option value="health">健康检查 URL</option><option value="process">进程关键词</option></select></label>
            <label className="field"><span>检测值</span><input value={commandDraft.detectionValue} onChange={(event) => setCommandDraft({ ...commandDraft, detectionValue: event.target.value })} disabled={commandDraft.detectionType === 'none'} placeholder={commandDraft.detectionType === 'port' ? '5173' : commandDraft.detectionType === 'health' ? 'http://localhost:3000/health' : commandDraft.detectionType === 'process' ? 'vite' : '无需填写'} /></label>
          </div>
        ) : null}
      </Modal>

      {logCommand ? (
        <aside className="log-panel" aria-label={`${logCommand.name} 日志`}>
          <header><div><span>LIVE LOG</span><strong>{logCommand.name}</strong></div><button className="icon-button" type="button" onClick={() => setLogCommand(null)} aria-label="关闭日志"><X size={18} /></button></header>
          <pre>{logText || '暂无由 DevDesk 捕获的日志。外部终端启动的进程无法接管此前输出。'}</pre>
        </aside>
      ) : null}
    </section>
  )
}
