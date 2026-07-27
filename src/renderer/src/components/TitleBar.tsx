import { useEffect, useState } from 'react'
import { Minus, Square, Copy, TerminalSquare, X } from 'lucide-react'

export function TitleBar() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    // 启动时同步一次真实状态,之后由主进程 maximize/unmaximize 事件推送。
    void window.devcanopy.window.isMaximized().then(setMaximized)
    const unsubscribe = window.devcanopy.window.onMaximizeChange(setMaximized)
    return unsubscribe
  }, [])

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <span className="brand-mark"><TerminalSquare size={16} /></span>
        <strong>DevCanopy</strong>
      </div>
      <div className="titlebar-controls">
        <button type="button" className="titlebar-btn" aria-label="最小化" onClick={() => void window.devcanopy.window.minimize()}>
          <Minus size={15} />
        </button>
        <button type="button" className="titlebar-btn" aria-label={maximized ? '还原' : '最大化'} onClick={() => void window.devcanopy.window.toggleMaximize()}>
          {maximized ? <Copy size={13} /> : <Square size={13} />}
        </button>
        <button type="button" className="titlebar-btn close" aria-label="关闭" onClick={() => void window.devcanopy.window.close()}>
          <X size={16} />
        </button>
      </div>
    </header>
  )
}
