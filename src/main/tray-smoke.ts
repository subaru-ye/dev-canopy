import type { BrowserWindow } from 'electron'
import type { AppDatabase } from './database'
import type { ProcessManager } from './process-manager'
import type { TrayController } from './tray'

interface TraySmokeDeps {
  commandId: number
  database: AppDatabase
  processManager: ProcessManager
  getWindow: () => BrowserWindow | null
  getTray: () => TrayController | null
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
// 主进程 stderr 直出,外层脚本靠 [tray-smoke] 前缀断言各阶段状态。
const log = (message: string): void => console.error(`[tray-smoke] ${message}`)

function pidAlive(pid: number | null): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// 托盘验收冒烟(仅开发态,由 DEVCANOPY_TRAY_SMOKE=<commandId> 触发):
// ① 启动命令后关窗 → 窗口隐藏、进程存活(关闭最小化到托盘);
// ② 点托盘菜单「停止」 → 进程被终止;
// ③ 重启命令后点托盘菜单「退出」 → 走 before-quit 清理链,外层脚本验证进程已死。
export async function runTraySmoke(deps: TraySmokeDeps): Promise<void> {
  const command = deps.database.getCommand(deps.commandId)
  const project = command ? deps.database.getProject(command.projectId) : null
  if (!command || !project) {
    log(`command-missing id=${deps.commandId}`)
    return
  }

  const first = await deps.processManager.start(command, project)
  log(`started pid=${first.pid}`)
  deps.getWindow()?.close()
  await wait(1_200)
  const window = deps.getWindow()
  log(`after-close window-visible=${window && !window.isDestroyed() ? window.isVisible() : 'destroyed'} managed=${deps.processManager.listManaged().length} pid1-alive=${pidAlive(first.pid)}`)

  const menu = deps.getTray()?.getMenu()
  log(`menu=[${menu?.items.map((item) => item.label).join(' | ') ?? ''}]`)
  const stopItem = menu?.items.find((item) => item.label.startsWith('停止「'))
  stopItem?.click()
  await wait(2_500)
  log(`after-tray-stop managed=${deps.processManager.listManaged().length} pid1-alive=${pidAlive(first.pid)}`)

  const second = await deps.processManager.start(command, project)
  log(`restarted pid=${second.pid}`)
  await wait(300)
  log('clicking tray-quit')
  deps.getTray()?.getMenu()?.getMenuItemById('tray-quit')?.click()
}
