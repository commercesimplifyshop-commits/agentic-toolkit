import { Marked } from 'marked'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { AttachmentStrip, attachmentUrl, useAttachments, type Attached } from './OpenSpecPropose'

interface Turn {
  role: 'user' | 'assistant'
  content: string
  at: string
  attachments?: Attached[]
}
interface Session {
  id: string
  createdAt: string
  updatedAt: string
  messages: Turn[]
  linkedChange?: string
}
interface SessionMeta {
  id: string
  title: string
  updatedAt: string
  turns: number
  linkedChange: string | null
}

// Escapes raw HTML: a reply can quote files, and nothing it says may run as markup
const md = new Marked({ gfm: true, renderer: { html: ({ text }: { text: string }) => text.replace(/</g, '&lt;').replace(/>/g, '&gt;') } })

/**
 * Explore: the conversation where a task is refined with Claude, the way OpenSpec's explore mode
 * works. Claude reads the code (and the attached images), asks what is missing, and never writes.
 * "Transformar em proposta" turns the conversation into a complete change to review.
 */
export function OpenSpecExplore({
  id,
  onCapture,
  initialSession,
  startWith,
  onChanged,
}: {
  id: string
  /** Turns a conversation into a proposal: the page drafts the complete change for review */
  onCapture: (text: string, sid?: string) => void
  /** Opens this conversation */
  initialSession?: string | null
  /** A new conversation that starts with this message (from "Nova mudança") */
  startWith?: { message: string; attachments: Attached[] } | null
  onChanged?: () => void
}) {
  const [list, setList] = useState<SessionMeta[]>([])
  const [active, setActive] = useState<Session | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  /** The message being sent, shown at once while Claude answers */
  const [pending, setPending] = useState<{ message: string; attachments: Attached[] } | null>(null)
  const [error, setError] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  const [conn, setConn] = useState<{ ok: boolean; message: string; checkedAt: string; version?: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const att = useAttachments(id)
  const started = useRef(false)

  /** Connection check shown in the chat header: binary answers, and a one-word question gets an answer */
  const checkConnection = async () => {
    setChecking(true)
    try {
      setConn(await api.get(`/workspaces/${id}/openspec/explore/connection`))
    } catch (e) {
      setConn({ ok: false, message: (e as Error).message, checkedAt: new Date().toISOString() })
    } finally {
      setChecking(false)
    }
  }

  const refresh = () =>
    api
      .get<SessionMeta[]>(`/workspaces/${id}/openspec/explore/sessions`)
      .then(setList)
      .catch((e) => setError(e.message))

  useEffect(() => {
    checkConnection()
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (initialSession) open(initialSession)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSession])

  // "Nova mudança" opens the chat with the task already written: it is sent once, right away
  useEffect(() => {
    if (!startWith || started.current) return
    started.current = true
    void post(startWith.message, startWith.attachments, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startWith])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [active?.messages.length, pending])

  /** Removes only Agentic Toolkit's copy of the conversation */
  const remove = async (sid: string) => {
    if (!confirm('Excluir esta conversa de exploração? O histórico guardado no Agentic Toolkit será apagado.')) return
    try {
      await api.del(`/workspaces/${id}/openspec/explore/session?id=${sid}`)
      if (active?.id === sid) setActive(null)
      refresh()
      onChanged?.()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const open = async (sid: string) => {
    setError('')
    try {
      setActive(await api.get<Session>(`/workspaces/${id}/openspec/explore/session?id=${sid}`))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const post = async (message: string, attachments: Attached[], sessionId: string | null) => {
    setBusy(true)
    setError('')
    setPending({ message, attachments })
    try {
      const s = await api.post<Session>(`/workspaces/${id}/openspec/explore`, { sessionId: sessionId ?? undefined, message, attachments })
      setActive(s)
      refresh()
      onChanged?.()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setPending(null)
      setBusy(false)
    }
  }

  const send = async () => {
    const message = input.trim()
    if ((message.length < 2 && !att.items.length) || busy || att.uploading) return
    const attachments = att.items
    setInput('')
    att.clear()
    const ok = await post(message, attachments, active?.id ?? null)
    if (!ok) setInput(message)
  }

  return (
    <div className="sf-explore">
      <aside className="sf-explore-list">
        <button className="sf-btn accent" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setActive(null)} disabled={busy}>
          + Nova exploração
        </button>
        <div className="sf-explore-items">
          {list.map((s) => (
            <div key={s.id} className={`sf-docs-item sf-explore-row ${active?.id === s.id ? 'on' : ''}`}>
              <span className="t">{s.title}</span>
              <span className="sf-faint" style={{ fontSize: 11 }}>
                {(s.turns / 2) | 0} trocas · {new Date(s.updatedAt).toLocaleDateString('pt-BR')}
                {s.linkedChange ? ` · virou ${s.linkedChange}` : ''}
              </span>
              <div className="actions">
                <button className="sf-link" onClick={() => open(s.id)} disabled={busy}>
                  Continuar
                </button>
                <button className="sf-link" onClick={() => onCapture('', s.id)} disabled={busy || s.turns < 2}>
                  Transformar em proposta
                </button>
                <button className="sf-link" style={{ color: '#f87171' }} onClick={() => remove(s.id)} disabled={busy}>
                  Excluir
                </button>
              </div>
            </div>
          ))}
          {list.length === 0 && <div className="sf-faint" style={{ fontSize: 12.5, padding: '10px 4px' }}>Nenhuma conversa ainda.</div>}
        </div>
      </aside>

      <section className="sf-explore-main">
        <div className="sf-explore-head">
          {checking && !conn && <span className="sf-badge">Verificando conexão…</span>}
          {conn && (
            <span className={`sf-badge ${conn.ok ? 'green' : 'red'}`} title={conn.message}>
              {conn.ok ? '● Conectado' : '● Falha na conexão'}
            </span>
          )}
          {conn && <span className="sf-faint" style={{ fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conn.message}</span>}
          <span style={{ flex: 1 }} />
          <button
            className="sf-btn small accent"
            onClick={() => active && onCapture('', active.id)}
            disabled={!active || active.messages.length < 2 || busy || conn?.ok === false}
            title="O Claude lê toda a conversa e escreve a mudança completa; você revisa antes de criar"
          >
            ✦ Transformar em proposta
          </button>
          <button className="sf-btn small" onClick={checkConnection} disabled={checking}>
            {checking ? 'Testando…' : 'Testar conexão'}
          </button>
        </div>
        <div className="sf-callout" style={{ fontSize: 12.5, marginBottom: 12 }}>
          <b>Refinar a tarefa:</b> o Claude lê o código e as imagens, aponta o que falta decidir e propõe critérios de aceite. Ele não escreve nada no projeto. Quando o refinamento estiver claro, use <b>Transformar em proposta</b>: ele escreve a mudança completa (proposta, tarefas e specs) para você revisar antes de criar.
        </div>

        <div className="sf-explore-thread">
          {!active && !pending && (
            <div className="sf-faint" style={{ fontSize: 13, lineHeight: 1.6, padding: '20px 4px' }}>
              Cole a tarefa como ela chegou (texto do ticket, prints) ou comece com uma dúvida: "o checkout B2B está difícil de entender", "queremos frete na página de produto". O Claude investiga o código e refina com você.
            </div>
          )}
          {active?.messages.map((m, i) => (
            <Message key={i} workspaceId={id} turn={m} />
          ))}
          {pending && (
            <>
              <Message workspaceId={id} turn={{ role: 'user', content: pending.message, at: '', attachments: pending.attachments }} />
              <div className="sf-explore-msg assistant">
                <div className="who">Claude</div>
                <div className="body">
                  <span className="sf-spinner" /> lendo o código{pending.attachments.length ? ' e as imagens' : ''} e pensando…
                </div>
              </div>
            </>
          )}
          <div ref={bottom} />
        </div>

        {error && <div className="sf-callout red" style={{ marginBottom: 8 }}>{error}</div>}
        <div className="sf-explore-compose" onDragOver={(e) => e.preventDefault()} onDrop={att.onDrop}>
          <div className="sf-explore-input">
            <textarea
              className="sf-input"
              rows={3}
              value={input}
              placeholder="Escreva sua resposta ou dúvida. Enter envia, Shift+Enter quebra linha. Cole prints com Ctrl+V."
              disabled={busy}
              onChange={(e) => setInput(e.target.value)}
              onPaste={att.onPaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
            />
            <button className="sf-btn accent" onClick={send} disabled={busy || att.uploading > 0 || (input.trim().length < 2 && !att.items.length) || conn?.ok === false}>
              Enviar
            </button>
          </div>
          <AttachmentStrip workspaceId={id} att={att} disabled={busy} />
        </div>
      </section>
    </div>
  )
}

function Message({ workspaceId, turn }: { workspaceId: string; turn: Turn }) {
  return (
    <div className={`sf-explore-msg ${turn.role}`}>
      <div className="who">{turn.role === 'user' ? 'Você' : 'Claude'}</div>
      {turn.role === 'user' ? (
        <div className="body" style={{ whiteSpace: 'pre-wrap' }}>
          {turn.content}
        </div>
      ) : (
        <div className="sf-doc sf-doc-small" dangerouslySetInnerHTML={{ __html: md.parse(turn.content) as string }} />
      )}
      {turn.attachments && turn.attachments.length > 0 && (
        <div className="sf-attach" style={{ marginTop: 8 }}>
          {turn.attachments.map((a) => (
            <a key={a.id} className="sf-attach-thumb large" href={attachmentUrl(workspaceId, a.id)} target="_blank" rel="noreferrer" title={a.name}>
              <img src={attachmentUrl(workspaceId, a.id)} alt={a.name} />
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
