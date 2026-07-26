import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { AppDatabase } from './database'
import { ProcessManager } from './process-manager'
import { scanSkills } from './skills'
import type { CommandDraft, ProjectDraft, PromptDraft, PromptImportResult, TaskDraft } from '../shared/types'

let database: AppDatabase
let processManager: ProcessManager
let mainWindow: BrowserWindow | null = null
let databasePath = ''

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
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    console.error(`[renderer:load] ${errorCode} ${errorDescription} ${validatedUrl}`)
  })
  if (process.env.DEVCANOPY_CAPTURE_PATH) {
    mainWindow.webContents.on('console-message', (_event, level, message) => {
      if (level >= 2) console.error(`[renderer:${level}] ${message}`)
    })
  }
  mainWindow.webContents.once('did-finish-load', () => {
    const capturePath = process.env.DEVCANOPY_CAPTURE_PATH
    if (!capturePath) return
    setTimeout(async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const clickSelector = process.env.DEVCANOPY_CAPTURE_CLICK
      if (clickSelector) {
        await mainWindow.webContents
          .executeJavaScript(`document.querySelector(${JSON.stringify(clickSelector)})?.click()`)
          .catch(() => undefined)
        await new Promise((resolve) => setTimeout(resolve, 600))
      }
      const image = await mainWindow.webContents.capturePage()
      await fs.writeFile(capturePath, image.toPNG())
      app.quit()
    }, 1_500)
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const captureRoute = process.env.DEVCANOPY_CAPTURE_ROUTE
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

function resolveDatabasePath(): string {
  const currentPath = join(app.getPath('userData'), 'devcanopy.db')
  if (existsSync(currentPath)) return currentPath

  const legacyPath = join(app.getPath('appData'), 'DevDesk', 'devdesk.db')
  return existsSync(legacyPath) ? legacyPath : currentPath
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

const REPORT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const PROMPT_IMPORT_MAX_BYTES = 2 * 1024 * 1024

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
  ipcMain.handle('projects:list', () => database.listProjects())
  ipcMain.handle('projects:select-folder', async () => {
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
  ipcMain.handle('projects:create', (_event, draft: ProjectDraft) => {
    if (!draft.name.trim()) throw new Error('项目名称不能为空。')
    if (!existsSync(draft.path)) throw new Error('项目目录不存在。')
    return database.createProject(draft)
  })
  ipcMain.handle('projects:remove', (_event, projectId: number) => database.removeProject(projectId))
  ipcMain.handle('projects:reveal', async (_event, projectPath: string) => {
    const error = await shell.openPath(projectPath)
    if (error) throw new Error(error)
  })

  ipcMain.handle('commands:list', (_event, projectId: number) => {
    database.touchProject(projectId)
    return database.listCommands(projectId)
  })
  ipcMain.handle('commands:create', (_event, draft: CommandDraft) => {
    if (!draft.name.trim() || !draft.command.trim()) throw new Error('名称和命令不能为空。')
    return database.createCommand(draft)
  })
  ipcMain.handle('commands:update', (_event, commandId: number, draft: CommandDraft) => {
    if (!draft.name.trim() || !draft.command.trim()) throw new Error('名称和命令不能为空。')
    return database.updateCommand(commandId, draft)
  })
  ipcMain.handle('commands:remove', (_event, commandId: number) => database.removeCommand(commandId))
  ipcMain.handle('commands:start', async (_event, commandId: number) => {
    const command = database.getCommand(commandId)
    if (!command) throw new Error('命令不存在。')
    const project = database.getProject(command.projectId)
    if (!project) throw new Error('项目不存在。')
    return processManager.start(command, project)
  })
  ipcMain.handle('commands:stop', async (_event, commandId: number) => {
    const command = database.getCommand(commandId)
    if (!command) throw new Error('命令不存在。')
    const project = database.getProject(command.projectId)
    if (!project) throw new Error('项目不存在。')
    return processManager.stop(command, project)
  })
  ipcMain.handle('commands:statuses', async (_event, projectId: number) => {
    const project = database.getProject(projectId)
    if (!project) throw new Error('项目不存在。')
    const commands = database.listCommands(projectId)
    return Promise.all(commands.map((command) => processManager.status(command, project)))
  })
  ipcMain.handle('commands:logs', (_event, commandId: number) => processManager.getLogs(commandId))

  ipcMain.handle('tasks:list', (_event, projectId?: number | null) => database.listTasks(projectId))
  ipcMain.handle('tasks:create', (_event, draft: TaskDraft) => {
    if (!draft.title.trim()) throw new Error('任务标题不能为空。')
    return database.createTask(draft)
  })
  ipcMain.handle('tasks:update', (_event, taskId: number, draft: Partial<TaskDraft>) => database.updateTask(taskId, draft))
  ipcMain.handle('tasks:remove', (_event, taskId: number) => database.removeTask(taskId))
  ipcMain.handle('tasks:notes:list', (_event, taskId: number) => database.listTaskNotes(taskId))
  ipcMain.handle('tasks:notes:create', (_event, taskId: number, content: string) => {
    if (!content.trim()) throw new Error('记录内容不能为空。')
    return database.createTaskNote(taskId, content)
  })
  ipcMain.handle('tasks:notes:remove', (_event, noteId: number) => database.removeTaskNote(noteId))
  ipcMain.handle('tasks:checklist:list', (_event, taskId: number) => database.listChecklistItems(taskId))
  ipcMain.handle('tasks:checklist:create', (_event, taskId: number, title: string) => {
    if (!title.trim()) throw new Error('子任务标题不能为空。')
    return database.createChecklistItem(taskId, title)
  })
  ipcMain.handle('tasks:checklist:toggle', (_event, itemId: number, done: boolean) => database.toggleChecklistItem(itemId, done))
  ipcMain.handle('tasks:checklist:remove', (_event, itemId: number) => database.removeChecklistItem(itemId))
  ipcMain.handle('tasks:completed-between', (_event, startIso: string, endIso: string) =>
    database.listTasksCompletedBetween(startIso, endIso))

  ipcMain.handle('reports:get', (_event, reportDate: string) => {
    if (!REPORT_DATE_PATTERN.test(reportDate)) throw new Error('日报日期格式不正确。')
    return database.getDailyReport(reportDate)
  })
  ipcMain.handle('reports:save', (_event, reportDate: string, content: string) => {
    if (!REPORT_DATE_PATTERN.test(reportDate)) throw new Error('日报日期格式不正确。')
    if (reportDate > todayLocalDate()) throw new Error('不能填写未来日期的日报。')
    if (!content.trim()) {
      database.removeDailyReport(reportDate)
      return null
    }
    return database.upsertDailyReport(reportDate, content)
  })
  ipcMain.handle('reports:dates', () => database.listDailyReportDates())

  ipcMain.handle('prompts:list', () => database.listPrompts())
  ipcMain.handle('prompts:create', (_event, draft: PromptDraft) => {
    if (!draft.title.trim()) throw new Error('记忆标题不能为空。')
    return database.createPrompt(draft)
  })
  ipcMain.handle('prompts:update', (_event, promptId: number, draft: PromptDraft) => {
    if (!draft.title.trim()) throw new Error('记忆标题不能为空。')
    return database.updatePrompt(promptId, draft)
  })
  ipcMain.handle('prompts:remove', (_event, promptId: number) => database.removePrompt(promptId))
  ipcMain.handle('prompts:import-files', () => importPromptFiles())

  ipcMain.handle('skills:list', () => scanSkills(skillsPath))
  ipcMain.handle('skills:open', async (_event, skillPath: string) => {
    const relativePath = relative(skillsPath, skillPath)
    const outside = !relativePath
      || relativePath === '..'
      || relativePath.startsWith(`..${sep}`)
      || isAbsolute(relativePath)
    if (outside) throw new Error('Skill 路径不在 Codex Skills 目录中。')
    const error = await shell.openPath(skillPath)
    if (error) throw new Error(error)
  })
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    databasePath,
    skillsPath,
    platform: process.platform
  }))
}

app.whenReady().then(() => {
  databasePath = resolveDatabasePath()
  database = new AppDatabase(databasePath)
  processManager = new ProcessManager(database, (commandId, chunk) => {
    mainWindow?.webContents.send('commands:log', { commandId, chunk })
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

app.on('before-quit', () => {
  database?.close()
})
