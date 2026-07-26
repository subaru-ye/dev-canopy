import { X } from 'lucide-react'

interface ErrorBannerProps {
  message: string
  onClose: () => void
}

export function ErrorBanner({ message, onClose }: ErrorBannerProps) {
  if (!message) return null
  return (
    <div className="error-banner" role="alert">
      {message}
      <button type="button" onClick={onClose} aria-label="关闭错误"><X size={15} /></button>
    </div>
  )
}
