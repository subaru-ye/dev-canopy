import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { AppDatabase } from '../src/main/database.ts'
import { localDayUtcRange, shiftDate } from '../src/renderer/src/utils/dates.ts'

function localDateOf(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function openDb(): AppDatabase {
  return new AppDatabase(':memory:')
}

test('日报 upsert 幂等,日期清单倒序,清空即删', () => {
  const db = openDb()
  const first = db.upsertDailyReport('2026-07-25', '第一版')
  const second = db.upsertDailyReport('2026-07-25', '第二版')
  assert.equal(second.id, first.id)
  assert.equal(second.content, '第二版')
  db.upsertDailyReport('2026-07-24', '昨天')
  assert.deepEqual(db.listDailyReportDates(), ['2026-07-25', '2026-07-24'])
  db.removeDailyReport('2026-07-24')
  assert.equal(db.getDailyReport('2026-07-24'), null)
  db.close()
})

test('当日完成任务走半开区间,相邻两天区间无缝衔接', () => {
  const db = openDb()
  const done = db.createTask({ projectId: null, title: '完成的事', description: '', status: 'done', priority: 'normal', dueDate: null, completionNote: '' })
  db.createTask({ projectId: null, title: '未完成的事', description: '', status: 'todo', priority: 'normal', dueDate: null, completionNote: '' })

  // 用任务自身 completedAt 推导所属本地日,测试跨零点运行也不会错位。
  assert.ok(done.completedAt !== null)
  const day = localDateOf(done.completedAt as string)
  const range = localDayUtcRange(day)
  // 半开区间连续性:今天的 end 就是明天的 start(比断言恰好 24h 更稳,DST 切换日宽度本就不是 24h)。
  assert.equal(range.endIso, localDayUtcRange(shiftDate(day, 1)).startIso)

  const completed = db.listTasksCompletedBetween(range.startIso, range.endIso)
  assert.equal(completed.length, 1)
  assert.equal(completed[0].id, done.id)
  assert.ok((done.completedAt as string) >= range.startIso && (done.completedAt as string) < range.endIso)

  db.updateTask(done.id, { status: 'todo' })
  assert.equal(db.listTasksCompletedBetween(range.startIso, range.endIso).length, 0)
  db.close()
})

test('updateTask 对文本字段 trim', () => {
  const db = openDb()
  const task = db.createTask({ projectId: null, title: '原标题', description: '', status: 'todo', priority: 'normal', dueDate: null, completionNote: '' })
  const updated = db.updateTask(task.id, { title: '  新标题  ', description: '  描述  ' })
  assert.equal(updated.title, '新标题')
  assert.equal(updated.description, '描述')
  db.close()
})

test('prompts CRUD 与批量导入的回退标题', () => {
  const db = openDb()
  const prompt = db.createPrompt({ title: '  代码评审  ', content: '  保留首尾空白  ' })
  assert.equal(prompt.title, '代码评审')
  assert.equal(prompt.content, '  保留首尾空白  ')
  assert.equal(db.updatePrompt(prompt.id, { title: '评审 v2', content: '新正文' }).title, '评审 v2')
  assert.equal(db.importPrompts([{ title: 'A', content: 'a' }, { title: '', content: 'b' }]), 2)
  const all = db.listPrompts()
  assert.equal(all.length, 3)
  assert.ok(all.some((entry) => entry.title === '未命名记忆'))
  db.removePrompt(prompt.id)
  assert.equal(db.getPrompt(prompt.id), null)
  db.close()
})

test('pruneProcessRuns 只裁保留期之外的记录', () => {
  const db = openDb()
  const project = db.createProject({ name: '示例', path: 'C:\\tmp\\proj', commands: [{ name: 'dev', command: 'npm run dev', workingDirectory: '' }] })
  const command = db.listCommands(project.id)[0]
  const oldRun = db.createProcessRun(command.id, 100, new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString())
  db.createProcessRun(command.id, 101, new Date().toISOString())
  db.finishProcessRun(oldRun, 0)
  assert.equal(db.pruneProcessRuns(30), 1)
  assert.equal(db.pruneProcessRuns(30), 0)
  db.close()
})

test('listProcessRuns 按开始时间倒序并受 limit 约束,listProcessRunIds 返回全量', () => {
  const db = openDb()
  const project = db.createProject({ name: '示例', path: 'C:\\tmp\\proj', commands: [{ name: 'dev', command: 'npm run dev', workingDirectory: '' }] })
  const command = db.listCommands(project.id)[0]
  const base = Date.now()
  const ids: number[] = []
  for (let index = 0; index < 3; index += 1) {
    ids.push(db.createProcessRun(command.id, 100 + index, new Date(base + index * 1000).toISOString()))
  }
  db.finishProcessRun(ids[2], 0)

  const runs = db.listProcessRuns(command.id)
  assert.deepEqual(runs.map((run) => run.id), [ids[2], ids[1], ids[0]])
  assert.equal(runs[0].exitCode, 0)
  assert.ok(runs[0].endedAt !== null)
  assert.equal(runs[1].exitCode, null)
  assert.equal(db.listProcessRuns(command.id, 2).length, 2)
  assert.deepEqual(db.listProcessRunIds().sort(), ids.sort())
  db.close()
})

test('search 覆盖四类实体,中文关键词可用且摘要含命中片段', () => {
  const db = openDb()
  db.createProject({ name: '全域检索工程', path: 'C:\\tmp\\search-proj', commands: [] })
  db.createTask({ projectId: null, title: '检索任务标题', description: '任务正文里提到全域检索细节', status: 'todo', priority: 'normal', dueDate: null, completionNote: '' })
  db.upsertDailyReport('2026-07-25', '今天调研了全域检索方案，明天继续。')
  db.createPrompt({ title: '检索提示词', content: '这里保存了全域检索的模板文本' })

  const results = db.search('全域检索')
  assert.deepEqual(results.map((result) => result.kind).sort(), ['project', 'prompt', 'report', 'task'])
  const report = results.find((result) => result.kind === 'report')
  assert.equal(report?.date, '2026-07-25')
  assert.ok(report?.snippet.includes('全域检索'))
  assert.equal(results.find((result) => result.kind === 'project')?.title, '全域检索工程')
  db.close()
})

test('search 转义 % 与 _,空白关键词返回空,单类限 10 条', () => {
  const db = openDb()
  db.createPrompt({ title: '进度 100%达成', content: 'a' })
  db.createPrompt({ title: '进度 100 分', content: 'b' })
  // 未转义时 '100%达' 中的 % 会吞掉任意中缀,把 '100 分' 也误伤进来。
  assert.deepEqual(db.search('100%达').map((result) => result.title), ['进度 100%达成'])
  assert.equal(db.search('   ').length, 0)

  for (let index = 0; index < 12; index += 1) {
    db.createTask({ projectId: null, title: `批量任务 ${index}`, description: '', status: 'todo', priority: 'normal', dueDate: null, completionNote: '' })
  }
  assert.equal(db.search('批量任务').length, 10)
  db.close()
})

test('settings 键值表:get 未写返回 null,set 幂等覆盖', () => {
  const db = openDb()
  assert.equal(db.getSetting('theme'), null)
  db.setSetting('theme', 'light')
  assert.equal(db.getSetting('theme'), 'light')
  db.setSetting('theme', 'dark')
  assert.equal(db.getSetting('theme'), 'dark')
  db.close()
})

test('迁移 1:仅有基线的老库升级后获得 settings 表且 user_version 递增', () => {
  const dbPath = join(tmpdir(), `devcanopy-migrate-${process.pid}-${Math.floor(Math.random() * 1e9)}.db`)
  try {
    // 模拟只跑过迁移 0 的老库:建基线结构后剥掉迁移 1/2 的产物,把 user_version 拨回 1。
    const seeded = new AppDatabase(dbPath)
    seeded.createPrompt({ title: '升级前数据', content: 'v1' })
    seeded.close()
    const raw = new Database(dbPath)
    raw.exec('DROP TABLE settings')
    raw.exec('DROP INDEX idx_tasks_due_date')
    raw.exec('ALTER TABLE tasks DROP COLUMN due_date')
    raw.pragma('user_version = 1')
    raw.close()

    const upgraded = new AppDatabase(dbPath)
    upgraded.setSetting('theme', 'light')
    assert.equal(upgraded.getSetting('theme'), 'light')
    assert.equal(upgraded.listPrompts()[0]?.title, '升级前数据')
    upgraded.close()

    const check = new Database(dbPath, { readonly: true })
    assert.equal(check.pragma('user_version', { simple: true }), 3)
    check.close()
  } finally {
    for (const suffix of ['', '-wal', '-shm']) {
      try { rmSync(dbPath + suffix) } catch { /* 忽略 */ }
    }
  }
})

test('迁移 2:老库 ALTER 加 due_date 列,数据保留且新列可写', () => {
  const dbPath = join(tmpdir(), `devcanopy-due-${process.pid}-${Math.floor(Math.random() * 1e9)}.db`)
  try {
    // 建满版本库写入任务,再手工退回迁移 2 之前的结构(删索引与列 + 拨回版本号)。
    const seeded = new AppDatabase(dbPath)
    const created = seeded.createTask({ projectId: null, title: '升级前任务', description: '', status: 'todo', priority: 'normal', dueDate: null, completionNote: '' })
    seeded.close()
    const raw = new Database(dbPath)
    raw.exec('DROP INDEX idx_tasks_due_date')
    raw.exec('ALTER TABLE tasks DROP COLUMN due_date')
    raw.pragma('user_version = 2')
    raw.close()

    const upgraded = new AppDatabase(dbPath)
    const restored = upgraded.getTask(created.id)
    assert.equal(restored?.title, '升级前任务')
    assert.equal(restored?.dueDate, null)
    assert.equal(upgraded.updateTask(created.id, { dueDate: '2026-08-01' }).dueDate, '2026-08-01')
    upgraded.close()

    const check = new Database(dbPath, { readonly: true })
    assert.equal(check.pragma('user_version', { simple: true }), 3)
    const columns = check.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>
    assert.ok(columns.some((column) => column.name === 'due_date'))
    check.close()
  } finally {
    for (const suffix of ['', '-wal', '-shm']) {
      try { rmSync(dbPath + suffix) } catch { /* 忽略 */ }
    }
  }
})

test('listTasks 同状态组内把逾期/今日到期前置,已完成任务不受截止影响', () => {
  const db = openDb()
  const base = { projectId: null, description: '', completionNote: '' }
  db.createTask({ ...base, title: '高优未来', status: 'todo', priority: 'high', dueDate: '2026-08-30' })
  db.createTask({ ...base, title: '无截止', status: 'todo', priority: 'normal', dueDate: null })
  db.createTask({ ...base, title: '高优逾期', status: 'todo', priority: 'high', dueDate: '2026-07-20' })
  db.createTask({ ...base, title: '普通今日', status: 'todo', priority: 'normal', dueDate: '2026-07-27' })
  db.createTask({ ...base, title: '进行中', status: 'doing', priority: 'normal', dueDate: null })
  db.createTask({ ...base, title: '完成但日期已过', status: 'done', priority: 'high', dueDate: '2026-07-01' })

  const titles = db.listTasks(undefined, '2026-07-27').map((task) => task.title)
  assert.deepEqual(titles, ['进行中', '高优逾期', '普通今日', '高优未来', '无截止', '完成但日期已过'])
  assert.equal(db.listTasks(undefined, '2026-07-27').find((task) => task.title === '高优逾期')?.dueDate, '2026-07-20')
  db.close()
})

test('版本化迁移:老库二次打开不重复执行且数据保留', () => {
  const dbPath = join(tmpdir(), `devcanopy-test-${process.pid}-${Math.floor(Math.random() * 1e9)}.db`)
  try {
    const first = new AppDatabase(dbPath)
    const created = first.createPrompt({ title: '迁移检查', content: 'v1' })
    first.close()

    const second = new AppDatabase(dbPath)
    const restored = second.getPrompt(created.id)
    assert.equal(restored?.title, '迁移检查')
    second.close()
  } finally {
    for (const suffix of ['', '-wal', '-shm']) {
      try { rmSync(dbPath + suffix) } catch { /* 忽略 */ }
    }
  }
})
