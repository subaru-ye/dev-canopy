import Database from 'better-sqlite3'
import type {
  CommandConfig,
  CommandDraft,
  DailyReport,
  ProcessRun,
  Project,
  ProjectDraft,
  PromptDoc,
  PromptDraft,
  SearchResult,
  Task,
  TaskChecklistItem,
  TaskDraft,
  TaskNote
} from '../shared/types'

// 命中位置前后截一段作为搜索结果摘要,压掉换行以免撑爆单行 UI。
function excerpt(text: string, query: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  const index = clean.toLowerCase().indexOf(query.toLowerCase())
  if (index < 0) return clean.slice(0, 80)
  const start = Math.max(0, index - 24)
  return `${start > 0 ? '…' : ''}${clean.slice(start, index + query.length + 56)}`
}

// 用 SQLite 在线 backup 拷贝数据库(连同 WAL 中未落盘的写入),供旧路径迁移使用。
export async function copyDatabase(sourcePath: string, destinationPath: string): Promise<void> {
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true })
  try {
    await source.backup(destinationPath)
  } finally {
    source.close()
  }
}

// 共享的列映射片段:同一实体的 SELECT/INSERT 只写一份,加列时不会漏改某个读取点。
const PROJECT_SELECT = `
  SELECT
    p.id,
    p.name,
    p.path,
    p.created_at AS createdAt,
    p.last_opened_at AS lastOpenedAt,
    (SELECT COUNT(*) FROM commands c WHERE c.project_id = p.id) AS commandCount,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'done') AS taskCount
  FROM projects p`

const COMMAND_SELECT = `
  SELECT
    id,
    project_id AS projectId,
    name,
    command,
    working_directory AS workingDirectory,
    shell,
    detection_type AS detectionType,
    detection_value AS detectionValue,
    sort_order AS sortOrder,
    created_at AS createdAt
  FROM commands`

const TASK_SELECT = `
  SELECT
    t.id,
    t.project_id AS projectId,
    p.name AS projectName,
    t.title,
    t.description,
    t.status,
    t.priority,
    t.completion_note AS completionNote,
    t.created_at AS createdAt,
    t.completed_at AS completedAt,
    (SELECT COUNT(*) FROM task_notes n WHERE n.task_id = t.id) AS noteCount,
    (SELECT COUNT(*) FROM task_checklist c WHERE c.task_id = t.id AND c.done = 1) AS checklistDone,
    (SELECT COUNT(*) FROM task_checklist c WHERE c.task_id = t.id) AS checklistTotal
  FROM tasks t
  LEFT JOIN projects p ON p.id = t.project_id`

const REPORT_SELECT = `
  SELECT id, report_date AS reportDate, content, created_at AS createdAt, updated_at AS updatedAt
  FROM daily_reports`

const PROMPT_SELECT = `
  SELECT id, title, content, created_at AS createdAt, updated_at AS updatedAt
  FROM prompts`

const PROMPT_INSERT = `
  INSERT INTO prompts (title, content, created_at, updated_at)
  VALUES (@title, @content, @createdAt, @updatedAt)`

export class AppDatabase {
  private readonly db: Database.Database

  constructor(databasePath: string) {
    this.db = new Database(databasePath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
  }

  close(): void {
    this.db.close()
  }

  // SQLite 在线 backup:WAL 模式下热备安全,连同未 checkpoint 的写入一起落盘。
  async backup(destinationPath: string): Promise<void> {
    await this.db.backup(destinationPath)
  }

  // 版本化迁移:PRAGMA user_version 记录已执行到第几步,新库与老库都从自己的版本继续。
  // 迁移 0 是幂等基线(全部 IF NOT EXISTS);之后的结构变更(如 ALTER TABLE 加列)必须
  // 作为新数组项追加,禁止改动已发布的条目。
  private migrate(): void {
    const migrations = [this.baselineSchema(), this.settingsSchema()]
    const applyMigrations = this.db.transaction(() => {
      let version = this.db.pragma('user_version', { simple: true }) as number
      while (version < migrations.length) {
        this.db.exec(migrations[version])
        version += 1
        this.db.pragma(`user_version = ${version}`)
      }
    })
    applyMigrations()
  }

  private baselineSchema(): string {
    return `
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_opened_at TEXT
      );

      CREATE TABLE IF NOT EXISTS commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        command TEXT NOT NULL,
        working_directory TEXT NOT NULL DEFAULT '',
        shell TEXT NOT NULL DEFAULT '',
        detection_type TEXT NOT NULL DEFAULT 'none',
        detection_value TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS process_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command_id INTEGER NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
        pid INTEGER,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        exit_code INTEGER
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'todo',
        priority TEXT NOT NULL DEFAULT 'normal',
        completion_note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS task_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_checklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS daily_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_date TEXT NOT NULL UNIQUE,
        content TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_commands_project ON commands(project_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_completed_at ON tasks(completed_at);
      CREATE INDEX IF NOT EXISTS idx_task_notes_task ON task_notes(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_checklist_task ON task_checklist(task_id);
      CREATE INDEX IF NOT EXISTS idx_prompts_updated ON prompts(updated_at);
    `
  }

  // 迁移 1:settings 键值表,主题/托盘/模板等配置的公共基建。
  private settingsSchema(): string {
    return `
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  setSetting(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value)
  }

  listProjects(): Project[] {
    return this.db.prepare(`
      ${PROJECT_SELECT}
      ORDER BY COALESCE(p.last_opened_at, p.created_at) DESC
    `).all() as Project[]
  }

  getProject(projectId: number): Project | null {
    return (this.db.prepare(`
      ${PROJECT_SELECT}
      WHERE p.id = ?
    `).get(projectId) as Project | undefined) ?? null
  }

  createProject(draft: ProjectDraft): Project {
    const now = new Date().toISOString()
    const insertProject = this.db.prepare(`
      INSERT INTO projects (name, path, created_at, last_opened_at)
      VALUES (@name, @path, @createdAt, @lastOpenedAt)
    `)
    const insertCommand = this.db.prepare(`
      INSERT INTO commands (
        project_id, name, command, working_directory, shell,
        detection_type, detection_value, sort_order, created_at
      ) VALUES (
        @projectId, @name, @command, @workingDirectory, '',
        'none', '', @sortOrder, @createdAt
      )
    `)

    const create = this.db.transaction(() => {
      const result = insertProject.run({
        name: draft.name.trim(),
        path: draft.path,
        createdAt: now,
        lastOpenedAt: now
      })
      const projectId = Number(result.lastInsertRowid)
      draft.commands.forEach((command, index) => {
        insertCommand.run({
          projectId,
          name: command.name.trim(),
          command: command.command.trim(),
          workingDirectory: command.workingDirectory.trim(),
          sortOrder: index,
          createdAt: now
        })
      })
      return projectId
    })

    const project = this.getProject(create())
    if (!project) throw new Error('创建项目后无法读取项目。')
    return project
  }

  touchProject(projectId: number): void {
    this.db.prepare('UPDATE projects SET last_opened_at = ? WHERE id = ?')
      .run(new Date().toISOString(), projectId)
  }

  removeProject(projectId: number): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
  }

  listCommands(projectId: number): CommandConfig[] {
    return this.db.prepare(`
      ${COMMAND_SELECT}
      WHERE project_id = ?
      ORDER BY sort_order ASC, id ASC
    `).all(projectId) as CommandConfig[]
  }

  getCommand(commandId: number): CommandConfig | null {
    return (this.db.prepare(`
      ${COMMAND_SELECT}
      WHERE id = ?
    `).get(commandId) as CommandConfig | undefined) ?? null
  }

  createCommand(draft: CommandDraft): CommandConfig {
    const nextOrder = this.db.prepare(`
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS nextOrder
      FROM commands WHERE project_id = ?
    `).get(draft.projectId) as { nextOrder: number }
    const result = this.db.prepare(`
      INSERT INTO commands (
        project_id, name, command, working_directory, shell,
        detection_type, detection_value, sort_order, created_at
      ) VALUES (
        @projectId, @name, @command, @workingDirectory, @shell,
        @detectionType, @detectionValue, @sortOrder, @createdAt
      )
    `).run({
      ...draft,
      name: draft.name.trim(),
      command: draft.command.trim(),
      workingDirectory: draft.workingDirectory.trim(),
      detectionValue: draft.detectionValue.trim(),
      sortOrder: nextOrder.nextOrder,
      createdAt: new Date().toISOString()
    })
    const command = this.getCommand(Number(result.lastInsertRowid))
    if (!command) throw new Error('创建命令后无法读取命令。')
    return command
  }

  updateCommand(commandId: number, draft: CommandDraft): CommandConfig {
    this.db.prepare(`
      UPDATE commands SET
        name = @name,
        command = @command,
        working_directory = @workingDirectory,
        shell = @shell,
        detection_type = @detectionType,
        detection_value = @detectionValue
      WHERE id = @id
    `).run({
      ...draft,
      id: commandId,
      name: draft.name.trim(),
      command: draft.command.trim(),
      workingDirectory: draft.workingDirectory.trim(),
      detectionValue: draft.detectionValue.trim()
    })
    const command = this.getCommand(commandId)
    if (!command) throw new Error('更新命令后无法读取命令。')
    return command
  }

  removeCommand(commandId: number): void {
    this.db.prepare('DELETE FROM commands WHERE id = ?').run(commandId)
  }

  createProcessRun(commandId: number, pid: number, startedAt: string): number {
    const result = this.db.prepare(`
      INSERT INTO process_runs (command_id, pid, started_at)
      VALUES (?, ?, ?)
    `).run(commandId, pid, startedAt)
    return Number(result.lastInsertRowid)
  }

  finishProcessRun(runId: number, exitCode: number | null): void {
    this.db.prepare(`
      UPDATE process_runs SET ended_at = ?, exit_code = ? WHERE id = ?
    `).run(new Date().toISOString(), exitCode, runId)
  }

  // 不清理会无限增长;启动时裁掉保留期之外的历史,调用方随后按存活 id 清理日志文件。
  pruneProcessRuns(retainDays = 30): number {
    const cutoff = new Date(Date.now() - retainDays * 24 * 3600 * 1000).toISOString()
    const result = this.db.prepare('DELETE FROM process_runs WHERE started_at < ?').run(cutoff)
    return result.changes
  }

  // hasLog 由主进程按日志文件是否存在补齐,数据库层不感知文件系统。
  listProcessRuns(commandId: number, limit = 20): Array<Omit<ProcessRun, 'hasLog'>> {
    return this.db.prepare(`
      SELECT id, command_id AS commandId, pid, started_at AS startedAt, ended_at AS endedAt, exit_code AS exitCode
      FROM process_runs
      WHERE command_id = ?
      ORDER BY started_at DESC, id DESC
      LIMIT ?
    `).all(commandId, limit) as Array<Omit<ProcessRun, 'hasLog'>>
  }

  listProcessRunIds(): number[] {
    const rows = this.db.prepare('SELECT id FROM process_runs').all() as Array<{ id: number }>
    return rows.map((row) => row.id)
  }

  listTasks(projectId?: number | null): Task[] {
    let where = ''
    const params: unknown[] = []
    if (typeof projectId === 'number') {
      where = 'WHERE t.project_id = ?'
      params.push(projectId)
    } else if (projectId === null) {
      where = 'WHERE t.project_id IS NULL'
    }
    return this.db.prepare(`
      ${TASK_SELECT}
      ${where}
      ORDER BY
        CASE t.status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END,
        CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
        t.created_at DESC
    `).all(...params) as Task[]
  }

  getTask(taskId: number): Task | null {
    return (this.db.prepare(`
      ${TASK_SELECT}
      WHERE t.id = ?
    `).get(taskId) as Task | undefined) ?? null
  }

  createTask(draft: TaskDraft): Task {
    const now = new Date().toISOString()
    const result = this.db.prepare(`
      INSERT INTO tasks (
        project_id, title, description, status, priority,
        completion_note, created_at, completed_at
      ) VALUES (
        @projectId, @title, @description, @status, @priority,
        @completionNote, @createdAt, @completedAt
      )
    `).run({
      ...draft,
      title: draft.title.trim(),
      description: draft.description.trim(),
      completionNote: draft.completionNote.trim(),
      createdAt: now,
      completedAt: draft.status === 'done' ? now : null
    })
    const task = this.getTask(Number(result.lastInsertRowid))
    if (!task) throw new Error('创建任务后无法读取任务。')
    return task
  }

  updateTask(taskId: number, patch: Partial<TaskDraft>): Task {
    const current = this.getTask(taskId)
    if (!current) throw new Error('任务不存在。')
    const next = {
      projectId: patch.projectId === undefined ? current.projectId : patch.projectId,
      title: (patch.title ?? current.title).trim(),
      description: (patch.description ?? current.description).trim(),
      status: patch.status ?? current.status,
      priority: patch.priority ?? current.priority,
      completionNote: (patch.completionNote ?? current.completionNote).trim()
    }
    const completedAt = next.status === 'done'
      ? (current.completedAt ?? new Date().toISOString())
      : null
    this.db.prepare(`
      UPDATE tasks SET
        project_id = @projectId,
        title = @title,
        description = @description,
        status = @status,
        priority = @priority,
        completion_note = @completionNote,
        completed_at = @completedAt
      WHERE id = @id
    `).run({ ...next, completedAt, id: taskId })
    const task = this.getTask(taskId)
    if (!task) throw new Error('更新任务后无法读取任务。')
    return task
  }

  removeTask(taskId: number): void {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId)
  }

  listTaskNotes(taskId: number): TaskNote[] {
    return this.db.prepare(`
      SELECT id, task_id AS taskId, content, created_at AS createdAt
      FROM task_notes
      WHERE task_id = ?
      ORDER BY created_at DESC, id DESC
    `).all(taskId) as TaskNote[]
  }

  createTaskNote(taskId: number, content: string): TaskNote {
    const result = this.db.prepare(`
      INSERT INTO task_notes (task_id, content, created_at)
      VALUES (?, ?, ?)
    `).run(taskId, content.trim(), new Date().toISOString())
    return this.db.prepare(`
      SELECT id, task_id AS taskId, content, created_at AS createdAt
      FROM task_notes WHERE id = ?
    `).get(Number(result.lastInsertRowid)) as TaskNote
  }

  removeTaskNote(noteId: number): void {
    this.db.prepare('DELETE FROM task_notes WHERE id = ?').run(noteId)
  }

  private readChecklistItem(itemId: number): TaskChecklistItem {
    const row = this.db.prepare(`
      SELECT id, task_id AS taskId, title, done, sort_order AS sortOrder, created_at AS createdAt
      FROM task_checklist WHERE id = ?
    `).get(itemId) as (Omit<TaskChecklistItem, 'done'> & { done: number }) | undefined
    if (!row) throw new Error('子任务不存在。')
    return { ...row, done: row.done === 1 }
  }

  listChecklistItems(taskId: number): TaskChecklistItem[] {
    const rows = this.db.prepare(`
      SELECT id, task_id AS taskId, title, done, sort_order AS sortOrder, created_at AS createdAt
      FROM task_checklist
      WHERE task_id = ?
      ORDER BY sort_order ASC, id ASC
    `).all(taskId) as Array<Omit<TaskChecklistItem, 'done'> & { done: number }>
    return rows.map((row) => ({ ...row, done: row.done === 1 }))
  }

  createChecklistItem(taskId: number, title: string): TaskChecklistItem {
    const nextOrder = this.db.prepare(`
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS nextOrder
      FROM task_checklist WHERE task_id = ?
    `).get(taskId) as { nextOrder: number }
    const result = this.db.prepare(`
      INSERT INTO task_checklist (task_id, title, done, sort_order, created_at)
      VALUES (?, ?, 0, ?, ?)
    `).run(taskId, title.trim(), nextOrder.nextOrder, new Date().toISOString())
    return this.readChecklistItem(Number(result.lastInsertRowid))
  }

  toggleChecklistItem(itemId: number, done: boolean): TaskChecklistItem {
    this.db.prepare('UPDATE task_checklist SET done = ? WHERE id = ?').run(done ? 1 : 0, itemId)
    return this.readChecklistItem(itemId)
  }

  removeChecklistItem(itemId: number): void {
    this.db.prepare('DELETE FROM task_checklist WHERE id = ?').run(itemId)
  }

  listTasksCompletedBetween(startIso: string, endIso: string): Task[] {
    return this.db.prepare(`
      ${TASK_SELECT}
      WHERE t.status = 'done' AND t.completed_at >= ? AND t.completed_at < ?
      ORDER BY t.completed_at ASC
    `).all(startIso, endIso) as Task[]
  }

  getDailyReport(reportDate: string): DailyReport | null {
    return (this.db.prepare(`
      ${REPORT_SELECT}
      WHERE report_date = ?
    `).get(reportDate) as DailyReport | undefined) ?? null
  }

  // 周报/月报聚合用:一次取回本地日期闭区间内的全部日报。
  listDailyReportsBetween(startDate: string, endDate: string): DailyReport[] {
    return this.db.prepare(`
      ${REPORT_SELECT}
      WHERE report_date >= ? AND report_date <= ?
      ORDER BY report_date ASC
    `).all(startDate, endDate) as DailyReport[]
  }

  upsertDailyReport(reportDate: string, content: string): DailyReport {
    const now = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO daily_reports (report_date, content, created_at, updated_at)
      VALUES (@reportDate, @content, @now, @now)
      ON CONFLICT(report_date) DO UPDATE SET
        content = excluded.content,
        updated_at = excluded.updated_at
    `).run({ reportDate, content, now })
    const report = this.getDailyReport(reportDate)
    if (!report) throw new Error('保存日报后无法读取日报。')
    return report
  }

  removeDailyReport(reportDate: string): void {
    this.db.prepare('DELETE FROM daily_reports WHERE report_date = ?').run(reportDate)
  }

  listDailyReportDates(): string[] {
    const rows = this.db.prepare(`
      SELECT report_date AS reportDate FROM daily_reports ORDER BY report_date DESC
    `).all() as Array<{ reportDate: string }>
    return rows.map((row) => row.reportDate)
  }

  listPrompts(): PromptDoc[] {
    return this.db.prepare(`
      ${PROMPT_SELECT}
      ORDER BY updated_at DESC, id DESC
    `).all() as PromptDoc[]
  }

  getPrompt(promptId: number): PromptDoc | null {
    return (this.db.prepare(`
      ${PROMPT_SELECT}
      WHERE id = ?
    `).get(promptId) as PromptDoc | undefined) ?? null
  }

  createPrompt(draft: PromptDraft): PromptDoc {
    const now = new Date().toISOString()
    const result = this.db.prepare(PROMPT_INSERT).run({
      title: draft.title.trim(),
      content: draft.content,
      createdAt: now,
      updatedAt: now
    })
    const prompt = this.getPrompt(Number(result.lastInsertRowid))
    if (!prompt) throw new Error('创建 Prompt 后无法读取。')
    return prompt
  }

  updatePrompt(promptId: number, draft: PromptDraft): PromptDoc {
    this.db.prepare(`
      UPDATE prompts SET title = @title, content = @content, updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id: promptId,
      title: draft.title.trim(),
      content: draft.content,
      updatedAt: new Date().toISOString()
    })
    const prompt = this.getPrompt(promptId)
    if (!prompt) throw new Error('更新 Prompt 后无法读取。')
    return prompt
  }

  removePrompt(promptId: number): void {
    this.db.prepare('DELETE FROM prompts WHERE id = ?').run(promptId)
  }

  // 全局搜索:四类实体各限 10 条。% 与 _ 转义后参数化拼接,含中文关键词直接可用。
  search(query: string): SearchResult[] {
    const keyword = query.trim()
    if (!keyword) return []
    const pattern = `%${keyword.replace(/[\\%_]/g, (char) => `\\${char}`)}%`

    const projects = this.db.prepare(`
      SELECT id, name, path FROM projects
      WHERE name LIKE ? ESCAPE '\\'
      ORDER BY COALESCE(last_opened_at, created_at) DESC
      LIMIT 10
    `).all(pattern) as Array<{ id: number; name: string; path: string }>

    const tasks = this.db.prepare(`
      SELECT id, title, description FROM tasks
      WHERE title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
      ORDER BY created_at DESC
      LIMIT 10
    `).all(pattern, pattern) as Array<{ id: number; title: string; description: string }>

    const reports = this.db.prepare(`
      SELECT id, report_date AS reportDate, content FROM daily_reports
      WHERE content LIKE ? ESCAPE '\\'
      ORDER BY report_date DESC
      LIMIT 10
    `).all(pattern) as Array<{ id: number; reportDate: string; content: string }>

    const prompts = this.db.prepare(`
      SELECT id, title, content FROM prompts
      WHERE title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\'
      ORDER BY updated_at DESC
      LIMIT 10
    `).all(pattern, pattern) as Array<{ id: number; title: string; content: string }>

    return [
      ...projects.map((row): SearchResult => ({ kind: 'project', id: row.id, title: row.name, snippet: row.path, date: null })),
      ...tasks.map((row): SearchResult => ({ kind: 'task', id: row.id, title: row.title, snippet: excerpt(row.description, keyword), date: null })),
      ...reports.map((row): SearchResult => ({ kind: 'report', id: row.id, title: row.reportDate, snippet: excerpt(row.content, keyword), date: row.reportDate })),
      ...prompts.map((row): SearchResult => ({ kind: 'prompt', id: row.id, title: row.title, snippet: excerpt(row.content, keyword), date: null }))
    ]
  }

  importPrompts(drafts: PromptDraft[]): number {
    const now = new Date().toISOString()
    const insert = this.db.prepare(PROMPT_INSERT)
    this.db.transaction(() => {
      for (const draft of drafts) {
        insert.run({
          title: draft.title.trim() || '未命名记忆',
          content: draft.content,
          createdAt: now,
          updatedAt: now
        })
      }
    })()
    return drafts.length
  }
}
