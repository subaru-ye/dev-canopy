import { Menu, Tray, type NativeImage } from 'electron'

export interface TrayRunningCommand {
  commandId: number
  label: string
}

export interface TrayOptions {
  icon: NativeImage
  showWindow: () => void
  listRunning: () => TrayRunningCommand[]
  stopCommand: (commandId: number) => void
  quit: () => void
}

export interface TrayController {
  refresh: () => void
  getMenu: () => Menu | null
  destroy: () => void
}

// Windows 托盘菜单是构建时的静态快照,运行中命令增减后必须整体重建再 setContextMenu。
export function setupTray(options: TrayOptions): TrayController {
  const tray = new Tray(options.icon)
  tray.setToolTip('DevCanopy')
  tray.on('click', options.showWindow)
  let menu: Menu | null = null

  const refresh = (): void => {
    const running = options.listRunning()
    const runningItems: Electron.MenuItemConstructorOptions[] = running.length === 0
      ? [{ label: '没有运行中的命令', enabled: false }]
      : running.map((entry) => ({
          label: `停止「${entry.label}」`,
          click: () => options.stopCommand(entry.commandId)
        }))
    menu = Menu.buildFromTemplate([
      { label: '显示主窗口', click: options.showWindow },
      { type: 'separator' },
      ...runningItems,
      { type: 'separator' },
      // 退出必须走 app.quit(),让 before-quit 清理链(disposeAll + 关库)照常执行。
      { id: 'tray-quit', label: '退出 DevCanopy', click: options.quit }
    ])
    tray.setContextMenu(menu)
  }
  refresh()

  return {
    refresh,
    getMenu: () => menu,
    destroy: () => tray.destroy()
  }
}
