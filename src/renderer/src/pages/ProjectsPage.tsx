import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ChevronRight, Folder, FolderOpen } from 'lucide-react'
import type { FolderInspection, Project } from '../../../shared/types'
import { ErrorBanner } from '../components/ErrorBanner'
import { Modal } from '../components/Modal'
import { useNewItemShortcut } from '../hooks/useNewItemShortcut'
import { clearJumpIntent, peekJumpIntent } from '../jump'
import { ProjectDetail } from './ProjectDetail'

interface ProjectsPageProps {
  projects: Project[]
  reloadProjects: () => Promise<void>
}

export function ProjectsPage({ projects, reloadProjects }: ProjectsPageProps) {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [inspection, setInspection] = useState<FolderInspection | null>(null)
  const [importName, setImportName] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [error, setError] = useState('')

  const totals = useMemo(() => ({
    commands: projects.reduce((sum, project) => sum + project.commandCount, 0),
    tasks: projects.reduce((sum, project) => sum + project.taskCount, 0)
  }), [projects])

  // 全局搜索跳转:项目清单就绪后直接进入目标项目详情。
  useEffect(() => {
    const intent = peekJumpIntent('project')
    if (!intent || projects.length === 0) return
    clearJumpIntent()
    const target = projects.find((project) => project.id === intent.id)
    if (target) setSelectedProject(target)
  }, [projects])

  // 项目详情打开时不劫持:详情页的命令/任务弹窗由 ProjectDetail 与内嵌 TasksPage 处理。
  useNewItemShortcut(() => {
    if (!selectedProject && !inspection && !importBusy) void beginImport()
  })

  const beginImport = async (): Promise<void> => {
    setError('')
    try {
      const result = await window.devcanopy.projects.selectFolder()
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
      const project = await window.devcanopy.projects.create({
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

  if (selectedProject) {
    return (
      <ProjectDetail
        project={selectedProject}
        projects={projects}
        reloadProjects={reloadProjects}
        onBack={() => setSelectedProject(null)}
      />
    )
  }

  return (
    <section className="page route-enter">
      <header className="page-header">
        <div>
          <p className="eyebrow">LOCAL PROJECTS</p>
          <h1>项目</h1>
          <p>导入本地目录，集中管理长期运行的开发命令。</p>
          {projects.length > 0 ? (
            <div className="page-stats">
              <span><b>{projects.length}</b> 个项目</span>
              <span><b>{totals.commands}</b> 条命令</span>
              <span><b>{totals.tasks}</b> 项待办</span>
            </div>
          ) : null}
        </div>
        <button className="button primary" type="button" onClick={() => void beginImport()}>
          <FolderOpen size={17} /> 导入项目
        </button>
      </header>

      <ErrorBanner message={error} onClose={() => setError('')} />

      {projects.length === 0 ? (
        <div className="empty-state project-empty">
          <Folder size={34} />
          <h2>从一个本地项目开始</h2>
          <p>DevCanopy 会读取 package.json，帮助你选择需要长期管理的开发命令。</p>
          <button className="button secondary" type="button" onClick={() => void beginImport()}>选择目录</button>
        </div>
      ) : (
        <div className="project-grid">
          {projects.map((project, index) => (
            <button
              className="project-card"
              type="button"
              key={project.id}
              onClick={() => { setSelectedProject(project); setError('') }}
              style={{ '--row-index': index } as React.CSSProperties}
            >
              <span className="project-card-top">
                <span className="project-mark"><Folder size={19} /></span>
                <span className="project-main">
                  <strong>{project.name}</strong>
                  <code>{project.path}</code>
                </span>
                <ChevronRight size={17} />
              </span>
              <span className="project-card-stats">
                <span><b>{project.commandCount}</b> 条命令</span>
                <span><b>{project.taskCount}</b> 项待办</span>
              </span>
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
