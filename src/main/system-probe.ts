import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { promisify } from 'node:util'
import { parseWindowsProcessSnapshot, type ProcessSnapshot } from './process-detection'

const execFileAsync = promisify(execFile)

// ProcessManager 的全部 OS 触点收敛在这个接口后面:状态机逻辑用假实现即可单测,
// 真实的 PowerShell/taskkill/ps/spawn 调用只存在于 systemProbe 一处。
export interface SystemProbe {
  readonly platform: NodeJS.Platform
  workingDirectoryExists(directory: string): boolean
  spawnCommand(command: string, shell: string, workingDirectory: string): ChildProcessWithoutNullStreams
  processSnapshot(): Promise<ProcessSnapshot[]>
  isPortOpen(port: number): Promise<boolean>
  findPortPid(port: number): Promise<number | null>
  findProcess(keyword: string): Promise<{ pid: number; detail: string } | null>
  healthStatus(url: string): Promise<number | null>
  killTree(pid: number): Promise<void>
}

export const systemProbe: SystemProbe = {
  platform: process.platform,

  workingDirectoryExists(directory: string): boolean {
    return existsSync(directory)
  },

  spawnCommand(command: string, shell: string, workingDirectory: string): ChildProcessWithoutNullStreams {
    return process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/s', '/c', command], {
          cwd: workingDirectory,
          windowsHide: true,
          env: { ...process.env, FORCE_COLOR: '1' }
        })
      : spawn(shell || process.env.SHELL || '/bin/sh', ['-lc', command], {
          cwd: workingDirectory,
          detached: true,
          env: { ...process.env, FORCE_COLOR: '1' }
        })
  },

  async processSnapshot(): Promise<ProcessSnapshot[]> {
    const script = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress'
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', script],
      { timeout: 4_000, maxBuffer: 5 * 1024 * 1024 }
    )
    return parseWindowsProcessSnapshot(stdout)
  },

  isPortOpen(port: number): Promise<boolean> {
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
  },

  async findPortPid(port: number): Promise<number | null> {
    if (process.platform !== 'win32') return null
    try {
      const script = `(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)`
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], { timeout: 2_000 })
      const pid = Number(stdout.trim())
      return Number.isInteger(pid) && pid > 0 ? pid : null
    } catch {
      return null
    }
  },

  async findProcess(keyword: string): Promise<{ pid: number; detail: string } | null> {
    if (process.platform === 'win32') {
      const safeKeyword = keyword.replaceAll("'", "''")
      const script = `$k='${safeKeyword}'; Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.IndexOf($k, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -First 1 ProcessId,Name,CommandLine | ConvertTo-Json -Compress`
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
  },

  async healthStatus(url: string): Promise<number | null> {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_500) })
      return response.ok ? response.status : null
    } catch {
      return null
    }
  },

  async killTree(pid: number): Promise<void> {
    if (process.platform === 'win32') {
      await execFileAsync('taskkill.exe', ['/pid', String(pid), '/T', '/F'], { timeout: 8_000 })
      return
    }
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      process.kill(pid, 'SIGTERM')
    }
  }
}
