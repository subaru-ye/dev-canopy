import { rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

let electronApp: ElectronApplication
let page: Page
let tmpUserData: string
let tmpProjectDir: string

test.beforeEach(async () => {
  // 唯一临时目录:userData 保证空库干净状态,projectDir 作为导入项目的本地目录。
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  tmpUserData = join(tmpdir(), `devcanopy-e2e-userdata-${stamp}`)
  tmpProjectDir = join(tmpdir(), `devcanopy-e2e-project-${stamp}`)
  mkdirSync(tmpUserData, { recursive: true })
  mkdirSync(tmpProjectDir, { recursive: true })
  // inspectProjectFolder 读 package.json 的 scripts,放一个 dev 脚本让它检测到。
  writeFileSync(join(tmpProjectDir, 'package.json'), JSON.stringify({ name: 'e2e-fixture', scripts: { dev: 'vite' } }))

  electronApp = await electron.launch({
    args: [join(process.cwd(), 'out/main/index.js')],
    env: {
      ...process.env,
      // 隔离 userData:主进程读此变量在 app ready 前 setPath,
      // 让数据库/设置/备份/日志都落临时目录,互不污染。
      DEVCANOPY_E2E_USER_DATA: tmpUserData
    }
  })

  page = await electronApp.firstWindow()
  // 等首页加载完成:空项目状态或项目卡片出现。
  await page.waitForSelector('.empty-state, .project-grid', { timeout: 15_000 })
})

test.afterEach(async () => {
  await electronApp.close().catch(() => undefined)
  rmSync(tmpUserData, { recursive: true, force: true })
  rmSync(tmpProjectDir, { recursive: true, force: true })
})

test('核心冒烟:建项目 → 建任务并完成 → 日报引用 → 建记忆并复制', async () => {
  // 1. 直接通过 preload API 建项目(绕过文件夹选择对话框)
  await page.evaluate(async (projectPath) => {
    await window.devcanopy.projects.create({
      name: '冒烟项目',
      path: projectPath,
      commands: []
    })
  }, tmpProjectDir)

  // 刷新页面让项目列表更新
  await page.reload()
  await page.waitForSelector('.project-card', { timeout: 10_000 })
  await expect(page.locator('.project-card', { hasText: '冒烟项目' })).toBeVisible()

  // 2. 切到任务页,新建任务
  await page.locator('.main-nav button', { hasText: '任务' }).click()
  await page.waitForSelector('button:has-text("新建任务")', { timeout: 10_000 })

  await page.locator('button:has-text("新建任务")').click()
  // Modal 的 form 自身有 .modal 类,用 form.modal 而非 .modal form
  await page.waitForSelector('form.modal', { timeout: 10_000 })
  // 填标题
  const titleInput = page.locator('form.modal input').first()
  await titleInput.fill('冒烟任务一')
  // 选归属:选「冒烟项目」
  const projectSelect = page.locator('form.modal select').first()
  await projectSelect.selectOption({ label: '冒烟项目' })
  // 提交
  await page.locator('form.modal button[type="submit"]').click()
  // 等待 Modal 关闭、任务列表出现
  await page.waitForSelector('.task-row', { timeout: 10_000 })
  await expect(page.locator('.task-row', { hasText: '冒烟任务一' })).toBeVisible()

  // 3. 点 task-check 标记完成
  await page.locator('.task-check').first().click()
  // 等任务移到已完成分组(done 分组默认折叠,点开)
  const doneGroup = page.locator('.task-group', { hasText: '已完成' })
  await doneGroup.locator('button[aria-expanded]').click()
  await page.waitForSelector('.task-row.is-done', { timeout: 10_000 })

  // 4. 切到日报页,点「插入到正文」
  await page.locator('.main-nav button', { hasText: '日报' }).click()
  await page.waitForSelector('.report-textarea', { timeout: 10_000 })
  // 等日报页数据加载完成(textarea 可用)
  await page.waitForTimeout(1_500)

  // 确认当日完成任务面板有「插入到正文」按钮
  const insertButton = page.locator('.report-head-action', { hasText: '插入到正文' })
  await insertButton.click()
  // 等自动保存防抖触发
  await page.waitForTimeout(1_500)

  // 断言 textarea 包含任务标题
  const textarea = page.locator('.report-textarea')
  await expect(textarea).toContainText('冒烟任务一')

  // 5. 切到记忆页,新建记忆并复制
  await page.locator('.main-nav button', { hasText: '记忆' }).click()
  await page.waitForSelector('button:has-text("新建记忆")', { timeout: 10_000 })

  await page.locator('button:has-text("新建记忆")').click()
  await page.waitForSelector('form.modal', { timeout: 10_000 })

  // 填标题和正文
  const promptTitleInput = page.locator('form.modal input').first()
  await promptTitleInput.fill('冒烟记忆')
  const promptEditor = page.locator('form.modal .prompt-editor')
  await promptEditor.fill('这是冒烟记忆的正文内容')

  // 提交
  await page.locator('form.modal button[type="submit"]').click()
  await page.waitForSelector('.prompt-row', { timeout: 10_000 })
  await expect(page.locator('.prompt-row', { hasText: '冒烟记忆' })).toBeVisible()

  // 点复制按钮
  await page.locator('.prompt-row .button.ghost', { hasText: '复制' }).first().click()
  // 等复制反馈出现
  await page.waitForSelector('.prompt-row .is-copied', { timeout: 5_000 })

  // 通过 evaluate 读剪贴板验证
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
  expect(clipboardText).toContain('这是冒烟记忆的正文内容')
})
