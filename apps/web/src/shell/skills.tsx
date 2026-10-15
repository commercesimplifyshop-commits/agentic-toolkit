import { useEffect, useState } from 'react'
import { api } from './api'

/** Mirrors apps/api/src/skills */
export interface SkillView {
  id: string
  name: string
  title: string
  group: 'comum' | 'adobe-commerce' | 'salesforce-b2c'
  techs: string[]
  features: string[]
  description: string
  enabled: boolean
}
export interface SkillUse {
  at: string
  workspace?: string
  feature: string
  skill: string
  title: string
}
export interface SkillsView {
  enabled: boolean
  features: { id: string; label: string }[]
  skills: SkillView[]
  recent: SkillUse[]
}

// The catalogue changes only with a new version of the app: one request per page load
let catalog: Promise<SkillsView> | null = null
const loadCatalog = () => (catalog ??= api.get<SkillsView>('/skills').catch((e) => ((catalog = null), Promise.reject(e))))
export const refreshSkillCatalog = () => {
  catalog = null
  return loadCatalog()
}

function useTitles() {
  const [titles, setTitles] = useState<Record<string, string>>({})
  useEffect(() => {
    loadCatalog()
      .then((c) => setTitles(Object.fromEntries(c.skills.map((s) => [s.name, s.title]))))
      .catch(() => undefined)
  }, [])
  return titles
}

/**
 * The skills Claude loaded for an answer or a task, shown the way Claude Code shows them:
 * one "⏺ Skill(name)" line each.
 */
export function SkillUses({ skills, compact = false }: { skills?: (string | { name: string; title?: string })[]; compact?: boolean }) {
  const titles = useTitles()
  if (!skills?.length) return null
  const list = skills.map((s) => (typeof s === 'string' ? { name: s, title: titles[s] } : { name: s.name, title: s.title ?? titles[s.name] }))
  return (
    <div className={`sf-skill-uses ${compact ? 'compact' : ''}`} aria-label="Skills usadas pelo Claude">
      {list.map((s) => (
        <div key={s.name} className="sf-skill-use" title={s.name}>
          <span className="dot">⏺</span>
          <span className="sf-mono">Skill({s.name})</span>
          {s.title && s.title !== s.name && <span className="sf-faint">· {s.title}</span>}
        </div>
      ))}
    </div>
  )
}

const GROUPS: { id: SkillView['group']; label: string; hint: string }[] = [
  { id: 'comum', label: 'Comuns', hint: 'Valem para Adobe Commerce e Salesforce B2C.' },
  { id: 'adobe-commerce', label: 'Adobe Commerce', hint: 'Usadas só em workspaces Adobe Commerce / Magento 2.' },
  { id: 'salesforce-b2c', label: 'Salesforce B2C', hint: 'Usadas só em workspaces Salesforce B2C Commerce (SFRA).' },
]

/** Configurações → IA → Skills: feature flags of every skill, what each one is for, and recent uses */
export function SkillsSettings() {
  const [view, setView] = useState<SkillsView | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [content, setContent] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState('')

  useEffect(() => {
    refreshSkillCatalog()
      .then(setView)
      .catch((e) => setError((e as Error).message))
  }, [])

  const save = async (patch: { enabled?: boolean; skills?: Record<string, boolean> }, key: string) => {
    setSaving(key)
    setError('')
    try {
      const next = await api.put<SkillsView>('/skills/settings', patch)
      setView(next)
      catalog = Promise.resolve(next)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving('')
    }
  }
  const toggleOpen = async (id: string) => {
    if (open === id) return setOpen(null)
    setOpen(id)
    if (!content[id]) {
      try {
        const r = await api.get<{ content: string }>(`/skills/${id}`)
        setContent((c) => ({ ...c, [id]: r.content }))
      } catch (e) {
        setContent((c) => ({ ...c, [id]: (e as Error).message }))
      }
    }
  }

  if (error && !view) return <div className="sf-card"><div className="sf-callout red">{error}</div></div>
  if (!view) return <div className="sf-card"><span className="sf-spinner" /></div>
  const label = Object.fromEntries(view.features.map((f) => [f.id, f.label]))
  const active = view.skills.filter((s) => s.enabled).length

  return (
    <div className="sf-card sf-skills">
      <div className="sf-row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 style={{ margin: 0 }}>Skills do Claude</h2>
          <span className="sub">
            Conhecimento que o Claude Code carrega em cada funcionalidade: refinamento, desenvolvimento, Pergunte ao código, diagramas, documentação e OpenSpec. Cada uma recebe as skills da
            tecnologia do workspace. Quando o Claude usa uma skill, a tela mostra <span className="sf-mono">⏺ Skill(nome)</span>, como no Claude Code.
          </span>
        </div>
        <label className="sf-switch">
          <input type="checkbox" checked={view.enabled} disabled={saving === 'all'} onChange={(e) => save({ enabled: e.target.checked }, 'all')} />
          <span>{view.enabled ? `Ligadas (${active} de ${view.skills.length})` : 'Desligadas'}</span>
        </label>
      </div>
      {error && <div className="sf-callout red" style={{ marginTop: 8 }}>{error}</div>}

      {GROUPS.map((g) => (
        <div key={g.id} className="sf-skills-group">
          <div className="sf-section-title">
            {g.label} <span className="sf-faint" style={{ fontWeight: 400 }}>· {g.hint}</span>
          </div>
          {view.skills
            .filter((s) => s.group === g.id)
            .map((s) => (
              <div key={s.id} className={`sf-skill ${s.enabled && view.enabled ? '' : 'off'}`}>
                <label className="sf-switch small" title={s.enabled ? 'Desligar esta skill' : 'Ligar esta skill'}>
                  <input type="checkbox" checked={s.enabled} disabled={!view.enabled || saving === s.id} onChange={(e) => save({ skills: { [s.id]: e.target.checked } }, s.id)} />
                </label>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="sf-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <strong>{s.title}</strong>
                    <span className="sf-mono sf-faint" style={{ fontSize: 11.5 }}>
                      {s.name}
                    </span>
                  </div>
                  <div className="sf-skill-desc">{s.description}</div>
                  <div className="sf-row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                    {s.features.map((f) => (
                      <span key={f} className="sf-badge">
                        {label[f] ?? f}
                      </span>
                    ))}
                    <button className="sf-link" style={{ fontSize: 12, marginLeft: 6 }} onClick={() => toggleOpen(s.id)}>
                      {open === s.id ? 'ocultar SKILL.md' : 'ver SKILL.md'}
                    </button>
                  </div>
                  {open === s.id && <pre className="sf-skill-md">{content[s.id] ?? 'Carregando…'}</pre>}
                </div>
              </div>
            ))}
        </div>
      ))}

      <div className="sf-skills-group">
        <div className="sf-section-title">Usos recentes</div>
        {view.recent.length === 0 ? (
          <div className="sf-faint" style={{ fontSize: 13 }}>Nenhum uso desde que a aplicação iniciou.</div>
        ) : (
          <div className="sf-skill-recent">
            {view.recent.map((u, i) => (
              <div key={i}>
                <span className="sf-faint">{new Date(u.at).toLocaleString('pt-BR')}</span> <span className="sf-mono">⏺ Skill({u.skill})</span>{' '}
                <span className="sf-faint">
                  · {u.title} · {label[u.feature] ?? u.feature}
                  {u.workspace ? ` · ${u.workspace}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
