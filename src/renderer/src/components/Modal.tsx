import { useEffect, type FormEvent, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  title: string
  description?: string
  children: ReactNode
  submitLabel?: string
  busy?: boolean
  wide?: boolean
  headerActions?: ReactNode
  onClose: () => void
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void
}

export function Modal({
  open,
  title,
  description,
  children,
  submitLabel = '保存',
  busy = false,
  wide = false,
  headerActions,
  onClose,
  onSubmit
}: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, busy, onClose])

  if (!open) return null

  const content = (
    <>
      <header className="modal-header">
        <div>
          <h2 id="modal-title">{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        <div className="modal-header-actions">
          {headerActions}
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭弹窗" disabled={busy}>
            <X size={18} />
          </button>
        </div>
      </header>
      <div className="modal-content">{children}</div>
      {onSubmit ? (
        <footer className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose} disabled={busy}>取消</button>
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? '处理中…' : submitLabel}
          </button>
        </footer>
      ) : null}
    </>
  )

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      {onSubmit ? (
        <form className={`modal${wide ? ' wide' : ''}`} onSubmit={onSubmit} role="dialog" aria-modal="true" aria-labelledby="modal-title">
          {content}
        </form>
      ) : (
        <section className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
          {content}
        </section>
      )}
    </div>
  )
}
