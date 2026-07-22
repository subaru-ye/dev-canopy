import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import type { SkillInfo } from '../shared/types'

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

async function readSkill(skillPath: string, scope: 'user' | 'system'): Promise<SkillInfo> {
  const skillFile = join(skillPath, 'SKILL.md')
  const directoryName = skillPath.split(/[\\/]/).at(-1) ?? 'unknown'
  try {
    const [raw, stat] = await Promise.all([
      fs.readFile(skillFile, 'utf8'),
      fs.stat(skillFile)
    ])
    const parsed = matter(raw)
    const name = typeof parsed.data.name === 'string' ? parsed.data.name : directoryName
    const description = typeof parsed.data.description === 'string'
      ? parsed.data.description
      : '未提供描述'
    return {
      name,
      description,
      path: skillPath,
      scope,
      modifiedAt: stat.mtime.toISOString(),
      hasScripts: await pathExists(join(skillPath, 'scripts')),
      hasReferences: await pathExists(join(skillPath, 'references')),
      hasAssets: await pathExists(join(skillPath, 'assets')),
      valid: Boolean(parsed.data.name && parsed.data.description),
      issue: parsed.data.name && parsed.data.description ? null : 'frontmatter 缺少 name 或 description'
    }
  } catch (error) {
    return {
      name: directoryName,
      description: '无法读取 SKILL.md',
      path: skillPath,
      scope,
      modifiedAt: new Date(0).toISOString(),
      hasScripts: false,
      hasReferences: false,
      hasAssets: false,
      valid: false,
      issue: error instanceof Error ? error.message : '未知读取错误'
    }
  }
}

async function listDirectories(path: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(path, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(path, entry.name))
  } catch {
    return []
  }
}

export async function scanSkills(skillsPath: string): Promise<SkillInfo[]> {
  const topLevel = await listDirectories(skillsPath)
  const userPaths = topLevel.filter((path) => !path.endsWith(`${join('', '.system')}`))
  const systemRoot = join(skillsPath, '.system')
  const systemPaths = await listDirectories(systemRoot)
  const skills = await Promise.all([
    ...userPaths.map((path) => readSkill(path, 'user')),
    ...systemPaths.map((path) => readSkill(path, 'system'))
  ])
  return skills.sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === 'user' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}
