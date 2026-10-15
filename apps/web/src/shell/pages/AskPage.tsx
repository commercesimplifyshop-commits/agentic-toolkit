import { Fragment, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, type AskResult, type LinkedTask, type Providers } from '../api'
import { SkillUses } from '../skills'
import { useShell } from '../store'

interface Turn {
  question: string
  result?: AskResult
  error?: string
}

interface CardSummary {
  id: string
  title: string
  status: string
  git?: { branch: string }
}

const SUGGESTIONS = [
  'Quais plugins e observers rodam quando um pedido é finalizado? Em que ordem?',
  'Quais integrações com ERP ou sistemas externos existem e como os dados saem do Magento?',
  'Resuma o que foi customizado no checkout em relação ao nativo.',
  'Quais endpoints REST customizados não exigem autenticação e o que eles fazem?',
  'Onde o preço final do produto é calculado ou alterado por código customizado?',
  'Que pontos eu deveria revisar antes de um upgrade de versão do Magento?',
]

const SFCC_SUGGESTIONS = [
  'Qual a ordem do cartridge path e o que cada cartucho do projeto estende da base?',
  'Quais controllers e rotas foram customizados em relação ao SFRA?',
  'Quais serviços externos (LocalServiceRegistry) existem e quando são chamados?',
  'Quais hooks estão registrados e o que cada um faz?',
  'Quais jobs existem e o que processam?',
]

/** With a task linked, the questions people ask about it */
const TASK_SUGGESTIONS = [
  'Explique o que foi desenvolvido nesta tarefa e onde está cada mudança.',
  'Revise o código desta tarefa contra a descrição técnica e os critérios de aceite.',
  'O que falta ou pode quebrar antes de levar esta tarefa para produção?',
  'Como eu testo esta tarefa passo a passo?',
]

/** Minimal markdown: code fences, headings, lists, bold, inline code, file:line. */
function Markdown({ text }: { text: string }) {
  const blocks = text.split(/```/)
  return (
    <>
      {blocks.map((block, i) =>
        i % 2 === 1 ? (
          <pre key={i}>{block.replace(/^\w*\n/, '')}</pre>
        ) : (
          <Fragment key={i}>
            {block
              .split(/\n{2,}/)
              .filter((p) => p.trim())
              .map((p, j) => {
                const lines = p.split('\n')
                if (lines.every((l) => /^\s*([-*]|\d+\.)\s/.test(l))) {
                  return (
                    <ul key={j}>
                      {lines.map((l, k) => (
                        <li key={k}>{inline(l.replace(/^\s*([-*]|\d+\.)\s/, ''))}</li>
                      ))}
                    </ul>
                  )
                }
                const h = p.match(/^#{1,4}\s+(.*)/)
                if (h) return <h4 key={j}>{inline(h[1])}</h4>
                return <p key={j}>{lines.map((l, k) => <Fragment key={k}>{k > 0 && <br />}{inline(l)}</Fragment>)}</p>
              })}
          </Fragment>
        ),
      )}
    </>
  )
}

function inline(text: string) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((part, i) =>
    part.startsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  )
}

export function AskPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const [providers, setProviders] = useState<Providers | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [cards, setCards] = useState<CardSummary[]>([])
  const [linked, setLinked] = useState<LinkedTask[]>([])
  const [picking, setPicking] = useState(false)
  const log = useRef<HTMLDivElement>(null)
  const sfcc = useShell((s) => s.workspaces.find((w) => w.id === id)?.tech === 'salesforce-b2c')

  useEffect(() => {
    api.get<Providers>('/ai/providers').then(setProviders).catch(() => undefined)
  }, [])
  // the tasks of the Refinement, to link one to the conversation; ?card=<id> comes linked
  useEffect(() => {
    api
      .get<CardSummary[]>(`/workspaces/${id}/refine/cards`)
      .then((list) => {
        setCards(list)
        const preset = params.get('card')
        const c = preset && list.find((x) => x.id === preset)
        if (c) setLinked([{ id: c.id, title: c.title, status: c.status, branch: c.git?.branch }])
      })
      .catch(() => setCards([]))
  }, [id, params])
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' })
  }, [turns])

  const active = providers?.providers.find((p) => p.id === providers.active)

  const ask = async (question: string) => {
    if (!question.trim() || busy) return
    setInput('')
    setBusy(true)
    const history = turns.filter((t) => t.result).map((t) => ({ question: t.question, answer: t.result!.answer }))
    setTurns((t) => [...t, { question }])
    try {
      const result = await api.post<AskResult>(`/workspaces/${id}/ask`, { question, cards: linked.map((c) => c.id), history })
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, result } : x)))
      // a task cited by link or id in the question stays linked for the next ones
      const found = (result.tasks ?? []).filter((c) => !linked.some((l) => l.id === c.id))
      if (found.length) setLinked((l) => [...l, ...found].slice(0, 5))
    } catch (e) {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: (e as Error).message } : x)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sf-chat">
      <div className="sf-chat-log" ref={log}>
        <div className="sf-row" style={{ gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 22, flex: 1 }}>Pergunte ao código</h1>
          {active && (
            <span className={`sf-badge ${active.available ? 'green' : 'red'}`} title={active.detail}>
              {active.name}
              {providers?.active === 'anthropic' ? ` · ${providers.settings.anthropic.model}` : ''}
            </span>
          )}
          <Link className="sf-btn small" to={`/w/${id}/settings`}>
            Trocar provedor
          </Link>
        </div>
        <div className="sf-callout green" style={{ maxWidth: 860 }}>
          A IA lê o código desta instalação com ferramentas somente leitura (listar pastas, ler arquivos, buscar, consultar o mapa). Ela não consegue editar, rodar comandos ou acessar
          arquivos de credenciais. Ela também conhece as tarefas do Refinamento: vincule uma, cole o link do card ou peça para buscar pelo nome. Com o Claude Code, ela lê o código
          desenvolvido no worktree da tarefa vinculada. A conversa leva as últimas perguntas como contexto.
        </div>
        {active && !active.available && (
          <div className="sf-callout red" style={{ maxWidth: 860 }}>
            {active.detail} Configure em <Link to={`/w/${id}/settings`}>Configurações</Link>.
          </div>
        )}
        {turns.length === 0 && (
          <div className="sf-chips" style={{ maxWidth: 860 }}>
            {(linked.length ? TASK_SUGGESTIONS : sfcc ? SFCC_SUGGESTIONS : SUGGESTIONS).map((s) => (
              <button key={s} className="sf-chip" style={{ textAlign: 'left' }} onClick={() => ask(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (
          <Fragment key={i}>
            <div className="sf-msg user">{t.question}</div>
            <div className="sf-msg bot">
              {t.result ? (
                <>
                  <SkillUses skills={t.result.skills} />
                  {t.result.tasks && t.result.tasks.length > 0 && (
                    <div className="sf-ask-tasks">
                      Tarefas consideradas:{' '}
                      {t.result.tasks.map((c) => (
                        <Link key={c.id} to={`/w/${id}/refinamento/${c.id}`} className="sf-ask-task">
                          ✓ {c.title}
                        </Link>
                      ))}
                    </div>
                  )}
                  <Markdown text={t.result.answer} />
                  <div className="sf-msg-meta">
                    {t.result.provider}
                    {t.result.model ? ` · ${t.result.model}` : ''}
                    {t.result.toolCalls.length ? ` · ${t.result.toolCalls.length} leituras no código` : ''}
                    {t.result.stopReason ? ` · ${t.result.stopReason}` : ''}
                  </div>
                  {t.result.toolCalls.length > 0 && (
                    <details className="sf-help">
                      <summary>O que a IA leu</summary>
                      <ol>
                        {t.result.toolCalls.map((c, k) => (
                          <li key={k} className="sf-mono">
                            {c.name} {JSON.stringify(c.input)}
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </>
              ) : t.error ? (
                <div className="sf-error">{t.error}</div>
              ) : (
                <span className="sf-muted">
                  <span className="sf-spinner" /> lendo o código…
                </span>
              )}
            </div>
          </Fragment>
        ))}
      </div>
      <div className="sf-chat-input">
        <div className="sf-ask-linkbar">
          {linked.map((c) => (
            <span key={c.id} className="sf-ask-chip" title={c.branch ? `branch ${c.branch}` : c.status}>
              <Link to={`/w/${id}/refinamento/${c.id}`}>✓ {c.title}</Link>
              <button aria-label={`Desvincular ${c.title}`} onClick={() => setLinked((l) => l.filter((x) => x.id !== c.id))}>
                ×
              </button>
            </span>
          ))}
          {linked.length < 5 && cards.length > 0 && (
            <span style={{ position: 'relative' }}>
              <button className="sf-link" style={{ fontSize: 12.5 }} onClick={() => setPicking((p) => !p)}>
                + Vincular tarefa do Refinamento
              </button>
              {picking && (
                <div className="sf-ask-picker">
                  {cards
                    .filter((c) => !linked.some((l) => l.id === c.id))
                    .map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setLinked((l) => [...l, { id: c.id, title: c.title, status: c.status, branch: c.git?.branch }])
                          setPicking(false)
                        }}
                      >
                        <strong>{c.title}</strong>
                        <span className="sf-faint">
                          {' '}
                          · {c.status}
                          {c.git ? ` · ${c.git.branch}` : ''}
                        </span>
                      </button>
                    ))}
                </div>
              )}
            </span>
          )}
          {linked.length === 0 && (
            <span className="sf-faint" style={{ fontSize: 12 }}>
              ou cole o link de um card do Refinamento na pergunta, ou peça para o Claude buscar a tarefa pelo nome.
            </span>
          )}
        </div>
        <textarea
          placeholder={linked.length ? 'Pergunte sobre a tarefa vinculada ou sobre o código (Enter envia, Shift+Enter quebra linha)' : 'Ex.: o que acontece quando um boleto expira? (Enter envia, Shift+Enter quebra linha)'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              ask(input)
            }
          }}
        />
      </div>
    </div>
  )
}
