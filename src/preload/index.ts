import { contextBridge, ipcRenderer } from 'electron'
import type { CommandDraft, DevDeskApi, ProjectDraft, TaskDraft } from '../shared/types'

const api: DevDeskApi = {
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
    remove: (taskId: number) => ipcRenderer.invoke('tasks:remove', taskId)
  },
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    open: (skillPath: string) => ipcRenderer.invoke('skills:open', skillPath)
  },
  app: {
    info: () => ipcRenderer.invoke('app:info')
  }
}

contextBridge.exposeInMainWorld('devdesk', api)
