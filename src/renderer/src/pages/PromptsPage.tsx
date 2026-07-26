import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Check, Copy, Edit3, FileText, FileUp, Plus, Search, Trash2, X } from 'lucide-react'
import type { PromptDoc, PromptDraft } from '../../../shared/types'
import { Modal } from '../components/Modal'
import { dayLabel, timeLabel } from '../utils/dates'

const emptyDraft: PromptDraft = { title: '', content: '' }

export function PromptsPage() {
  const [prompts, setPrompts] = useState<PromptDoc[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<PromptDoc | null>(null)
  const [draft, setDraft] = useState<PromptDraft>(emptyDraft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pageError, setPageError] = useState('')
  const [copiedKey, setCopiedKey] = useState<number | 'modal' | null>(null)
  const [importNotice, setImportNotice] = useState('')
  const [importHasFailures, setImportHasFailures] = useState(false)
  const copyTimerRef = useRef<number | null>(null)

  const load = useCallback(async () => {
    setPrompts(await window.devcanopy.prompts.list())
  }, [])

  useEffect(() => {
    load()
      .catch((reason) => setPageError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false))
  }, [load])

  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
  }, [])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return normalized
      ? prompts.filter((prompt) => `${prompt.title} ${prompt.content}`.toLowerCase().includes(normalized))
      : prompts
  }, [prompts, query])

  const copyText = (text: string, key: number | 'modal'): void => {
    navigator.clipboard.writeText(text)
      .then(() => {
        setCopiedKey(key)
        if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
        copyTimerRef.current = window.setTimeout(() => setCopiedKey(null), 1_500)
      })
      .catch(() => setPageError('复制失败，请重试。'))
  }

  const openCreate = (): void => {
    setEditing(null)
    setDraft(emptyDraft)
    setError('')
    setDialogOpen(true)
  }

  const openEdit = (prompt: PromptDoc): void => {
    setEditing(prompt)
    setDraft({ title: prompt.title, content: prompt.content })
    setError('')
    setDialogOpen(true)
  }

  const savePrompt = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!draft.title.trim()) {
      setError('请输入标题。')
      return
    }
    setBusy(true)
    setError('')
    try {
      if (editing) await window.devcanopy.prompts.update(editing.id, draft)
      else await window.devcanopy.prompts.create(draft)
      setDialogOpen(false)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const removePrompt = async (prompt: PromptDoc): Promise<void> => {
    if (!window.confirm(`删除记忆“${prompt.title}”？此操作不可恢复。`)) return
    try {
      await window.devcanopy.prompts.remove(prompt.id)
      await load()
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const handleImport = async (): Promise<void> => {
    try {
      const result = await window.devcanopy.prompts.importFiles()
      if (!result) return
      const parts = [`成功导入 ${result.imported} 篇`]
      if (result.failed.length > 0) {
        parts.push(`${result.failed.length} 个文件失败：${result.failed.map((entry) => `${entry.file}（${entry.reason}）`).join('、')}`)
      }
      setImportNotice(parts.join('，'))
      setImportHasFailures(result.failed.length > 0)
      await load()
    } catch (reason) {
      setImportNotice(reason instanceof Error ? reason.message : String(reason))
      setImportHasFailures(true)
    }
  }

  return (
    <section className="page route-enter">
      <header className="page-header">
        <div>
          <p className="eyebrow">MEMORY</p>
          <h1>记忆</h1>
          <p>{prompts.length} 篇文档，随取随用</p>
        </div>
        <div className="header-actions">
          <button className="button secondary" type="button" onClick={() => void handleImport()}>
            <FileUp size={16} /> 导入 .md
          </button>
          <button className="button primary" type="button" onClick={openCreate}>
            <Plus size={17} /> 新建记忆
          </button>
        </div>
      </header>

      <div className="toolbar">
        <label className="search-field">
          <Search size={16} />
          <span className="sr-only">搜索记忆</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题或正文" />
        </label>
      </div>

      {pageError ? (
        <div className="error-banner" role="alert">
          {pageError}
          <button type="button" onClick={() => setPageError('')} aria-label="关闭错误"><X size={15} /></button>
        </div>
      ) : null}

      {importNotice ? (
        <p className={`import-notice ${importHasFailures ? 'has-failures' : ''}`} role="status">
          {importNotice}
          <button type="button" onClick={() => setImportNotice('')} aria-label="关闭提示"><X size={14} /></button>
        </p>
      ) : null}

      <div className="prompt-list">
        {loading ? <div className="loading-line">正在读取记忆文档…</div> : null}
        {!loading && prompts.length === 0 ? (
          <div className="empty-state">
            <FileText size={30} />
            <h2>还没有记忆文档</h2>
            <p>把打磨好的 prompt 和常用内容存进来，或直接导入已有的 .md 文件。</p>
            <div className="header-actions">
              <button className="button secondary" type="button" onClick={() => void handleImport()}>导入 .md</button>
              <button className="button secondary" type="button" onClick={openCreate}>新建第一篇</button>
            </div>
          </div>
        ) : null}
        {!loading && prompts.length > 0 && filtered.length === 0 ? (
          <div className="empty-state"><FileText size={30} /><h2>没有匹配的文档</h2><p>尝试更换搜索关键词。</p></div>
        ) : null}
        {filtered.map((prompt) => (
          <article className="prompt-row" key={prompt.id}>
            <div className="prompt-icon"><FileText size={18} /></div>
            <button className="prompt-open" type="button" onClick={() => openEdit(prompt)}>
              <div className="prompt-title-line">
                <h2>{prompt.title}</h2>
                <span className="char-tag">{prompt.content.length} 字符</span>
              </div>
              {prompt.content ? <p className="prompt-excerpt">{prompt.content.replace(/\s+/g, ' ').slice(0, 160)}</p> : null}
              <div className="prompt-meta">更新于 {dayLabel(prompt.updatedAt)} {timeLabel(prompt.updatedAt)}</div>
            </button>
            <button
              className={`button ghost ${copiedKey === prompt.id ? 'is-copied' : ''}`}
              type="button"
              onClick={() => copyText(prompt.content, prompt.id)}
            >
              {copiedKey === prompt.id ? <><Check size={15} /> 已复制</> : <><Copy size={15} /> 复制</>}
            </button>
            <button className="icon-button" type="button" onClick={() => openEdit(prompt)} aria-label={`编辑 ${prompt.title}`}>
              <Edit3 size={16} />
            </button>
            <button className="icon-button danger" type="button" onClick={() => void removePrompt(prompt)} aria-label={`删除 ${prompt.title}`}>
              <Trash2 size={16} />
            </button>
          </article>
        ))}
      </div>

      <Modal
        open={dialogOpen}
        wide
        title={editing ? '编辑记忆' : '新建记忆'}
        description="纯文本保存，随时复制给任何 AI 工具。"
        submitLabel={editing ? '保存修改' : '创建记忆'}
        busy={busy}
        headerActions={(
          <button
            className={`button ghost ${copiedKey === 'modal' ? 'is-copied' : ''}`}
            type="button"
            disabled={!draft.content}
            onClick={() => copyText(draft.content, 'modal')}
          >
            {copiedKey === 'modal' ? <><Check size={15} /> 已复制</> : <><Copy size={15} /> 复制全文</>}
          </button>
        )}
        onClose={() => setDialogOpen(false)}
        onSubmit={(event) => void savePrompt(event)}
      >
        <div className="form-grid">
          <label className="field span-2">
            <span>标题</span>
            <input autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          </label>
          <label className="field span-2">
            <span>正文</span>
            <textarea
              className="prompt-editor"
              value={draft.content}
              onChange={(event) => setDraft({ ...draft, content: event.target.value })}
              placeholder="粘贴或撰写 prompt 正文…"
            />
          </label>
          {error ? <p className="form-error span-2" role="alert">{error}</p> : null}
        </div>
      </Modal>
    </section>
  )
}
