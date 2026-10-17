import { Marked } from 'marked'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api, waitJob } from '../api'
import { useAssistantPanel, useDevMode } from '../devmode'

interface Turn {
  message: string
  reply: string
  /** The tools it used, in order */
  steps: string[]
  error?: string
}

/** The answers come in Markdown; raw HTML in them is shown as text, never rendered (same as the Refinement) */
const md = new Marked({ gfm: true, breaks: true, renderer: { html: ({ text }: { text: string }) => text.replace(/</g, '&lt;').replace(/>/g, '&gt;') } })

/** The same tool called several times in a row becomes one line with a count */
function grouped(steps: string[]) {
  const out: { label: string; n: number }[] = []
  for (const s of steps) {
    const last = out.at(-1)
    if (last?.label === s) last.n++
    else out.push({ label: s, n: 1 })
  }
  return out
}

/** The tools the assistant used: short lists shown, long ones folded behind a summary */
function Steps({ steps, live }: { steps: string[]; live?: boolean }) {
  const groups = grouped(steps)
  const list = (
    <ul className="steps">
      {groups.map((g, j) => (
        <li key={j}>
          {live && j === groups.length - 1 ? '…' : '✓'} {g.label}
          {g.n > 1 && <span className="n"> ×{g.n}</span>}
        </li>
      ))}
    </ul>
  )
  if (live || groups.length <= 4) return list
  return (
    <details className="steps-fold">
      <summary>
        ✓ {steps.length} passos em {groups.length} etapas
      </summary>
      {list}
    </details>
  )
}

const SIZE_KEY = 'agentic-toolkit.assistantSize'
const MIN = { w: 320, h: 320 }
/** Never bigger than the window, never smaller than the minimum */
const fit = (w: number, h: number) => ({
  w: Math.round(Math.max(MIN.w, Math.min(w, window.innerWidth - 32))),
  h: Math.round(Math.max(MIN.h, Math.min(h, window.innerHeight - 110))),
})

/** The size the person dragged the panel to, kept per browser (storage may be unavailable) */
function readSize() {
  try {
    const v = JSON.parse(localStorage.getItem(SIZE_KEY) ?? 'null') as { w: number; h: number } | null
    if (v && Number.isFinite(v.w) && Number.isFinite(v.h)) return fit(v.w, v.h)
  } catch {
    // no saved size
  }
  return fit(420, 620)
}

const PROVIDER: Record<string, string> = { 'claude-code': 'Claude Code local', anthropic: 'API da Anthropic', 'openai-compatible': 'modelo compatível com OpenAI' }

/** Examples by screen: what makes sense where the person is */
/** With the developer mode on, the requests are about changing the app */
const DEV_EXAMPLES = ['Coloque os Highlights técnicos no topo', 'Renomeie "Pergunte ao código" para "Pergunte a Sophia"', 'Deixe o destaque azul e os cartões menos arredondados', 'Esconda o bloco Atividade recente']

function examples(path: string) {
  if (/\/diagrams/.test(path) && /diagram=/.test(path)) return ['Crie uma tarefa no Refinamento a partir deste diagrama', 'Explique este diagrama', 'Gere um diagrama de sequência deste fluxo']
  if (/\/refinamento\/[a-f0-9]{10}/.test(path)) return ['Crie um diagrama de sequência desta tarefa e anexe a ela', 'Refine esta tarefa', 'Quais módulos esta tarefa toca?']
  if (/\/api-client/.test(path)) return ['Preencha esta rota com um exemplo válido', 'Preencha a criação de carrinho do cliente logado']
  return ['Busque o módulo de integração com o ERP e gere um diagrama dele', 'Preencha o Simulador de API para criar um pedido', 'Desative o Fluxo 3D, eu não uso', 'Coloque o bloco Stack logo abaixo dos Highlights']
}

/**
 * The global assistant button: the AI configured in Configurações does what the person asks with the
 * toolkit's tools (the same the MCP offers): it links diagrams, tasks and the API simulator, looks
 * things up in the project and adjusts the interface. It knows the screen the person is on.
 */
export function InterfaceAssistant({ workspaceId }: { workspaceId: string }) {
  const { open, setOpen, draft } = useAssistantPanel()
  const devMode = useDevMode((s) => s.on)
  const [text, setText] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [provider, setProvider] = useState('')
  const [live, setLive] = useState<string[]>([])
  const location = useLocation()
  const end = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(readSize)

  // the panel sits in the bottom right corner: it grows by dragging its left edge, top edge or top-left corner
  const startResize = (edges: { x: boolean; y: boolean }) => (e: React.PointerEvent) => {
    e.preventDefault()
    const start = { x: e.clientX, y: e.clientY, ...size }
    let last = size
    const move = (ev: PointerEvent) => {
      last = fit(edges.x ? start.w + (start.x - ev.clientX) : start.w, edges.y ? start.h + (start.y - ev.clientY) : start.h)
      setSize(last)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('sf-resizing')
      try {
        localStorage.setItem(SIZE_KEY, JSON.stringify(last))
      } catch {
        // size just won't persist
      }
    }
    document.body.classList.add('sf-resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  // a smaller window keeps the panel inside it
  useEffect(() => {
    const onResize = () => setSize((s) => fit(s.w, s.h))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // a draft from the developer bar or a link fills the input
  useEffect(() => {
    if (draft) {
      setText(draft)
      useAssistantPanel.setState({ draft: '' })
    }
  }, [draft])
  useEffect(() => {
    if (open && !provider)
      api
        .get<{ active: string }>('/ai/providers')
        .then((p) => setProvider(PROVIDER[p.active] ?? p.active))
        .catch(() => undefined)
  }, [open, provider])
  useEffect(() => {
    // braces: scrollIntoView returns a promise in recent browsers, and an effect must not return one
    end.current?.scrollIntoView({ block: 'end' })
  }, [turns, busy, live])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+K / Cmd+K opens it from anywhere
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const send = async (message = text) => {
    if (!message.trim() || busy) return
    setBusy(true)
    setError('')
    setText('')
    setLive([])
    try {
      const { jobId } = await api.post<{ jobId: string }>('/ui/assistant', {
        message,
        history: turns.map((t) => ({ message: t.message, reply: t.reply })),
        // "this diagram", "this task": the screen the person is on
        // with the developer mode on, the request is to change the app (and only then the tools that change it are given)
        context: { workspace: workspaceId, path: `${location.pathname}${location.search}`, devMode },
      })
      const job = await waitJob(jobId, (j) => setLive(j.log.filter((l) => l.startsWith('⚙')).map((l) => l.slice(2))))
      const steps = job.log.filter((l) => l.startsWith('⚙')).map((l) => l.slice(2))
      setTurns((ts) => [...ts, { message, reply: job.status === 'done' ? String(job.result?.reply ?? 'Pronto.') : '', steps, error: job.status === 'error' ? job.error : undefined }])
    } catch (e) {
      setError((e as Error).message)
      setText(message)
    } finally {
      setBusy(false)
      setLive([])
    }
  }

  return (
    <>
      <button className={`sf-assist-fab ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} title="Assistente (Ctrl+K)" aria-label="Assistente">
        ✦<span>Assistente</span>
      </button>
      {open && (
        <div className="sf-assist" role="dialog" aria-label="Assistente" style={{ width: size.w, height: size.h }}>
          <div className="sf-assist-grip left" onPointerDown={startResize({ x: true, y: false })} title="Arraste para mudar a largura" />
          <div className="sf-assist-grip top" onPointerDown={startResize({ x: false, y: true })} title="Arraste para mudar a altura" />
          <div className="sf-assist-grip corner" onPointerDown={startResize({ x: true, y: true })} onDoubleClick={() => {
              setSize(fit(420, 620))
              try {
                localStorage.removeItem(SIZE_KEY)
              } catch {
                // nothing saved
              }
            }} title="Arraste para redimensionar · clique duplo volta ao tamanho padrão" />
          <div className="sf-assist-head">
            <div>
              <strong>
                Assistente do toolkit {devMode && <em className="sf-assist-dev">⚒ alterando a aplicação</em>}
              </strong>
              <span>{provider ? `Usa o ${provider}` : 'Usa a IA configurada'} · {devMode ? 'modo desenvolvedor: pedidos mudam a interface' : 'usa as funcionalidades; para alterar a aplicação, ligue o modo desenvolvedor (⚒)'}</span>
            </div>
            <button className="sf-link" onClick={() => setOpen(false)} aria-label="Fechar">
              ×
            </button>
          </div>
          <div className="sf-assist-body">
            {turns.length === 0 && (
              <div className="sf-assist-intro">
                <p>Peça em linguagem natural: criar uma tarefa a partir de um diagrama, gerar o diagrama de um módulo e anexar a uma tarefa, preencher o Simulador de API, achar algo no projeto ou ajustar a interface. Ele sabe em que tela você está.</p>
                {(devMode ? DEV_EXAMPLES : examples(location.pathname + location.search)).map((e) => (
                  <button key={e} className="sf-assist-chip" onClick={() => send(e)} disabled={busy}>
                    {e}
                  </button>
                ))}
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className="sf-assist-turn">
                <div className="sf-assist-me">{t.message}</div>
                <div className="sf-assist-ai">
                  {t.steps.length > 0 && <Steps steps={t.steps} />}
                  {t.reply && <div className="sf-assist-reply" dangerouslySetInnerHTML={{ __html: md.parse(t.reply) as string }} />}
                  {t.error && <div className="sf-assist-err">Não consegui terminar: {t.error}</div>}
                </div>
              </div>
            ))}
            {busy && (
              <div className="sf-assist-ai">
                {live.length > 0 && <Steps steps={live} live />}
                <span className="sf-spinner" /> {live.length ? 'Trabalhando…' : 'Pensando…'}
              </div>
            )}
            {error && <div className="sf-callout red">{error}</div>}
            <div ref={end} />
          </div>
          <form
            className="sf-assist-input"
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
          >
            <input className="sf-input" autoFocus placeholder={devMode ? 'Ex.: mova o bloco Stack para o topo' : 'Ex.: gere o diagrama do módulo de frete'} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} maxLength={4000} />
            <button className="sf-btn primary" disabled={busy || !text.trim()}>
              Enviar
            </button>
          </form>
          <div className="sf-assist-foot">
            <Link to={`/w/${workspaceId}/settings?secao=interface`} onClick={() => setOpen(false)}>
              Ajustar à mão
            </Link>
            {devMode && (
              <Link to={`/w/${workspaceId}/studio`} onClick={() => setOpen(false)} title="Desenvolver o Agentic Toolkit numa tela dedicada">
                Abrir o Estúdio
              </Link>
            )}
            <Link to={`/w/${workspaceId}/settings?secao=mcp`} onClick={() => setOpen(false)}>
              Conectar outra IA (MCP)
            </Link>
          </div>
        </div>
      )}
    </>
  )
}
