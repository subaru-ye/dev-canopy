import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { backupFileName, runStartupBackup, selectExpiredBackups } from '../src/main/backup.ts'
import { AppDatabase } from '../src/main/database.ts'

test('selectExpiredBackups 只裁自动备份命名且保留最新 keep 份', () => {
  const names = [
    'devcanopy-2026-07-20.db',
    'devcanopy-2026-07-21.db',
    'devcanopy-2026-07-22.db',
    'devcanopy-2026-07-23.db',
    'devcanopy-2026-07-24.db',
    'devcanopy-2026-07-25.db',
    'devcanopy-2026-07-26.db',
    '手动备份.db',
    'devcanopy-2026-07-19.db.tmp'
  ]
  const expired = selectExpiredBackups(names, 5)
  // 最旧的两份出局,手动文件与临时文件不参与。
  assert.deepEqual(expired.sort(), ['devcanopy-2026-07-20.db', 'devcanopy-2026-07-21.db'])
  assert.deepEqual(selectExpiredBackups(['devcanopy-2026-07-26.db'], 5), [])
})

test('runStartupBackup 产出可读备份并滚动清理最旧', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'devcanopy-backup-'))
  try {
    const db = new AppDatabase(join(dir, 'devcanopy.db'))
    db.createTask({ projectId: null, title: '备份前的任务', description: '', status: 'todo', priority: 'normal', completionNote: '' })

    const backupsDir = join(dir, 'backups')
    // 预置 5 份旧备份,今天这份写入后最旧的一份应被清理。
    mkdirSync(backupsDir, { recursive: true })
    for (let day = 20; day <= 24; day += 1) {
      writeFileSync(join(backupsDir, backupFileName(`2026-07-${day}`)), '')
    }

    await runStartupBackup((destination) => db.backup(destination), backupsDir, '2026-07-26')
    db.close()

    const backupPath = join(backupsDir, backupFileName('2026-07-26'))
    assert.ok(existsSync(backupPath))
    assert.ok(!existsSync(join(backupsDir, backupFileName('2026-07-20'))))
    assert.equal(readdirSync(backupsDir).length, 5)

    // 验收:备份文件能以只读方式打开并读到数据。
    const readonly = new Database(backupPath, { readonly: true })
    const row = readonly.prepare('SELECT title FROM tasks').get() as { title: string }
    assert.equal(row.title, '备份前的任务')
    readonly.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runStartupBackup 同日重复执行覆盖当日备份而非报错', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'devcanopy-backup-'))
  try {
    const db = new AppDatabase(join(dir, 'devcanopy.db'))
    const backupsDir = join(dir, 'backups')
    await runStartupBackup((destination) => db.backup(destination), backupsDir, '2026-07-26')
    db.createTask({ projectId: null, title: '第二次启动前新增', description: '', status: 'todo', priority: 'normal', completionNote: '' })
    await runStartupBackup((destination) => db.backup(destination), backupsDir, '2026-07-26')
    db.close()

    const readonly = new Database(join(backupsDir, backupFileName('2026-07-26')), { readonly: true })
    const count = readonly.prepare('SELECT COUNT(*) AS count FROM tasks').get() as { count: number }
    assert.equal(count.count, 1)
    readonly.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
