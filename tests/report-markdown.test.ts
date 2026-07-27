import assert from 'node:assert/strict'
import test from 'node:test'
import type { DailyReport, Task } from '../src/shared/types.ts'
import { buildRangeMarkdown, groupByProject } from '../src/renderer/src/utils/reportMarkdown.ts'

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 1,
    projectId: null,
    projectName: null,
    title: '任务',
    description: '',
    status: 'done',
    priority: 'normal',
    dueDate: null,
    completionNote: '',
    createdAt: '2026-07-20T00:00:00.000Z',
    completedAt: new Date(2026, 6, 22, 14, 5).toISOString(),
    noteCount: 0,
    checklistDone: 0,
    checklistTotal: 0,
    ...overrides
  }
}

function makeReport(reportDate: string, content: string): DailyReport {
  return { id: 1, reportDate, content, createdAt: '', updatedAt: '' }
}

test('groupByProject 按项目聚合,无项目归入个人待办', () => {
  const groups = groupByProject([
    makeTask({ id: 1, projectName: 'DevCanopy' }),
    makeTask({ id: 2, projectName: null }),
    makeTask({ id: 3, projectName: 'DevCanopy' })
  ])
  assert.deepEqual(groups.map((group) => [group.name, group.tasks.length]), [
    ['DevCanopy', 2],
    ['个人待办', 1]
  ])
})

test('buildRangeMarkdown 周报结构完整:标题/分组/任务行/备注/日报正文', () => {
  const markdown = buildRangeMarkdown(
    'week',
    { start: '2026-07-20', end: '2026-07-26' },
    [
      makeTask({ id: 1, projectName: 'DevCanopy', title: '修复登录', completionNote: 'root cause 是时区' }),
      makeTask({ id: 2, projectName: null, title: '报销' })
    ],
    [makeReport('2026-07-22', '今天修好了登录。')]
  )
  assert.ok(markdown.startsWith('# 周报（2026-07-20 ~ 2026-07-26）\n'))
  assert.ok(markdown.includes('## 完成任务（2）'))
  assert.ok(markdown.includes('### DevCanopy（1）'))
  assert.ok(markdown.includes('- [x] 修复登录（07-22 14:05 完成）\n  - root cause 是时区'))
  assert.ok(markdown.includes('### 个人待办（1）'))
  assert.ok(markdown.includes('## 每日日报'))
  assert.ok(markdown.includes('### 2026-07-22（周三）\n\n今天修好了登录。'))
  // 结尾单个换行,无三连空行。
  assert.ok(markdown.endsWith('。\n') && !markdown.includes('\n\n\n'))
})

test('buildRangeMarkdown 月报标题与空区间占位', () => {
  const markdown = buildRangeMarkdown('month', { start: '2026-07-01', end: '2026-07-31' }, [], [])
  assert.ok(markdown.startsWith('# 月报（2026-07）\n'))
  assert.ok(markdown.includes('（这段时间没有完成的任务）'))
  assert.ok(markdown.includes('（这段时间没有写过日报）'))
})
