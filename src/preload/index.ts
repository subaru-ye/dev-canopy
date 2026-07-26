import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel } from '../shared/ipc'
import type { CommandDraft, DevCanopyApi, ProjectDraft, PromptDraft, TaskDraft } from '../shared/types'

const api: DevCanopyApi = {
  projects: {
    list: () => ipcRenderer.invoke(IpcChannel.ProjectsList),
    selectFolder: () => ipcRenderer.invoke(IpcChannel.ProjectsSelectFolder),
    create: (draft: ProjectDraft) => ipcRenderer.invoke(IpcChannel.ProjectsCreate, draft),
    remove: (projectId: number) => ipcRenderer.invoke(IpcChannel.ProjectsRemove, projectId),
    reveal: (projectPath: string) => ipcRenderer.invoke(IpcChannel.ProjectsReveal, projectPath),
    openEditor: (projectPath: string) => ipcRenderer.invoke(IpcChannel.ProjectsOpenEditor, projectPath),
    openTerminal: (projectPath: string) => ipcRenderer.invoke(IpcChannel.ProjectsOpenTerminal, projectPath)
  },
  commands: {
    list: (projectId: number) => ipcRenderer.invoke(IpcChannel.CommandsList, projectId),
    create: (draft: CommandDraft) => ipcRenderer.invoke(IpcChannel.CommandsCreate, draft),
    update: (commandId: number, draft: CommandDraft) => ipcRenderer.invoke(IpcChannel.CommandsUpdate, commandId, draft),
    remove: (commandId: number) => ipcRenderer.invoke(IpcChannel.CommandsRemove, commandId),
    start: (commandId: number) => ipcRenderer.invoke(IpcChannel.CommandsStart, commandId),
    stop: (commandId: number) => ipcRenderer.invoke(IpcChannel.CommandsStop, commandId),
    statuses: (projectId: number) => ipcRenderer.invoke(IpcChannel.CommandsStatuses, projectId),
    logs: (commandId: number) => ipcRenderer.invoke(IpcChannel.CommandsLogs, commandId),
    onLog: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { commandId: number; chunk: string }): void => listener(payload)
      ipcRenderer.on(IpcChannel.CommandsLogEvent, handler)
      return () => ipcRenderer.removeListener(IpcChannel.CommandsLogEvent, handler)
    }
  },
  tasks: {
    list: (projectId?: number | null) => ipcRenderer.invoke(IpcChannel.TasksList, projectId),
    create: (draft: TaskDraft) => ipcRenderer.invoke(IpcChannel.TasksCreate, draft),
    update: (taskId: number, draft: Partial<TaskDraft>) => ipcRenderer.invoke(IpcChannel.TasksUpdate, taskId, draft),
    remove: (taskId: number) => ipcRenderer.invoke(IpcChannel.TasksRemove, taskId),
    notes: (taskId: number) => ipcRenderer.invoke(IpcChannel.TaskNotesList, taskId),
    addNote: (taskId: number, content: string) => ipcRenderer.invoke(IpcChannel.TaskNotesCreate, taskId, content),
    removeNote: (noteId: number) => ipcRenderer.invoke(IpcChannel.TaskNotesRemove, noteId),
    checklist: (taskId: number) => ipcRenderer.invoke(IpcChannel.TaskChecklistList, taskId),
    addChecklistItem: (taskId: number, title: string) => ipcRenderer.invoke(IpcChannel.TaskChecklistCreate, taskId, title),
    toggleChecklistItem: (itemId: number, done: boolean) => ipcRenderer.invoke(IpcChannel.TaskChecklistToggle, itemId, done),
    removeChecklistItem: (itemId: number) => ipcRenderer.invoke(IpcChannel.TaskChecklistRemove, itemId),
    completedBetween: (startIso: string, endIso: string) => ipcRenderer.invoke(IpcChannel.TasksCompletedBetween, startIso, endIso)
  },
  reports: {
    get: (reportDate: string) => ipcRenderer.invoke(IpcChannel.ReportsGet, reportDate),
    save: (reportDate: string, content: string) => ipcRenderer.invoke(IpcChannel.ReportsSave, reportDate, content),
    dates: () => ipcRenderer.invoke(IpcChannel.ReportsDates)
  },
  prompts: {
    list: () => ipcRenderer.invoke(IpcChannel.PromptsList),
    create: (draft: PromptDraft) => ipcRenderer.invoke(IpcChannel.PromptsCreate, draft),
    update: (promptId: number, draft: PromptDraft) => ipcRenderer.invoke(IpcChannel.PromptsUpdate, promptId, draft),
    remove: (promptId: number) => ipcRenderer.invoke(IpcChannel.PromptsRemove, promptId),
    importFiles: () => ipcRenderer.invoke(IpcChannel.PromptsImportFiles)
  },
  skills: {
    list: () => ipcRenderer.invoke(IpcChannel.SkillsList),
    open: (skillPath: string) => ipcRenderer.invoke(IpcChannel.SkillsOpen, skillPath)
  },
  backup: {
    create: () => ipcRenderer.invoke(IpcChannel.BackupCreate),
    openDir: () => ipcRenderer.invoke(IpcChannel.BackupOpenDir)
  },
  settings: {
    get: (key: string) => ipcRenderer.invoke(IpcChannel.SettingsGet, key),
    set: (key: string, value: string) => ipcRenderer.invoke(IpcChannel.SettingsSet, key, value)
  },
  app: {
    info: () => ipcRenderer.invoke(IpcChannel.AppInfo)
  }
}

contextBridge.exposeInMainWorld('devcanopy', api)
