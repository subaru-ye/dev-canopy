import type { TaskPriority, TaskStatus } from '../../../shared/types'

export const statusLabels: Record<TaskStatus, string> = {
  todo: '待处理',
  doing: '进行中',
  done: '已完成'
}

export const priorityLabels: Record<TaskPriority, string> = {
  low: '低优先级',
  normal: '普通',
  high: '高优先级'
}
