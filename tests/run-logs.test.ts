import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { cleanupRunLogs, runLogPath } from '../src/main/run-logs.ts'

test('runLogPath 组合 logs/<commandId>/<runId>.log', () => {
  assert.equal(runLogPath(join('C:', 'data', 'logs'), 3, 42), join('C:', 'data', 'logs', '3', '42.log'))
})

test('cleanupRunLogs 删除失效 run 的日志并移除空目录,保留存活与无关文件', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'devcanopy-runlogs-'))
  try {
    // 命令 1:run 1 存活、run 2 已被 prune;命令 2:全部失效;混入无关文件不受影响。
    mkdirSync(join(dir, '1'), { recursive: true })
    mkdirSync(join(dir, '2'), { recursive: true })
    writeFileSync(join(dir, '1', '1.log'), 'alive')
    writeFileSync(join(dir, '1', '2.log'), 'pruned')
    writeFileSync(join(dir, '1', 'note.txt'), 'unrelated')
    writeFileSync(join(dir, '2', '3.log'), 'cascade-deleted')

    const removed = await cleanupRunLogs(dir, new Set([1]))
    assert.equal(removed, 2)
    assert.ok(existsSync(join(dir, '1', '1.log')))
    assert.ok(!existsSync(join(dir, '1', '2.log')))
    assert.ok(existsSync(join(dir, '1', 'note.txt')))
    // 命令 2 目录已空,连目录一起移除;命令 1 还有文件,目录保留。
    assert.ok(!existsSync(join(dir, '2')))
    assert.ok(existsSync(join(dir, '1')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cleanupRunLogs 对不存在的目录静默返回 0', async () => {
  assert.equal(await cleanupRunLogs(join(tmpdir(), 'devcanopy-no-such-dir'), new Set()), 0)
})
