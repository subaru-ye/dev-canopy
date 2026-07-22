import { useCallback, useEffect, useState } from 'react'
import { CheckSquare2, FolderKanban, Settings, Sparkles, TerminalSquare } from 'lucide-react'
import type { Project } from '../../shared/types'
import { ProjectsPage } from './pages/ProjectsPage'
import { SettingsPage } from './pages/SettingsPage'
import { SkillsPage } from './pages/SkillsPage'
import { TasksPage } from './pages/TasksPage'

type Route = 'projects' | 'tasks' | 'skills' | 'settings'

const navigation = [
  { id: 'projects' as const, label: '项目', icon: FolderKanban },
  { id: 'tasks' as const, label: '任务', icon: CheckSquare2 },
  { id: 'skills' as const, label: 'Skills', icon: Sparkles },
  { id: 'settings' as const, label: '设置', icon: Settings }
]

export function App() {
  const [route, setRoute] = useState<Route>('projects')
  const [projects, setProjects] = useState<Project[]>([])

  const reloadProjects = useCallback(async () => {
    setProjects(await window.devdesk.projects.list())
  }, [])

  useEffect(() => { void reloadProjects() }, [reloadProjects])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><TerminalSquare size={20} /></span>
          <div><strong>DevDesk</strong><span>Local workspace</span></div>
        </div>
        <nav className="main-nav" aria-label="主菜单">
          {navigation.map((item) => {
            const Icon = item.icon
            return (
              <button
                type="button"
                key={item.id}
                className={route === item.id ? 'active' : ''}
                aria-current={route === item.id ? 'page' : undefined}
                onClick={() => setRoute(item.id)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>
        <div className="sidebar-footer">
          <span className="local-dot" />
          <div><strong>本地模式</strong><span>数据只保存在此设备</span></div>
        </div>
      </aside>
      <main className="main-content" tabIndex={-1}>
        {route === 'projects' ? <ProjectsPage projects={projects} reloadProjects={reloadProjects} /> : null}
        {route === 'tasks' ? <TasksPage projects={projects} /> : null}
        {route === 'skills' ? <SkillsPage /> : null}
        {route === 'settings' ? <SettingsPage /> : null}
      </main>
    </div>
  )
}
