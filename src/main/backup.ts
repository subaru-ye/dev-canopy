import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export const BACKUP_KEEP_COUNT = 5

// 只认自动备份自己的命名,目录里用户手动放置的文件不参与滚动清理。
const BACKUP_NAME_PATTERN = /^devcanopy-\d{4}-\d{2}-\d{2}\.db$/

export function backupFileName(localDate: string): string {
  return `devcanopy-${localDate}.db`
}

// 文件名内嵌日期,字典序即时间序:倒序保留最新 keep 份,其余待删。
export function selectExpiredBackups(names: string[], keep = BACKUP_KEEP_COUNT): string[] {
  return names
    .filter((name) => BACKUP_NAME_PATTERN.test(name))
    .sort()
    .reverse()
    .slice(keep)
}

// 启动自动备份:先热备到临时文件再改名,中途被杀不会留下半个 .db 被当成完整备份;
// 同日重复启动覆盖当日文件(rename 在 Windows 上会覆盖已存在目标)。
export async function runStartupBackup(
  backupTo: (destinationPath: string) => Promise<void>,
  backupsDir: string,
  localDate: string,
  keep = BACKUP_KEEP_COUNT
): Promise<void> {
  await fs.mkdir(backupsDir, { recursive: true })
  const target = join(backupsDir, backupFileName(localDate))
  const staging = `${target}.tmp`
  await fs.rm(staging, { force: true })
  await backupTo(staging)
  await fs.rename(staging, target)
  const names = await fs.readdir(backupsDir)
  await Promise.all(
    selectExpiredBackups(names, keep).map((name) => fs.rm(join(backupsDir, name), { force: true }))
  )
}
