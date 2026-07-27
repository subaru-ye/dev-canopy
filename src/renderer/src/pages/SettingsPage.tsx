import { useEffect, useState } from 'react'
import { Database, FolderCog, FolderOpen, HardDriveDownload, Info, Minimize2, MonitorCog, Moon, Power, Sun, SunMoon } from 'lucide-react'
import type { AppInfo, ThemePreference } from '../../../shared/types'
import { ErrorBanner } from '../components/ErrorBanner'
import { loadThemePreference, saveThemePreference } from '../theme'

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'system', label: '跟随系统', icon: SunMoon },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon }
]

// 与主进程约定:'1' 开启,其余(含未写)视为关闭。
const CLOSE_TO_TRAY_SETTING = 'closeToTray'
const LAUNCH_AT_LOGIN_SETTING = 'launchAtLogin'

function BoolSwitch(props: {
  label: string
  value: boolean | null
  onLabel: string
  offLabel: string
  onChange: (next: boolean) => void
}) {
  return (
    <div className="theme-switch" role="radiogroup" aria-label={props.label}>
      {[
        { flag: true, text: props.onLabel },
        { flag: false, text: props.offLabel }
      ].map((option) => (
        <button
          type="button"
          key={option.text}
          role="radio"
          aria-checked={props.value === option.flag}
          className={props.value === option.flag ? 'active' : ''}
          disabled={props.value === null}
          onClick={() => props.onChange(option.flag)}
        >
          {option.text}
        </button>
      ))}
    </div>
  )
}

export function SettingsPage() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState('')
  const [backupNotice, setBackupNotice] = useState('')
  const [theme, setTheme] = useState<ThemePreference | null>(null)
  const [closeToTray, setCloseToTray] = useState<boolean | null>(null)
  const [launchAtLogin, setLaunchAtLogin] = useState<boolean | null>(null)
  useEffect(() => { void window.devcanopy.app.info().then(setInfo) }, [])
  useEffect(() => { void loadThemePreference().then(setTheme) }, [])
  useEffect(() => {
    void window.devcanopy.settings.get(CLOSE_TO_TRAY_SETTING).then((value) => setCloseToTray(value === '1'))
    void window.devcanopy.settings.get(LAUNCH_AT_LOGIN_SETTING).then((value) => setLaunchAtLogin(value === '1'))
  }, [])

  const handleTheme = async (preference: ThemePreference) => {
    setTheme(preference)
    try {
      await saveThemePreference(preference)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const handleBoolSetting = (key: string, setter: (next: boolean) => void) => (next: boolean) => {
    setter(next)
    window.devcanopy.settings.set(key, next ? '1' : '0').catch((reason) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  const handleBackup = async () => {
    setBackupNotice('备份中…')
    try {
      const savedPath = await window.devcanopy.backup.create()
      setBackupNotice(savedPath ? `已备份到 ${savedPath}` : '')
    } catch (reason) {
      setBackupNotice('')
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const handleOpenBackupsDir = async () => {
    try {
      await window.devcanopy.backup.openDir()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <section className="page route-enter settings-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">SETTINGS</p>
          <h1>设置</h1>
          <p>本地数据位置与当前运行环境</p>
        </div>
      </header>
      <ErrorBanner message={error} onClose={() => setError('')} />
      <div className="settings-list">
        <div className="setting-row">
          <SunMoon size={19} />
          <div><h2>界面主题</h2><p>跟随系统时随系统深浅色自动切换。</p></div>
          <div className="theme-switch" role="radiogroup" aria-label="界面主题">
            {THEME_OPTIONS.map((option) => {
              const Icon = option.icon
              return (
                <button
                  type="button"
                  key={option.value}
                  role="radio"
                  aria-checked={theme === option.value}
                  className={theme === option.value ? 'active' : ''}
                  disabled={theme === null}
                  onClick={() => void handleTheme(option.value)}
                >
                  <Icon size={15} />{option.label}
                </button>
              )
            })}
          </div>
        </div>
        <div className="setting-row">
          <Minimize2 size={19} />
          <div><h2>关闭窗口时</h2><p>最小化到托盘后命令继续运行，从托盘菜单可恢复窗口或退出。</p></div>
          <BoolSwitch
            label="关闭窗口时"
            value={closeToTray}
            onLabel="最小化到托盘"
            offLabel="退出应用"
            onChange={handleBoolSetting(CLOSE_TO_TRAY_SETTING, setCloseToTray)}
          />
        </div>
        <div className="setting-row">
          <Power size={19} />
          <div><h2>开机自启动</h2><p>登录 Windows 后自动启动 DevCanopy（仅安装版生效）。</p></div>
          <BoolSwitch
            label="开机自启动"
            value={launchAtLogin}
            onLabel="开启"
            offLabel="关闭"
            onChange={handleBoolSetting(LAUNCH_AT_LOGIN_SETTING, setLaunchAtLogin)}
          />
        </div>
        <div className="setting-row">
          <Database size={19} />
          <div><h2>SQLite 数据库</h2><p>项目、命令和任务保存在本机。</p></div>
          <code>{info?.databasePath ?? '读取中…'}</code>
        </div>
        <div className="setting-row">
          <HardDriveDownload size={19} />
          <div>
            <h2>数据备份</h2>
            <p>{backupNotice || '每次启动自动备份，保留最近 5 份。'}</p>
            <code className="setting-detail-path">{info?.backupsDir ?? '读取中…'}</code>
          </div>
          <div className="setting-actions">
            <button type="button" className="button ghost" onClick={handleOpenBackupsDir}>
              <FolderOpen size={15} />打开目录
            </button>
            <button type="button" className="button secondary" onClick={handleBackup}>立即备份</button>
          </div>
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
