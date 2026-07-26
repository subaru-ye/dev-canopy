import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import type { CommandConfig, CommandRuntime, Project } from '../shared/types'
import type { AppDatabase } from './database'
import {
  matchAutomaticProcess,
  parseWindowsProcessSnapshot,
  type ProcessSnapshot
} from './process-detection'

const execFileAsync = promisify(execFile)

interface ManagedProcess {
  child: ChildProcessWithoutNullStreams
  startedAt: string
  runId: number
}

export class ProcessManager {
  private static readonly SNAPSHOT_TTL_MS = 4_000

  private readonly managed = new Map<number, ManagedProcess>()
  private readonly logs = new Map<number, string>()
  private readonly lastErrors = new Map<number, string>()
  private processSnapshotInFlight: Promise<ProcessSnapshot[]> | null = null
  private processSnapshotCache: { takenAt: number; processes: ProcessSnapshot[] } | null = null

  constructor(
    private readonly database: AppDatabase,
    private readonly emitLog: (commandId: number, chunk: string) => void
  ) {}

  async start(command: CommandConfig, project: Project): Promise<CommandRuntime> {
    const current = await this.status(command, project)
    if (current.state === 'running' || current.state === 'starting') return current

    const workingDirectory = resolve(project.path, command.workingDirectory || '.')
    if (!existsSync(workingDirectory)) {
      throw new Error(`工作目录不存在：${workingDirectory}`)
    }

    this.lastErrors.delete(command.id)
    this.logs.set(command.id, '')
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/s', '/c', command.command], {
          cwd: workingDirectory,
          windowsHide: true,
          env: { ...process.env, FORCE_COLOR: '1' }
        })
      : spawn(command.shell || process.env.SHELL || '/bin/sh', ['-lc', command.command], {
          cwd: workingDirectory,
          detached: true,
          env: { ...process.env, FORCE_COLOR: '1' }
        })

    const startedAt = new Date().toISOString()
    const runId = this.database.createProcessRun(command.id, child.pid ?? 0, startedAt)
    this.managed.set(command.id, { child, startedAt, runId })

    const append = (data: Buffer): void => {
      const chunk = data.toString('utf8')
      const previous = this.logs.get(command.id) ?? ''
      this.logs.set(command.id, (previous + chunk).slice(-200_000))
      this.emitLog(command.id, chunk)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', (error) => {
      this.lastErrors.set(command.id, error.message)
      append(Buffer.from(`\n[DevCanopy] ${error.message}\n`, 'utf8'))
    })
    child.on('exit', (code) => {
      this.database.finishProcessRun(runId, code)
      this.managed.delete(command.id)
      if (code !== 0 && code !== null) this.lastErrors.set(command.id, `进程退出码：${code}`)
      this.emitLog(command.id, `\n[DevCanopy] 进程已退出，退出码 ${code ?? 'unknown'}。\n`)
    })

    return {
      commandId: command.id,
      state: 'running',
      pid: child.pid ?? null,
      startedAt,
      source: 'managed',
      detail: null
    }
  }

  async stop(command: CommandConfig, project: Project): Promise<CommandRuntime> {
    const runtime = await this.status(command, project)
    if (!runtime.pid) return runtime
    await this.killTree(runtime.pid)
    this.managed.delete(command.id)
    return {
      commandId: command.id,
      state: 'stopped',
      pid: null,
      startedAt: null,
      source: null,
      detail: null
    }
  }

  getLogs(commandId: number): string {
    return this.logs.get(commandId) ?? ''
  }

  async status(command: CommandConfig, project: Project): Promise<CommandRuntime> {
    const managed = this.managed.get(command.id)
    if (managed && managed.child.exitCode === null && !managed.child.killed) {
      return {
        commandId: command.id,
        state: 'running',
        pid: managed.child.pid ?? null,
        startedAt: managed.startedAt,
        source: 'managed',
        detail: null
      }
    }

    const detected = await this.detect(command, project)
    if (detected) {
      return {
        commandId: command.id,
        state: 'running',
        pid: detected.pid,
        startedAt: detected.startedAt,
        source: 'detected',
        detail: detected.detail
      }
    }

    const error = this.lastErrors.get(command.id)
    return {
      commandId: command.id,
      state: error ? 'error' : 'stopped',
      pid: null,
      startedAt: null,
      source: null,
      detail: error ?? null
    }
  }

  private async detect(
    command: CommandConfig,
    project: Project
  ): Promise<{ pid: number | null; startedAt: string | null; detail: string } | null> {
    if (command.detectionType === 'none') return this.detectPackageScript(command, project)
    if (!command.detectionValue) return null
    if (command.detectionType === 'port') {
      const port = Number(command.detectionValue)
      if (!Number.isInteger(port) || port < 1 || port > 65535) return null
      if (!(await this.isPortOpen(port))) return null
      return { pid: await this.findPortPid(port), startedAt: null, detail: `端口 ${port} 正在监听` }
    }
    if (command.detectionType === 'health') {
      try {
        const response = await fetch(command.detectionValue, {
          signal: AbortSignal.timeout(1_500)
        })
        return response.ok
          ? { pid: null, startedAt: null, detail: `健康检查返回 ${response.status}` }
          : null
      } catch {
        return null
      }
    }
    if (command.detectionType === 'process') {
      const process = await this.findProcess(command.detectionValue)
      return process ? { ...process, startedAt: null } : null
    }
    return null
  }

  private async detectPackageScript(command: CommandConfig, project: Project) {
    if (process.platform !== 'win32') return null
    const processes = await this.getWindowsProcessSnapshot()
    return matchAutomaticProcess(command.command, project.path, processes)
  }

  private async getWindowsProcessSnapshot(): Promise<ProcessSnapshot[]> {
    const cached = this.processSnapshotCache
    if (cached && Date.now() - cached.takenAt < ProcessManager.SNAPSHOT_TTL_MS) return cached.processes
    if (this.processSnapshotInFlight) return this.processSnapshotInFlight

    const script = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress'
    this.processSnapshotInFlight = execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', script],
      { timeout: 4_000, maxBuffer: 5 * 1024 * 1024 }
    )
      .then(({ stdout }) => {
        const processes = parseWindowsProcessSnapshot(stdout)
        this.processSnapshotCache = { takenAt: Date.now(), processes }
        return processes
      })
      .catch(() => [])
      .finally(() => {
        this.processSnapshotInFlight = null
      })
    return this.processSnapshotInFlight
  }

  private isPortOpen(port: number): Promise<boolean> {
    return new Promise((resolvePromise) => {
      const socket = net.createConnection({ host: '127.0.0.1', port })
      const finish = (value: boolean): void => {
        socket.removeAllListeners()
        socket.destroy()
        resolvePromise(value)
      }
      socket.setTimeout(500)
      socket.once('connect', () => finish(true))
      socket.once('timeout', () => finish(false))
      socket.once('error', () => finish(false))
    })
  }

  private async findPortPid(port: number): Promise<number | null> {
    if (process.platform !== 'win32') return null
    try {
      const script = `(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)`
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], { timeout: 2_000 })
      const pid = Number(stdout.trim())
      return Number.isInteger(pid) && pid > 0 ? pid : null
    } catch {
      return null
    }
  }

  private async findProcess(keyword: string): Promise<{ pid: number; detail: string } | null> {
    if (process.platform === 'win32') {
      const safeKeyword = keyword.replaceAll("'", "''")
      const script = `$k='${safeKeyword}'; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($k, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -First 1 ProcessId,Name,CommandLine | ConvertTo-Json -Compress`
      try {
        const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], { timeout: 3_000 })
        if (!stdout.trim()) return null
        const match = JSON.parse(stdout) as { ProcessId: number; Name: string }
        return { pid: match.ProcessId, detail: `检测到 ${match.Name}` }
      } catch {
        return null
      }
    }
    try {
      const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,command='], { timeout: 2_000 })
      const line = stdout.split('\n').find((entry) => entry.toLowerCase().includes(keyword.toLowerCase()))
      if (!line) return null
      const pid = Number(line.trim().split(/\s+/, 1)[0])
      return Number.isInteger(pid) ? { pid, detail: `检测到进程 ${pid}` } : null
    } catch {
      return null
    }
  }

  private async killTree(pid: number): Promise<void> {
    try {
      if (process.platform === 'win32') {
        await execFileAsync('taskkill.exe', ['/pid', String(pid), '/T', '/F'], { timeout: 8_000 })
        return
      }
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        process.kill(pid, 'SIGTERM')
      }
    } finally {
      // 进程树已变化,丢弃快照缓存,避免刚停止的命令在 TTL 内仍被识别为运行中。
      this.processSnapshotCache = null
    }
  }
}
