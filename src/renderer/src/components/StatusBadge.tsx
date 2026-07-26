import { AlertCircle, Circle, LoaderCircle } from 'lucide-react'
import type { RuntimeState } from '../../../shared/types'

const labels: Record<RuntimeState, string> = {
  stopped: '未运行',
  starting: '启动中',
  running: '运行中',
  stopping: '停止中',
  error: '异常退出',
  unknown: '状态不确定'
}

export function StatusBadge({ state }: { state: RuntimeState }) {
  if (state === 'running') {
    return (
      <span className="status-badge running">
        <span className="live-dot" aria-hidden="true" />
        {labels.running}
      </span>
    )
  }
  const Icon = state === 'error' || state === 'unknown'
    ? AlertCircle
    : state === 'starting' || state === 'stopping'
      ? LoaderCircle
      : Circle
  return (
    <span className={`status-badge ${state}`}>
      <Icon size={14} className={state === 'starting' || state === 'stopping' ? 'spin' : undefined} />
      {labels[state]}
    </span>
  )
}
