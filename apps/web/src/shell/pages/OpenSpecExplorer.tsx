import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CHANGE_LABEL, CHANGE_TONE, SPEC_LABEL, SPEC_TONE, type Overview } from './openspec-model'

type ChangeEntry = Overview['changes'][number]
type SpecEntry = Overview['specs'][number]

/** Statuses in the order work moves through them: what is in progress comes first */
const ORDER = ['em-andamento', 'planejamento', 'revisao', 'impedida', 'pronta'] as const
const rank = (s: string) => {
  const i = (ORDER as readonly string[]).indexOf(s)
  return i < 0 ? ORDER.length : i
}
const sorted = (changes: ChangeEntry[]) => [...changes].sort((a, b) => rank(a.status) - rank(b.status) || a.id.localeCompare(b.id))
const pct = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0)

/** A change, optionally opened on one of its files (path relative to the installation root) */
export const changeHref = (id: string, change: string, file?: string) =>
  `/w/${id}/openspec/change/${encodeURIComponent(change)}${file ? `?file=${encodeURIComponent(file)}` : ''}`
export const specHref = (id: string, capability: string) => `/w/${id}/openspec/spec?cap=${encodeURIComponent(capability)}`

/** openspec/ as a folder tree: changes with their files and spec deltas, then the main specs. Every name is a link. */
export function OpenSpecTree({ id, data }: { id: string; data: Overview }) {
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  const toggle = (k: string) => setClosed((c) => ({ ...c, [k]: !c[k] }))
  const open = (k: string) => !closed[k]

  return (
    <nav className="sf-ostree-tree" aria-label="Estrutura do OpenSpec">
      <div className="sf-ostree-row sf-ostree-root">openspec/</div>

      <button className="sf-ostree-row sf-ostree-dir sf-ostree-toggle" onClick={() => toggle('changes')} aria-expanded={open('changes')}>
        <span className="sf-ostree-ico">{open('changes') ? '▾' : '▸'}</span> changes/
        <span className="sf-ostree-count">{data.changes.length}</span>
      </button>

      {open('changes') &&
        sorted(data.changes).map((c) => {
          const folder = `${data.dir}/changes/${c.id}`
          const specFiles = c.files.filter((f) => f.startsWith('specs/'))
          const shown = new Set(['proposal.md', 'design.md', 'tasks.md'])
          const others = c.files.filter((f) => !f.startsWith('specs/') && !shown.has(f))
          return (
            <div key={c.id} className="sf-ostree-group">
              <div className="sf-ostree-row sf-ostree-change">
                <button className="sf-ostree-chev" onClick={() => toggle(`c:${c.id}`)} aria-label={open(`c:${c.id}`) ? 'Recolher' : 'Expandir'}>
                  {open(`c:${c.id}`) ? '▾' : '▸'}
                </button>
                <Link className="sf-ostree-name" to={changeHref(id, c.id)} title="Abrir a mudança">
                  {c.id}
                </Link>
                <span className={`sf-badge ${CHANGE_TONE[c.status]} sf-ostree-badge`}>{CHANGE_LABEL[c.status]}</span>
              </div>
              {open(`c:${c.id}`) && (
                <div className="sf-ostree-children">
                  {c.stages.proposal && (
                    <Link className="sf-ostree-row sf-ostree-file" to={changeHref(id, c.id, `${folder}/proposal.md`)}>
                      <span className="sf-ostree-ico">▤</span>
                      <span className="sf-ostree-path">proposal.md</span>
                    </Link>
                  )}
                  {c.stages.design && (
                    <Link className="sf-ostree-row sf-ostree-file" to={changeHref(id, c.id, `${folder}/design.md`)}>
                      <span className="sf-ostree-ico">▤</span>
                      <span className="sf-ostree-path">design.md</span>
                    </Link>
                  )}
                  {specFiles.length > 0 && (
                    <>
                      <div className="sf-ostree-row sf-ostree-dir">
                        <span className="sf-ostree-ico">▾</span> specs/
                      </div>
                      {c.deltas.map((d) => (
                        <Link key={d.capability} className="sf-ostree-row sf-ostree-file sf-ostree-deep" to={changeHref(id, c.id, `${folder}/specs/${d.capability}/spec.md`)}>
                          <span className="sf-ostree-ico">▤</span>
                          <span className="sf-ostree-path">{d.capability}/spec.md</span>
                          {d.added.length > 0 && <span className="sf-ostree-tag green">+{d.added.length}</span>}
                          {d.modified.length > 0 && <span className="sf-ostree-tag orange">~{d.modified.length}</span>}
                          {d.removed.length > 0 && <span className="sf-ostree-tag red">−{d.removed.length}</span>}
                        </Link>
                      ))}
                    </>
                  )}
                  {c.stages.tasks && (
                    <Link className="sf-ostree-row sf-ostree-file" to={changeHref(id, c.id, `${folder}/tasks.md`)}>
                      <span className="sf-ostree-ico">☑</span>
                      <span className="sf-ostree-path">tasks.md</span>
                      <span className="sf-ostree-tag">
                        {c.tasks.done}/{c.tasks.total}
                      </span>
                    </Link>
                  )}
                  {others.map((f) => (
                    <Link key={f} className="sf-ostree-row sf-ostree-file sf-faint" to={changeHref(id, c.id, `${folder}/${f}`)}>
                      <span className="sf-ostree-ico">·</span>
                      <span className="sf-ostree-path">{f}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      {open('changes') && data.changes.length === 0 && <div className="sf-faint sf-ostree-empty">Nenhuma mudança ativa.</div>}

      <button className="sf-ostree-row sf-ostree-dir sf-ostree-toggle" onClick={() => toggle('specs')} aria-expanded={open('specs')} style={{ marginTop: 8 }}>
        <span className="sf-ostree-ico">{open('specs') ? '▾' : '▸'}</span> specs/
        <span className="sf-ostree-count">{data.specs.length}</span>
      </button>
      {open('specs') &&
        data.specs.map((s) => (
          <Link key={s.id} className="sf-ostree-row sf-ostree-file sf-ostree-deep" to={specHref(id, s.id)}>
            <span className="sf-ostree-ico">▤</span>
            <span className="sf-ostree-path">{s.id}/spec.md</span>
            <span className={`sf-badge ${SPEC_TONE[s.status]} sf-ostree-badge`}>{SPEC_LABEL[s.status]}</span>
          </Link>
        ))}
      {open('specs') && data.specs.length === 0 && <div className="sf-faint sf-ostree-empty">Nenhuma spec ainda.</div>}

      {data.archived.length > 0 && <div className="sf-faint sf-ostree-empty">changes/archive/: {data.archived.length} arquivadas</div>}
    </nav>
  )
}

/** The four steps every change goes through, with the state of each one from its files */
function stagesOf(c: ChangeEntry) {
  const proposal = c.stages.proposal ? 'done' : 'pending'
  const design = c.stages.design ? 'done' : 'optional'
  const specs = c.deltas.length > 0 || c.skipSpecs ? 'done' : 'pending'
  const tasks = c.tasks.total > 0 && c.tasks.done === c.tasks.total ? 'done' : 'pending'
  const list = [
    { label: 'Proposta', state: proposal },
    { label: 'Design', state: design },
    { label: 'Specs', state: specs },
    { label: 'Tarefas', state: tasks },
  ]
  // the first step still to do is the current one (optional steps are skipped)
  const current = list.findIndex((s) => s.state === 'pending')
  return list.map((s, i) => ({ ...s, current: i === current }))
}

const GROUP_BAR: Record<string, string> = { planejamento: 'orange', 'em-andamento': 'blue', revisao: 'purple', impedida: 'red', pronta: 'green' }

/** Changes grouped by status: each card shows its four steps and the percentage of tasks done */
export function ChangeStages({ id, data }: { id: string; data: Overview }) {
  const groups = ORDER.map((status) => ({ status, items: sorted(data.changes.filter((c) => c.status === status)) })).filter((g) => g.items.length > 0)
  if (!groups.length) return null
  return (
    <section className="sf-stages" aria-label="Andamento das mudanças">
      {groups.map((g) => (
        <div key={g.status} className="sf-stages-group">
          <div className="sf-stages-head">
            <span className={`sf-stages-bar ${GROUP_BAR[g.status] ?? ''}`} />
            <strong>{CHANGE_LABEL[g.status]}</strong>
            <span className="sf-stages-count">{g.items.length}</span>
          </div>
          <div className="sf-stages-grid">
            {g.items.map((c) => (
              <article key={c.id} className="sf-stage-card">
                <div className="sf-stage-top">
                  <Link className="sf-stage-name" to={changeHref(id, c.id)}>
                    {c.title}
                  </Link>
                  <span className={`sf-badge ${CHANGE_TONE[c.status]}`}>{CHANGE_LABEL[c.status]}</span>
                </div>
                <div className="sf-stage-line" role="list">
                  {stagesOf(c).map((s) => (
                    <div key={s.label} role="listitem" className={`sf-stage-step ${s.state} ${s.current ? 'current' : ''}`}>
                      <span className="sf-stage-dot" aria-hidden />
                      <span className="sf-stage-label">{s.label}</span>
                    </div>
                  ))}
                </div>
                <div className="sf-stage-progress">
                  <span>
                    Tarefas {c.tasks.done}/{c.tasks.total}
                  </span>
                  <span>{pct(c.tasks.done, c.tasks.total)}%</span>
                </div>
                <div className="sf-stage-bar" aria-hidden>
                  <span style={{ width: `${pct(c.tasks.done, c.tasks.total)}%` }} />
                </div>
              </article>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}

/** Main specs as cards: status, size, gaps, and which changes touched them */
export function SpecCards({ id, data }: { id: string; data: Overview }) {
  if (!data.specs.length) return null
  return (
    <section className="sf-stages" aria-label="Specs">
      <div className="sf-stages-head">
        <span className="sf-stages-bar purple" />
        <strong>Specs</strong>
        <span className="sf-stages-count">{data.specs.length}</span>
      </div>
      <div className="sf-stages-grid">
        {data.specs.map((s: SpecEntry) => {
          const invalid = s.validation && !s.validation.valid
          return (
            <Link key={s.id} className="sf-stage-card sf-spec-card" to={specHref(id, s.id)}>
              <div className="sf-stage-top">
                <span className="sf-stage-name sf-mono">{s.id}</span>
                <span className={`sf-badge ${SPEC_TONE[s.status]}`}>{SPEC_LABEL[s.status]}</span>
              </div>
              {s.purpose && <p className="sf-spec-purpose">{s.purpose.slice(0, 140)}</p>}
              <div className="sf-spec-meta">
                <span>
                  {s.requirements} requisitos · {s.scenarios} cenários
                </span>
                {s.withoutScenario > 0 && <span className="sf-spec-warn">{s.withoutScenario} sem cenário</span>}
                {invalid && <span className="sf-spec-warn">com erros de validação</span>}
              </div>
              <div className="sf-spec-changes">{s.changes.length ? `alterada por: ${s.changes.join(', ')}` : 'nenhuma mudança ativa'}</div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

/** The folder of one change, as a tree; the file open in the workspace is highlighted */
export function ChangeFileTree({ dir, name, files, active, onSelect }: { dir: string; name: string; files: string[]; active: string; onSelect: (path: string) => void }) {
  const abs = (rel: string) => `${dir}/${rel}`
  const top = files.filter((f) => !f.startsWith('specs/'))
  const specs = files.filter((f) => f.startsWith('specs/'))
  return (
    <nav className="sf-ostree-tree" aria-label="Arquivos da mudança">
      <div className="sf-ostree-row sf-ostree-root">{name}/</div>
      {top.map((f) => (
        <button key={f} className={`sf-ostree-row sf-ostree-file sf-ostree-spec ${active === abs(f) ? 'on' : ''}`} onClick={() => onSelect(abs(f))}>
          <span className="sf-ostree-ico">▤</span>
          <span className="sf-ostree-path">{f}</span>
        </button>
      ))}
      {specs.length > 0 && (
        <div className="sf-ostree-row sf-ostree-dir">
          <span className="sf-ostree-ico">▾</span> specs/
        </div>
      )}
      {specs.map((f) => (
        <button key={f} className={`sf-ostree-row sf-ostree-file sf-ostree-spec sf-ostree-deep ${active === abs(f) ? 'on' : ''}`} onClick={() => onSelect(abs(f))}>
          <span className="sf-ostree-ico">▤</span>
          <span className="sf-ostree-path">{f.slice('specs/'.length)}</span>
        </button>
      ))}
    </nav>
  )
}
