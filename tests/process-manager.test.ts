import assert from 'node:assert/strict'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { AppDatabase } from '../src/main/database.ts'
import { ProcessManager } from '../src/main/process-manager.ts'
import type { SystemProbe } from '../src/main/system-probe.ts'
import type { CommandConfig, Project } from '../src/shared/types.ts'

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  exitCode: number | null = null
  killed = false
  pid: number | undefined

  constructor(pid: number | undefined) {
    super()
    this.pid = pid
  }
}

function asChild(child: FakeChild): ChildProcessWithoutNullStreams {
  return child as unknown as ChildProcessWithoutNullStreams
}

interface ProbeHarness {
  probe: SystemProbe
  killed: number[]
}

function fakeProbe(overrides: Partial<SystemProbe> = {}): ProbeHarness {
  const killed: number[] = []
  const probe: SystemProbe = {
    platform: 'linux',
    workingDirectoryExists: () => true,
    spawnCommand: () => {
      throw new Error('测试未预期 spawn')
    },
    processSnapshot: async () => [],
    isPortOpen: async () => false,
    findPortPid: async () => null,
    findProcess: async () => null,
    healthStatus: async () => null,
    killTree: async (pid) => {
      killed.push(pid)
    },
    ...overrides
  }
  return { probe, killed }
}

interface DatabaseHarness {
  db: AppDatabase
  finished: Array<{ runId: number; exitCode: number | null }>
}

function fakeDatabase(): DatabaseHarness {
  const finished: Array<{ runId: number; exitCode: number | null }> = []
  let nextRunId = 1
  const db = {
    createProcessRun: () => nextRunId++,
    finishProcessRun: (runId: number, exitCode: number | null) => {
      finished.push({ runId, exitCode })
    }
  }
  return { db: db as unknown as AppDatabase, finished }
}

const project: Project = {
  id: 1,
  name: '示例项目',
  path: 'C:\\tmp\\proj',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: null,
  commandCount: 1,
  taskCount: 0
}

function makeCommand(overrides: Partial<CommandConfig> = {}): CommandConfig {
  return {
    id: 1,
    projectId: 1,
    name: 'dev',
    command: 'npm run dev',
    workingDirectory: '',
    shell: '',
    detectionType: 'none',
    detectionValue: '',
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

test('start 拉起进程并报告 running,exit 后结算并回到 stopped', async () => {
  const child = new FakeChild(1234)
  const { probe } = fakeProbe({ spawnCommand: () => asChild(child) })
  const { db, finished } = fakeDatabase()
  const manager = new ProcessManager(db, () => {}, probe)
  const command = makeCommand()

  const runtime = await manager.start(command, project)
  assert.equal(runtime.state, 'running')
  assert.equal(runtime.pid, 1234)
  assert.equal((await manager.status(command, project)).source, 'managed')

  child.exitCode = 0
  child.emit('exit', 0)
  assert.deepEqual(finished, [{ runId: 1, exitCode: 0 }])
  assert.equal((await manager.status(command, project)).state, 'stopped')
})

test('并发 start 共享同一次尝试,只 spawn 一个进程', async () => {
  let spawnCount = 0
  const { probe } = fakeProbe({
    spawnCommand: () => {
      spawnCount += 1
      return asChild(new FakeChild(50 + spawnCount))
    }
  })
  const manager = new ProcessManager(fakeDatabase().db, () => {}, probe)
  const command = makeCommand()

  const [first, second] = await Promise.all([
    manager.start(command, project),
    manager.start(command, project)
  ])
  assert.equal(spawnCount, 1)
  assert.equal(first.pid, second.pid)
})

test('spawn error 事件清理托管条目并结算 run,状态转为 error', async () => {
  const child = new FakeChild(undefined)
  const { probe } = fakeProbe({ spawnCommand: () => asChild(child) })
  const { db, finished } = fakeDatabase()
  const manager = new ProcessManager(db, () => {}, probe)
  const command = makeCommand()

  await manager.start(command, project)
  child.emit('error', new Error('spawn ENOENT'))

  assert.deepEqual(finished, [{ runId: 1, exitCode: null }])
  const runtime = await manager.status(command, project)
  assert.equal(runtime.state, 'error')
  assert.match(runtime.detail ?? '', /ENOENT/)
})

test('disposeAll 结算并终止全部托管进程,之后 start 被拒绝', async () => {
  const child = new FakeChild(42)
  const { probe, killed } = fakeProbe({ spawnCommand: () => asChild(child) })
  const { db, finished } = fakeDatabase()
  const manager = new ProcessManager(db, () => {}, probe)
  const command = makeCommand()

  await manager.start(command, project)
  await manager.disposeAll()
  assert.deepEqual(killed, [42])
  assert.deepEqual(finished, [{ runId: 1, exitCode: null }])

  // 退出后 kill 触发的 exit 回调不应重复结算
  child.emit('exit', null)
  assert.equal(finished.length, 1)

  await assert.rejects(() => manager.start(command, project), /正在退出/)
})

test('stopManaged 等待 in-flight 启动落定后再终止,不放跑刚 spawn 的进程', async () => {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolvePromise) => {
    release = resolvePromise
  })
  const child = new FakeChild(77)
  const { probe, killed } = fakeProbe({
    isPortOpen: async () => {
      await gate
      return false
    },
    spawnCommand: () => asChild(child)
  })
  const { db, finished } = fakeDatabase()
  const manager = new ProcessManager(db, () => {}, probe)
  const command = makeCommand({ detectionType: 'port', detectionValue: '5173' })

  const startPromise = manager.start(command, project)
  const stopPromise = manager.stopManaged(command.id)
  release()
  await startPromise
  await stopPromise

  assert.deepEqual(killed, [77])
  assert.deepEqual(finished, [{ runId: 1, exitCode: null }])
  assert.equal(manager.getLogs(command.id), '')
})

test('传入 logsDir 时输出落盘为 <commandId>/<runId>.log,close 后内容完整', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'devcanopy-pm-logs-'))
  try {
    const child = new FakeChild(888)
    const { probe } = fakeProbe({ spawnCommand: () => asChild(child) })
    const manager = new ProcessManager(fakeDatabase().db, () => {}, probe, dir)
    await manager.start(makeCommand(), project)

    child.stdout.emit('data', Buffer.from('server started\n'))
    child.stderr.emit('data', Buffer.from('warn: low memory\n'))
    child.exitCode = 0
    child.emit('exit', 0)
    child.emit('close', 0)

    // 等 WriteStream 异步 flush 完成后再断言文件内容。
    const logPath = join(dir, '1', '1.log')
    const expected = 'server started\nwarn: low memory\n'
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (existsSync(logPath) && readFileSync(logPath, 'utf8') === expected) break
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
    }
    assert.equal(readFileSync(logPath, 'utf8'), expected)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('listManaged 反映存活托管进程,增减时触发 onManagedChange', async () => {
  const child = new FakeChild(321)
  const { probe } = fakeProbe({ spawnCommand: () => asChild(child) })
  const manager = new ProcessManager(fakeDatabase().db, () => {}, probe)
  let changes = 0
  manager.onManagedChange = () => { changes += 1 }
  assert.deepEqual(manager.listManaged(), [])

  await manager.start(makeCommand(), project)
  const running = manager.listManaged()
  assert.equal(running.length, 1)
  assert.equal(running[0].commandId, 1)
  assert.equal(running[0].pid, 321)
  assert.equal(changes, 1)

  child.exitCode = 0
  child.emit('exit', 0)
  assert.deepEqual(manager.listManaged(), [])
  assert.equal(changes, 2)
})

test('端口检测经 probe 报告 detected 运行态', async () => {
  const { probe } = fakeProbe({
    isPortOpen: async () => true,
    findPortPid: async () => 4321
  })
  const manager = new ProcessManager(fakeDatabase().db, () => {}, probe)
  const command = makeCommand({ detectionType: 'port', detectionValue: '5173' })

  const runtime = await manager.status(command, project)
  assert.equal(runtime.state, 'running')
  assert.equal(runtime.source, 'detected')
  assert.equal(runtime.pid, 4321)
  assert.match(runtime.detail ?? '', /5173/)
})
