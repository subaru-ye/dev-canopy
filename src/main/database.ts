import Database from 'better-sqlite3'
import type {
  CommandConfig,
  CommandDraft,
  Project,
  ProjectDraft,
  Task,
  TaskDraft
} from '../shared/types'

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

  private migrate(): void {
    this.db.exec(`
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

      CREATE INDEX IF NOT EXISTS idx_commands_project ON commands(project_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    `)
  }

  listProjects(): Project[] {
    return this.db.prepare(`
      SELECT
        p.id,
        p.name,
        p.path,
        p.created_at AS createdAt,
        p.last_opened_at AS lastOpenedAt,
        (SELECT COUNT(*) FROM commands c WHERE c.project_id = p.id) AS commandCount,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'done') AS taskCount
      FROM projects p
      ORDER BY COALESCE(p.last_opened_at, p.created_at) DESC
    `).all() as Project[]
  }

  getProject(projectId: number): Project | null {
    return (this.db.prepare(`
      SELECT
        p.id,
        p.name,
        p.path,
        p.created_at AS createdAt,
        p.last_opened_at AS lastOpenedAt,
        (SELECT COUNT(*) FROM commands c WHERE c.project_id = p.id) AS commandCount,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'done') AS taskCount
      FROM projects p
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
      FROM commands
      WHERE project_id = ?
      ORDER BY sort_order ASC, id ASC
    `).all(projectId) as CommandConfig[]
  }

  getCommand(commandId: number): CommandConfig | null {
    return (this.db.prepare(`
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
      FROM commands
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
        t.completed_at AS completedAt
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      ${where}
      ORDER BY
        CASE t.status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END,
        CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
        t.created_at DESC
    `).all(...params) as Task[]
  }

  getTask(taskId: number): Task | null {
    return (this.db.prepare(`
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
        t.completed_at AS completedAt
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
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
      title: patch.title ?? current.title,
      description: patch.description ?? current.description,
      status: patch.status ?? current.status,
      priority: patch.priority ?? current.priority,
      completionNote: patch.completionNote ?? current.completionNote
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
}
