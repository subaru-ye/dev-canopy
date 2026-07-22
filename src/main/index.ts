import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { AppDatabase } from './database'
import { ProcessManager } from './process-manager'
import { scanSkills } from './skills'
import type { CommandDraft, ProjectDraft, TaskDraft } from '../shared/types'

let database: AppDatabase
let processManager: ProcessManager
let mainWindow: BrowserWindow | null = null

const skillsPath = join(process.env.USERPROFILE ?? app.getPath('home'), '.codex', 'skills')

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: 'DevDesk',
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
  if (process.env.DEVDESK_CAPTURE_PATH) {
    mainWindow.webContents.on('console-message', (_event, level, message) => {
      if (level >= 2) console.error(`[renderer:${level}] ${message}`)
    })
  }
  mainWindow.webContents.once('did-finish-load', () => {
    const capturePath = process.env.DEVDESK_CAPTURE_PATH
    if (!capturePath) return
    setTimeout(async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const image = await mainWindow.webContents.capturePage()
      await fs.writeFile(capturePath, image.toPNG())
      app.quit()
    }, 1_500)
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function detectPackageManager(projectPath: string): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  if (existsSync(join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(projectPath, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(projectPath, 'bun.lockb')) || existsSync(join(projectPath, 'bun.lock'))) return 'bun'
  return 'npm'
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
    return processManager.stop(command)
  })
  ipcMain.handle('commands:statuses', async (_event, projectId: number) => {
    const commands = database.listCommands(projectId)
    return Promise.all(commands.map((command) => processManager.status(command)))
  })
  ipcMain.handle('commands:logs', (_event, commandId: number) => processManager.getLogs(commandId))

  ipcMain.handle('tasks:list', (_event, projectId?: number | null) => database.listTasks(projectId))
  ipcMain.handle('tasks:create', (_event, draft: TaskDraft) => {
    if (!draft.title.trim()) throw new Error('任务标题不能为空。')
    return database.createTask(draft)
  })
  ipcMain.handle('tasks:update', (_event, taskId: number, draft: Partial<TaskDraft>) => database.updateTask(taskId, draft))
  ipcMain.handle('tasks:remove', (_event, taskId: number) => database.removeTask(taskId))

  ipcMain.handle('skills:list', () => scanSkills(skillsPath))
  ipcMain.handle('skills:open', async (_event, skillPath: string) => {
    const normalizedRoot = skillsPath.toLowerCase()
    if (!skillPath.toLowerCase().startsWith(normalizedRoot)) throw new Error('Skill 路径不在 Codex Skills 目录中。')
    const error = await shell.openPath(skillPath)
    if (error) throw new Error(error)
  })
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    databasePath: join(app.getPath('userData'), 'devdesk.db'),
    skillsPath,
    platform: process.platform
  }))
}

app.whenReady().then(() => {
  const databasePath = join(app.getPath('userData'), 'devdesk.db')
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
