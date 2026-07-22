import { useEffect, useMemo, useState } from 'react'
import { Box, ExternalLink, FileWarning, Search, Wrench } from 'lucide-react'
import type { SkillInfo } from '../../../shared/types'

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.devdesk.skills.list().then(setSkills).finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return normalized
      ? skills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(normalized))
      : skills
  }, [skills, query])

  const validCount = skills.filter((skill) => skill.valid).length

  return (
    <section className="page route-enter">
      <header className="page-header">
        <div>
          <p className="eyebrow">CODEX SKILLS</p>
          <h1>Skills</h1>
          <p>{skills.length} 个 Skill，{validCount} 个结构有效</p>
        </div>
      </header>

      <div className="toolbar">
        <label className="search-field">
          <Search size={16} />
          <span className="sr-only">搜索 Skills</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或描述" />
        </label>
      </div>

      <div className="skill-list">
        {loading ? <div className="loading-line">正在读取 Codex Skills…</div> : null}
        {!loading && filtered.length === 0 ? (
          <div className="empty-state"><Box size={30} /><h2>没有匹配的 Skill</h2><p>尝试更换搜索关键词。</p></div>
        ) : filtered.map((skill) => (
          <article className="skill-row" key={`${skill.scope}-${skill.path}`}>
            <div className={`skill-icon ${skill.valid ? '' : 'invalid'}`}>
              {skill.valid ? <Wrench size={18} /> : <FileWarning size={18} />}
            </div>
            <div className="skill-copy">
              <div className="skill-title-line">
                <h2>{skill.name}</h2>
                <span className="scope-tag">{skill.scope === 'system' ? '系统' : '用户'}</span>
                {!skill.valid ? <span className="invalid-tag">需要检查</span> : null}
              </div>
              <p>{skill.description}</p>
              <div className="skill-meta">
                {skill.hasScripts ? <span>scripts</span> : null}
                {skill.hasReferences ? <span>references</span> : null}
                {skill.hasAssets ? <span>assets</span> : null}
                <code>{skill.path}</code>
              </div>
            </div>
            <button className="button ghost" type="button" onClick={() => void window.devdesk.skills.open(skill.path)}>
              <ExternalLink size={15} /> 打开目录
            </button>
          </article>
        ))}
      </div>
    </section>
  )
}
