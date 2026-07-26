import { useEffect, useRef } from 'react'

// App 层把 Ctrl+N 广播成 CustomEvent,当前挂载的页面用本 hook 打开自己的"新建"入口。
// 事件方案避免把各页回调注册进 context:隐藏路由会被卸载,监听器随组件生命周期自清理。
export const NEW_ITEM_EVENT = 'devcanopy:new-item'

export function useNewItemShortcut(handler: () => void): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => {
    const listener = (): void => handlerRef.current()
    window.addEventListener(NEW_ITEM_EVENT, listener)
    return () => window.removeEventListener(NEW_ITEM_EVENT, listener)
  }, [])
}
