# DevDesk

DevDesk 是一个本地优先的开发工作台，用于按项目管理长期运行的开发命令、个人与项目任务，以及 Codex Skills。

## 当前能力

- 导入本地项目目录并读取 `package.json` scripts。
- 为项目保存前端、后端、桌面端等长期运行命令。
- 启动、停止、重启进程并终止完整进程树。
- 查看由 DevDesk 启动的命令日志。
- 通过端口、健康检查 URL 或进程关键词检测外部启动的命令。
- 使用统一任务模型管理个人待办和项目需求。
- 读取 `~/.codex/skills` 中的用户级和系统级 Skills。
- 使用 SQLite 在本地持久化项目、命令、运行历史和任务。

## 技术栈

- Electron
- React
- TypeScript
- SQLite（better-sqlite3）
- electron-vite

## 开发

要求：Node.js 22 或更高版本。

```powershell
npm install
npm run dev
```

类型检查和生产构建：

```powershell
npm run typecheck
npm run build
```

生成 Windows 安装包：

```powershell
npm run dist:win
```

## 运行检测

DevDesk 不区分命令由人工还是编程智能体启动，只判断命令是否正在运行。

- DevDesk 启动的命令通过 PID、启动时间和子进程树管理。
- 端口检测适合 Vite、API Server 等本地服务。
- 健康检查适合提供 HTTP 状态接口的服务。
- 进程关键词适合 Electron、Worker 等没有监听端口的进程。

外部终端启动的进程可以被检测，但无法接管它在原终端中的历史日志。

## 数据位置

SQLite 数据库保存在 Electron 的 `userData` 目录。项目源代码和 Codex Skills 不会被复制到 DevDesk。

## 项目结构

```text
src/
├─ main/       Electron 主进程、SQLite、进程管理和 Skills 扫描
├─ preload/    受控 IPC 桥接
├─ renderer/   React 桌面界面
└─ shared/     主进程和渲染层共享类型
```

## 当前边界

- 当前版本优先支持 Windows。
- 暂不包含完整交互式终端、云同步、Docker 编排和 Skill 市场。
- 项目级 Skills 暂不纳入管理。
