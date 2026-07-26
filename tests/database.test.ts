import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
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
  const done = db.createTask({ projectId: null, title: '完成的事', description: '', status: 'done', priority: 'normal', completionNote: '' })
  db.createTask({ projectId: null, title: '未完成的事', description: '', status: 'todo', priority: 'normal', completionNote: '' })

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
  const task = db.createTask({ projectId: null, title: '原标题', description: '', status: 'todo', priority: 'normal', completionNote: '' })
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
