import { useEffect, useState } from 'react'
import { Database, FolderCog, Info, MonitorCog } from 'lucide-react'
import type { AppInfo } from '../../../shared/types'

export function SettingsPage() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => { void window.devcanopy.app.info().then(setInfo) }, [])

  return (
    <section className="page route-enter settings-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">SETTINGS</p>
          <h1>设置</h1>
          <p>本地数据位置与当前运行环境</p>
        </div>
      </header>
      <div className="settings-list">
        <div className="setting-row">
          <Database size={19} />
          <div><h2>SQLite 数据库</h2><p>项目、命令和任务保存在本机。</p></div>
          <code>{info?.databasePath ?? '读取中…'}</code>
        </div>
        <div className="setting-row">
          <FolderCog size={19} />
          <div><h2>Codex Skills</h2><p>Skills 页面直接读取此目录，不复制文件。</p></div>
          <code>{info?.skillsPath ?? '读取中…'}</code>
        </div>
        <div className="setting-row">
          <MonitorCog size={19} />
          <div><h2>运行平台</h2><p>当前版本优先针对 Windows 进程检测与终止。</p></div>
          <code>{info?.platform ?? '读取中…'}</code>
        </div>
        <div className="setting-row">
          <Info size={19} />
          <div><h2>DevCanopy</h2><p>本地项目、进程、任务和 Skills 工作台。</p></div>
          <code>v{info?.version ?? '0.1.0'}</code>
        </div>
      </div>
    </section>
  )
}
