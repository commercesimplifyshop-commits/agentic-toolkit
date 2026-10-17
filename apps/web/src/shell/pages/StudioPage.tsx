import { Marked } from 'marked'
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { useDevMode } from '../devmode'

/** Mirrors apps/api/src/studio/studio.service.ts */
type StudioEvent = { t: 'text'; text: string } | { t: 'tool'; name: string; detail?: string } | { t: 'note'; text: string }
interface StudioFile {
  id: string
  name: string
  type: string
  size: number
}
interface Turn {
  id: string
  at: string
  text: string
  attachments: StudioFile[]
  model?: string
  mode: string
  effort?: string
  web: boolean
  status: 'running' | 'done' | 'error' | 'cancelled'
  events: StudioEvent[]
  error?: string
  costUsd?: number
  durationMs?: number
}
interface Session {
  id: string
  title: string
  target: 'toolkit' | 'workspace'
  targetName: string
  branch?: string
  turns: Turn[]
  running: boolean
  updatedAt: string
}
interface Summary {
  id: string
  title: string
  target: 'toolkit' | 'workspace'
  branch?: string
  turns: number
  updatedAt: string
  running: boolean
}
interface Changes {
  branch: string | null
  files: { file: string; added: number; removed: number; status: string }[]
  commits: string[]
  pushed: boolean
  ahead: number | null
  error?: string
}

/** Raw HTML in the answers is shown as text, never rendered */
const md = new Marked({ gfm: true, breaks: true, renderer: { html: ({ text }: { text: string }) => text.replace(/</g, '&lt;').replace(/>/g, '&gt;') } })

const MODELS = [
  ['', 'Padrão da conta'],
  ['opus', 'Opus 5.5'],
  ['sonnet', 'Sonnet 5.5'],
  ['haiku', 'Haiku 5.5'],
  ['fable', 'Fable 5.1'],
] as const
const MODES = [
  ['auto', 'Automático', 'Decide sozinho o que pode fazer: lê, edita, roda comandos'],
  ['plan', 'Planejar', 'Investiga e escreve o plano, sem alterar arquivos'],
  ['acceptEdits', 'Aceitar edições', 'Edita arquivos sem perguntar; o resto segue as permissões'],
] as const
const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max']

const OPTS_KEY = 'agentic-toolkit.studioOptions'
function readOpts() {
  try {
    return { model: '', mode: 'auto', effort: '', web: true, ...JSON.parse(localStorage.getItem(OPTS_KEY) ?? '{}') } as { model: string; mode: string; effort: string; web: boolean }
  } catch {
    return { model: '', mode: 'auto', effort: '', web: true }
  }
}

/** Drawn icons: emoji are not in every font */
const Clip = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21.4 11.1l-9.2 9.2a6 6 0 01-8.5-8.5l9.2-9.2a4 4 0 015.7 5.7l-9.2 9.2a2 2 0 01-2.8-2.8l8.5-8.5" />
  </svg>
)
const Mic = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10a7 7 0 0014 0M12 17v5M8 22h8" />
  </svg>
)

const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

type Recognition = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null }

/** What the agent did in a turn: tools as short lines (folded when many), texts as Markdown */
function TurnView({ turn }: { turn: Turn }) {
  const tools = turn.events.filter((e) => e.t === 'tool') as Extract<StudioEvent, { t: 'tool' }>[]
  const texts = turn.events.filter((e) => e.t === 'text') as Extract<StudioEvent, { t: 'text' }>[]
  const answer = texts.at(-1)
  return (
    <div className="sf-st-turn">
      <div className="sf-st-me">
        <div className="sf-st-me-text">{turn.text || '(anexos)'}</div>
        {turn.attachments.length > 0 && (
          <div className="sf-st-files">
            {turn.attachments.map((f) => (
              <span key={f.id}>
                <Clip /> {f.name}
              </span>
            ))}
          </div>
        )}
        <div className="sf-st-meta">
          {MODELS.find((m) => m[0] === (turn.model ?? ''))?.[1] ?? turn.model} · {MODES.find((m) => m[0] === turn.mode)?.[1]}
          {turn.effort ? ` · esforço ${turn.effort}` : ''}
          {turn.web ? ' · web' : ''}
        </div>
      </div>
      <div className="sf-st-ai">
        {tools.length > 0 && (
          <details className="sf-st-tools" open={turn.status === 'running'}>
            <summary>
              {turn.status === 'running' ? <span className="sf-spinner" /> : '✓'} {tools.length} {tools.length === 1 ? 'ação' : 'ações'}
              {turn.status === 'running' && tools.at(-1) ? ` · ${tools.at(-1)!.name}${tools.at(-1)!.detail ? `: ${tools.at(-1)!.detail}` : ''}` : ''}
            </summary>
            <ul>
              {tools.slice(-80).map((t, i) => (
                <li key={i}>
                  <b>{t.name}</b> {t.detail && <span className="sf-mono">{t.detail}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
        {texts.slice(0, -1).length > 0 && turn.status !== 'running' && (
          <details className="sf-st-notes">
            <summary>Comentários durante o trabalho ({texts.length - 1})</summary>
            {texts.slice(0, -1).map((t, i) => (
              <div key={i} className="sf-st-md" dangerouslySetInnerHTML={{ __html: md.parse(t.text) as string }} />
            ))}
          </details>
        )}
        {turn.status === 'running' && texts.length > 0 && <div className="sf-st-md live" dangerouslySetInnerHTML={{ __html: md.parse(texts.at(-1)!.text) as string }} />}
        {turn.status !== 'running' && answer && <div className="sf-st-md" dangerouslySetInnerHTML={{ __html: md.parse(answer.text) as string }} />}
        {turn.status === 'running' && !turn.events.length && (
          <div className="sf-faint">
            <span className="sf-spinner" /> Começando…
          </div>
        )}
        {turn.error && <div className={`sf-callout ${turn.status === 'cancelled' ? 'orange' : 'red'}`}>{turn.error}</div>}
        {turn.status !== 'running' && (
          <div className="sf-st-meta">
            {turn.durationMs ? `${Math.round(turn.durationMs / 1000)} s` : ''}
            {turn.costUsd ? ` · US$ ${turn.costUsd.toFixed(2)}` : ''}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Estúdio: develop straight from the app. With the developer mode on it works on the Agentic Toolkit
 * itself; off, on the workspace's project. A conversation keeps its Claude Code session (each message
 * continues where the last one stopped), with attachments, voice, model, mode and effort; the
 * result pane shows the changes, a preview of the app and the activity.
 */
export function StudioPage() {
  const { id = '' } = useParams()
  const devMode = useDevMode((s) => s.on)
  const target = devMode ? 'toolkit' : 'workspace'
  const [toolkit, setToolkit] = useState(true)
  const [branches, setBranches] = useState<{ toolkit: string | null; workspace: string | null }>({ toolkit: null, workspace: null })
  const [sessions, setSessions] = useState<Summary[]>([])
  const [current, setCurrent] = useState<Session | null>(null)
  const [text, setText] = useState('')
  const [files, setFiles] = useState<StudioFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [opts, setOpts] = useState(readOpts)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'changes' | 'preview' | 'activity'>('changes')
  const [changes, setChanges] = useState<Changes | null>(null)
  const [diff, setDiff] = useState<{ file: string; diff: string } | null>(null)
  const [previewPath, setPreviewPath] = useState(`/w/${id}`)
  const [previewKey, setPreviewKey] = useState(0)
  const [restarting, setRestarting] = useState('')
  const [listening, setListening] = useState(false)
  const rec = useRef<Recognition | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const setOpt = (patch: Partial<typeof opts>) =>
    setOpts((o) => {
      const next = { ...o, ...patch }
      try {
        localStorage.setItem(OPTS_KEY, JSON.stringify(next))
      } catch {
        // options just won't persist
      }
      return next
    })

  const loadList = useCallback(async () => {
    const r = await api.get<{ toolkit: boolean; branches?: { toolkit: string | null; workspace: string | null }; sessions: Summary[] }>(`/workspaces/${id}/studio`)
    setToolkit(r.toolkit)
    if (r.branches) setBranches(r.branches)
    setSessions(r.sessions)
    return r.sessions
  }, [id])

  const open = useCallback(
    async (sid: string) => {
      setCurrent(await api.get<Session>(`/workspaces/${id}/studio/${sid}`))
      setDiff(null)
    },
    [id],
  )

  const loadChanges = useCallback(async () => {
    if (!current) return setChanges(null)
    try {
      setChanges(await api.get<Changes>(`/workspaces/${id}/studio/${current.id}/changes`))
    } catch (e) {
      setChanges({ branch: null, files: [], commits: [], pushed: false, ahead: null, error: (e as Error).message })
    }
  }, [id, current?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // the conversations of the code the mode points to
  useEffect(() => {
    loadList()
      .then((list) => {
        const mine = list.filter((s) => s.target === target)
        if (current?.target !== target) {
          if (mine[0]) void open(mine[0].id)
          else setCurrent(null)
        }
      })
      .catch((e) => setError((e as Error).message))
  }, [target, loadList]) // eslint-disable-line react-hooks/exhaustive-deps

  // follow a running conversation
  useEffect(() => {
    if (!current?.running) return
    const t = window.setInterval(async () => {
      try {
        const s = await api.get<Session>(`/workspaces/${id}/studio/${current.id}`)
        setCurrent(s)
        if (!s.running) {
          void loadList()
          void loadChanges()
        }
      } catch {
        // the server may be restarting
      }
    }, 1200)
    return () => window.clearInterval(t)
  }, [current?.running, current?.id, id, loadList, loadChanges])

  useEffect(() => {
    void loadChanges()
  }, [current?.id, loadChanges])
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [current?.turns.length, current?.turns.at(-1)?.events.length])

  const newSession = async () => {
    setError('')
    try {
      const s = await api.post<Session>(`/workspaces/${id}/studio`, { target })
      setCurrent(s)
      void loadList()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const upload = async (list: FileList | File[]) => {
    let s = current
    if (!s) {
      s = await api.post<Session>(`/workspaces/${id}/studio`, { target })
      setCurrent(s)
      void loadList()
    }
    setUploading(true)
    try {
      for (const f of [...list].slice(0, 10 - files.length)) {
        const form = new FormData()
        form.append('file', f, f.name || 'imagem.png')
        const saved = await api.post<StudioFile>(`/workspaces/${id}/studio/${s.id}/files`, form)
        setFiles((x) => [...x, saved])
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const send = async () => {
    if ((!text.trim() && !files.length) || current?.running) return
    setError('')
    try {
      let s = current
      if (!s) {
        s = await api.post<Session>(`/workspaces/${id}/studio`, { target, title: text.split('\n')[0] })
      }
      const next = await api.post<Session>(`/workspaces/${id}/studio/${s.id}/messages`, { text, attachments: files.map((f) => f.id), model: opts.model || undefined, mode: opts.mode, effort: opts.effort || undefined, web: opts.web })
      setCurrent(next)
      setText('')
      setFiles([])
      void loadList()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const stop = () => current && api.post(`/workspaces/${id}/studio/${current.id}/cancel`).catch(() => undefined)

  // voice: the browser's speech recognition writes what is said into the message
  const SR = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition
  const toggleVoice = () => {
    if (listening) return rec.current?.stop()
    if (!SR) return setError('Este navegador não transcreve fala. Use o Chrome ou o Edge.')
    const r = new SR()
    r.lang = 'pt-BR'
    r.continuous = true
    r.interimResults = false
    r.onresult = (e) => {
      let said = ''
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) said += e.results[i][0].transcript
      if (said) setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}${said.trim()}`)
    }
    r.onend = () => setListening(false)
    r.onerror = (e) => {
      setListening(false)
      if (e.error !== 'aborted') setError(e.error === 'not-allowed' ? 'O navegador não liberou o microfone.' : `Falha no áudio: ${e.error}`)
    }
    rec.current = r
    r.start()
    setListening(true)
  }

  const restart = async () => {
    if (!window.confirm('Reiniciar o servidor do Agentic Toolkit para valerem as mudanças da API? A tela volta em alguns segundos.')) return
    setRestarting('Reiniciando…')
    try {
      await api.post('/studio/restart')
    } catch {
      // the server exits right after answering
    }
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      try {
        await api.get('/system/health')
        setRestarting('')
        setPreviewKey((k) => k + 1)
        return
      } catch {
        setRestarting(`Reiniciando… ${i + 1}s`)
      }
    }
    setRestarting('O servidor não voltou em 60 s: veja o log em ~/.agentic-toolkit/core/server.log')
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files.length) void upload(e.dataTransfer.files)
  }

  const mine = sessions.filter((s) => s.target === target)
  const branch = branches[target]
  const running = Boolean(current?.running)
  const allTools = (current?.turns ?? []).flatMap((t) => t.events.filter((e) => e.t === 'tool') as Extract<StudioEvent, { t: 'tool' }>[])
  const cost = (current?.turns ?? []).reduce((s, t) => s + (t.costUsd ?? 0), 0)

  return (
    <div className="sf-studio">
      <aside className="sf-st-list">
        <div className={`sf-st-target ${target}`}>
          <strong>{target === 'toolkit' ? '⚒ Agentic Toolkit' : '◫ Projeto do workspace'}</strong>
          <span>{target === 'toolkit' ? 'Modo desenvolvedor ligado: altera o próprio app.' : 'Modo desenvolvedor desligado: altera o código do projeto.'}</span>
          <span className="sf-st-branch sf-mono" title="Branch atual do diretório">
            ⎇ {branch ?? 'sem git'}
          </span>
        </div>
        <button className="sf-btn primary small" onClick={newSession} style={{ width: '100%' }}>
          + Nova conversa
        </button>
        <div className="sf-st-sessions">
          {mine.map((s) => (
            <button key={s.id} className={current?.id === s.id ? 'on' : ''} onClick={() => open(s.id)}>
              <strong>{s.title}</strong>
              <span>
                {s.running ? '● trabalhando · ' : ''}
                {s.turns} {s.turns === 1 ? 'mensagem' : 'mensagens'}
                {s.branch ? ` · ${s.branch}` : ''}
              </span>
            </button>
          ))}
          {mine.length === 0 && <div className="sf-empty">Nenhuma conversa ainda.</div>}
        </div>
      </aside>

      <section className="sf-st-chat" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <div className="sf-st-head">
          <div>
            <strong>{current?.title ?? 'Estúdio de desenvolvimento'}</strong>
            <span>
              {target === 'toolkit' ? 'Agentic Toolkit' : (current?.targetName ?? 'projeto do workspace')}
              {branch ? ` · branch ${branch}` : ''}{!branch || ['main', 'master'].includes(branch) ? ' · ao começar no main, cria uma branch studio/…' : ''} · commit e push da branch, nunca em main
            </span>
          </div>
          {current && !running && (
            <button className="sf-link" onClick={() => window.confirm('Excluir esta conversa? O código e os commits continuam.') && api.del(`/workspaces/${id}/studio/${current.id}`).then(() => (setCurrent(null), loadList()))}>
              excluir
            </button>
          )}
        </div>
        {target === 'toolkit' && !toolkit && <div className="sf-callout orange">Este servidor não roda de um checkout git do Agentic Toolkit: não há código do app para alterar.</div>}
        <div className="sf-st-messages">
          {!current?.turns.length && (
            <div className="sf-st-empty">
              <h2>{target === 'toolkit' ? 'O que vamos mudar no Agentic Toolkit?' : 'O que vamos desenvolver no projeto?'}</h2>
              <p>
                O Claude Code trabalha direto no código, com as mesmas ferramentas de uma sessão na IDE: lê, edita, roda build e testes, pesquisa na web e faz commit e push da branch. Cada mensagem continua de onde a anterior parou. Anexe prints, logs ou arquivos; fale pelo microfone; escolha o modelo e o modo abaixo.
              </p>
            </div>
          )}
          {current?.turns.map((t) => <TurnView key={t.id} turn={t} />)}
          <div ref={end} />
        </div>

        {error && (
          <div className="sf-callout red" style={{ margin: '0 16px 8px' }} onClick={() => setError('')}>
            {error}
          </div>
        )}
        <div className="sf-st-composer">
          {files.length > 0 && (
            <div className="sf-st-files">
              {files.map((f) => (
                <span key={f.id}>
                  <Clip /> {f.name} <small>{size(f.size)}</small>
                  <button onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))} aria-label={`Remover ${f.name}`}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            className="sf-input"
            rows={3}
            placeholder={running ? 'O agente está trabalhando… você pode escrever a próxima mensagem.' : 'Descreva o que quer desenvolver. Ctrl+Enter envia. Cole ou arraste imagens e arquivos.'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void send()
              }
            }}
            onPaste={(e) => {
              const pasted = [...e.clipboardData.files]
              if (pasted.length) {
                e.preventDefault()
                void upload(pasted)
              }
            }}
          />
          <div className="sf-st-bar">
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => e.target.files && upload(e.target.files).then(() => (e.target.value = ''))} />
            <button className="sf-st-icon" onClick={() => fileInput.current?.click()} disabled={uploading} title="Anexar arquivos (até 10, 20 MB cada)">
              {uploading ? <span className="sf-spinner" /> : <Clip />}
            </button>
            <button className={`sf-st-icon ${listening ? 'rec' : ''}`} onClick={toggleVoice} title={SR ? (listening ? 'Parar de ouvir' : 'Falar o pedido (o navegador transcreve; no Chrome e no Edge, pelo serviço de voz do navegador)') : 'Este navegador não transcreve fala'}>
              {listening ? '■' : <Mic />}
            </button>
            <select className="sf-input" value={opts.model} onChange={(e) => setOpt({ model: e.target.value })} title="Modelo do Claude">
              {MODELS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <select className="sf-input" value={opts.mode} onChange={(e) => setOpt({ mode: e.target.value })} title={MODES.find((m) => m[0] === opts.mode)?.[2]}>
              {MODES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <select className="sf-input" value={opts.effort} onChange={(e) => setOpt({ effort: e.target.value })} title="Esforço de raciocínio">
              {EFFORTS.map((v) => (
                <option key={v} value={v}>
                  {v ? `esforço ${v}` : 'esforço padrão'}
                </option>
              ))}
            </select>
            <label className="sf-st-check" title="Pesquisar e ler páginas na web">
              <input type="checkbox" checked={opts.web} onChange={(e) => setOpt({ web: e.target.checked })} /> web
            </label>
            <span style={{ flex: 1 }} />
            {running ? (
              <button className="sf-btn small" onClick={stop}>
                ■ Parar
              </button>
            ) : (
              <button className="sf-btn accent small" onClick={send} disabled={!text.trim() && !files.length}>
                Enviar
              </button>
            )}
          </div>
        </div>
      </section>

      <aside className="sf-st-result">
        <div className="sf-st-tabs">
          {(
            [
              ['changes', `Alterações${changes?.files.length ? ` (${changes.files.length})` : ''}`],
              ['preview', 'Prévia'],
              ['activity', `Atividade${allTools.length ? ` (${allTools.length})` : ''}`],
            ] as const
          ).map(([v, l]) => (
            <button key={v} className={`sf-tab ${tab === v ? 'on' : ''}`} onClick={() => setTab(v)}>
              {l}
            </button>
          ))}
        </div>

        {tab === 'changes' && (
          <div className="sf-st-pane">
            <div className="sf-row" style={{ justifyContent: 'space-between' }}>
              <span className="sf-faint" style={{ fontSize: 12 }}>
                {changes?.branch ? `⎇ ${changes.branch}` : ''}
                {changes?.branch ? (changes.pushed ? ' · enviada' : changes.ahead ? ` · ${changes.ahead} commit(s) sem push` : ' · sem push') : ''}
              </span>
              <button className="sf-link" style={{ fontSize: 12 }} onClick={() => loadChanges()}>
                atualizar
              </button>
            </div>
            {changes?.error && <div className="sf-faint">{changes.error}</div>}
            {changes && changes.commits.length > 0 && (
              <div className="sf-st-commits">
                {changes.commits.map((c) => (
                  <div key={c} className="sf-mono">
                    {c}
                  </div>
                ))}
              </div>
            )}
            {!current && <div className="sf-empty">Abra ou comece uma conversa.</div>}
            {current && changes && !changes.files.length && !changes.error && <div className="sf-empty">Nenhuma alteração desde o início da conversa.</div>}
            {changes?.files.map((f) => (
              <button key={f.file} className={`sf-st-file ${diff?.file === f.file ? 'on' : ''}`} onClick={() => current && api.get<{ file: string; diff: string }>(`/workspaces/${id}/studio/${current.id}/changes?file=${encodeURIComponent(f.file)}`).then(setDiff)}>
                <span className="sf-mono">{f.file}</span>
                <small>{f.status === 'novo' ? 'novo' : `+${f.added} −${f.removed}`}</small>
              </button>
            ))}
            {diff && (
              <pre className="sf-st-diff">
                {diff.diff.split('\n').map((l, i) => (
                  <div key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : l.startsWith('@@') ? 'hunk' : ''}>
                    {l || ' '}
                  </div>
                ))}
              </pre>
            )}
          </div>
        )}

        {tab === 'preview' && (
          <div className="sf-st-pane preview">
            {target === 'toolkit' ? (
              <>
                <div className="sf-row" style={{ gap: 6 }}>
                  <input className="sf-input sf-mono" value={previewPath} onChange={(e) => setPreviewPath(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setPreviewKey((k) => k + 1)} />
                  <button className="sf-btn small" onClick={() => setPreviewKey((k) => k + 1)} title="Recarregar a prévia (mudanças na web, depois do build)">
                    ↻
                  </button>
                  <button className="sf-btn small" onClick={restart} disabled={Boolean(restarting) || running} title="Reinicia o servidor para valerem as mudanças da API">
                    Reiniciar servidor
                  </button>
                </div>
                {restarting && <div className="sf-faint" style={{ fontSize: 12 }}>{restarting}</div>}
                <iframe key={previewKey} className="sf-st-frame" src={previewPath} title="Prévia do Agentic Toolkit" />
              </>
            ) : (
              <>
                <div className="sf-faint" style={{ fontSize: 12.5 }}>
                  A prévia do projeto é a loja rodando no seu ambiente. Informe o endereço (ex.: https://minha-loja.test) para abrir aqui; as alterações do código aparecem na aba Alterações.
                </div>
                <div className="sf-row" style={{ gap: 6 }}>
                  <input className="sf-input sf-mono" placeholder="https://minha-loja.test" value={previewPath.startsWith('/') ? '' : previewPath} onChange={(e) => setPreviewPath(e.target.value)} />
                  <button className="sf-btn small" onClick={() => setPreviewKey((k) => k + 1)}>
                    ↻
                  </button>
                </div>
                {!previewPath.startsWith('/') && previewPath && <iframe key={previewKey} className="sf-st-frame" src={previewPath} title="Prévia do projeto" />}
              </>
            )}
          </div>
        )}

        {tab === 'activity' && (
          <div className="sf-st-pane">
            <div className="sf-faint" style={{ fontSize: 12 }}>
              {allTools.length} ações · {current?.turns.length ?? 0} mensagens{cost ? ` · US$ ${cost.toFixed(2)}` : ''}
            </div>
            <ul className="sf-st-activity">
              {allTools
                .slice(-300)
                .reverse()
                .map((t, i) => (
                  <li key={i}>
                    <b>{t.name}</b>
                    {t.detail && <span className="sf-mono">{t.detail}</span>}
                  </li>
                ))}
            </ul>
          </div>
        )}
        <div className="sf-st-foot">
          <Link to={`/w/${id}/ia/harness`}>Harness da IA →</Link>
        </div>
      </aside>
    </div>
  )
}
