# DevCanopy 功能路线图

按投入产出比排序的扩展清单。每条自带改动面、实现要点与验收标准，可直接作为一次独立开发会话的任务书。

**已完成的前置基建**（无需重做）：版本化迁移机制（`database.ts` 的 `migrate()` 迁移数组 + `PRAGMA user_version`，加列走新数组项）、DB/进程状态机单测（`npm test` 经 Electron 自带 Node 运行，`tests/` 下有现成范式）、旧 DevDesk 库自动搬迁、IPC channel 常量（`src/shared/ipc.ts`）。

**通用约定**：新数据域走 `types.ts → database.ts → index.ts(registerIpc) → preload` 链路，channel 名加进 `shared/ipc.ts`；样式按功能块放 `src/renderer/src/styles/` 对应文件；验收统一包含 `npm run typecheck && npm test` 通过；UI 改动用 `DEVCANOPY_CAPTURE_PATH/DEVCANOPY_CAPTURE_ROUTE`（可加 `DEVCANOPY_CAPTURE_CLICK`）截图确认。

---

## 第一批：小改动高回报

### 1. 日报一键引用当日完成任务 + 日报模板
- **价值**：completedTasks 与正文已同屏但互不打通，用户仍要手抄任务标题。
- **改动面**：仅 `src/renderer/src/pages/ReportsPage.tsx`。
- **要点**：完成任务面板头部加「插入到正文」按钮，把任务列表转 Markdown（`- [x] 标题（项目名 · HH:mm 完成）`，有 completionNote 附一行）追加进 draft 并走现有 `onDraftChange` 触发自动保存；空日报首次编辑时提供「使用模板」按钮预填（模板文本先做模块常量，将来迁 settings 表）。
- **验收**：插入后保存状态显示「已保存」，切日期往返内容不丢。

### 2. 数据备份（在线 backup + 滚动保留）
- **价值**：全部数据在单个 WAL 库文件里，手动拷文件会漏 -wal。
- **改动面**：`database.ts`（已有 `copyDatabase` 可复用）、`index.ts`、`shared/{ipc,types}.ts`、`preload`、`SettingsPage.tsx`。
- **要点**：`backup:create` IPC 用 `dialog.showSaveDialog` 选目标后 `db.backup()`（WAL 下在线热备安全）；启动时自动备份到 `userData/backups/devcanopy-YYYY-MM-DD.db`，保留最近 5 份删最旧；设置页加「立即备份」按钮与备份目录展示（可 `shell.openPath` 打开）。
- **验收**：备份文件能被 `new Database(path, {readonly:true})` 打开读到数据；滚动保留逻辑有单测。

### 3. 全局快捷键
- **改动面**：`App.tsx` 为主，各页暴露"新建"入口。
- **要点**：window `keydown` 监听：`Ctrl+1~6` 按 navigation 数组顺序切页；`Ctrl+N` 触发当前页的新建弹窗（用 CustomEvent 或把回调注册进 App 层 context）；焦点在 input/textarea/select 或 `event.isComposing` 时忽略；Esc 已由 Modal 处理不必重复。
- **验收**：各页快捷键生效；在日报 textarea 内输入数字不会切页。

### 4. 记忆库变量占位符
- **价值**：把静态 prompt 升级为参数化模板。
- **改动面**：`PromptsPage.tsx`（复用 `components/Modal.tsx`）。
- **要点**：复制时用 `/\{\{\s*([^{}]+?)\s*\}\}/g` 提取去重变量；无占位符走现有直接复制；有则弹填空 Modal（每变量一个输入框，`localStorage` 记住上次填值），确认后替换再写剪贴板，复用现有 `copiedKey` 反馈；列表行 `char-tag` 旁可加变量数小标签。
- **验收**：含/不含占位符两条路径手测；取消填空不写剪贴板。

### 5. 项目一键用 VS Code / 终端打开
- **改动面**：`index.ts`（照 `projects:reveal` 的模式）、`shared/{ipc,types}.ts`、`preload`、`ProjectDetail.tsx`。
- **要点**：`projects:open-editor` 在项目目录 spawn `code .`（Windows 下 code 是 cmd 脚本，需 `spawn('cmd.exe', ['/c','code','.'], {cwd, detached:true})` 或 shell:true）；`projects:open-terminal` 优先 `wt -d <path>` 回退 `start cmd`；失败抛中文 Error（如未安装 code）；按钮加在 ProjectDetail 头部「打开目录」旁。
- **验收**：两个按钮手测；未装编辑器时错误提示可见。

### 6. settings 表 + 深浅主题手动切换
- **价值**：light 样式已完整写好只差开关；settings 表是托盘/模板/编辑器路径等后续配置的公共基建。
- **改动面**：`database.ts`（**迁移数组追加新项**建 `settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)`，这是迁移框架第一次真实使用）、`index.ts`、`shared/{ipc,types}.ts`、`preload`、`SettingsPage.tsx`、`styles/base.css` 与 `styles/reports.css` 的两处 light `@media`。
- **要点**：`settings:get/set` IPC；主题三档 `system/light/dark`；CSS 把 `@media (prefers-color-scheme: light)` 的变量覆盖改写为 `:root[data-theme='light']` 选择器（system 档由渲染层用 `matchMedia` 解析成实际值落 `data-theme`，并监听系统变化）；启动防闪烁：主题值镜像一份进 `localStorage`，`index.html` 内联脚本在 React 挂载前先设 `data-theme`。
- **验收**：三档即时生效、重启保持、启动无闪烁；日报页 date input 图标两主题下均可见。

## 第二批：中等改动

### 7. 周报/月报聚合
- **要点**：ReportsPage 加「日/周/月」视图切换；周/月视图用 `listTasksCompletedBetween` 传大区间 + 循环 `reports.get` 拉取区间内日报正文（或新增 `reports:range` IPC 一次取回）；按项目分组汇总完成任务；「复制为 Markdown」输出周报底稿；`utils/dates.ts` 补周界计算（周一为起始）。
- **验收**：跨周边界（周日/周一）任务归属正确；复制出的 Markdown 结构完整。

### 8. 命令运行历史 + 日志落盘
- **价值**：process_runs 已持续写入但无人读；日志只在内存，重启即丢，"昨晚 dev server 为何挂了"不可排查。
- **要点**：`process-manager.ts` 的 `append` 同步写 `userData/logs/<commandId>/<runId>.log`（`createWriteStream`，exit/dispose 时关闭）；`database.ts` 加 `listProcessRuns(commandId, limit)`；ProjectDetail 命令行加「运行历史」弹窗（起止时间/时长/退出码，行内按钮 `shell.showItemInFolder` 打开日志）；`pruneProcessRuns` 时同步删对应日志文件。
- **验收**：启动-停止一次后历史可见、日志文件有内容；prune 后文件同步清理。

### 9. Ctrl+K 全局搜索
- **要点**：`database.ts` 加 `search(query)`：tasks(title/description)、prompts(title/content)、daily_reports(content)、projects(name) 各 LIKE 限 10 条（转义 `%_`，参数化拼 `%q%`）；新建 `components/CommandPalette.tsx`（Ctrl+K 唤起、上下键选择、回车跳转）；App.tsx 加"跳转意图"状态让目标页打开对应详情（如任务详情弹窗、日报定位日期）。
- **验收**：四类实体均可搜到并正确跳转；中文关键词正常。

### 10. 系统托盘常驻 + 关闭最小化 + 开机自启
- **前置**：第 6 条的 settings 表。
- **要点**：`Tray` + 托盘菜单（显示主窗口/运行中命令列表/退出）；「关闭最小化到托盘」settings 开关：开启时窗口 close 事件 `preventDefault` + hide（真正退出走托盘菜单，沿用现有 before-quit 清理链）；`ProcessManager` 暴露 `listManaged()` 供菜单展示；`app.setLoginItemSettings` 做开机自启开关。注意 `window-all-closed` 与托盘常驻的关系（常驻时不 quit）。
- **验收**：关窗后 dev server 继续运行且托盘可停止；托盘退出会走 disposeAll 清理；两开关重启后保持。

### 11. 任务截止日期 + 今日待办前置
- **要点**：迁移数组追加 `ALTER TABLE tasks ADD COLUMN due_date TEXT`（第一次对老库加列，顺带验证迁移框架）；`Task/TaskDraft` 加 `dueDate: string | null`；任务表单加日期选择（复用日报页 `report-date-input` 样式）；`listTasks` 的 ORDER BY 把逾期/今日到期前置；task-row 逾期红标、今日到期 accent 标；日报页可顺势列出明日到期任务。
- **验收**：老库升级后 user_version 递增且新列可写；排序与标记正确。

## 第三批：工程侧

### 12. CI（GitHub Actions）
- **要点**：`.github/workflows/ci.yml`，windows-latest：`npm ci` → `npm run typecheck` → `npm test` → `npx electron-builder --win --dir`，unpacked 产物传 artifact；注意 postinstall 会重编 better-sqlite3（Electron ABI），npm test 已兼容。
- **验收**：推送后全绿；artifact 可下载运行。

### 13. Playwright e2e 冒烟
- **要点**：`@playwright/test` 的 `_electron.launch` 启动 `out/`（或 unpacked 产物），走通：导入项目（可用 dialog mock 或直接写库后重启）→ 新建任务并完成 → 日报页看到该任务 → 新建记忆并复制；跑通后可删除 `DEVCANOPY_CAPTURE_*` 截图后门（目前仅 `!app.isPackaged` 时可用）。
- **验收**：`npm run e2e` 本地与 CI 均绿。
