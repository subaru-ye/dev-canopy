import type { SearchResultKind } from '../../shared/types'

export interface JumpIntent {
  kind: SearchResultKind
  id: number
  date: string | null
}

// 全局搜索的跳转意图:App 切路由前写入,目标页挂载后读取并打开对应详情。
// 用模块级存储而非 props 层层透传;目标页通过 remount(key 变化)保证一定会重新读取。
let pending: JumpIntent | null = null

export function setJumpIntent(intent: JumpIntent): void {
  pending = intent
}

export function peekJumpIntent(kind: SearchResultKind): JumpIntent | null {
  return pending?.kind === kind ? pending : null
}

export function clearJumpIntent(): void {
  pending = null
}
