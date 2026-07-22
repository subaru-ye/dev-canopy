export interface ProcessSnapshot {
  pid: number
  parentPid: number
  name: string
  executablePath: string
  commandLine: string
  startedAt: string | null
}

export interface AutomaticProcessMatch {
  pid: number
  startedAt: string | null
  detail: string
}

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

interface PackageScriptInvocation {
  manager: PackageManager
  script: string
}

interface WindowsProcessJson {
  ProcessId?: number
  ParentProcessId?: number
  Name?: string | null
  ExecutablePath?: string | null
  CommandLine?: string | null
  CreationDate?: string | null
}

const managerNames: Record<PackageManager, Set<string>> = {
  npm: new Set(['npm', 'npm.cmd', 'npm.exe', 'npm-cli.js']),
  pnpm: new Set(['pnpm', 'pnpm.cmd', 'pnpm.exe', 'pnpm.cjs', 'pnpm.mjs']),
  yarn: new Set(['yarn', 'yarn.cmd', 'yarn.exe', 'yarn.js', 'yarn.cjs']),
  bun: new Set(['bun', 'bun.cmd', 'bun.exe'])
}

function cleanToken(token: string): string {
  return token.replace(/["'^]/g, '').trim()
}

function tokenBasename(token: string): string {
  const normalized = cleanToken(token).replaceAll('\\', '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase()
}

function tokenize(commandLine: string): string[] {
  return (commandLine.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(cleanToken).filter(Boolean)
}

function packageManagerAt(token: string): PackageManager | null {
  const name = tokenBasename(token)
  for (const manager of Object.keys(managerNames) as PackageManager[]) {
    if (managerNames[manager].has(name)) return manager
  }
  return null
}

export function parsePackageScriptInvocation(commandLine: string): PackageScriptInvocation | null {
  const tokens = tokenize(commandLine)
  for (let index = 0; index < tokens.length; index += 1) {
    const manager = packageManagerAt(tokens[index])
    if (!manager) continue

    const args = tokens.slice(index + 1)
    if (args[0] === 'run' || args[0] === 'run-script') args.shift()
    const script = args[0]
    if (!script || script.startsWith('-') || /[&|<>]/.test(script)) continue
    return { manager, script }
  }
  return null
}

function normalizePath(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
}

function containsProjectPath(process: ProcessSnapshot, projectPath: string): boolean {
  const needle = normalizePath(projectPath)
  if (!needle) return false
  const haystack = normalizePath(`${process.executablePath} ${process.commandLine}`)
  let index = haystack.indexOf(needle)
  while (index >= 0) {
    const next = haystack[index + needle.length]
    if (next === undefined || /[\s/"']/.test(next)) return true
    index = haystack.indexOf(needle, index + 1)
  }
  return false
}

function parseCreationDate(value: string | null | undefined): string | null {
  if (!value) return null
  const microsoftDate = /\/Date\((\d+)(?:[+-]\d+)?\)\//.exec(value)
  const date = microsoftDate ? new Date(Number(microsoftDate[1])) : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function parseWindowsProcessSnapshot(raw: string): ProcessSnapshot[] {
  if (!raw.trim()) return []
  const parsed = JSON.parse(raw) as WindowsProcessJson | WindowsProcessJson[]
  return (Array.isArray(parsed) ? parsed : [parsed])
    .filter((process) => Number.isInteger(process.ProcessId) && Number(process.ProcessId) > 0)
    .map((process) => ({
      pid: Number(process.ProcessId),
      parentPid: Number(process.ParentProcessId) || 0,
      name: process.Name ?? '',
      executablePath: process.ExecutablePath ?? '',
      commandLine: process.CommandLine ?? '',
      startedAt: parseCreationDate(process.CreationDate)
    }))
}

export function matchAutomaticProcess(
  configuredCommand: string,
  projectPath: string,
  processes: ProcessSnapshot[]
): AutomaticProcessMatch | null {
  const expected = parsePackageScriptInvocation(configuredCommand)
  if (!expected) return null

  const children = new Map<number, ProcessSnapshot[]>()
  const byPid = new Map(processes.map((process) => [process.pid, process]))
  for (const process of processes) {
    const siblings = children.get(process.parentPid) ?? []
    siblings.push(process)
    children.set(process.parentPid, siblings)
  }

  const subtreeContainsProject = (rootPid: number): boolean => {
    const pending = [rootPid]
    const visited = new Set<number>()
    while (pending.length > 0) {
      const pid = pending.pop()
      if (pid === undefined || visited.has(pid)) continue
      visited.add(pid)
      const process = byPid.get(pid)
      if (process && containsProjectPath(process, projectPath)) return true
      for (const child of children.get(pid) ?? []) pending.push(child.pid)
    }
    return false
  }

  const candidates = processes.filter((process) => {
    const invocation = parsePackageScriptInvocation(process.commandLine)
    return invocation?.manager === expected.manager
      && invocation.script === expected.script
      && subtreeContainsProject(process.pid)
  })
  if (candidates.length === 0) return null

  const candidateIds = new Set(candidates.map((candidate) => candidate.pid))
  const hasCandidateAncestor = (candidate: ProcessSnapshot): boolean => {
    let parentPid = candidate.parentPid
    const visited = new Set<number>()
    while (parentPid > 0 && !visited.has(parentPid)) {
      if (candidateIds.has(parentPid)) return true
      visited.add(parentPid)
      parentPid = byPid.get(parentPid)?.parentPid ?? 0
    }
    return false
  }

  // Windows 上 pnpm 会生成多层等价包装进程；选择最外层，停止时才能结束整棵进程树。
  const match = candidates
    .filter((candidate) => !hasCandidateAncestor(candidate))
    .sort((left, right) => (left.startedAt ?? '').localeCompare(right.startedAt ?? '') || left.pid - right.pid)[0]

  return {
    pid: match.pid,
    startedAt: match.startedAt,
    detail: `外部终端 · ${expected.manager} ${expected.script}`
  }
}
