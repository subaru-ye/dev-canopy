import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { runStartupBackup } from './backup'
import { AppDatabase, copyDatabase } from './database'
import { ProcessManager } from './process-manager'
import { scanSkills } from './skills'
import { IpcChannel } from '../shared/ipc'
import type { CommandDraft, ProjectDraft, PromptDraft, PromptImportResult, TaskDraft, TaskPriority, TaskStatus } from '../shared/types'

let database: AppDatabase
let processManager: ProcessManager
let mainWindow: BrowserWindow | null = null
let databasePath = ''
let backupsDir = ''

const skillsPath = join(process.env.USERPROFILE ?? app.getPath('home'), '.codex', 'skills')

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: 'DevCanopy',
    backgroundColor: '#101312',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    console.error(`[renderer:load] ${errorCode} ${errorDescription} ${validatedUrl}`)
  })
  // 截图冒烟脚手架只在未打包的开发/测试环境生效,不进生产包。
  const captureEnabled = !app.isPackaged && !!process.env.DEVCANOPY_CAPTURE_PATH
  if (captureEnabled) {
    mainWindow.webContents.on('console-message', (_event, level, message) => {
      if (level >= 2) console.error(`[renderer:${level}] ${message}`)
    })
  }
  mainWindow.webContents.once('did-finish-load', () => {
    const capturePath = process.env.DEVCANOPY_CAPTURE_PATH
    if (!captureEnabled || !capturePath) return
    setTimeout(async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const clickSelector = process.env.DEVCANOPY_CAPTURE_CLICK
      if (clickSelector) {
        // ";;" 分隔的选择器依次点击(逗号留给 CSS 选择器列表),支持多步进入的界面状态。
        for (const selector of clickSelector.split(';;')) {
          // click() 不转移焦点,补 focus() 让后续按键注入能落在表单控件上。
          await mainWindow.webContents
            .executeJavaScript(`{ const el = document.querySelector(${JSON.stringify(selector.trim())}); el?.click(); el?.focus?.(); }`)
            .catch(() => undefined)
          await new Promise((resolve) => setTimeout(resolve, 600))
        }
        // 等过渲染层 800ms 的自动保存防抖,让截图能拍到「已保存」等落库后的状态。
        await new Promise((resolve) => setTimeout(resolve, 1_500))
      }
      // 逗号分隔的按键序列(如 "ctrl+2,ctrl+n"),走 Chromium 输入管线验证快捷键。
      const keysSpec = process.env.DEVCANOPY_CAPTURE_KEYS
      if (keysSpec) {
        for (const combo of keysSpec.split(',')) {
          const parts = combo.trim().split('+')
          const keyCode = parts.pop() ?? ''
          const modifiers = parts.map((part) => (part === 'ctrl' ? 'control' : part)) as Array<'control' | 'shift' | 'alt' | 'meta'>
          mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
          mainWindow.webContents.sendInputEvent({ type: 'char', keyCode, modifiers })
          mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
          await new Promise((resolve) => setTimeout(resolve, 400))
        }
      }
      const image = await mainWindow.webContents.capturePage()
      await fs.writeFile(capturePath, image.toPNG())
      app.quit()
    }, 1_500)
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // 只放行 http/https,防止 file:// 等协议经系统默认处理器执行本地程序。
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const captureRoute = captureEnabled ? process.env.DEVCANOPY_CAPTURE_ROUTE : undefined
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}${captureRoute ? `#${captureRoute}` : ''}`)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'), captureRoute ? { hash: captureRoute } : undefined)
  }
}

function detectPackageManager(projectPath: string): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  if (existsSync(join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(projectPath, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(projectPath, 'bun.lockb')) || existsSync(join(projectPath, 'bun.lock'))) return 'bun'
  return 'npm'
}

async function resolveDatabasePath(): Promise<string> {
  const currentPath = join(app.getPath('userData'), 'devcanopy.db')
  if (existsSync(currentPath)) return currentPath

  const legacyPath = join(app.getPath('appData'), 'DevDesk', 'devdesk.db')
  if (!existsSync(legacyPath)) return currentPath

  // 一次性把旧 DevDesk 库搬到新目录:继续写旧目录的话,用户清理"已弃用"的
  // DevDesk 文件夹时会丢掉全部数据。先拷到临时文件、成功后再改名,保证
  // 中途断电/被杀不会留下半个 devcanopy.db 被当成完整库打开;失败则回落旧路径。
  const migratingPath = `${currentPath}.migrating`
  try {
    await fs.mkdir(app.getPath('userData'), { recursive: true })
    await fs.rm(migratingPath, { force: true })
    await copyDatabase(legacyPath, migratingPath)
    await fs.rename(migratingPath, currentPath)
    return currentPath
  } catch (error) {
    await fs.rm(migratingPath, { force: true }).catch(() => undefined)
    console.error('[database] 迁移旧数据库失败，继续使用旧路径。', error)
    return legacyPath
  }
}

async function inspectProjectFolder(projectPath: string) {
  const packageManager = detectPackageManager(projectPath)
  const packageJsonPath = join(projectPath, 'package.json')
  let scripts: Record<string, string> = {}
  try {
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as { scripts?: Record<string, string> }
    scripts = packageJson.scripts ?? {}
  } catch {
    scripts = {}
  }
  const likelyLongRunning = /(^|:)(dev|start|serve|server|desktop|electron|tauri)(:|$)/i
  return {
    path: projectPath,
    name: basename(projectPath),
    packageManager,
    scripts: Object.keys(scripts).map((name) => ({
      name,
      command: packageManager === 'yarn' ? `yarn ${name}` : `${packageManager} run ${name}`,
      selected: likelyLongRunning.test(name)
    }))
  }
}

// 经 cmd /c 跑短命启动器(code/wt 拉起目标后即退),用退出码区分"已拉起"与"命令不存在"。
function runWindowsLauncher(args: string[], cwd: string, failureMessage: string): Promise<void> {
  if (process.platform !== 'win32') {
    return Promise.reject(new Error('当前功能仅支持 Windows。'))
  }
  return new Promise((resolve, reject) => {
    const child = spawn('cmd.exe', ['/c', ...args], { cwd, detached: true, stdio: 'ignore' })
    child.once('error', () => reject(new Error(failureMessage)))
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(failureMessage))
    })
  })
}

const REPORT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const PROMPT_IMPORT_MAX_BYTES = 2 * 1024 * 1024
const TASK_STATUSES: TaskStatus[] = ['todo', 'doing', 'done']
const TASK_PRIORITIES: TaskPriority[] = ['low', 'normal', 'high']

function todayLocalDate(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

async function importPromptFiles(): Promise<PromptImportResult | null> {
  const options: Electron.OpenDialogOptions = {
    title: '选择要导入的 Markdown 文件',
    filters: [{ name: 'Markdown / 文本', extensions: ['md', 'markdown', 'txt'] }],
    properties: ['openFile', 'multiSelections']
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null

  const drafts: PromptDraft[] = []
  const failed: Array<{ file: string; reason: string }> = []
  for (const filePath of result.filePaths) {
    const fileName = basename(filePath)
    try {
      const stat = await fs.stat(filePath)
      if (stat.size > PROMPT_IMPORT_MAX_BYTES) {
        failed.push({ file: fileName, reason: '文件超过 2MB 限制' })
        continue
      }
      let content = await fs.readFile(filePath, 'utf8')
      if (content.charCodeAt(0) === 0xfeff) content = content.slice(1)
      const title = fileName.replace(/\.[^.]+$/, '').trim() || '未命名记忆'
      drafts.push({ title, content })
    } catch (error) {
      failed.push({ file: fileName, reason: error instanceof Error ? error.message : '读取失败' })
    }
  }
  const imported = drafts.length > 0 ? database.importPrompts(drafts) : 0
  return { imported, failed }
}

function registerIpc(): void {
  ipcMain.handle(IpcChannel.ProjectsList, () => database.listProjects())
  ipcMain.handle(IpcChannel.ProjectsSelectFolder, async () => {
    const options: Electron.OpenDialogOptions = {
      title: '选择项目目录',
      properties: ['openDirectory']
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return inspectProjectFolder(result.filePaths[0])
  })
  ipcMain.handle(IpcChannel.ProjectsCreate, (_event, draft: ProjectDraft) => {
    if (!draft.name.trim()) throw new Error('项目名称不能为空。')
    if (!existsSync(draft.path)) throw new Error('项目目录不存在。')
    return database.createProject(draft)
  })
  ipcMain.handle(IpcChannel.ProjectsRemove, async (_event, projectId: number) => {
    const commands = database.listCommands(projectId)
    await Promise.allSettled(commands.map((command) => processManager.stopManaged(command.id)))
    database.removeProject(projectId)
  })
  ipcMain.handle(IpcChannel.ProjectsReveal, async (_event, projectPath: string) => {
    const error = await shell.openPath(projectPath)
    if (error) throw new Error(error)
  })
  ipcMain.handle(IpcChannel.ProjectsOpenEditor, async (_event, projectPath: string) => {
    if (!existsSync(projectPath)) throw new Error('项目目录不存在。')
    // code 在 Windows 上是 cmd 脚本,不能直接 spawn,须经 cmd /c 解析。
    await runWindowsLauncher(['code', '.'], projectPath, '无法启动 VS Code：请确认已安装并把 code 加入 PATH。')
  })
  ipcMain.handle(IpcChannel.ProjectsOpenTerminal, async (_event, projectPath: string) => {
    if (!existsSync(projectPath)) throw new Error('项目目录不存在。')
    try {
      await runWindowsLauncher(['wt', '-d', projectPath], projectPath, 'Windows Terminal 不可用。')
    } catch {
      // 没装 Windows Terminal 时回退系统自带 cmd,start 的空引号是窗口标题占位。
      await runWindowsLauncher(['start', '', 'cmd'], projectPath, '无法打开终端。')
    }
  })

  ipcMain.handle(IpcChannel.CommandsList, (_event, projectId: number) => {
    database.touchProject(projectId)
    return database.listCommands(projectId)
  })
  ipcMain.handle(IpcChannel.CommandsCreate, (_event, draft: CommandDraft) => {
    if (!draft.name.trim() || !draft.command.trim()) throw new Error('名称和命令不能为空。')
    return database.createCommand(draft)
  })
  ipcMain.handle(IpcChannel.CommandsUpdate, (_event, commandId: number, draft: CommandDraft) => {
    if (!draft.name.trim() || !draft.command.trim()) throw new Error('名称和命令不能为空。')
    return database.updateCommand(commandId, draft)
  })
  ipcMain.handle(IpcChannel.CommandsRemove, async (_event, commandId: number) => {
    await processManager.stopManaged(commandId)
    database.removeCommand(commandId)
  })
  ipcMain.handle(IpcChannel.CommandsStart, async (_event, commandId: number) => {
    const command = database.getCommand(commandId)
    if (!command) throw new Error('命令不存在。')
    const project = database.getProject(command.projectId)
    if (!project) throw new Error('项目不存在。')
    return processManager.start(command, project)
  })
  ipcMain.handle(IpcChannel.CommandsStop, async (_event, commandId: number) => {
    const command = database.getCommand(commandId)
    if (!command) throw new Error('命令不存在。')
    const project = database.getProject(command.projectId)
    if (!project) throw new Error('项目不存在。')
    return processManager.stop(command, project)
  })
  ipcMain.handle(IpcChannel.CommandsStatuses, async (_event, projectId: number) => {
    const project = database.getProject(projectId)
    if (!project) throw new Error('项目不存在。')
    const commands = database.listCommands(projectId)
    return Promise.all(commands.map((command) => processManager.status(command, project)))
  })
  ipcMain.handle(IpcChannel.CommandsLogs, (_event, commandId: number) => processManager.getLogs(commandId))

  ipcMain.handle(IpcChannel.TasksList, (_event, projectId?: number | null) => database.listTasks(projectId))
  ipcMain.handle(IpcChannel.TasksCreate, (_event, draft: TaskDraft) => {
    if (!draft.title.trim()) throw new Error('任务标题不能为空。')
    return database.createTask(draft)
  })
  ipcMain.handle(IpcChannel.TasksUpdate, (_event, taskId: number, draft: Partial<TaskDraft>) => {
    if (draft.title !== undefined && !draft.title.trim()) throw new Error('任务标题不能为空。')
    if (draft.status !== undefined && !TASK_STATUSES.includes(draft.status)) throw new Error('任务状态无效。')
    if (draft.priority !== undefined && !TASK_PRIORITIES.includes(draft.priority)) throw new Error('任务优先级无效。')
    return database.updateTask(taskId, draft)
  })
  ipcMain.handle(IpcChannel.TasksRemove, (_event, taskId: number) => database.removeTask(taskId))
  ipcMain.handle(IpcChannel.TaskNotesList, (_event, taskId: number) => database.listTaskNotes(taskId))
  ipcMain.handle(IpcChannel.TaskNotesCreate, (_event, taskId: number, content: string) => {
    if (!content.trim()) throw new Error('记录内容不能为空。')
    return database.createTaskNote(taskId, content)
  })
  ipcMain.handle(IpcChannel.TaskNotesRemove, (_event, noteId: number) => database.removeTaskNote(noteId))
  ipcMain.handle(IpcChannel.TaskChecklistList, (_event, taskId: number) => database.listChecklistItems(taskId))
  ipcMain.handle(IpcChannel.TaskChecklistCreate, (_event, taskId: number, title: string) => {
    if (!title.trim()) throw new Error('子任务标题不能为空。')
    return database.createChecklistItem(taskId, title)
  })
  ipcMain.handle(IpcChannel.TaskChecklistToggle, (_event, itemId: number, done: boolean) => database.toggleChecklistItem(itemId, done))
  ipcMain.handle(IpcChannel.TaskChecklistRemove, (_event, itemId: number) => database.removeChecklistItem(itemId))
  ipcMain.handle(IpcChannel.TasksCompletedBetween, (_event, startIso: string, endIso: string) =>
    database.listTasksCompletedBetween(startIso, endIso))

  ipcMain.handle(IpcChannel.ReportsGet, (_event, reportDate: string) => {
    if (!REPORT_DATE_PATTERN.test(reportDate)) throw new Error('日报日期格式不正确。')
    return database.getDailyReport(reportDate)
  })
  ipcMain.handle(IpcChannel.ReportsSave, (_event, reportDate: string, content: string) => {
    if (!REPORT_DATE_PATTERN.test(reportDate)) throw new Error('日报日期格式不正确。')
    if (reportDate > todayLocalDate()) throw new Error('不能填写未来日期的日报。')
    if (!content.trim()) {
      database.removeDailyReport(reportDate)
      return null
    }
    return database.upsertDailyReport(reportDate, content)
  })
  ipcMain.handle(IpcChannel.ReportsDates, () => database.listDailyReportDates())
  ipcMain.handle(IpcChannel.ReportsRange, (_event, startDate: string, endDate: string) => {
    if (!REPORT_DATE_PATTERN.test(startDate) || !REPORT_DATE_PATTERN.test(endDate)) {
      throw new Error('日报日期格式不正确。')
    }
    if (startDate > endDate) throw new Error('日期区间起点不能晚于终点。')
    return database.listDailyReportsBetween(startDate, endDate)
  })

  ipcMain.handle(IpcChannel.PromptsList, () => database.listPrompts())
  ipcMain.handle(IpcChannel.PromptsCreate, (_event, draft: PromptDraft) => {
    if (!draft.title.trim()) throw new Error('记忆标题不能为空。')
    return database.createPrompt(draft)
  })
  ipcMain.handle(IpcChannel.PromptsUpdate, (_event, promptId: number, draft: PromptDraft) => {
    if (!draft.title.trim()) throw new Error('记忆标题不能为空。')
    return database.updatePrompt(promptId, draft)
  })
  ipcMain.handle(IpcChannel.PromptsRemove, (_event, promptId: number) => database.removePrompt(promptId))
  ipcMain.handle(IpcChannel.PromptsImportFiles, () => importPromptFiles())

  ipcMain.handle(IpcChannel.SkillsList, () => scanSkills(skillsPath))
  ipcMain.handle(IpcChannel.SkillsOpen, async (_event, skillPath: string) => {
    const relativePath = relative(skillsPath, skillPath)
    const outside = !relativePath
      || relativePath === '..'
      || relativePath.startsWith(`..${sep}`)
      || isAbsolute(relativePath)
    if (outside) throw new Error('Skill 路径不在 Codex Skills 目录中。')
    const error = await shell.openPath(skillPath)
    if (error) throw new Error(error)
  })
  ipcMain.handle(IpcChannel.BackupCreate, async () => {
    const options: Electron.SaveDialogOptions = {
      title: '选择备份保存位置',
      defaultPath: `devcanopy-${todayLocalDate()}.db`,
      filters: [{ name: 'SQLite 数据库', extensions: ['db'] }]
    }
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    await database.backup(result.filePath)
    return result.filePath
  })
  ipcMain.handle(IpcChannel.BackupOpenDir, async () => {
    await fs.mkdir(backupsDir, { recursive: true })
    const error = await shell.openPath(backupsDir)
    if (error) throw new Error(error)
  })

  ipcMain.handle(IpcChannel.SettingsGet, (_event, key: string) => {
    if (typeof key !== 'string' || !key.trim()) throw new Error('设置键不能为空。')
    return database.getSetting(key)
  })
  ipcMain.handle(IpcChannel.SettingsSet, (_event, key: string, value: string) => {
    if (typeof key !== 'string' || !key.trim()) throw new Error('设置键不能为空。')
    if (typeof value !== 'string') throw new Error('设置值必须是字符串。')
    database.setSetting(key, value)
  })

  ipcMain.handle(IpcChannel.AppInfo, () => ({
    version: app.getVersion(),
    databasePath,
    skillsPath,
    backupsDir,
    platform: process.platform
  }))
}

app.whenReady().then(async () => {
  databasePath = await resolveDatabasePath()
  database = new AppDatabase(databasePath)
  database.pruneProcessRuns()
  backupsDir = join(app.getPath('userData'), 'backups')
  // 自动备份不阻塞窗口创建,失败只记日志(例如磁盘满),不影响应用可用。
  void runStartupBackup((destination) => database.backup(destination), backupsDir, todayLocalDate())
    .catch((error) => console.error('[backup] 启动自动备份失败。', error))
  processManager = new ProcessManager(database, (commandId, chunk) => {
    // 可选链防不住已销毁的窗口:destroyed 后访问 webContents 会抛异常并打崩主进程。
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send(IpcChannel.CommandsLogEvent, { commandId, chunk })
  })
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 退出前先结算并终止托管进程(否则 dev server 变孤儿继续占端口),再关数据库。
let cleanupDone = false
app.on('before-quit', (event) => {
  if (cleanupDone) return
  cleanupDone = true
  event.preventDefault()
  void (async () => {
    try {
      await processManager?.disposeAll()
    } catch {
      // 尽力清理,失败也要继续退出。
    }
    database?.close()
    app.quit()
  })()
})
