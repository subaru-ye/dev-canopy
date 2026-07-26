import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Check, Copy, Edit3, FileText, FileUp, Plus, Search, Trash2, X } from 'lucide-react'
import type { PromptDoc, PromptDraft } from '../../../shared/types'
import { ErrorBanner } from '../components/ErrorBanner'
import { Modal } from '../components/Modal'
import { useEditDialog } from '../hooks/useEditDialog'
import { useNewItemShortcut } from '../hooks/useNewItemShortcut'
import { dayLabel, timeLabel } from '../utils/dates'

const emptyDraft: PromptDraft = { title: '', content: '' }

// {{ 变量名 }} 占位符:复制时提取去重,弹填空框替换后才写剪贴板。
const VARIABLE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g
const VARIABLE_MEMORY_KEY = 'devcanopy-prompt-variables'

function extractVariables(content: string): string[] {
  const names: string[] = []
  for (const match of content.matchAll(VARIABLE_PATTERN)) {
    const name = match[1].trim()
    if (!names.includes(name)) names.push(name)
  }
  return names
}

function fillVariables(content: string, values: Record<string, string>): string {
  return content.replace(VARIABLE_PATTERN, (raw, name: string) => values[name.trim()] || raw)
}

function readRememberedValues(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(VARIABLE_MEMORY_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {}
  } catch {
    return {}
  }
}

interface VariableFillState {
  content: string
  copyKey: number | 'modal'
  variables: string[]
  values: Record<string, string>
}

export function PromptsPage() {
  const [prompts, setPrompts] = useState<PromptDoc[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [copiedKey, setCopiedKey] = useState<number | 'modal' | null>(null)
  const [importNotice, setImportNotice] = useState('')
  const [importHasFailures, setImportHasFailures] = useState(false)
  const copyTimerRef = useRef<number | null>(null)
  const [fillState, setFillState] = useState<VariableFillState | null>(null)
  const dialog = useEditDialog<PromptDoc, PromptDraft>(emptyDraft)

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

  useNewItemShortcut(() => {
    if (!dialog.open) dialog.openCreate(emptyDraft)
  })

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

  // 无占位符直接复制;有占位符先弹填空,用上次填过的值预填。
  const requestCopy = (text: string, key: number | 'modal'): void => {
    const variables = extractVariables(text)
    if (variables.length === 0) {
      copyText(text, key)
      return
    }
    const remembered = readRememberedValues()
    setFillState({
      content: text,
      copyKey: key,
      variables,
      values: Object.fromEntries(variables.map((name) => [name, remembered[name] ?? '']))
    })
  }

  const confirmFill = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!fillState) return
    try {
      window.localStorage.setItem(VARIABLE_MEMORY_KEY, JSON.stringify({ ...readRememberedValues(), ...fillState.values }))
    } catch {
      // 记忆上次填值失败不阻断复制。
    }
    copyText(fillVariables(fillState.content, fillState.values), fillState.copyKey)
    setFillState(null)
  }

  const openEdit = (prompt: PromptDoc): void => {
    dialog.openEdit(prompt, { title: prompt.title, content: prompt.content })
  }

  const savePrompt = (event: FormEvent<HTMLFormElement>): void => {
    void dialog.submit(event, async () => {
      if (!dialog.draft.title.trim()) throw new Error('请输入标题。')
      if (dialog.editing) await window.devcanopy.prompts.update(dialog.editing.id, dialog.draft)
      else await window.devcanopy.prompts.create(dialog.draft)
      await load()
    })
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
          <button className="button primary" type="button" onClick={() => dialog.openCreate(emptyDraft)}>
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

      <ErrorBanner message={pageError} onClose={() => setPageError('')} />

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
              <button className="button secondary" type="button" onClick={() => dialog.openCreate(emptyDraft)}>新建第一篇</button>
            </div>
          </div>
        ) : null}
        {!loading && prompts.length > 0 && filtered.length === 0 ? (
          <div className="empty-state"><FileText size={30} /><h2>没有匹配的文档</h2><p>尝试更换搜索关键词。</p></div>
        ) : null}
        {filtered.map((prompt) => {
          const variableCount = extractVariables(prompt.content).length
          return (
          <article className="prompt-row" key={prompt.id}>
            <div className="prompt-icon"><FileText size={18} /></div>
            <button className="prompt-open" type="button" onClick={() => openEdit(prompt)}>
              <div className="prompt-title-line">
                <h2>{prompt.title}</h2>
                <span className="char-tag">{prompt.content.length} 字符</span>
                {variableCount > 0 ? <span className="char-tag variable-tag">{variableCount} 变量</span> : null}
              </div>
              {prompt.content ? <p className="prompt-excerpt">{prompt.content.replace(/\s+/g, ' ').slice(0, 160)}</p> : null}
              <div className="prompt-meta">更新于 {dayLabel(prompt.updatedAt)} {timeLabel(prompt.updatedAt)}</div>
            </button>
            <button
              className={`button ghost ${copiedKey === prompt.id ? 'is-copied' : ''}`}
              type="button"
              onClick={() => requestCopy(prompt.content, prompt.id)}
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
          )
        })}
      </div>

      <Modal
        open={dialog.open}
        wide
        title={dialog.editing ? '编辑记忆' : '新建记忆'}
        description="纯文本保存，随时复制给任何 AI 工具。"
        submitLabel={dialog.editing ? '保存修改' : '创建记忆'}
        busy={dialog.busy}
        headerActions={(
          <button
            className={`button ghost ${copiedKey === 'modal' ? 'is-copied' : ''}`}
            type="button"
            disabled={!dialog.draft.content}
            onClick={() => requestCopy(dialog.draft.content, 'modal')}
          >
            {copiedKey === 'modal' ? <><Check size={15} /> 已复制</> : <><Copy size={15} /> 复制全文</>}
          </button>
        )}
        onClose={dialog.close}
        onSubmit={savePrompt}
      >
        <div className="form-grid">
          <label className="field span-2">
            <span>标题</span>
            <input autoFocus value={dialog.draft.title} onChange={(event) => dialog.setDraft({ ...dialog.draft, title: event.target.value })} />
          </label>
          <label className="field span-2">
            <span>正文</span>
            <textarea
              className="prompt-editor"
              value={dialog.draft.content}
              onChange={(event) => dialog.setDraft({ ...dialog.draft, content: event.target.value })}
              placeholder="粘贴或撰写 prompt 正文…"
            />
          </label>
          {dialog.error ? <p className="form-error span-2" role="alert">{dialog.error}</p> : null}
        </div>
      </Modal>

      <Modal
        open={fillState !== null}
        title="填写变量"
        description="替换 {{ }} 占位符后复制，取消则不写入剪贴板。"
        submitLabel="替换并复制"
        onClose={() => setFillState(null)}
        onSubmit={confirmFill}
      >
        <div className="form-grid">
          {fillState?.variables.map((name, index) => (
            <label className="field span-2" key={name}>
              <span>{name}</span>
              <input
                autoFocus={index === 0}
                value={fillState.values[name] ?? ''}
                placeholder={`{{ ${name} }}`}
                onChange={(event) => setFillState((current) => (
                  current ? { ...current, values: { ...current.values, [name]: event.target.value } } : current
                ))}
              />
            </label>
          ))}
        </div>
      </Modal>
    </section>
  )
}
