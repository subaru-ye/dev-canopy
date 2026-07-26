import { promises as fs } from 'node:fs'
import { join } from 'node:path'

// 运行日志按 logs/<commandId>/<runId>.log 落盘,与 process_runs 行一一对应。
export function runLogPath(logsDir: string, commandId: number, runId: number): string {
  return join(logsDir, String(commandId), `${runId}.log`)
}

// 删除数据库里已不存在的 run 对应的日志(prune 裁掉的、命令级联删除的),
// 清空后的命令目录一并移除;目录不存在或个别删除失败都静默跳过。
export async function cleanupRunLogs(logsDir: string, validRunIds: Set<number>): Promise<number> {
  let removed = 0
  let commandDirs: string[]
  try {
    commandDirs = await fs.readdir(logsDir)
  } catch {
    return 0
  }
  for (const dirName of commandDirs) {
    if (!/^\d+$/.test(dirName)) continue
    const dirPath = join(logsDir, dirName)
    let files: string[]
    try {
      files = await fs.readdir(dirPath)
    } catch {
      continue
    }
    for (const fileName of files) {
      const match = /^(\d+)\.log$/.exec(fileName)
      if (!match || validRunIds.has(Number(match[1]))) continue
      await fs.rm(join(dirPath, fileName), { force: true }).catch(() => undefined)
      removed += 1
    }
    // 仅在目录已空时移除成功,还有残留文件则保留目录。
    await fs.rmdir(dirPath).catch(() => undefined)
  }
  return removed
}
