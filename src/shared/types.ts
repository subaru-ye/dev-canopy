export type TaskStatus = 'todo' | 'doing' | 'done'
export type TaskPriority = 'low' | 'normal' | 'high'
export type DetectionType = 'none' | 'port' | 'health' | 'process'
export type RuntimeState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error' | 'unknown'

export interface Project {
  id: number
  name: string
  path: string
  createdAt: string
  lastOpenedAt: string | null
  commandCount: number
  taskCount: number
}

export interface DetectedScript {
  name: string
  command: string
  selected: boolean
}

export interface FolderInspection {
  path: string
  name: string
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun'
  scripts: DetectedScript[]
}

export interface ProjectDraft {
  name: string
  path: string
  commands: Array<Pick<CommandConfig, 'name' | 'command' | 'workingDirectory'>>
}

export interface CommandConfig {
  id: number
  projectId: number
  name: string
  command: string
  workingDirectory: string
  shell: string
  detectionType: DetectionType
  detectionValue: string
  sortOrder: number
  createdAt: string
}

export interface CommandDraft {
  projectId: number
  name: string
  command: string
  workingDirectory: string
  shell: string
  detectionType: DetectionType
  detectionValue: string
}

export interface CommandRuntime {
  commandId: number
  state: RuntimeState
  pid: number | null
  startedAt: string | null
  source: 'managed' | 'detected' | null
  detail: string | null
}

export interface Task {
  id: number
  projectId: number | null
  projectName: string | null
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  completionNote: string
  createdAt: string
  completedAt: string | null
}

export interface TaskDraft {
  projectId: number | null
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  completionNote: string
}

export interface SkillInfo {
  name: string
  description: string
  path: string
  scope: 'user' | 'system'
  modifiedAt: string
  hasScripts: boolean
  hasReferences: boolean
  hasAssets: boolean
  valid: boolean
  issue: string | null
}

export interface AppInfo {
  version: string
  databasePath: string
  skillsPath: string
  platform: string
}

export interface DevDeskApi {
  projects: {
    list: () => Promise<Project[]>
    selectFolder: () => Promise<FolderInspection | null>
    create: (draft: ProjectDraft) => Promise<Project>
    remove: (projectId: number) => Promise<void>
    reveal: (projectPath: string) => Promise<void>
  }
  commands: {
    list: (projectId: number) => Promise<CommandConfig[]>
    create: (draft: CommandDraft) => Promise<CommandConfig>
    update: (commandId: number, draft: CommandDraft) => Promise<CommandConfig>
    remove: (commandId: number) => Promise<void>
    start: (commandId: number) => Promise<CommandRuntime>
    stop: (commandId: number) => Promise<CommandRuntime>
    statuses: (projectId: number) => Promise<CommandRuntime[]>
    logs: (commandId: number) => Promise<string>
    onLog: (listener: (payload: { commandId: number; chunk: string }) => void) => () => void
  }
  tasks: {
    list: (projectId?: number | null) => Promise<Task[]>
    create: (draft: TaskDraft) => Promise<Task>
    update: (taskId: number, draft: Partial<TaskDraft>) => Promise<Task>
    remove: (taskId: number) => Promise<void>
  }
  skills: {
    list: () => Promise<SkillInfo[]>
    open: (skillPath: string) => Promise<void>
  }
  app: {
    info: () => Promise<AppInfo>
  }
}
