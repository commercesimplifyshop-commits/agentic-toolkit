import { Marked } from 'marked'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'

// Escapes raw HTML: the text comes from GitHub users, and nothing in it may run as markup
const md = new Marked({ gfm: true, renderer: { html: ({ text }: { text: string }) => text.replace(/</g, '&lt;').replace(/>/g, '&gt;') } })
const Markdown = ({ text }: { text: string }) => <div className="sf-doc sf-doc-small" dangerouslySetInnerHTML={{ __html: md.parse(text || '') as string }} />

/** Mirrors apps/api/src/gitops/github.service.ts */
type GitHubStatus =
  | { github: false; message: string }
  | { github: true; host: string; owner: string; repo: string; url: string; connected: boolean; source?: 'git-credential' | 'token'; login?: string }

interface PrSummary {
  number: number
  title: string
  state: string
  draft: boolean
  url: string
  author: string
  avatar: string
  head: string
  base: string
  createdAt: string
  updatedAt: string
  reviewers: string[]
  awaitingMe: boolean
  labels: { name: string; color: string }[]
}
interface Person {
  login: string
  avatar?: string
}
interface PrFile {
  path: string
  previous?: string
  status: string
  additions: number
  deletions: number
  patch: string | null
  url: string
}
interface ReviewComment {
  id: number
  replyTo?: number
  author: Person
  body: string
  path: string
  line: number | null
  originalLine: number | null
  side: 'LEFT' | 'RIGHT'
  at: string
  url: string
  outdated: boolean
  hunk: string
}
interface PrDetail {
  repo: string
  me?: string
  canReview: boolean
  isAuthor: boolean
  pr: {
    number: number
    title: string
    body: string
    state: string
    draft: boolean
    url: string
    author: Person
    head: string
    headSha: string
    base: string
    createdAt: string
    updatedAt: string
    additions: number
    deletions: number
    changedFiles: number
    commits: number
    mergeable?: string
    reviewers: string[]
  }
  files: PrFile[]
  truncated: boolean
  reviews: { id: number; author: Person; state: string; body: string; at?: string; url: string }[]
  comments: ReviewComment[]
  conversation: { id: number; author: Person; body: string; at: string; url: string }[]
  checks: { name: string; status: string; conclusion: string | null; url: string }[]
}
interface Draft {
  key: string
  path: string
  line: number
  side: 'LEFT' | 'RIGHT'
  body: string
}
type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'

const ago = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '')

const REVIEW_STATE: Record<string, { label: string; tone: string }> = {
  APPROVED: { label: 'aprovou', tone: 'green' },
  CHANGES_REQUESTED: { label: 'pediu alterações', tone: 'red' },
  COMMENTED: { label: 'comentou', tone: '' },
  DISMISSED: { label: 'revisão descartada', tone: '' },
}

/** Per-viewer drafts and "viewed" marks; storage may be unavailable, so nothing depends on it */
const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : fallback
    } catch {
      return fallback
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // the draft just won't survive a reload
    }
  },
}

// ---- connection -------------------------------------------------------------------------------

function useGitHub(workspaceId: string) {
  const [status, setStatus] = useState<GitHubStatus | null>(null)
  const reload = useCallback(
    () =>
      api
        .get<GitHubStatus>(`/workspaces/${workspaceId}/git/github`)
        .then(setStatus)
        .catch((e) => setStatus({ github: false, message: (e as Error).message })),
    [workspaceId],
  )
  useEffect(() => {
    reload()
  }, [reload])
  return { status, setStatus, reload }
}

/** Connects the GitHub of the repository: the git credential of this machine, or a token. Both stay in memory. */
function GitHubConnect({ workspaceId, status, onChange }: { workspaceId: string; status: Extract<GitHubStatus, { github: true }>; onChange: (s: GitHubStatus) => void }) {
  const [open, setOpen] = useState(false)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const connect = async (body: { source: 'git-credential' | 'token'; token?: string }) => {
    setBusy(true)
    setError('')
    try {
      onChange(await api.post<GitHubStatus>(`/workspaces/${workspaceId}/git/github/connect`, body))
      setOpen(false)
      setToken('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (status.connected) {
    return (
      <span className="sf-row" style={{ gap: 8, fontSize: 12.5 }}>
        <span className="sf-badge green">GitHub: {status.login}</span>
        <span className="sf-faint">{status.source === 'token' ? 'token informado' : 'credencial do git desta máquina'} · só em memória</span>
        <button className="sf-link" onClick={() => api.del<GitHubStatus>(`/workspaces/${workspaceId}/git/github`).then(onChange)}>
          desconectar
        </button>
      </span>
    )
  }
  return (
    <span style={{ position: 'relative' }}>
      <button className="sf-btn small" onClick={() => setOpen((o) => !o)}>
        Conectar ao GitHub
      </button>
      {open && (
        <div className="sf-pr-connect">
          <strong>Conectar ao GitHub ({status.host})</strong>
          <p className="sf-faint">Para revisar e aprovar pull requests. A credencial fica só na memória da aplicação: some ao fechar e nunca vai para o disco nem para a tela.</p>
          <button className="sf-btn small accent" disabled={busy} onClick={() => connect({ source: 'git-credential' })}>
            {busy ? 'Conectando…' : 'Usar a credencial do git desta máquina'}
          </button>
          <div className="sf-faint" style={{ fontSize: 11.5, margin: '4px 0 10px' }}>
            A mesma que o git usa nos seus pushes (Git Credential Manager). Nada é pedido em janela.
          </div>
          <div className="sf-row" style={{ gap: 6 }}>
            <input className="sf-input" type="password" placeholder="ou cole um token (repo / pull requests: leitura e escrita)" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
            <button className="sf-btn small" disabled={busy || token.trim().length < 20} onClick={() => connect({ source: 'token', token })}>
              Usar token
            </button>
          </div>
          {error && <div className="sf-callout red" style={{ marginTop: 8, fontSize: 12.5 }}>{error}</div>}
        </div>
      )}
    </span>
  )
}

// ---- list (inside the Git page) -----------------------------------------------------------------

/** Open pull requests of the repository on GitHub, each linking to its review */
export function PullRequestList({ workspaceId }: { workspaceId: string }) {
  const { status, setStatus } = useGitHub(workspaceId)
  const [prs, setPrs] = useState<PrSummary[] | null>(null)
  const [error, setError] = useState('')
  const connected = status?.github ? status.connected : false

  useEffect(() => {
    if (!status?.github) return
    setError('')
    api
      .get<PrSummary[]>(`/workspaces/${workspaceId}/git/prs`)
      .then(setPrs)
      .catch((e) => setError((e as Error).message))
  }, [workspaceId, status?.github, connected])

  if (!status) return null
  if (!status.github) {
    return (
      <div className="sf-card sf-faint" style={{ padding: 12, fontSize: 12.5, marginBottom: 16 }}>
        Pull requests: {status.message}
      </div>
    )
  }
  return (
    <>
      <div className="sf-row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', margin: '4px 0 8px' }}>
        <div className="sf-section-title" style={{ margin: 0 }}>
          Pull requests abertas {prs ? `(${prs.length})` : ''}{' '}
          <a className="sf-faint" style={{ fontWeight: 400, fontSize: 12 }} href={`${status.url}/pulls`} target="_blank" rel="noreferrer">
            {status.owner}/{status.repo} ↗
          </a>
        </div>
        <GitHubConnect workspaceId={workspaceId} status={status} onChange={setStatus} />
      </div>
      <div className="sf-card sf-pr-list" style={{ padding: 0, marginBottom: 16 }}>
        {error && <div className="sf-callout red" style={{ margin: 12, fontSize: 12.5 }}>{error}</div>}
        {!prs && !error && <div style={{ padding: 12 }}><span className="sf-spinner" /></div>}
        {prs && prs.length === 0 && <div className="sf-faint" style={{ padding: 12, fontSize: 13 }}>Nenhuma pull request aberta.</div>}
        {prs && prs.length > 0 && (
          <table className="sf-table">
            <tbody>
              {prs.map((p) => (
                <tr key={p.number}>
                  <td style={{ width: 60 }} className="sf-mono sf-faint">#{p.number}</td>
                  <td>
                    <Link to={`/w/${workspaceId}/git/pr/${p.number}`} className="sf-pr-title">
                      {p.title}
                    </Link>{' '}
                    {p.draft && <span className="sf-badge">rascunho</span>} {p.awaitingMe && <span className="sf-badge orange">aguardando sua revisão</span>}
                    {p.labels.map((l) => (
                      <span key={l.name} className="sf-badge" style={{ marginLeft: 4, borderColor: `#${l.color}` }}>
                        {l.name}
                      </span>
                    ))}
                    <div className="sf-faint" style={{ fontSize: 11.5 }}>
                      <span className="sf-mono">{p.head}</span> → <span className="sf-mono">{p.base}</span> · {p.author} · atualizada {ago(p.updatedAt)}
                    </div>
                  </td>
                  <td style={{ width: 120, textAlign: 'right' }}>
                    <Link className="sf-btn small" to={`/w/${workspaceId}/git/pr/${p.number}`}>
                      Revisar →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

// ---- diff ---------------------------------------------------------------------------------------

interface DiffRow {
  kind: 'hunk' | 'add' | 'del' | 'ctx' | 'note'
  old?: number
  new?: number
  text: string
}

/** A unified diff (GitHub's "patch") as rows with the old and new line numbers */
export function parsePatch(patch: string): DiffRow[] {
  const rows: DiffRow[] = []
  let o = 0
  let n = 0
  for (const line of patch.split('\n')) {
    const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/)
    if (h) {
      o = Number(h[1])
      n = Number(h[2])
      rows.push({ kind: 'hunk', text: line })
    } else if (line.startsWith('\\')) rows.push({ kind: 'note', text: line.slice(1).trim() })
    else if (line.startsWith('+')) rows.push({ kind: 'add', new: n++, text: line.slice(1) })
    else if (line.startsWith('-')) rows.push({ kind: 'del', old: o++, text: line.slice(1) })
    else rows.push({ kind: 'ctx', old: o++, new: n++, text: line.slice(1) })
  }
  return rows
}

/** Where a comment on this row goes: the new side for added and unchanged lines, the old side for removed ones */
const anchorOf = (r: DiffRow) => (r.kind === 'del' ? { side: 'LEFT' as const, line: r.old! } : r.kind === 'add' || r.kind === 'ctx' ? { side: 'RIGHT' as const, line: r.new! } : null)

function Thread({ comments, all, canReply, onReply }: { comments: ReviewComment[]; all: ReviewComment[]; canReply: boolean; onReply: (id: number, body: string) => Promise<void> }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const root = comments[0]
  const replies = all.filter((c) => c.replyTo === root.id)
  return (
    <div className="sf-pr-thread">
      {[root, ...replies].map((c) => (
        <div key={c.id} className="sf-pr-comment">
          <div className="sf-faint" style={{ fontSize: 11.5 }}>
            <strong style={{ color: 'var(--sf-text)' }}>{c.author.login}</strong> · {ago(c.at)}{' '}
            <a href={c.url} target="_blank" rel="noreferrer">
              ↗
            </a>
          </div>
          <Markdown text={c.body} />
        </div>
      ))}
      {canReply && (
        <div className="sf-row" style={{ gap: 6, marginTop: 6 }}>
          <input className="sf-input" placeholder="Responder…" value={text} onChange={(e) => setText(e.target.value)} />
          <button
            className="sf-btn small"
            disabled={busy || !text.trim()}
            onClick={async () => {
              setBusy(true)
              try {
                await onReply(root.id, text)
                setText('')
              } finally {
                setBusy(false)
              }
            }}
          >
            Responder
          </button>
        </div>
      )}
    </div>
  )
}

function FileDiff({
  file,
  comments,
  drafts,
  canComment,
  viewed,
  onViewed,
  onDraft,
  onRemoveDraft,
  onReply,
}: {
  file: PrFile
  comments: ReviewComment[]
  drafts: Draft[]
  canComment: boolean
  viewed: boolean
  onViewed: (v: boolean) => void
  onDraft: (d: Omit<Draft, 'key'>) => void
  onRemoveDraft: (key: string) => void
  onReply: (id: number, body: string) => Promise<void>
}) {
  const rows = useMemo(() => (file.patch ? parsePatch(file.patch) : []), [file.patch])
  const [composing, setComposing] = useState<{ side: 'LEFT' | 'RIGHT'; line: number } | null>(null)
  const [text, setText] = useState('')
  const [collapsed, setCollapsed] = useState(viewed)
  const roots = comments.filter((c) => !c.replyTo && !c.outdated)
  const outdated = comments.filter((c) => !c.replyTo && c.outdated)

  return (
    <div className="sf-pr-file" id={`file-${file.path}`}>
      <div className="sf-pr-file-head">
        <button className="sf-link" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expandir' : 'Recolher'}>
          {collapsed ? '▸' : '▾'}
        </button>
        <span className="sf-mono" style={{ overflowWrap: 'anywhere' }}>
          {file.previous ? `${file.previous} → ` : ''}
          {file.path}
        </span>
        <span className="sf-pr-stat">
          <span className="add">+{file.additions}</span> <span className="del">−{file.deletions}</span>
        </span>
        {file.status !== 'modified' && <span className="sf-badge">{file.status}</span>}
        <span style={{ flex: 1 }} />
        <label className="sf-faint" style={{ fontSize: 12, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={viewed}
            onChange={(e) => {
              onViewed(e.target.checked)
              setCollapsed(e.target.checked)
            }}
          />
          Visualizado
        </label>
      </div>
      {!collapsed &&
        (!file.patch ? (
          <div className="sf-faint" style={{ padding: 12, fontSize: 12.5 }}>
            Diff grande ou binário: o GitHub não envia o conteúdo.{' '}
            <a href={file.url} target="_blank" rel="noreferrer">
              Ver no GitHub ↗
            </a>
          </div>
        ) : (
          <table className="sf-diff">
            <colgroup>
              <col style={{ width: 52 }} />
              <col style={{ width: 52 }} />
              <col />
            </colgroup>
            <tbody>
              {rows.map((r, i) => {
                const a = anchorOf(r)
                const here = a ? roots.filter((c) => c.side === a.side && c.line === a.line) : []
                const mine = a ? drafts.filter((d) => d.side === a.side && d.line === a.line) : []
                const open = a && composing && composing.side === a.side && composing.line === a.line
                return (
                  <Fragment key={i}>
                    <tr className={`row-${r.kind}`}>
                      {r.kind === 'hunk' || r.kind === 'note' ? (
                        <td colSpan={3} className="hunk">
                          {r.text}
                        </td>
                      ) : (
                        <>
                          <td className="num">{r.old ?? ''}</td>
                          <td className="num">
                            {canComment && a && (
                              <button className="sf-diff-add" title="Comentar nesta linha" onClick={() => (setComposing(a), setText(''))}>
                                +
                              </button>
                            )}
                            {r.new ?? ''}
                          </td>
                          <td className="code">
                            <span className="sign">{r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ' '}</span>
                            {r.text}
                          </td>
                        </>
                      )}
                    </tr>
                    {(here.length > 0 || mine.length > 0 || open) && (
                      <tr className="row-thread">
                        <td colSpan={3}>
                          {here.map((c) => (
                            <Thread key={c.id} comments={[c]} all={comments} canReply={canComment} onReply={onReply} />
                          ))}
                          {mine.map((d) => (
                            <div key={d.key} className="sf-pr-draft">
                              <div className="sf-row" style={{ justifyContent: 'space-between' }}>
                                <span className="sf-badge orange">pendente</span>
                                <button className="sf-link" onClick={() => onRemoveDraft(d.key)}>
                                  remover
                                </button>
                              </div>
                              <Markdown text={d.body} />
                            </div>
                          ))}
                          {open && (
                            <div className="sf-pr-composer">
                              <textarea className="sf-input" rows={3} autoFocus placeholder="Comentário nesta linha (Markdown)" value={text} onChange={(e) => setText(e.target.value)} />
                              <div className="sf-row" style={{ gap: 6, justifyContent: 'flex-end', marginTop: 6 }}>
                                <button className="sf-btn small" onClick={() => setComposing(null)}>
                                  Cancelar
                                </button>
                                <button
                                  className="sf-btn small accent"
                                  disabled={!text.trim()}
                                  onClick={() => {
                                    onDraft({ path: file.path, side: composing!.side, line: composing!.line, body: text.trim() })
                                    setComposing(null)
                                    setText('')
                                  }}
                                >
                                  Adicionar à revisão
                                </button>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        ))}
      {!collapsed && outdated.length > 0 && (
        <details className="sf-pr-outdated">
          <summary>{outdated.length} comentário(s) em versões anteriores deste arquivo</summary>
          {outdated.map((c) => (
            <Thread key={c.id} comments={[c]} all={comments} canReply={canComment} onReply={onReply} />
          ))}
        </details>
      )}
    </div>
  )
}

// ---- review page ----------------------------------------------------------------------------------

/** Code review of one pull request, sent to GitHub: line comments, approve, request changes or comment */
export function PullRequestPage() {
  const { id = '', number = '' } = useParams()
  const { status, setStatus } = useGitHub(id)
  const [data, setData] = useState<PrDetail | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'files' | 'conversation'>('files')
  const draftKey = data ? `agentic-toolkit.pr-review.${data.repo}#${number}` : ''
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [viewed, setViewed] = useState<Record<string, boolean>>({})
  const [summary, setSummary] = useState('')
  const [event, setEvent] = useState<ReviewEvent>('COMMENT')
  const [panel, setPanel] = useState(false)
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState('')
  const connected = status?.github ? status.connected : false

  const load = useCallback(
    () =>
      api
        .get<PrDetail>(`/workspaces/${id}/git/prs/${number}`)
        .then((d) => {
          setData(d)
          setError('')
        })
        .catch((e) => setError((e as Error).message)),
    [id, number],
  )
  useEffect(() => {
    load()
  }, [load, connected])
  useEffect(() => {
    if (!draftKey) return
    setDrafts(store.get<Draft[]>(draftKey, []))
    setViewed(store.get<Record<string, boolean>>(`${draftKey}.viewed`, {}))
  }, [draftKey])

  const saveDrafts = (next: Draft[]) => {
    setDrafts(next)
    store.set(draftKey, next)
  }
  const reply = async (commentId: number, body: string) => {
    await api.post(`/workspaces/${id}/git/prs/${number}/comments/${commentId}/replies`, { body })
    await load()
  }
  const submit = async () => {
    if (!data) return
    setSending(true)
    setError('')
    try {
      await api.post(`/workspaces/${id}/git/prs/${number}/review`, {
        event,
        body: summary,
        commitId: data.pr.headSha,
        comments: drafts.map((d) => ({ path: d.path, line: d.line, side: d.side, body: d.body })),
      })
      saveDrafts([])
      setSummary('')
      setPanel(false)
      setNotice(event === 'APPROVE' ? 'Pull request aprovada no GitHub.' : event === 'REQUEST_CHANGES' ? 'Alterações solicitadas no GitHub.' : 'Revisão enviada ao GitHub.')
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  if (error && !data) {
    return (
      <div className="sf-page">
        <Link to={`/w/${id}/git`} className="sf-faint">
          ← Git
        </Link>
        <div className="sf-callout red" style={{ marginTop: 10 }}>
          {error}
        </div>
      </div>
    )
  }
  if (!data) return <div className="sf-page"><span className="sf-spinner" /></div>
  const pr = data.pr
  const byFile = (path: string) => data.comments.filter((c) => c.path === path)
  const latest = new Map<string, { state: string; at?: string }>()
  for (const r of data.reviews) if (r.state !== 'COMMENTED' || !latest.has(r.author.login)) latest.set(r.author.login, { state: r.state, at: r.at })
  const failing = data.checks.filter((c) => c.conclusion && !['success', 'neutral', 'skipped'].includes(c.conclusion))
  const pending = data.checks.filter((c) => c.status !== 'completed')

  return (
    <div className="sf-page sf-pr">
      <Link to={`/w/${id}/git`} className="sf-faint" style={{ fontSize: 12.5 }}>
        ← Git
      </Link>
      <div className="sf-row" style={{ justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginTop: 6 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: '0 0 4px', fontSize: 22 }}>
            {pr.title} <span className="sf-faint" style={{ fontWeight: 400 }}>#{pr.number}</span>
          </h1>
          <div className="sf-row" style={{ gap: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
            <span className={`sf-badge ${pr.state === 'open' ? 'green' : pr.state === 'merged' ? 'purple' : 'red'}`}>{pr.state === 'open' ? (pr.draft ? 'rascunho' : 'aberta') : pr.state === 'merged' ? 'mesclada' : 'fechada'}</span>
            <span>
              <strong>{pr.author.login}</strong> quer mesclar {pr.commits} commit(s) de <span className="sf-mono">{pr.head}</span> em <span className="sf-mono">{pr.base}</span>
            </span>
            <span className="sf-pr-stat">
              <span className="add">+{pr.additions}</span> <span className="del">−{pr.deletions}</span> em {pr.changedFiles} arquivo(s)
            </span>
            <a href={pr.url} target="_blank" rel="noreferrer">
              Abrir no GitHub ↗
            </a>
          </div>
        </div>
        <div className="sf-row" style={{ gap: 8, flexShrink: 0 }}>
          {status?.github && <GitHubConnect workspaceId={id} status={status} onChange={setStatus} />}
          {pr.state === 'open' && (
            <button className="sf-btn accent" disabled={!data.canReview} onClick={() => setPanel((p) => !p)} title={data.canReview ? '' : 'Conecte ao GitHub para revisar'}>
              Revisar alterações{drafts.length ? ` (${drafts.length})` : ''}
            </button>
          )}
        </div>
      </div>

      {notice && <div className="sf-callout green" style={{ marginTop: 10 }}>{notice}</div>}
      {error && <div className="sf-callout red" style={{ marginTop: 10 }}>{error}</div>}

      {panel && (
        <div className="sf-card sf-pr-panel">
          <strong>Concluir a revisão</strong>
          <textarea className="sf-input" rows={4} placeholder="Comentário geral (Markdown)" value={summary} onChange={(e) => setSummary(e.target.value)} />
          <div className="sf-pr-events">
            {(
              [
                ['COMMENT', 'Comentar', 'Feedback geral, sem aprovar.'],
                ['APPROVE', 'Aprovar', 'Aprova as alterações para serem mescladas.'],
                ['REQUEST_CHANGES', 'Solicitar alterações', 'Feedback que precisa ser resolvido antes de mesclar.'],
              ] as [ReviewEvent, string, string][]
            ).map(([value, label, hint]) => {
              const blocked = data.isAuthor && value !== 'COMMENT'
              return (
                <label key={value} className={blocked ? 'off' : ''}>
                  <input type="radio" name="event" checked={event === value} disabled={blocked} onChange={() => setEvent(value)} />
                  <span>
                    <strong>{label}</strong>
                    <span className="sf-faint"> · {blocked ? 'o GitHub não deixa o autor aprovar ou pedir alterações na própria PR' : hint}</span>
                  </span>
                </label>
              )
            })}
          </div>
          <div className="sf-row" style={{ justifyContent: 'space-between', gap: 8 }}>
            <span className="sf-faint" style={{ fontSize: 12 }}>
              {drafts.length} comentário(s) de linha pendente(s) vão junto. Revisando como {data.me}.
            </span>
            <span className="sf-row" style={{ gap: 6 }}>
              <button className="sf-btn small" onClick={() => setPanel(false)}>
                Cancelar
              </button>
              <button className="sf-btn small accent" disabled={sending || (event !== 'APPROVE' && !summary.trim() && !drafts.length)} onClick={submit}>
                {sending ? 'Enviando…' : 'Enviar revisão ao GitHub'}
              </button>
            </span>
          </div>
        </div>
      )}

      <div className="sf-pr-meta">
        <span>
          Revisores:{' '}
          {[...latest].map(([login, r]) => (
            <span key={login} className={`sf-badge ${REVIEW_STATE[r.state]?.tone ?? ''}`} style={{ marginRight: 4 }}>
              {login} {REVIEW_STATE[r.state]?.label ?? r.state.toLowerCase()}
            </span>
          ))}
          {pr.reviewers
            .filter((r) => !latest.has(r))
            .map((r) => (
              <span key={r} className="sf-badge" style={{ marginRight: 4 }}>
                {r} pendente
              </span>
            ))}
          {latest.size === 0 && pr.reviewers.length === 0 && <span className="sf-faint">nenhum</span>}
        </span>
        {data.checks.length > 0 && (
          <span>
            Checks:{' '}
            {failing.length ? <span className="sf-badge red">{failing.length} falhando</span> : pending.length ? <span className="sf-badge orange">{pending.length} em andamento</span> : <span className="sf-badge green">todos ok</span>}
          </span>
        )}
      </div>

      <div className="sf-tabs" style={{ marginTop: 12 }}>
        <button className={`sf-tab ${tab === 'files' ? 'on' : ''}`} onClick={() => setTab('files')}>
          Arquivos alterados ({data.files.length})
        </button>
        <button className={`sf-tab ${tab === 'conversation' ? 'on' : ''}`} onClick={() => setTab('conversation')}>
          Conversa ({data.conversation.length + data.reviews.filter((r) => r.body).length})
        </button>
      </div>

      {tab === 'conversation' && (
        <div className="sf-pr-conversation">
          <div className="sf-card">
            <div className="sf-faint" style={{ fontSize: 12 }}>
              <strong style={{ color: 'var(--sf-text)' }}>{pr.author.login}</strong> abriu em {ago(pr.createdAt)}
            </div>
            {pr.body ? <Markdown text={pr.body} /> : <div className="sf-faint">Sem descrição.</div>}
          </div>
          {[
            ...data.conversation.map((c) => ({ at: c.at, key: `c${c.id}`, who: c.author.login, label: 'comentou', tone: '', body: c.body, url: c.url })),
            ...data.reviews.filter((r) => r.body || r.state !== 'COMMENTED').map((r) => ({ at: r.at ?? '', key: `r${r.id}`, who: r.author.login, label: REVIEW_STATE[r.state]?.label ?? r.state, tone: REVIEW_STATE[r.state]?.tone ?? '', body: r.body, url: r.url })),
          ]
            .sort((a, b) => a.at.localeCompare(b.at))
            .map((e) => (
              <div key={e.key} className="sf-card">
                <div className="sf-faint" style={{ fontSize: 12 }}>
                  <strong style={{ color: 'var(--sf-text)' }}>{e.who}</strong> <span className={`sf-badge ${e.tone}`}>{e.label}</span> · {ago(e.at)}{' '}
                  <a href={e.url} target="_blank" rel="noreferrer">
                    ↗
                  </a>
                </div>
                {e.body && <Markdown text={e.body} />}
              </div>
            ))}
          {data.checks.length > 0 && (
            <div className="sf-card">
              <strong>Checks</strong>
              {data.checks.map((c) => (
                <div key={c.name} style={{ fontSize: 12.5 }}>
                  <span className={`sf-badge ${c.conclusion === 'success' ? 'green' : c.status !== 'completed' ? 'orange' : c.conclusion && ['neutral', 'skipped'].includes(c.conclusion) ? '' : 'red'}`}>{c.conclusion ?? c.status}</span>{' '}
                  <a href={c.url} target="_blank" rel="noreferrer">
                    {c.name}
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'files' && (
        <div className="sf-pr-files">
          <aside className="sf-pr-tree">
            {data.files.map((f) => (
              <a key={f.path} href={`#file-${f.path}`} className={viewed[f.path] ? 'viewed' : ''} title={f.path} onClick={(e) => (e.preventDefault(), document.getElementById(`file-${f.path}`)?.scrollIntoView({ block: 'start' }))}>
                <span className="sf-mono">{f.path.split('/').pop()}</span>
                <span className="sf-faint"> {f.path.split('/').slice(0, -1).join('/')}</span>
                {byFile(f.path).length > 0 && <span className="sf-badge" style={{ marginLeft: 4 }}>💬 {byFile(f.path).length}</span>}
                {drafts.some((d) => d.path === f.path) && <span className="sf-badge orange" style={{ marginLeft: 4 }}>pendente</span>}
              </a>
            ))}
            <div className="sf-faint" style={{ fontSize: 11.5, marginTop: 8 }}>
              {Object.values(viewed).filter(Boolean).length} de {data.files.length} visualizados
            </div>
          </aside>
          <div className="sf-pr-diffs">
            {!data.canReview && pr.state === 'open' && <div className="sf-callout" style={{ fontSize: 12.5, marginBottom: 10 }}>Conecte ao GitHub (botão acima) para comentar nas linhas e enviar a revisão.</div>}
            {data.truncated && <div className="sf-callout orange" style={{ fontSize: 12.5, marginBottom: 10 }}>A PR tem mais arquivos do que o GitHub envia de uma vez; veja o restante no GitHub.</div>}
            {data.files.map((f) => (
              <FileDiff
                key={f.path}
                file={f}
                comments={byFile(f.path)}
                drafts={drafts.filter((d) => d.path === f.path)}
                canComment={data.canReview && pr.state === 'open'}
                viewed={Boolean(viewed[f.path])}
                onViewed={(v) => {
                  const next = { ...viewed, [f.path]: v }
                  setViewed(next)
                  store.set(`${draftKey}.viewed`, next)
                }}
                onDraft={(d) => saveDrafts([...drafts, { ...d, key: `${d.path}:${d.side}:${d.line}:${Date.now()}` }])}
                onRemoveDraft={(key) => saveDrafts(drafts.filter((d) => d.key !== key))}
                onReply={reply}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
