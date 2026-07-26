import { useEffect, useMemo, useRef, useState } from 'react'
import { Brain, CheckSquare2, FolderKanban, NotebookPen, Search } from 'lucide-react'
import type { SearchResult, SearchResultKind } from '../../../shared/types'

const KIND_META: Record<SearchResultKind, { label: string; icon: typeof Search }> = {
  project: { label: '项目', icon: FolderKanban },
  task: { label: '任务', icon: CheckSquare2 },
  report: { label: '日报', icon: NotebookPen },
  prompt: { label: '记忆', icon: Brain }
}

export function CommandPalette({
  open,
  onClose,
  onSelect
}: {
  open: boolean
  onClose: () => void
  onSelect: (result: SearchResult) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [searched, setSearched] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 每次打开都从空白开始,避免残留上一次的关键词与选中项。
  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
    setActiveIndex(0)
    setSearched(false)
    inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const keyword = query.trim()
    if (!keyword) {
      setResults([])
      setSearched(false)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      window.devcanopy.search.query(keyword)
        .then((found) => {
          if (cancelled) return
          setResults(found)
          setActiveIndex(0)
          setSearched(true)
        })
        .catch(() => undefined)
    }, 160)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, query])

  // 键盘移动选中项时让目标行滚进可视区。
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, results])

  const grouped = useMemo(() => {
    const kinds: SearchResultKind[] = ['project', 'task', 'report', 'prompt']
    return kinds
      .map((kind) => ({ kind, items: results.filter((result) => result.kind === kind) }))
      .filter((group) => group.items.length > 0)
  }, [results])

  if (!open) return null

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (results.length === 0) return
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((current) => (current + delta + results.length) % results.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const active = results[activeIndex]
      if (active) onSelect(active)
    }
  }

  return (
    <div
      className="palette-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="全局搜索">
        <div className="palette-input-row">
          <Search size={17} />
          <input
            ref={inputRef}
            value={query}
            placeholder="搜索项目、任务、日报、记忆…"
            aria-label="搜索关键词"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-results" ref={listRef}>
          {grouped.length === 0 ? (
            <p className="palette-empty">
              {searched ? '没有匹配的内容。' : '输入关键词,回车打开选中结果。'}
            </p>
          ) : grouped.map((group) => {
            const Icon = KIND_META[group.kind].icon
            return (
              <section key={group.kind}>
                <h3 className="palette-group-head">
                  <Icon size={13} /> {KIND_META[group.kind].label}
                </h3>
                {group.items.map((result) => {
                  const index = results.indexOf(result)
                  return (
                    <button
                      key={`${result.kind}-${result.id}`}
                      type="button"
                      className={`palette-row${index === activeIndex ? ' is-active' : ''}`}
                      data-active={index === activeIndex || undefined}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => onSelect(result)}
                    >
                      <strong>{result.title}</strong>
                      {result.snippet ? <span>{result.snippet}</span> : null}
                    </button>
                  )
                })}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
