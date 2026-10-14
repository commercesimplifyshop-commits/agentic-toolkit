import { useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { PrereqLink } from '../prereqs'

/** Mirrors apps/api/src/gitops/gitops.service.ts */
interface Branch {
  name: string
  current: boolean
  upstream?: string
  ahead: number
  behind: number
  sha: string
  date: string
  subject: string
  worktree?: string
}
interface Worktree {
  path: string
  branch?: string
  head: string
  main: boolean
  locked: boolean
  prunable: boolean
  changes: number
}
type Overview =
  | { repo: false; message: string }
  | {
      repo: true
      root: string
      current: string
      head: string
      files: { path: string; code: string }[]
      branches: Branch[]
      remoteBranches: string[]
      worktrees: Worktree[]
      stashes: { ref: string; subject: string }[]
      log: { sha: string; date: string; author: string; subject: string }[]
      remotes: { name: string; url: string }[]
    }

export interface BaseStatus {
  base: string
  upstream: string | null
  fetched: boolean
  ahead: number
  behind: number
  upToDate: boolean
  message: string
}

const when = (iso: string) => (iso ? new Date(iso.replace(' ', 'T').replace(' ', '')).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '')
const copy = (text: string) => navigator.clipboard?.writeText(text).catch(() => undefined)

/** Git: the local repository of the project, its branches and worktrees, and the actions to manage them */
export function GitPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const focus = params.get('branch')
  const [ov, setOv] = useState<Overview | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: 'red' | 'green' | 'orange'; text: string } | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(
    () =>
      api
        .get<Overview>(`/workspaces/${id}/git`)
        .then(setOv)
        .catch((e) => setMsg({ tone: 'red', text: (e as Error).message })),
    [id],
  )

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!focus || !ov?.repo) return
    document.getElementById(`branch-${focus}`)?.scrollIntoView({ block: 'center' })
  }, [focus, ov])

  /** Runs an action, shows how it went and reloads the overview */
  const act = async (label: string, run: () => Promise<unknown>, done: string) => {
    setBusy(label)
    setMsg(null)
    try {
      await run()
      setMsg({ tone: 'green', text: done })
    } catch (e) {
      setMsg({ tone: 'red', text: (e as Error).message })
    } finally {
      setBusy(null)
      load()
    }
  }

  if (!ov) return <div className="sf-page"><span className="sf-spinner" /></div>
  if (!ov.repo) {
    return (
      <div className="sf-page">
        <div className="sf-page-head">
          <div className="sf-page-icon">⎇</div>
          <div className="sf-page-title">
            <h1>Git</h1>
            <p>Branches, worktrees e alterações do repositório do projeto.</p>
          </div>
        </div>
        <div className="sf-card" style={{ padding: 16, fontSize: 13 }}>
          As branches, os worktrees e as ações aparecem aqui assim que o repositório git estiver configurado. Se o código analisado é uma cópia, informe a pasta do seu clone de
          trabalho como repositório.{' '}
          <PrereqLink workspaceId={id} section="repositorio">
            Configurar o repositório
          </PrereqLink>
        </div>
      </div>
    )
  }

  const removeWorktree = (w: Worktree) => {
    const force = w.changes > 0
    if (!window.confirm(force ? `O worktree ${w.path} tem ${w.changes} alteração(ões) não commitada(s). Remover mesmo assim? Elas serão perdidas.` : `Remover o worktree ${w.path}? A branch continua existindo.`)) return
    void act('wt', () => api.del(`/workspaces/${id}/git/worktree?path=${encodeURIComponent(w.path)}${force ? '&force=1' : ''}`), 'Worktree removido.')
  }

  const deleteBranch = async (b: Branch) => {
    if (!window.confirm(`Excluir a branch ${b.name}?`)) return
    setBusy('del')
    setMsg(null)
    try {
      await api.del(`/workspaces/${id}/git/branch?name=${encodeURIComponent(b.name)}`)
      setMsg({ tone: 'green', text: `Branch ${b.name} excluída.` })
    } catch (e) {
      const text = (e as Error).message
      // git -d refuses an unmerged branch: ask again before forcing it
      if (/not fully merged|não.*mescl/i.test(text) && window.confirm(`${b.name} tem commits que não estão em outra branch. Excluir mesmo assim? Esses commits ficam perdidos.`)) {
        try {
          await api.del(`/workspaces/${id}/git/branch?name=${encodeURIComponent(b.name)}&force=1`)
          setMsg({ tone: 'green', text: `Branch ${b.name} excluída.` })
        } catch (e2) {
          setMsg({ tone: 'red', text: (e2 as Error).message })
        }
      } else setMsg({ tone: 'red', text })
    } finally {
      setBusy(null)
      load()
    }
  }

  const push = (b: Branch) => {
    if (!window.confirm(`Enviar a branch ${b.name} para o remoto (git push -u origin ${b.name})?`)) return
    void act('push', () => api.post(`/workspaces/${id}/git/push`, { branch: b.name }), `Branch ${b.name} enviada ao remoto.`)
  }

  return (
    <div className="sf-page sf-git">
      <div className="sf-page-head">
        <div className="sf-page-icon">⎇</div>
        <div className="sf-page-title">
          <h1>Git</h1>
          <p className="sf-mono" style={{ fontSize: 12.5 }}>
            {ov.root}
          </p>
        </div>
        <div className="sf-row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="sf-btn small" disabled={!!busy} onClick={() => act('fetch', () => api.post(`/workspaces/${id}/git/fetch`), 'Fetch concluído: remotos atualizados.')}>
            {busy === 'fetch' ? 'Buscando…' : '↓ Fetch'}
          </button>
          <button className="sf-btn small" disabled={!!busy} onClick={() => act('pull', () => api.post(`/workspaces/${id}/git/pull`, {}), `Branch ${ov.current} atualizada (fast-forward).`)}>
            {busy === 'pull' ? 'Atualizando…' : '⇣ Pull da branch atual'}
          </button>
          <button className="sf-btn small accent" disabled={!!busy} onClick={() => setCreating(true)}>
            + Nova branch
          </button>
          <button className="sf-btn small" disabled={!!busy} onClick={() => act('prune', () => api.post(`/workspaces/${id}/git/worktree/prune`), 'Worktrees órfãos limpos.')}>
            Limpar worktrees órfãos
          </button>
        </div>
      </div>

      {msg && <div className={`sf-callout ${msg.tone}`} style={{ marginBottom: 12 }}>{msg.text}</div>}

      <div className="sf-git-kpis">
        <div className="sf-card sf-git-kpi">
          <span>Branch atual</span>
          <strong className="sf-mono">{ov.current}</strong>
          <small className="sf-faint">{ov.head}</small>
        </div>
        <div className="sf-card sf-git-kpi">
          <span>Alterações não commitadas</span>
          <strong>{ov.files.length}</strong>
          <small className="sf-faint">na pasta principal</small>
        </div>
        <div className="sf-card sf-git-kpi">
          <span>Worktrees</span>
          <strong>{ov.worktrees.length - 1}</strong>
          <small className="sf-faint">além da pasta principal</small>
        </div>
        <div className="sf-card sf-git-kpi">
          <span>Remotos</span>
          <strong>{ov.remotes.length}</strong>
          <small className="sf-faint sf-mono">{ov.remotes.map((r) => r.name).join(', ') || 'nenhum'}</small>
        </div>
      </div>

      <div className="sf-section-title">Worktrees</div>
      <div className="sf-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <table className="sf-table">
          <thead>
            <tr>
              <th>Pasta</th>
              <th>Branch</th>
              <th>Alterações</th>
              <th style={{ width: 230 }} />
            </tr>
          </thead>
          <tbody>
            {ov.worktrees.map((w) => (
              <tr key={w.path} className={w.branch === focus ? 'sf-git-focus' : ''}>
                <td className="sf-mono" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>
                  {w.path} {w.main && <span className="sf-badge">principal</span>} {w.prunable && <span className="sf-badge orange">pasta sumiu</span>}
                </td>
                <td className="sf-mono">{w.branch ?? `(HEAD ${w.head})`}</td>
                <td>{w.changes ? <span className="sf-badge orange">{w.changes}</span> : <span className="sf-faint">—</span>}</td>
                <td>
                  <span className="sf-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <button className="sf-link" onClick={() => copy(`cd "${w.path}"`)} title="Copia o comando para abrir a pasta no terminal">
                      Copiar cd
                    </button>
                    {!w.main && (
                      <>
                        <button className="sf-link" disabled={!!busy} onClick={() => act('wtpull', () => api.post(`/workspaces/${id}/git/pull`, { worktreePath: w.path }), `Worktree ${w.branch} atualizado.`)}>
                          Pull
                        </button>
                        <button className="sf-link" style={{ color: 'var(--sf-red)' }} disabled={!!busy} onClick={() => removeWorktree(w)}>
                          Remover
                        </button>
                      </>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sf-section-title">Branches locais ({ov.branches.length})</div>
      <div className="sf-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <table className="sf-table">
          <thead>
            <tr>
              <th>Branch</th>
              <th>Remoto</th>
              <th>Último commit</th>
              <th style={{ width: 300 }} />
            </tr>
          </thead>
          <tbody>
            {ov.branches.map((b) => (
              <tr key={b.name} id={`branch-${b.name}`} className={b.name === focus ? 'sf-git-focus' : ''}>
                <td>
                  <span className="sf-mono">{b.name}</span> {b.current && <span className="sf-badge green">atual</span>}
                  {b.worktree && !b.current && (
                    <div className="sf-faint sf-mono" style={{ fontSize: 11 }}>
                      worktree: {b.worktree}
                    </div>
                  )}
                </td>
                <td className="sf-mono" style={{ fontSize: 12 }}>
                  {b.upstream ? (
                    <>
                      {b.upstream} {b.ahead > 0 && <span className="sf-badge blue">↑{b.ahead}</span>} {b.behind > 0 && <span className="sf-badge orange">↓{b.behind}</span>}
                    </>
                  ) : (
                    <span className="sf-faint">sem remoto</span>
                  )}
                </td>
                <td style={{ fontSize: 12.5 }}>
                  <span className="sf-mono sf-faint">{b.sha}</span> {b.subject}
                  <div className="sf-faint" style={{ fontSize: 11 }}>
                    {when(b.date)}
                  </div>
                </td>
                <td>
                  <span className="sf-row" style={{ gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    {!b.current && !b.worktree && (
                      <button className="sf-link" disabled={!!busy} onClick={() => act('checkout', () => api.post(`/workspaces/${id}/git/checkout`, { branch: b.name }), `Pasta principal agora em ${b.name}.`)}>
                        Checkout
                      </button>
                    )}
                    {!b.worktree && !b.current && (
                      <button className="sf-link" disabled={!!busy} onClick={() => act('wtadd', () => api.post(`/workspaces/${id}/git/worktree`, { branch: b.name }), `Worktree criado para ${b.name}.`)}>
                        Criar worktree
                      </button>
                    )}
                    <button className="sf-link" disabled={!!busy} onClick={() => push(b)}>
                      Push
                    </button>
                    {!b.current && !b.worktree && (
                      <button className="sf-link" style={{ color: 'var(--sf-red)' }} disabled={!!busy} onClick={() => deleteBranch(b)}>
                        Excluir
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sf-git-cols">
        <div>
          <div className="sf-section-title">Alterações na pasta principal ({ov.files.length})</div>
          <div className="sf-card" style={{ padding: 12, maxHeight: 280, overflow: 'auto' }}>
            {ov.files.length === 0 && <div className="sf-faint" style={{ fontSize: 13 }}>Nenhuma alteração pendente.</div>}
            {ov.files.map((f) => (
              <div key={f.path} className="sf-mono" style={{ fontSize: 12 }}>
                <span className="sf-faint" style={{ display: 'inline-block', width: 26 }}>
                  {f.code}
                </span>
                {f.path}
              </div>
            ))}
          </div>
          {ov.stashes.length > 0 && (
            <>
              <div className="sf-section-title">Stashes ({ov.stashes.length})</div>
              <div className="sf-card" style={{ padding: 12 }}>
                {ov.stashes.map((s) => (
                  <div key={s.ref} style={{ fontSize: 12.5 }}>
                    <span className="sf-mono sf-faint">{s.ref}</span> {s.subject}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div>
          <div className="sf-section-title">Últimos commits de {ov.current}</div>
          <div className="sf-card" style={{ padding: 12, maxHeight: 280, overflow: 'auto' }}>
            {ov.log.map((c) => (
              <div key={c.sha} style={{ fontSize: 12.5, marginBottom: 6 }}>
                <span className="sf-mono sf-faint">{c.sha}</span> {c.subject}
                <div className="sf-faint" style={{ fontSize: 11 }}>
                  {c.author} · {when(c.date)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {creating && (
        <NewBranchDialog
          workspaceId={id}
          branches={ov.branches.map((b) => b.name)}
          defaultBase={ov.current}
          onClose={() => setCreating(false)}
          onDone={(text) => {
            setCreating(false)
            setMsg({ tone: 'green', text })
            load()
          }}
        />
      )}
    </div>
  )
}

/**
 * Checks the base against its remote and offers to bring it up to date. Shared by the Git page
 * and the task preparation.
 */
export function BaseCheck({ workspaceId, base, update, onUpdate }: { workspaceId: string; base: string; update: boolean; onUpdate: (v: boolean) => void }) {
  const [status, setStatus] = useState<BaseStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!base) return
    let alive = true
    setChecking(true)
    setError('')
    setStatus(null)
    api
      .post<BaseStatus>(`/workspaces/${workspaceId}/git/base-status`, { base })
      .then((s) => {
        if (!alive) return
        setStatus(s)
        onUpdate(!s.upToDate)
      })
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setChecking(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, workspaceId])

  if (checking) return <div className="sf-faint" style={{ fontSize: 12.5 }}><span className="sf-spinner" /> Buscando {base} no remoto…</div>
  if (error) return <div className="sf-callout red" style={{ fontSize: 12.5 }}>{error}</div>
  if (!status) return null
  return (
    <div className={`sf-callout ${status.upToDate ? 'green' : 'orange'}`} style={{ fontSize: 12.5 }}>
      {status.message}
      {!status.upToDate && (
        <label className="sf-row" style={{ gap: 6, marginTop: 6 }}>
          <input type="checkbox" checked={update} onChange={(e) => onUpdate(e.target.checked)} /> Atualizar {base} antes de criar (fast-forward)
        </label>
      )}
    </div>
  )
}

function NewBranchDialog({ workspaceId, branches, defaultBase, onClose, onDone }: { workspaceId: string; branches: string[]; defaultBase: string; onClose: () => void; onDone: (text: string) => void }) {
  const [name, setName] = useState('feature/')
  const [base, setBase] = useState(branches.includes(defaultBase) ? defaultBase : branches[0] ?? '')
  const [update, setUpdate] = useState(false)
  const [worktree, setWorktree] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    setBusy(true)
    setError('')
    try {
      if (update) await api.post(`/workspaces/${workspaceId}/git/update-base`, { base })
      if (worktree) await api.post(`/workspaces/${workspaceId}/git/worktree`, { branch: name, base })
      else await api.post(`/workspaces/${workspaceId}/git/branch`, { name, base })
      onDone(`Branch ${name} criada a partir de ${base}${worktree ? ', com worktree próprio' : ''}.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sf-drawer-back" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="sf-prompt-modal" role="dialog" aria-label="Nova branch" style={{ width: 'min(560px, calc(100vw - 32px))' }}>
        <div className="sf-drawer-head">
          <h2 style={{ margin: 0, fontSize: 16 }}>Nova branch</h2>
          <button className="sf-link" onClick={onClose} aria-label="Fechar" style={{ fontSize: 18 }}>
            ✕
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8, overflowY: 'auto', minHeight: 0 }}>
          <label className="sf-faint" style={{ fontSize: 12.5 }}>
            Nome
            <input className="sf-input sf-mono" value={name} onChange={(e) => setName(e.target.value.trim())} />
          </label>
          <label className="sf-faint" style={{ fontSize: 12.5 }}>
            Branch base
            <select className="sf-input" value={base} onChange={(e) => setBase(e.target.value)}>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <BaseCheck workspaceId={workspaceId} base={base} update={update} onUpdate={setUpdate} />
          <label className="sf-row" style={{ gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={worktree} onChange={(e) => setWorktree(e.target.checked)} /> Criar um worktree para a branch (pasta ao lado do projeto)
          </label>
          {error && <div className="sf-callout red" style={{ fontSize: 12.5 }}>{error}</div>}
          <div className="sf-row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="sf-btn" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button className="sf-btn accent" onClick={create} disabled={busy || !base || name.length < 2 || name.endsWith('/')}>
              {busy ? 'Criando…' : 'Criar branch'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
