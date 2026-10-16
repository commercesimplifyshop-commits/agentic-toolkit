import { Marked } from 'marked'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { AttachmentStrip, attachmentUrl, useAttachments } from './OpenSpecPropose'
import { BaseCheck } from './GitPage'
import { PrereqLink } from '../prereqs'
import { SkillUses } from '../skills'
import { useShell } from '../store'

// Escapes raw HTML: the text is Claude's, and nothing in it may run as markup
const md = new Marked({ gfm: true, renderer: { html: ({ text }: { text: string }) => text.replace(/</g, '&lt;').replace(/>/g, '&gt;') } })
const Markdown = ({ text }: { text: string }) => <div className="sf-doc sf-doc-small" dangerouslySetInnerHTML={{ __html: md.parse(text) as string }} />

/** Mirrors apps/api/src/refine/refine.service.ts */
interface Turn {
  role: 'user' | 'assistant'
  content: string
  at: string
  attachments?: { id: string; name: string }[]
  skills?: string[]
}
interface Split {
  title: string
  scope: string
}
interface LearningItem {
  topic: string
  adobe: string
  sfcc: string
  why: string
  docs: { title: string; url: string }[]
}
interface Refinement {
  title: string
  business: string
  technical: string
  plan: string[]
  acceptance: string[]
  observations: string[]
  /** Salesforce B2C: Business Manager and metadata steps */
  platformSteps?: string[]
  /** Salesforce B2C: the "Para quem vem do Adobe" guide */
  learning?: LearningItem[]
  skills?: string[]
  complexity: { level: 'baixa' | 'media' | 'alta'; reasoning: string; recommendSplit: boolean; splits: Split[] }
  generatedAt: string
}

const isSfcc = (workspaceId: string) => useShell.getState().workspaces.find((w) => w.id === workspaceId)?.tech === 'salesforce-b2c'
interface DevState {
  status: 'executando' | 'concluido' | 'falhou' | 'cancelado' | 'interrompido'
  startedAt: string
  finishedAt?: string
  progress: number
  done: number
  total: number
  step?: string
  activity: { at: string; text: string }[]
  summary?: string
  error?: string
  costUsd?: number
  skills?: string[]
}
type CardStatus = 'refinando' | 'refinado' | 'dividido' | 'pronto' | 'desenvolvendo' | 'concluido' | 'falhou' | 'interrompido'
interface Card {
  id: string
  title: string
  status: CardStatus
  /** Diagrams of the toolkit attached to the task (mirrors CardItem in refine.service.ts) */
  attached?: { kind: 'diagram'; refId: string; title: string; at: string; by: string }[]
  parentId?: string
  childIds?: string[]
  createdAt: string
  updatedAt: string
  busy?: string
  error?: string
  messages: Turn[]
  refinement?: Refinement
  git?: { branch: string; base?: string; path: string; preparedAt: string }
  dev?: DevState
}
interface CardSummary {
  id: string
  title: string
  status: CardStatus
  parentId?: string
  childIds?: string[]
  busy?: string
  updatedAt: string
  complexity?: Refinement['complexity']['level']
  git?: Card['git']
  dev?: { status: DevState['status']; progress: number; done: number; total: number; step?: string; last?: string }
}

const STATUS: Record<CardStatus, { label: string; tone: string }> = {
  refinando: { label: 'Refinando', tone: 'blue' },
  refinado: { label: 'Refinado', tone: 'green' },
  dividido: { label: 'Dividido', tone: '' },
  pronto: { label: 'Pronto para desenvolver', tone: 'green' },
  desenvolvendo: { label: 'Desenvolvendo', tone: 'blue' },
  concluido: { label: 'Concluído', tone: 'green' },
  falhou: { label: 'Falhou', tone: 'red' },
  interrompido: { label: 'Interrompido', tone: 'orange' },
}
const COLUMNS: { title: string; statuses: CardStatus[] }[] = [
  { title: 'Em refinamento', statuses: ['refinando'] },
  { title: 'Refinados', statuses: ['refinado', 'pronto'] },
  { title: 'Em desenvolvimento', statuses: ['desenvolvendo'] },
  { title: 'Finalizados', statuses: ['concluido', 'falhou', 'interrompido', 'dividido'] },
]
const COMPLEXITY: Record<string, string> = { baixa: 'Baixa', media: 'Média', alta: 'Alta' }

const copy = (text: string) => navigator.clipboard?.writeText(text).catch(() => undefined)
const ago = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

const DEV_LABEL: Record<DevState['status'], string> = { executando: 'Executando', concluido: 'Concluído', falhou: 'Falhou', cancelado: 'Parado', interrompido: 'Interrompido' }

/** The progress bar of a development; it pulses while Claude is working */
function DevProgress({ dev }: { dev: { status: DevState['status']; progress: number; done: number; total: number; step?: string } }) {
  const running = dev.status === 'executando'
  return (
    <div className="sf-dev">
      <div className="sf-row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
        <span>
          {running && <span className="sf-spinner" />} {running ? 'Claude desenvolvendo' : DEV_LABEL[dev.status]}
        </span>
        <strong>{dev.progress}%</strong>
      </div>
      <div className={`sf-dev-bar ${running ? 'running' : dev.status}`}>
        <span style={{ width: `${Math.max(dev.progress, running ? 3 : 0)}%` }} />
      </div>
      <div className="sf-faint" style={{ fontSize: 11.5 }}>
        {dev.done}/{dev.total} passos{dev.step && running ? ` · ${dev.step}` : ''}
      </div>
    </div>
  )
}

// ---- board ------------------------------------------------------------------------

/** Refinamento: demands become refined cards, then branches, then code written by Claude. Several run at once. */
export function RefinePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [cards, setCards] = useState<CardSummary[] | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(
    () =>
      api
        .get<CardSummary[]>(`/workspaces/${id}/refine/cards`)
        .then((c) => {
          setCards(c)
          setError('')
        })
        .catch((e) => setError((e as Error).message)),
    [id],
  )

  const active = (cards ?? []).some((c) => c.busy || c.dev?.status === 'executando')
  useEffect(() => {
    load()
  }, [load])
  // live while anything is being refined or developed
  useEffect(() => {
    if (!active) return
    const t = window.setInterval(load, 2500)
    return () => window.clearInterval(t)
  }, [active, load])

  const byId = useMemo(() => new Map((cards ?? []).map((c) => [c.id, c])), [cards])
  const running = (cards ?? []).filter((c) => c.dev?.status === 'executando')
  const sfcc = useShell((s) => s.workspaces.find((w) => w.id === id)?.tech === 'salesforce-b2c')

  return (
    <div className="sf-page sf-refine">
      <div className="sf-page-head">
        <div className="sf-page-icon">✎</div>
        <div className="sf-page-title">
          <h1>Refinamento</h1>
          <p>Descreva a demanda como ela chegou. O Claude lê o código, refina com você e escreve o card; depois prepara a branch e desenvolve.</p>
        </div>
        <button className="sf-btn accent" onClick={() => setCreating(true)}>
          + Nova demanda
        </button>
      </div>

      {error && <div className="sf-callout red">{error}</div>}
      {sfcc && (
        <div className="sf-callout blue sf-learning-banner" style={{ marginBottom: 12 }}>
          <span>🎓</span>
          <span>
            <strong>Modo aprendendo SFCC ligado.</strong> O Claude responde como arquiteto SFRA e explica cada conceito comparando com o Adobe Commerce; o card traz o guia "Para quem vem do
            Adobe" e os passos no Business Manager.
          </span>
        </div>
      )}
      {running.length > 0 && (
        <div className="sf-callout blue" style={{ marginBottom: 12 }}>
          {running.length === 1 ? '1 tarefa sendo desenvolvida' : `${running.length} tarefas sendo desenvolvidas em paralelo`} pelo Claude, cada uma no seu worktree.
        </div>
      )}
      {!cards && !error && <span className="sf-spinner" />}
      {cards && cards.length === 0 && (
        <div className="sf-card" style={{ padding: 24, textAlign: 'center' }}>
          <p style={{ marginTop: 0 }}>Nenhuma demanda ainda.</p>
          <p className="sf-faint" style={{ fontSize: 13 }}>
            Cole o texto do ticket, o pedido do cliente ou um print. O Claude investiga o código e devolve um card com descrição de negócio, solução técnica, critérios de aceite e
            observações, pronto para o Jira ou o Azure DevOps.
          </p>
          <button className="sf-btn accent" onClick={() => setCreating(true)}>
            + Nova demanda
          </button>
        </div>
      )}
      {cards && cards.length > 0 && (
        <div className="sf-refine-board">
          {COLUMNS.map((col) => {
            const list = cards.filter((c) => col.statuses.includes(c.status))
            return (
              <div key={col.title} className="sf-refine-col">
                <div className="sf-section-title">
                  {col.title} <span className="sf-faint">({list.length})</span>
                </div>
                {list.length === 0 && <div className="sf-faint" style={{ fontSize: 12.5, padding: '8px 2px' }}>—</div>}
                {list.map((c) => (
                  <Link key={c.id} to={`/w/${id}/refinamento/${c.id}`} className={`sf-card sf-refine-card ${c.dev?.status === 'executando' || c.busy ? 'is-live' : ''}`}>
                    <span className={`sf-badge ${STATUS[c.status].tone}`} style={{ alignSelf: 'flex-start' }}>
                      {STATUS[c.status].label}
                    </span>
                    <strong style={{ fontSize: 13.5, lineHeight: 1.35 }}>{c.title}</strong>
                    {c.parentId && byId.get(c.parentId) && <div className="sf-faint" style={{ fontSize: 11.5 }}>parte de: {byId.get(c.parentId)!.title}</div>}
                    {c.childIds?.length ? <div className="sf-faint" style={{ fontSize: 11.5 }}>dividido em {c.childIds.length} tarefas</div> : null}
                    {c.busy && (
                      <div className="sf-faint" style={{ fontSize: 12 }}>
                        <span className="sf-spinner" /> Claude {c.busy}…
                      </div>
                    )}
                    <div className="sf-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {c.complexity && <span className="sf-badge">complexidade {COMPLEXITY[c.complexity]}</span>}
                      {c.git && <span className="sf-badge sf-mono">⎇ {c.git.branch}</span>}
                    </div>
                    {c.dev && <DevProgress dev={c.dev} />}
                    {c.dev?.status === 'executando' && c.dev.last && (
                      <div className="sf-faint sf-mono" style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {c.dev.last}
                      </div>
                    )}
                    <div className="sf-faint" style={{ fontSize: 11 }}>atualizado {ago(c.updatedAt)}</div>
                  </Link>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {creating && (
        <NewDemand
          workspaceId={id}
          onClose={() => setCreating(false)}
          onCreated={(card) => {
            setCreating(false)
            navigate(`/w/${id}/refinamento/${card.id}`)
          }}
        />
      )}
    </div>
  )
}

/** A modal that only closes on its own buttons: a click outside never throws work away */
function Dialog({ title, width = 720, onClose, children }: { title: string; width?: number; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sf-drawer-back" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="sf-prompt-modal" role="dialog" aria-label={title} style={{ width: `min(${width}px, calc(100vw - 32px))`, maxHeight: 'calc(100vh - 48px)' }}>
        <div className="sf-drawer-head">
          <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
          <button className="sf-link" onClick={onClose} aria-label="Fechar" style={{ fontSize: 18 }}>
            ✕
          </button>
        </div>
        <div style={{ overflowY: 'auto', paddingTop: 8, minHeight: 0 }}>{children}</div>
      </div>
    </div>
  )
}

const DRAFT_KEY = (workspaceId: string) => `agentic-toolkit.refineDraft.${workspaceId}`

function NewDemand({ workspaceId, onClose, onCreated }: { workspaceId: string; onClose: () => void; onCreated: (card: Card) => void }) {
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(DRAFT_KEY(workspaceId)) ?? ''
    } catch {
      return ''
    }
  })
  const att = useAttachments(workspaceId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY(workspaceId), text)
    } catch {
      // the draft is a convenience only
    }
  }, [text, workspaceId])

  const send = async () => {
    setBusy(true)
    setError('')
    try {
      const card = await api.post<Card>(`/workspaces/${workspaceId}/refine/cards`, { message: text, attachments: att.items })
      try {
        localStorage.removeItem(DRAFT_KEY(workspaceId))
      } catch {
        // ignore
      }
      onCreated(card)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog title="Nova demanda" onClose={onClose}>
      <p className="sf-faint" style={{ marginTop: 0, fontSize: 13 }}>
        Escreva do jeito que a demanda chegou: o texto do ticket, o pedido do cliente, o que você já sabe. Anexe prints se tiver. O Claude lê o código do projeto (sem alterar nada) e
        volta com o entendimento, a solução que ele imagina e as perguntas que faltam.
      </p>
      <textarea
        className="sf-input"
        rows={10}
        autoFocus
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onPaste={att.onPaste}
        onDrop={att.onDrop}
        placeholder="Ex.: O cliente quer que o frete grátis apareça na página do produto quando o valor passar de R$ 299, só para a loja B2C…"
      />
      <AttachmentStrip workspaceId={workspaceId} att={att} disabled={busy} />
      {error && <div className="sf-callout red" style={{ fontSize: 12.5 }}>{error}</div>}
      <div className="sf-row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
        {busy && (
          <span className="sf-faint" style={{ fontSize: 12.5 }}>
            <span className="sf-spinner" /> O Claude está lendo o código…
          </span>
        )}
        <button className="sf-btn" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button className="sf-btn accent" onClick={send} disabled={busy || att.uploading > 0 || (text.trim().length < 2 && att.items.length === 0)}>
          Começar refinamento
        </button>
      </div>
    </Dialog>
  )
}

// ---- card detail ------------------------------------------------------------------

/** Export formats: Markdown, Jira wiki markup and Azure DevOps (HTML for the description field) */
function exportCard(card: Card, format: 'md' | 'jira' | 'ado') {
  const r = card.refinement!
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  if (format === 'jira') {
    const list = (items: string[]) => items.map((i) => `* ${i}`).join('\n')
    const toJira = (s: string) =>
      s
        .replace(/```[a-z]*\n([\s\S]*?)```/g, '{code}\n$1{code}')
        .replace(/^### (.*)$/gm, 'h4. $1')
        .replace(/^## (.*)$/gm, 'h3. $1')
        .replace(/^# (.*)$/gm, 'h2. $1')
        .replace(/\*\*(.+?)\*\*/g, '*$1*')
        .replace(/`([^`\n]+)`/g, '{{$1}}')
        .replace(/^(\s*)- /gm, (_m, sp: string) => `${'*'.repeat(sp.length / 2 + 1)} `)
    return [
      `h1. ${r.title || card.title}`,
      `h2. Descrição de negócio\n${toJira(r.business)}`,
      `h2. Descrição técnica\n${toJira(r.technical)}`,
      `h2. Plano\n${r.plan.map((p) => `# ${p}`).join('\n')}`,
      `h2. Critérios de aceite\n${list(r.acceptance)}`,
      r.observations.length ? `h2. Pontos de observação\n${list(r.observations)}` : '',
      r.platformSteps?.length ? `h2. Passos no Business Manager\n${list(r.platformSteps)}` : '',
      `_Complexidade: ${COMPLEXITY[r.complexity.level]}. ${r.complexity.reasoning}_`,
    ]
      .filter(Boolean)
      .join('\n\n')
  }
  if (format === 'ado') {
    const ul = (items: string[]) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
    return [
      `<h2>Descrição de negócio</h2>${md.parse(r.business)}`,
      `<h2>Descrição técnica</h2>${md.parse(r.technical)}`,
      `<h2>Plano</h2><ol>${r.plan.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>`,
      `<h2>Critérios de aceite</h2>${ul(r.acceptance)}`,
      r.observations.length ? `<h2>Pontos de observação</h2>${ul(r.observations)}` : '',
      r.platformSteps?.length ? `<h2>Passos no Business Manager</h2>${ul(r.platformSteps)}` : '',
      `<p><em>Complexidade: ${COMPLEXITY[r.complexity.level]}. ${esc(r.complexity.reasoning)}</em></p>`,
    ]
      .filter(Boolean)
      .join('\n')
  }
  return [
    `# ${r.title || card.title}`,
    `## Descrição de negócio\n\n${r.business}`,
    `## Descrição técnica\n\n${r.technical}`,
    `## Plano\n\n${r.plan.map((p, i) => `${i + 1}. ${p}`).join('\n')}`,
    `## Critérios de aceite\n\n${r.acceptance.map((a) => `- [ ] ${a}`).join('\n')}`,
    r.observations.length ? `## Pontos de observação\n\n${r.observations.map((o) => `- ${o}`).join('\n')}` : '',
    r.platformSteps?.length ? `## Passos no Business Manager\n\n${r.platformSteps.map((o) => `- [ ] ${o}`).join('\n')}` : '',
    r.learning?.length
      ? `## Para quem vem do Adobe\n\n${r.learning.map((l) => `- **${l.topic}**: no Adobe, ${l.adobe}; no SFCC, ${l.sfcc}. ${l.why}${l.docs.length ? ` (${l.docs.map((d) => `[${d.title}](${d.url})`).join(', ')})` : ''}`).join('\n')}`
      : '',
    `_Complexidade: ${COMPLEXITY[r.complexity.level]}. ${r.complexity.reasoning}_`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Copies rich text (Azure DevOps keeps the formatting on paste) with plain text as the fallback */
async function copyHtml(html: string, plain: string) {
  try {
    if (typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })])
      return
    }
  } catch {
    // fall back to plain text
  }
  await copy(plain)
}

export function RefineCardPage() {
  const { id = '', cardId = '' } = useParams()
  const navigate = useNavigate()
  const [card, setCard] = useState<Card | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'card' | 'chat'>('card')
  const [gitOpen, setGitOpen] = useState(false)
  const [notice, setNotice] = useState('')

  const load = useCallback(
    () =>
      api
        .get<Card>(`/workspaces/${id}/refine/cards/${cardId}`)
        .then((c) => {
          setCard(c)
          setError('')
        })
        .catch((e) => setError((e as Error).message)),
    [id, cardId],
  )
  useEffect(() => {
    setCard(null)
    load()
  }, [load])
  const live = !!card && (!!card.busy || card.dev?.status === 'executando')
  useEffect(() => {
    if (!live) return
    const t = window.setInterval(load, 2000)
    return () => window.clearInterval(t)
  }, [live, load])
  // with no refined card yet, the conversation is the place to be
  const first = useRef(true)
  useEffect(() => {
    if (card && first.current) {
      first.current = false
      if (!card.refinement) setTab('chat')
    }
  }, [card])

  const flash = (text: string) => {
    setNotice(text)
    window.setTimeout(() => setNotice(''), 2500)
  }

  if (error && !card) return <div className="sf-page"><div className="sf-callout red">{error}</div></div>
  if (!card) return <div className="sf-page"><span className="sf-spinner" /></div>

  const r = card.refinement
  const running = card.dev?.status === 'executando'

  const generate = async () => {
    setError('')
    setCard({ ...card, busy: 'refinando' })
    try {
      setCard(await api.post<Card>(`/workspaces/${id}/refine/cards/${cardId}/refine`))
      setTab('card')
    } catch (e) {
      setError((e as Error).message)
      load()
    }
  }

  const develop = async () => {
    if (!card.git) return
    if (!window.confirm(`O Claude vai implementar o plano no worktree ${card.git.path} (branch ${card.git.branch}), editando arquivos, rodando comandos e fazendo um commit no final (sem push). Começar?`)) return
    setError('')
    try {
      setCard(await api.post<Card>(`/workspaces/${id}/refine/cards/${cardId}/develop`))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const stop = async () => {
    if (!window.confirm('Parar o Claude? O que ele já alterou fica no worktree.')) return
    await api.post(`/workspaces/${id}/refine/cards/${cardId}/cancel`).catch((e) => setError((e as Error).message))
    load()
  }

  const remove = async () => {
    if (!window.confirm(`Excluir o card "${card.title}"? A branch e o worktree, se houver, continuam no Git.`)) return
    try {
      await api.del(`/workspaces/${id}/refine/cards/${cardId}`)
      navigate(`/w/${id}/refinamento`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="sf-page sf-refine">
      <div className="sf-row" style={{ marginBottom: 8 }}>
        <Link to={`/w/${id}/refinamento`} className="sf-link" style={{ fontSize: 13 }}>
          ← Refinamento
        </Link>
        {card.parentId && (
          <Link to={`/w/${id}/refinamento/${card.parentId}`} className="sf-link" style={{ fontSize: 13 }}>
            · demanda original
          </Link>
        )}
      </div>
      <div className="sf-page-head">
        <div className="sf-page-title">
          <h1 style={{ fontSize: 22 }}>{card.title}</h1>
          <p className="sf-row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className={`sf-badge ${STATUS[card.status].tone}`}>{STATUS[card.status].label}</span>
            {r && <span className="sf-badge">complexidade {COMPLEXITY[r.complexity.level]}</span>}
            {card.git && <span className="sf-badge sf-mono">⎇ {card.git.branch}</span>}
          </p>
        </div>
        <div className="sf-row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="sf-btn small" onClick={remove} disabled={running}>
            Excluir
          </button>
        </div>
      </div>

      {error && <div className="sf-callout red" style={{ marginBottom: 12 }}>{error}</div>}
      {card.error && !error && <div className="sf-callout red" style={{ marginBottom: 12 }}>{card.error}</div>}
      {notice && <div className="sf-callout green" style={{ marginBottom: 12 }}>{notice}</div>}

      <DevPanel card={card} workspaceId={id} onPrepare={() => setGitOpen(true)} onDevelop={develop} onStop={stop} />

      {(card.attached?.length ?? 0) > 0 && (
        <div className="sf-card sf-card-attached">
          <h3>Diagramas anexados</h3>
          <span className="sub">Entram como contexto quando o Claude conversa e refina esta tarefa. Peça ao assistente (✦) para anexar outros.</span>
          {card.attached!.map((a) => (
            <div key={a.refId} className="sf-ui-block">
              <span>⬡</span>
              <Link className="sf-link" style={{ flex: 1 }} to={`/w/${id}/diagrams?diagram=${encodeURIComponent(a.refId)}`}>
                {a.title}
              </Link>
              <span className="sf-faint" style={{ fontSize: 11.5 }}>
                por {a.by} · {new Date(a.at).toLocaleDateString('pt-BR')}
              </span>
              <button
                className="sf-ui-mini"
                title="Remover da tarefa (o diagrama continua em Diagramas)"
                onClick={() =>
                  api
                    .del<Card>(`/workspaces/${id}/refine/cards/${cardId}/attached/${encodeURIComponent(a.refId)}`)
                    .then(setCard)
                    .catch((e) => setError((e as Error).message))
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {card.childIds?.length ? <Children workspaceId={id} ids={card.childIds} /> : null}

      <div className="sf-tabs" style={{ margin: '14px 0 10px' }}>
        <button className={`sf-tab ${tab === 'card' ? 'on' : ''}`} onClick={() => setTab('card')}>
          Card refinado
        </button>
        <button className={`sf-tab ${tab === 'chat' ? 'on' : ''}`} onClick={() => setTab('chat')}>
          Conversa ({card.messages.length})
        </button>
      </div>

      {tab === 'chat' && <Chat workspaceId={id} card={card} setCard={setCard} onGenerate={generate} />}
      {tab === 'card' &&
        (r ? (
          <RefinedCard workspaceId={id} card={card} setCard={setCard} onCopied={flash} onRegenerate={generate} />
        ) : (
          <div className="sf-card" style={{ padding: 20 }}>
            {card.busy ? (
              <span>
                <span className="sf-spinner" /> O Claude está {card.busy}…
              </span>
            ) : (
              <>
                <p style={{ marginTop: 0 }}>O card ainda não foi gerado. Converse com o Claude até a demanda ficar clara e então gere o card.</p>
                <button className="sf-btn accent" onClick={generate} disabled={card.messages.length < 2}>
                  Gerar card refinado
                </button>
              </>
            )}
          </div>
        ))}

      {gitOpen && (
        <PrepareGit
          workspaceId={id}
          card={card}
          onClose={() => setGitOpen(false)}
          onDone={(c) => {
            setGitOpen(false)
            setCard(c)
            flash(`Branch ${c.git?.branch} pronta em ${c.git?.path}.`)
          }}
        />
      )}
    </div>
  )
}

function Children({ workspaceId, ids }: { workspaceId: string; ids: string[] }) {
  const [cards, setCards] = useState<CardSummary[]>([])
  useEffect(() => {
    const load = () =>
      api
        .get<CardSummary[]>(`/workspaces/${workspaceId}/refine/cards`)
        .then((all) => setCards(all.filter((c) => ids.includes(c.id))))
        .catch(() => undefined)
    load()
    const t = window.setInterval(load, 3000)
    return () => window.clearInterval(t)
  }, [workspaceId, ids])
  return (
    <div className="sf-card" style={{ padding: 14, marginTop: 12 }}>
      <div className="sf-section-title" style={{ marginTop: 0 }}>
        Tarefas desta demanda
      </div>
      {cards.map((c) => (
        <Link key={c.id} to={`/w/${workspaceId}/refinamento/${c.id}`} className="sf-row sf-refine-child">
          <span style={{ flex: 1 }}>{c.title}</span>
          {c.busy && (
            <span className="sf-faint" style={{ fontSize: 12 }}>
              <span className="sf-spinner" /> {c.busy}
            </span>
          )}
          {c.dev && <span style={{ fontSize: 12 }}>{c.dev.progress}%</span>}
          <span className={`sf-badge ${STATUS[c.status].tone}`}>{STATUS[c.status].label}</span>
        </Link>
      ))}
    </div>
  )
}

/** Branch, worktree and the development by Claude: where it is, how far it got, what it is doing */
function DevPanel({ card, workspaceId, onPrepare, onDevelop, onStop }: { card: Card; workspaceId: string; onPrepare: () => void; onDevelop: () => void; onStop: () => void }) {
  if (!card.refinement || card.status === 'dividido') return null
  const dev = card.dev
  const running = dev?.status === 'executando'
  return (
    <div className={`sf-card sf-devpanel ${running ? 'is-live' : ''}`}>
      <div className="sf-row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="sf-section-title" style={{ marginTop: 0 }}>
            Desenvolvimento
          </div>
          {card.git ? (
            <div style={{ fontSize: 13 }}>
              <div>
                Branch <span className="sf-mono">{card.git.branch}</span>
                {card.git.base && (
                  <span className="sf-faint">
                    {' '}
                    (a partir de <span className="sf-mono">{card.git.base}</span>)
                  </span>
                )}
              </div>
              <div className="sf-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="sf-mono sf-faint" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>
                  {card.git.path}
                </span>
                <button className="sf-link" style={{ fontSize: 12 }} onClick={() => copy(`cd "${card.git!.path}"`)}>
                  Copiar cd
                </button>
                <Link className="sf-link" style={{ fontSize: 12 }} to={`/w/${workspaceId}/git?branch=${encodeURIComponent(card.git.branch)}`}>
                  Ver no Git →
                </Link>
                <Link className="sf-link" style={{ fontSize: 12 }} to={`/w/${workspaceId}/ask?card=${card.id}`}>
                  ✦ Perguntar sobre esta tarefa →
                </Link>
                {isSfcc(workspaceId) && !running && (
                  <Link className="sf-link" style={{ fontSize: 12 }} to={`/w/${workspaceId}/sfcc/upload?card=${card.id}`}>
                    ⇪ Enviar para a sandbox →
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <div className="sf-faint" style={{ fontSize: 13 }}>
              Antes de desenvolver, escolha a branch da tarefa. Ela ganha um worktree próprio ao lado do projeto, então várias tarefas podem andar em paralelo.
            </div>
          )}
        </div>
        <div className="sf-row" style={{ gap: 8 }}>
          {!running && (
            <button className="sf-btn small" onClick={onPrepare}>
              {card.git ? 'Trocar branch' : '⎇ Preparar git'}
            </button>
          )}
          {running ? (
            <button className="sf-btn small" style={{ color: 'var(--sf-red)' }} onClick={onStop}>
              ■ Parar
            </button>
          ) : (
            <button className="sf-btn small accent" onClick={onDevelop} disabled={!card.git}>
              ▶ {dev ? 'Desenvolver de novo' : 'Iniciar desenvolvimento com o Claude'}
            </button>
          )}
        </div>
      </div>

      {dev && (
        <div style={{ marginTop: 12 }}>
          <DevProgress dev={dev} />
          <SkillUses skills={dev.skills} compact />
          <ol className="sf-dev-plan">
            {card.refinement.plan.map((p, i) => (
              <li key={i} className={i < dev.done ? 'done' : running && i === dev.done ? 'current' : ''}>
                {i < dev.done ? '✓' : running && i === dev.done ? <span className="sf-spinner" /> : '○'} {p}
              </li>
            ))}
          </ol>
          {dev.error && <div className="sf-callout red" style={{ fontSize: 12.5 }}>{dev.error}</div>}
          {dev.summary && (
            <div className="sf-card" style={{ padding: 12, marginTop: 8 }}>
              <div className="sf-section-title" style={{ marginTop: 0 }}>
                Resumo do Claude
              </div>
              <Markdown text={dev.summary} />
            </div>
          )}
          {dev.activity.length > 0 && (
            <details open={running} style={{ marginTop: 8 }}>
              <summary className="sf-faint" style={{ fontSize: 12.5, cursor: 'pointer' }}>
                Atividade ({dev.activity.length})
              </summary>
              <div className="sf-dev-log">
                {dev.activity
                  .slice()
                  .reverse()
                  .map((a, i) => (
                    <div key={i}>
                      <span className="sf-faint">{new Date(a.at).toLocaleTimeString('pt-BR')}</span> {a.text}
                    </div>
                  ))}
              </div>
            </details>
          )}
          <div className="sf-faint" style={{ fontSize: 11.5, marginTop: 6 }}>
            Iniciado {ago(dev.startedAt)}
            {dev.finishedAt ? ` · terminou ${ago(dev.finishedAt)}` : ''}
            {dev.costUsd !== undefined ? ` · custo US$ ${dev.costUsd.toFixed(2)}` : ''}
          </div>
        </div>
      )}
    </div>
  )
}

function Chat({ workspaceId, card, setCard, onGenerate }: { workspaceId: string; card: Card; setCard: (c: Card) => void; onGenerate: () => void }) {
  const [text, setText] = useState('')
  const att = useAttachments(workspaceId)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [card.messages.length, sending])

  const send = async () => {
    setSending(true)
    setError('')
    const pending = { role: 'user' as const, content: text, at: new Date().toISOString(), attachments: att.items }
    setCard({ ...card, messages: [...card.messages, pending] })
    try {
      const c = await api.post<Card>(`/workspaces/${workspaceId}/refine/cards/${card.id}/messages`, { message: text, attachments: att.items })
      setCard(c)
      setText('')
      att.clear()
    } catch (e) {
      setError((e as Error).message)
      setCard(card)
    } finally {
      setSending(false)
    }
  }

  const busy = sending || !!card.busy
  return (
    <div className="sf-card" style={{ padding: 14 }}>
      <div className="sf-refine-chat">
        {card.messages.map((m, i) => (
          <div key={i} className={`sf-refine-msg ${m.role}`}>
            <div className="sf-faint" style={{ fontSize: 11 }}>
              {m.role === 'user' ? 'Você' : 'Claude'} · {ago(m.at)}
            </div>
            {m.role === 'assistant' && <SkillUses skills={m.skills} />}
            {m.role === 'assistant' ? <Markdown text={m.content} /> : <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>}
            {m.attachments?.length ? (
              <div className="sf-attach">
                {m.attachments.map((a) => (
                  <a key={a.id} className="sf-attach-thumb" href={attachmentUrl(workspaceId, a.id)} target="_blank" rel="noreferrer" title={a.name}>
                    <img src={attachmentUrl(workspaceId, a.id)} alt={a.name} />
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {busy && (
          <div className="sf-refine-msg assistant">
            <span className="sf-spinner" /> O Claude está {card.busy ?? 'lendo o código'}…
          </div>
        )}
        <div ref={end} />
      </div>
      <textarea
        className="sf-input"
        rows={4}
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onPaste={att.onPaste}
        onDrop={att.onDrop}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim().length >= 2) void send()
        }}
        placeholder="Responda as perguntas, corrija o entendimento, acrescente regras… (Ctrl+Enter envia)"
      />
      <AttachmentStrip workspaceId={workspaceId} att={att} disabled={busy} />
      {error && <div className="sf-callout red" style={{ fontSize: 12.5 }}>{error}</div>}
      <div className="sf-row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <button className="sf-btn" onClick={send} disabled={busy || att.uploading > 0 || (text.trim().length < 2 && att.items.length === 0)}>
          Enviar
        </button>
        <button className="sf-btn accent" onClick={onGenerate} disabled={busy || card.messages.length < 2}>
          {card.refinement ? 'Gerar o card de novo' : 'Gerar card refinado'}
        </button>
      </div>
    </div>
  )
}

/** One list field of the card, editable as one item per line */
/** "Para quem vem do Adobe": each SFCC idea the solution uses, next to what it would be in Adobe Commerce */
function LearningGuide({ items }: { items: LearningItem[] }) {
  return (
    <section className="sf-refine-field">
      <h3>🎓 Para quem vem do Adobe</h3>
      <div className="sf-faint" style={{ fontSize: 11.5, marginBottom: 8 }}>Os conceitos de Salesforce B2C que esta solução usa, comparados com o Adobe Commerce. Vai na cópia em Markdown; não vai para o Jira nem para o Azure DevOps.</div>
      <div className="sf-learning">
        {items.map((l, i) => (
          <div key={i} className="sf-learning-item">
            <strong>{l.topic}</strong>
            <div className="sf-learning-map">
              <div>
                <span>No Adobe Commerce</span>
                {l.adobe}
              </div>
              <div>
                <span>No Salesforce B2C</span>
                {l.sfcc}
              </div>
            </div>
            {l.why && <div className="sf-learning-why">{l.why}</div>}
            {l.docs.length > 0 && (
              <div className="sf-learning-docs">
                {l.docs.map((d) => (
                  <a key={d.url} href={d.url} target="_blank" rel="noreferrer noopener">
                    {d.title} ↗
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function ListField({ title, items, ordered = false, editing, value, onChange }: { title: string; items: string[]; ordered?: boolean; editing: boolean; value: string; onChange: (v: string) => void }) {
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <section className="sf-refine-field">
      <h3>{title}</h3>
      {editing ? (
        <>
          <textarea className="sf-input" rows={Math.max(4, items.length + 1)} value={value} onChange={(e) => onChange(e.target.value)} />
          <div className="sf-faint" style={{ fontSize: 11.5 }}>Um item por linha.</div>
        </>
      ) : items.length ? (
        <Tag>
          {items.map((i, k) => (
            <li key={k}>{i}</li>
          ))}
        </Tag>
      ) : (
        <div className="sf-faint">—</div>
      )}
    </section>
  )
}

function RefinedCard({ workspaceId, card, setCard, onCopied, onRegenerate }: { workspaceId: string; card: Card; setCard: (c: Card) => void; onCopied: (t: string) => void; onRegenerate: () => void }) {
  const r = card.refinement!
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ title: '', business: '', technical: '', plan: '', acceptance: '', observations: '', platformSteps: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [splitOpen, setSplitOpen] = useState(false)

  const startEdit = () => {
    setDraft({ title: card.title, business: r.business, technical: r.technical, plan: r.plan.join('\n'), acceptance: r.acceptance.join('\n'), observations: r.observations.join('\n'), platformSteps: (r.platformSteps ?? []).join('\n') })
    setEditing(true)
  }
  const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean)
  const save = async () => {
    setSaving(true)
    setError('')
    try {
      setCard(
        await api.put<Card>(`/workspaces/${workspaceId}/refine/cards/${card.id}`, {
          title: draft.title,
          business: draft.business,
          technical: draft.technical,
          plan: lines(draft.plan),
          acceptance: lines(draft.acceptance),
          observations: lines(draft.observations),
          ...(r.platformSteps ? { platformSteps: lines(draft.platformSteps) } : {}),
        }),
      )
      setEditing(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const running = card.dev?.status === 'executando'
  const canSplit = card.status !== 'dividido' && !card.parentId && !card.git

  return (
    <div className="sf-card sf-refine-doc">
      <div className="sf-row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <div className="sf-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="sf-faint" style={{ fontSize: 12 }}>Copiar para:</span>
          <button className="sf-btn small" onClick={() => copy(exportCard(card, 'md')).then(() => onCopied('Card copiado em Markdown.'))}>
            Markdown
          </button>
          <button className="sf-btn small" onClick={() => copy(exportCard(card, 'jira')).then(() => onCopied('Card copiado no formato do Jira: cole na descrição da tarefa.'))}>
            Jira
          </button>
          <button
            className="sf-btn small"
            onClick={() => copyHtml(exportCard(card, 'ado'), exportCard(card, 'md')).then(() => onCopied('Card copiado para o Azure DevOps: cole na descrição do work item, a formatação vem junto.'))}
          >
            Azure DevOps
          </button>
        </div>
        <div className="sf-row" style={{ gap: 6 }}>
          {editing ? (
            <>
              <button className="sf-btn small" onClick={() => setEditing(false)} disabled={saving}>
                Cancelar
              </button>
              <button className="sf-btn small accent" onClick={save} disabled={saving}>
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </>
          ) : (
            <>
              <button className="sf-btn small" onClick={onRegenerate} disabled={!!card.busy || running}>
                {card.busy === 'refinando' ? 'Gerando…' : 'Gerar de novo'}
              </button>
              <button className="sf-btn small" onClick={startEdit} disabled={running}>
                ✎ Editar
              </button>
            </>
          )}
        </div>
      </div>
      {error && <div className="sf-callout red" style={{ fontSize: 12.5 }}>{error}</div>}

      {editing && (
        <section className="sf-refine-field">
          <h3>Título</h3>
          <input className="sf-input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </section>
      )}

      <section className="sf-refine-field">
        <h3>Descrição de negócio</h3>
        {editing ? <textarea className="sf-input" rows={8} value={draft.business} onChange={(e) => setDraft({ ...draft, business: e.target.value })} /> : <Markdown text={r.business} />}
      </section>

      <section className="sf-refine-field main">
        <h3>Descrição técnica</h3>
        <div className="sf-faint" style={{ fontSize: 11.5, marginBottom: 6 }}>É o que o Claude segue para desenvolver.</div>
        {editing ? <textarea className="sf-input sf-mono" rows={20} value={draft.technical} onChange={(e) => setDraft({ ...draft, technical: e.target.value })} /> : <Markdown text={r.technical} />}
      </section>

      {r.learning && r.learning.length > 0 && <LearningGuide items={r.learning} />}

      <ListField title="Plano de execução" ordered items={r.plan} editing={editing} value={draft.plan} onChange={(v) => setDraft({ ...draft, plan: v })} />
      {r.platformSteps && (
        <ListField title="Passos no Business Manager" items={r.platformSteps} editing={editing} value={draft.platformSteps} onChange={(v) => setDraft({ ...draft, platformSteps: v })} />
      )}
      <ListField title="Critérios de aceite" items={r.acceptance} editing={editing} value={draft.acceptance} onChange={(v) => setDraft({ ...draft, acceptance: v })} />
      <ListField title="Pontos de observação" items={r.observations} editing={editing} value={draft.observations} onChange={(v) => setDraft({ ...draft, observations: v })} />

      <section className="sf-refine-field">
        <h3>Complexidade: {COMPLEXITY[r.complexity.level]}</h3>
        <p style={{ marginTop: 0 }}>{r.complexity.reasoning}</p>
        {canSplit && (
          <div className={`sf-callout ${r.complexity.recommendSplit ? 'orange' : ''}`} style={{ fontSize: 13 }}>
            {r.complexity.recommendSplit ? (
              <>
                <strong>O Claude recomenda dividir em {r.complexity.splits.length} tarefas:</strong>
                <ol style={{ margin: '6px 0' }}>
                  {r.complexity.splits.map((s, i) => (
                    <li key={i}>
                      <strong>{s.title}</strong>: {s.scope}
                    </li>
                  ))}
                </ol>
                <div className="sf-row" style={{ gap: 8 }}>
                  <button className="sf-btn small accent" onClick={() => setSplitOpen(true)}>
                    Dividir…
                  </button>
                  <span className="sf-faint" style={{ fontSize: 12 }}>ou siga com uma tarefa só, preparando o git acima.</span>
                </div>
              </>
            ) : (
              <div className="sf-row" style={{ gap: 8, justifyContent: 'space-between' }}>
                <span>O Claude não vê necessidade de dividir.</span>
                <button className="sf-btn small" onClick={() => setSplitOpen(true)}>
                  Dividir mesmo assim…
                </button>
              </div>
            )}
          </div>
        )}
      </section>
      <SkillUses skills={r.skills} compact />
      <div className="sf-faint" style={{ fontSize: 11 }}>Gerado em {ago(r.generatedAt)}</div>

      {splitOpen && (
        <SplitDialog
          workspaceId={workspaceId}
          card={card}
          onClose={() => setSplitOpen(false)}
          onDone={(c) => {
            setSplitOpen(false)
            setCard(c)
          }}
        />
      )}
    </div>
  )
}

function SplitDialog({ workspaceId, card, onClose, onDone }: { workspaceId: string; card: Card; onClose: () => void; onDone: (c: Card) => void }) {
  const initial = card.refinement!.complexity.splits
  const [parts, setParts] = useState<Split[]>(initial.length >= 2 ? initial : [{ title: '', scope: '' }, { title: '', scope: '' }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (i: number, p: Partial<Split>) => setParts(parts.map((x, k) => (k === i ? { ...x, ...p } : x)))
  const valid = parts.length >= 2 && parts.every((p) => p.title.trim() && p.scope.trim())

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await api.post<{ parent: Card }>(`/workspaces/${workspaceId}/refine/cards/${card.id}/split`, { splits: parts })
      onDone(res.parent)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog title="Dividir em tarefas" onClose={onClose}>
      <p className="sf-faint" style={{ marginTop: 0, fontSize: 13 }}>
        Cada parte vira um card próprio e passa pelo mesmo refinamento, só com o seu escopo. O Claude refina uma por uma em segundo plano; acompanhe pelo quadro.
      </p>
      {parts.map((p, i) => (
        <div key={i} className="sf-card" style={{ padding: 10, marginBottom: 8 }}>
          <div className="sf-row" style={{ gap: 8 }}>
            <strong style={{ fontSize: 13 }}>{i + 1}.</strong>
            <input className="sf-input" placeholder="Título da tarefa" value={p.title} onChange={(e) => set(i, { title: e.target.value })} />
            <button className="sf-link" aria-label="Remover parte" onClick={() => setParts(parts.filter((_, k) => k !== i))} disabled={parts.length <= 2}>
              ✕
            </button>
          </div>
          <textarea className="sf-input" rows={3} placeholder="Escopo: o que entra e o que fica de fora" value={p.scope} onChange={(e) => set(i, { scope: e.target.value })} />
        </div>
      ))}
      {error && <div className="sf-callout red" style={{ fontSize: 12.5 }}>{error}</div>}
      <div className="sf-row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <button className="sf-btn small" onClick={() => setParts([...parts, { title: '', scope: '' }])} disabled={parts.length >= 6}>
          + Parte
        </button>
        <div className="sf-row" style={{ gap: 8 }}>
          <button className="sf-btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="sf-btn accent" onClick={submit} disabled={busy || !valid}>
            {busy ? 'Dividindo…' : `Dividir em ${parts.length} tarefas`}
          </button>
        </div>
      </div>
    </Dialog>
  )
}

interface GitOverviewLite {
  repo: boolean
  message?: string
  current?: string
  branches?: { name: string; worktree?: string }[]
  remoteBranches?: string[]
}

/** Suggests a branch name from the card title: feature/<slug> */
const suggestBranch = (title: string) =>
  `feature/${title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)}`

function PrepareGit({ workspaceId, card, onClose, onDone }: { workspaceId: string; card: Card; onClose: () => void; onDone: (c: Card) => void }) {
  const [ov, setOv] = useState<GitOverviewLite | null>(null)
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [name, setName] = useState(() => suggestBranch(card.title))
  const [existing, setExisting] = useState('')
  const [base, setBase] = useState('')
  const [update, setUpdate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .get<GitOverviewLite>(`/workspaces/${workspaceId}/git`)
      .then((o) => {
        setOv(o)
        const names = o.branches?.map((b) => b.name) ?? []
        setBase(['develop', 'main', 'master'].find((b) => names.includes(b)) ?? o.current ?? names[0] ?? '')
        setExisting(names.find((b) => b !== o.current) ?? names[0] ?? '')
      })
      .catch((e) => setError((e as Error).message))
  }, [workspaceId])

  const names = ov?.branches?.map((b) => b.name) ?? []
  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const body = mode === 'new' ? { mode, branch: name, base, updateBase: update } : { mode, branch: existing }
      onDone(await api.post<Card>(`/workspaces/${workspaceId}/refine/cards/${card.id}/git`, body))
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog title="Preparar git da tarefa" width={600} onClose={onClose}>
      {!ov && !error && <span className="sf-spinner" />}
      {ov && !ov.repo && (
        <div className="sf-callout orange">
          <p style={{ marginTop: 0 }}>{ov.message}</p>
          <PrereqLink workspaceId={workspaceId} section="repositorio">
            Configurar o repositório
          </PrereqLink>
        </div>
      )}
      {ov?.repo && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p className="sf-faint" style={{ margin: 0, fontSize: 13 }}>
            A tarefa ganha um worktree: uma pasta própria ao lado do projeto, já na branch escolhida. A pasta principal não muda, e outras tarefas podem rodar ao mesmo tempo.
          </p>
          <div className="sf-tabs">
            <button className={`sf-tab ${mode === 'new' ? 'on' : ''}`} onClick={() => setMode('new')}>
              Criar branch nova
            </button>
            <button className={`sf-tab ${mode === 'existing' ? 'on' : ''}`} onClick={() => setMode('existing')}>
              Usar branch existente
            </button>
          </div>
          {mode === 'new' ? (
            <>
              <label className="sf-faint" style={{ fontSize: 12.5 }}>
                Nome da branch
                <input className="sf-input sf-mono" value={name} onChange={(e) => setName(e.target.value.trim())} />
              </label>
              <label className="sf-faint" style={{ fontSize: 12.5 }}>
                Branch base
                <select className="sf-input" value={base} onChange={(e) => setBase(e.target.value)}>
                  {names.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>
              {base && <BaseCheck workspaceId={workspaceId} base={base} update={update} onUpdate={setUpdate} />}
            </>
          ) : (
            <label className="sf-faint" style={{ fontSize: 12.5 }}>
              Branch
              <select className="sf-input" value={existing} onChange={(e) => setExisting(e.target.value)}>
                {ov.branches!.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                    {b.worktree ? ' (já tem worktree)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {error && <div className="sf-callout red" style={{ fontSize: 12.5 }}>{error}</div>}
          <div className="sf-row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="sf-btn" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button className="sf-btn accent" onClick={submit} disabled={busy || (mode === 'new' ? !base || name.length < 2 || name.endsWith('/') : !existing)}>
              {busy ? 'Preparando…' : mode === 'new' ? 'Criar branch e worktree' : 'Usar esta branch'}
            </button>
          </div>
        </div>
      )}
      {error && !ov && <div className="sf-callout red">{error}</div>}
    </Dialog>
  )
}
