import { useCallback, useEffect, useState } from 'react'
import { Brain, CheckSquare2, FolderKanban, NotebookPen, Settings, Sparkles, TerminalSquare } from 'lucide-react'
import type { Project, SearchResult, SearchResultKind } from '../../shared/types'
import { CommandPalette } from './components/CommandPalette'
import { NEW_ITEM_EVENT } from './hooks/useNewItemShortcut'
import { setJumpIntent } from './jump'
import { loadThemePreference } from './theme'
import { ProjectsPage } from './pages/ProjectsPage'
import { PromptsPage } from './pages/PromptsPage'
import { ReportsPage } from './pages/ReportsPage'
import { SettingsPage } from './pages/SettingsPage'
import { SkillsPage } from './pages/SkillsPage'
import { TasksPage } from './pages/TasksPage'

type Route = 'projects' | 'tasks' | 'reports' | 'prompts' | 'skills' | 'settings'

const navigation = [
  { id: 'projects' as const, label: '项目', icon: FolderKanban },
  { id: 'tasks' as const, label: '任务', icon: CheckSquare2 },
  { id: 'reports' as const, label: '日报', icon: NotebookPen },
  { id: 'prompts' as const, label: '记忆', icon: Brain },
  { id: 'skills' as const, label: 'Skills', icon: Sparkles },
  { id: 'settings' as const, label: '设置', icon: Settings }
]

function initialRoute(): Route {
  const hash = window.location.hash.slice(1)
  return navigation.some((item) => item.id === hash) ? hash as Route : 'projects'
}

const KIND_ROUTE: Record<SearchResultKind, Route> = {
  project: 'projects',
  task: 'tasks',
  report: 'reports',
  prompt: 'prompts'
}

export function App() {
  const [route, setRoute] = useState<Route>(initialRoute)
  const [projects, setProjects] = useState<Project[]>([])
  const [paletteOpen, setPaletteOpen] = useState(false)
  // 每次搜索跳转 +1,作为目标页 key 强制 remount,让目标页重新读取跳转意图。
  const [jumpNonce, setJumpNonce] = useState(0)

  const reloadProjects = useCallback(async () => {
    setProjects(await window.devcanopy.projects.list())
  }, [])

  useEffect(() => { void reloadProjects() }, [reloadProjects])

  // localStorage 镜像只管首帧防闪烁,settings 表才是权威值:任何路由启动都要校准一次。
  useEffect(() => { void loadThemePreference().catch(() => undefined) }, [])

  // 全局快捷键:Ctrl+1~6 按 navigation 顺序切页,Ctrl+N 广播给当前页开新建弹窗,
  // Ctrl+K 唤起全局搜索(在表单控件里也生效)。
  // 其余快捷键在焦点位于表单控件或输入法合成中时整体忽略,避免劫持正常输入。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing) return
      if (event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
        return
      }
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return
      if (event.key >= '1' && event.key <= String(navigation.length)) {
        event.preventDefault()
        setRoute(navigation[Number(event.key) - 1].id)
        return
      }
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        window.dispatchEvent(new CustomEvent(NEW_ITEM_EVENT))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const openSearchResult = useCallback((result: SearchResult): void => {
    setJumpIntent({ kind: result.kind, id: result.id, date: result.date })
    setPaletteOpen(false)
    setRoute(KIND_ROUTE[result.kind])
    setJumpNonce((nonce) => nonce + 1)
  }, [])

  // 回写 hash,刷新/崩溃重载后停留在当前页面(initialRoute 会读取它)。
  useEffect(() => {
    window.location.hash = route
  }, [route])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><TerminalSquare size={20} /></span>
          <div><strong>DevCanopy</strong><span>Local workspace</span></div>
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
        {route === 'projects' ? <ProjectsPage key={jumpNonce} projects={projects} reloadProjects={reloadProjects} /> : null}
        {route === 'tasks' ? <TasksPage key={jumpNonce} projects={projects} /> : null}
        {route === 'reports' ? <ReportsPage key={jumpNonce} /> : null}
        {route === 'prompts' ? <PromptsPage key={jumpNonce} /> : null}
        {route === 'skills' ? <SkillsPage /> : null}
        {route === 'settings' ? <SettingsPage /> : null}
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onSelect={openSearchResult} />
    </div>
  )
}
