import assert from 'node:assert/strict'
import test from 'node:test'
import {
  matchAutomaticProcess,
  parsePackageScriptInvocation,
  parseWindowsProcessSnapshot,
  type ProcessSnapshot
} from '../src/main/process-detection.ts'

function process(
  pid: number,
  parentPid: number,
  commandLine: string,
  executablePath = 'C:\\Program Files\\nodejs\\node.exe'
): ProcessSnapshot {
  return {
    pid,
    parentPid,
    name: executablePath.slice(executablePath.lastIndexOf('\\') + 1),
    executablePath,
    commandLine,
    startedAt: new Date(1_700_000_000_000 + pid).toISOString()
  }
}

test('解析 package manager 的 script 简写与 run 写法', () => {
  assert.deepEqual(parsePackageScriptInvocation('pnpm run dev'), { manager: 'pnpm', script: 'dev' })
  assert.deepEqual(parsePackageScriptInvocation('pnpm dev:api'), { manager: 'pnpm', script: 'dev:api' })
  assert.deepEqual(parsePackageScriptInvocation('npm run desktop'), { manager: 'npm', script: 'desktop' })
  assert.equal(parsePackageScriptInvocation('node server.js'), null)
})

test('选择匹配项目的最外层 pnpm 包装进程', () => {
  const processes = [
    process(10, 1, 'node C:\\Users\\dev\\pnpm\\bin\\pnpm.cjs dev'),
    process(11, 10, 'cmd.exe /d /s /c pnpm ^"dev^"', 'C:\\Windows\\System32\\cmd.exe'),
    process(12, 11, 'node C:\\Users\\dev\\pnpm\\bin\\pnpm.mjs dev'),
    process(13, 12, 'node C:\\projects\\sample\\node_modules\\vite\\bin\\vite.js'),
    process(20, 1, 'node C:\\Users\\dev\\pnpm\\bin\\pnpm.cjs dev'),
    process(21, 20, 'node C:\\projects\\another\\node_modules\\vite\\bin\\vite.js')
  ]

  const match = matchAutomaticProcess('pnpm run dev', 'C:\\projects\\sample', processes)

  assert.equal(match?.pid, 10)
  assert.equal(match?.detail, '外部终端 · pnpm dev')
})

test('同名 script 不会跨项目误判', () => {
  const processes = [
    process(10, 1, 'node C:\\Users\\dev\\pnpm\\bin\\pnpm.cjs dev'),
    process(11, 10, 'node C:\\projects\\another\\node_modules\\vite\\bin\\vite.js')
  ]

  assert.equal(matchAutomaticProcess('pnpm run dev', 'C:\\projects\\sample', processes), null)
})

test('script 名称必须完全一致', () => {
  const processes = [
    process(10, 1, 'node C:\\Users\\dev\\pnpm\\bin\\pnpm.cjs dev:api'),
    process(11, 10, 'node C:\\projects\\sample\\apps\\api\\dist\\main.js')
  ]

  assert.equal(matchAutomaticProcess('pnpm run dev', 'C:\\projects\\sample', processes), null)
  assert.equal(matchAutomaticProcess('pnpm run dev:api', 'C:\\projects\\sample', processes)?.pid, 10)
})

test('解析 PowerShell 单条进程 JSON 与启动时间', () => {
  const snapshot = parseWindowsProcessSnapshot('{"ProcessId":13600,"ParentProcessId":37640,"Name":"node.exe","ExecutablePath":"C:\\\\node.exe","CommandLine":"node pnpm.cjs dev","CreationDate":"\\/Date(1784708137695)\\/"}')

  assert.equal(snapshot.length, 1)
  assert.equal(snapshot[0].pid, 13600)
  assert.equal(snapshot[0].startedAt, new Date(1_784_708_137_695).toISOString())
})
