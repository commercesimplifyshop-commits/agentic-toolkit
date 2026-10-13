import { Marked } from 'marked'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'

interface Turn {
  role: 'user' | 'assistant'
  content: string
  at: string
}
interface Session {
  id: string
  createdAt: string
  updatedAt: string
  messages: Turn[]
}
interface SessionMeta {
  id: string
  title: string
  updatedAt: string
  turns: number
}

// Escapes raw HTML: a reply can quote files, and nothing it says may run as markup
const md = new Marked({ gfm: true, renderer: { html: ({ text }: { text: string }) => text.replace(/</g, '&lt;').replace(/>/g, '&gt;') } })

/**
 * Explore: a thinking conversation about the project, the way OpenSpec's explore mode works.
 * It reads the code, asks questions and never implements. Nothing becomes a change until
 * the user presses "Capturar como mudança" and confirms the form.
 */
export function OpenSpecExplore({
  id,
  onCapture,
  initialSession,
  onChanged,
  hideList,
}: {
  id: string
  /** Proposes a change from an answer; the conversation id tells which card to link */
  onCapture: (text: string, sid?: string) => void
  /** The board's drawer shows only the chat: the conversations are the cards */
  hideList?: boolean
  /** Opens this conversation (used by the Explorar column of the board) */
  initialSession?: string | null
  onChanged?: () => void
}) {
  const [list, setList] = useState<SessionMeta[]>([])
  const [active, setActive] = useState<Session | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  const [conn, setConn] = useState<{ ok: boolean; message: string; checkedAt: string; version?: string } | null>(null)
  const [checking, setChecking] = useState(false)

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

  useEffect(() => {
    checkConnection()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (initialSession) open(initialSession)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSession])

  const refresh = () =>
    api
      .get<SessionMeta[]>(`/workspaces/${id}/openspec/explore/sessions`)
      .then(setList)
      .catch((e) => setError(e.message))

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [active?.messages.length, busy])

  /** Propor: the last answer becomes the starting point of the change form; nothing is created here */
  const propose = async (sid: string) => {
    try {
      const s = await api.get<Session>(`/workspaces/${id}/openspec/explore/session?id=${sid}`)
      const last = [...s.messages].reverse().find((m) => m.role === 'assistant')
      if (last) onCapture(last.content)
      else setError('Esta conversa ainda não tem resposta para propor')
    } catch (e) {
      setError((e as Error).message)
    }
  }

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

  const send = async () => {
    const message = input.trim()
    if (message.length < 2 || busy) return
    setBusy(true)
    setError('')
    setInput('')
    try {
      const s = await api.post<Session>(`/workspaces/${id}/openspec/explore`, { sessionId: active?.id, message })
      setActive(s)
      refresh()
      onChanged?.()
    } catch (e) {
      setError((e as Error).message)
      setInput(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`sf-explore ${hideList ? 'single' : ''}`}>
      {!hideList && (
      <aside className="sf-explore-list">
        <button className="sf-btn accent" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setActive(null)}>
          + Nova exploração
        </button>
        <div className="sf-explore-items">
          {list.map((s) => (
            <div key={s.id} className={`sf-docs-item sf-explore-row ${active?.id === s.id ? 'on' : ''}`}>
              <span className="t">{s.title}</span>
              <span className="sf-faint" style={{ fontSize: 11 }}>
                {s.turns / 2 | 0} trocas · {new Date(s.updatedAt).toLocaleDateString('pt-BR')}
              </span>
              <div className="actions">
                <button className="sf-link" onClick={() => open(s.id)}>
                  Explorar
                </button>
                <button className="sf-link" onClick={() => propose(s.id)}>
                  Propor
                </button>
                <button className="sf-link" style={{ color: '#f87171' }} onClick={() => remove(s.id)}>
                  Excluir
                </button>
              </div>
            </div>
          ))}
          {list.length === 0 && <div className="sf-faint" style={{ fontSize: 12.5, padding: '10px 4px' }}>Nenhuma conversa ainda.</div>}
        </div>
      </aside>
      )}

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
            disabled={!active || active.messages.length < 2 || conn?.ok === false}
            title="O Claude lê toda a conversa e monta a proposta; você revisa antes de criar"
          >
            ✦ Transformar em proposta
          </button>
          <button className="sf-btn small" onClick={checkConnection} disabled={checking}>
            {checking ? 'Testando…' : 'Testar conexão'}
          </button>
        </div>
        <div className="sf-callout" style={{ fontSize: 12.5, marginBottom: 12 }}>
          <b>Modo explorar:</b> pensar, não implementar. O Claude lê o código e faz perguntas, mas não escreve nada. Quando a ideia estiver clara, use <b>Capturar como mudança</b> numa resposta: isso só abre o formulário, e a mudança é criada quando você confirmar.
        </div>

        <div className="sf-explore-thread">
          {!active && (
            <div className="sf-faint" style={{ fontSize: 13, lineHeight: 1.6, padding: '20px 4px' }}>
              Comece com uma ideia vaga ou um problema: "o checkout B2B está difícil de entender", "queremos cupom por vendedor". O Claude investiga o código e te ajuda a chegar numa proposta.
            </div>
          )}
          {active?.messages.map((m, i) => (
            <div key={i} className={`sf-explore-msg ${m.role}`}>
              <div className="who">{m.role === 'user' ? 'Você' : 'Claude'}</div>
              {m.role === 'user' ? (
                <div className="body">{m.content}</div>
              ) : (
                <>
                  <div className="sf-doc sf-doc-small" dangerouslySetInnerHTML={{ __html: md.parse(m.content) as string }} />
                  <div style={{ marginTop: 6 }}>
                    <span className="sf-faint" style={{ fontSize: 11.5 }} />
                  </div>
                </>
              )}
            </div>
          ))}
          {busy && (
            <div className="sf-explore-msg assistant">
              <div className="who">Claude</div>
              <div className="body">
                <span className="sf-spinner" /> lendo o código e pensando…
              </div>
            </div>
          )}
          <div ref={bottom} />
        </div>

        {error && <div className="sf-callout red" style={{ marginBottom: 8 }}>{error}</div>}
        <div className="sf-explore-input">
          <textarea
            className="sf-input"
            rows={2}
            value={input}
            placeholder="Escreva o que quer entender. Enter envia, Shift+Enter quebra linha."
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          <button className="sf-btn accent" onClick={send} disabled={busy || input.trim().length < 2 || conn?.ok === false}>
            Enviar
          </button>
        </div>
      </section>
    </div>
  )
}
