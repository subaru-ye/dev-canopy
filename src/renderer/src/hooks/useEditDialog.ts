import { useState, type FormEvent } from 'react'

export interface EditDialog<TEntity, TDraft> {
  open: boolean
  editing: TEntity | null
  draft: TDraft
  busy: boolean
  error: string
  setDraft: (draft: TDraft) => void
  setError: (message: string) => void
  openCreate: (draft: TDraft) => void
  openEdit: (entity: TEntity, draft: TDraft) => void
  close: () => void
  submit: (event: FormEvent<HTMLFormElement>, action: () => Promise<void>) => Promise<void>
}

// 新建/编辑弹窗的通用状态机:open/editing/draft/busy/error 与提交流程。
// 校验直接在 action 里 throw 中文 Error,会展示为表单错误且弹窗保持打开。
export function useEditDialog<TEntity, TDraft>(emptyDraft: TDraft): EditDialog<TEntity, TDraft> {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<TEntity | null>(null)
  const [draft, setDraft] = useState<TDraft>(emptyDraft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const openCreate = (initial: TDraft): void => {
    setEditing(null)
    setDraft(initial)
    setError('')
    setOpen(true)
  }

  const openEdit = (entity: TEntity, initial: TDraft): void => {
    setEditing(entity)
    setDraft(initial)
    setError('')
    setOpen(true)
  }

  const close = (): void => setOpen(false)

  const submit = async (event: FormEvent<HTMLFormElement>, action: () => Promise<void>): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await action()
      setOpen(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return { open, editing, draft, busy, error, setDraft, setError, openCreate, openEdit, close, submit }
}
