import { Fragment, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type AskResult, type Providers } from '../api'

interface Turn {
  question: string
  result?: AskResult
  error?: string
}

const SUGGESTIONS = [
  'Quais plugins e observers rodam quando um pedido é finalizado? Em que ordem?',
  'Quais integrações com ERP ou sistemas externos existem e como os dados saem do Magento?',
  'Resuma o que foi customizado no checkout em relação ao nativo.',
  'Quais endpoints REST customizados não exigem autenticação e o que eles fazem?',
  'Onde o preço final do produto é calculado ou alterado por código customizado?',
  'Que pontos eu deveria revisar antes de um upgrade de versão do Magento?',
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
  const [providers, setProviders] = useState<Providers | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const log = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.get<Providers>('/ai/providers').then(setProviders).catch(() => undefined)
  }, [])
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' })
  }, [turns])

  const active = providers?.providers.find((p) => p.id === providers.active)

  const ask = async (question: string) => {
    if (!question.trim() || busy) return
    setInput('')
    setBusy(true)
    setTurns((t) => [...t, { question }])
    try {
      const result = await api.post<AskResult>(`/workspaces/${id}/ask`, { question })
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, result } : x)))
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
          arquivos de credenciais.
        </div>
        {active && !active.available && (
          <div className="sf-callout red" style={{ maxWidth: 860 }}>
            {active.detail} Configure em <Link to={`/w/${id}/settings`}>Configurações</Link>.
          </div>
        )}
        {turns.length === 0 && (
          <div className="sf-chips" style={{ maxWidth: 860 }}>
            {SUGGESTIONS.map((s) => (
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
        <textarea
          placeholder="Ex.: o que acontece quando um boleto expira? (Enter envia, Shift+Enter quebra linha)"
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
