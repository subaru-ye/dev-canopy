import { contextBridge, ipcRenderer } from 'electron'
import type { CommandDraft, DevCanopyApi, ProjectDraft, PromptDraft, TaskDraft } from '../shared/types'

const api: DevCanopyApi = {
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    selectFolder: () => ipcRenderer.invoke('projects:select-folder'),
    create: (draft: ProjectDraft) => ipcRenderer.invoke('projects:create', draft),
    remove: (projectId: number) => ipcRenderer.invoke('projects:remove', projectId),
    reveal: (projectPath: string) => ipcRenderer.invoke('projects:reveal', projectPath)
  },
  commands: {
    list: (projectId: number) => ipcRenderer.invoke('commands:list', projectId),
    create: (draft: CommandDraft) => ipcRenderer.invoke('commands:create', draft),
    update: (commandId: number, draft: CommandDraft) => ipcRenderer.invoke('commands:update', commandId, draft),
    remove: (commandId: number) => ipcRenderer.invoke('commands:remove', commandId),
    start: (commandId: number) => ipcRenderer.invoke('commands:start', commandId),
    stop: (commandId: number) => ipcRenderer.invoke('commands:stop', commandId),
    statuses: (projectId: number) => ipcRenderer.invoke('commands:statuses', projectId),
    logs: (commandId: number) => ipcRenderer.invoke('commands:logs', commandId),
    onLog: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { commandId: number; chunk: string }): void => listener(payload)
      ipcRenderer.on('commands:log', handler)
      return () => ipcRenderer.removeListener('commands:log', handler)
    }
  },
  tasks: {
    list: (projectId?: number | null) => ipcRenderer.invoke('tasks:list', projectId),
    create: (draft: TaskDraft) => ipcRenderer.invoke('tasks:create', draft),
    update: (taskId: number, draft: Partial<TaskDraft>) => ipcRenderer.invoke('tasks:update', taskId, draft),
    remove: (taskId: number) => ipcRenderer.invoke('tasks:remove', taskId),
    notes: (taskId: number) => ipcRenderer.invoke('tasks:notes:list', taskId),
    addNote: (taskId: number, content: string) => ipcRenderer.invoke('tasks:notes:create', taskId, content),
    removeNote: (noteId: number) => ipcRenderer.invoke('tasks:notes:remove', noteId),
    checklist: (taskId: number) => ipcRenderer.invoke('tasks:checklist:list', taskId),
    addChecklistItem: (taskId: number, title: string) => ipcRenderer.invoke('tasks:checklist:create', taskId, title),
    toggleChecklistItem: (itemId: number, done: boolean) => ipcRenderer.invoke('tasks:checklist:toggle', itemId, done),
    removeChecklistItem: (itemId: number) => ipcRenderer.invoke('tasks:checklist:remove', itemId),
    completedBetween: (startIso: string, endIso: string) => ipcRenderer.invoke('tasks:completed-between', startIso, endIso)
  },
  reports: {
    get: (reportDate: string) => ipcRenderer.invoke('reports:get', reportDate),
    save: (reportDate: string, content: string) => ipcRenderer.invoke('reports:save', reportDate, content),
    dates: () => ipcRenderer.invoke('reports:dates')
  },
  prompts: {
    list: () => ipcRenderer.invoke('prompts:list'),
    create: (draft: PromptDraft) => ipcRenderer.invoke('prompts:create', draft),
    update: (promptId: number, draft: PromptDraft) => ipcRenderer.invoke('prompts:update', promptId, draft),
    remove: (promptId: number) => ipcRenderer.invoke('prompts:remove', promptId),
    importFiles: () => ipcRenderer.invoke('prompts:import-files')
  },
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    open: (skillPath: string) => ipcRenderer.invoke('skills:open', skillPath)
  },
  app: {
    info: () => ipcRenderer.invoke('app:info')
  }
}

contextBridge.exposeInMainWorld('devcanopy', api)
