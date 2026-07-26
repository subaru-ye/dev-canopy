import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// better-sqlite3 被 postinstall(electron-builder install-app-deps)编译成 Electron ABI,
// 系统 Node 加载会 ERR_DLOPEN_FAILED,因此统一用 Electron 自带的 Node 跑测试。
const require = createRequire(import.meta.url)
const electronPath = require('electron')

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const testFiles = readdirSync(join(rootDir, 'tests'))
  .filter((name) => name.endsWith('.test.ts'))
  .map((name) => join('tests', name))

const result = spawnSync(electronPath, ['--experimental-strip-types', '--test', ...testFiles], {
  cwd: rootDir,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})
process.exit(result.status ?? 1)
