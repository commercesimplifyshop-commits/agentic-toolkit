import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, type GitAuth, type Providers, type Workspace } from '../api'
import { notifySettingsChanged } from '../prereqs'
import { useShell } from '../store'

export function SettingsPage() {
  return (
    <div className="sf-page">
      <div className="sf-page-head">
        <div className="sf-page-icon">⚙</div>
        <div className="sf-page-title">
          <h1>Configurações</h1>
          <p>O workspace (pasta, projeto, repositório e variáveis) e o provedor de IA. As funcionalidades que dependem de algo daqui trazem um link direto para a seção.</p>
        </div>
      </div>
      <WorkspaceSettings />
      <div className="sf-grid two">
        <div id="secao-ia" className="sf-ws-anchor">
          <AiSettings />
        </div>
        <DangerZone />
      </div>
    </div>
  )
}

function AiSettings() {
  const [p, setP] = useState<Providers | null>(null)
  const [anthropicKey, setAnthropicKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    api.get<Providers>('/ai/providers').then(setP)
  }, [])
  if (!p) return <div className="sf-card"><span className="sf-spinner" /></div>
  const s = p.settings
  const set = (patch: Partial<Providers['settings']>) => setP({ ...p, settings: { ...s, ...patch } })

  const save = async () => {
    const body: Record<string, unknown> = { ...s }
    if (anthropicKey) body.anthropicApiKey = anthropicKey
    if (openaiKey) body.openaiApiKey = openaiKey
    try {
      setP(await api.put<Providers>('/ai/settings', body))
      notifySettingsChanged()
      setAnthropicKey('')
      setOpenaiKey('')
      setMsg('Salvo.')
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  return (
    <div className="sf-card">
      <h2>Inteligência artificial</h2>
      <span className="sub">Qual modelo responde em “Pergunte ao código”. Em todos, a IA só recebe ferramentas de leitura.</span>
      {p.providers.map((prov) => (
        <div key={prov.id} className={`sf-radio ${s.provider === prov.id ? 'on' : ''}`} onClick={() => set({ provider: prov.id })}>
          <input type="radio" readOnly checked={s.provider === prov.id} />
          <div style={{ flex: 1 }}>
            <strong>
              {prov.name} {prov.available ? <span className="sf-badge green">disponível</span> : <span className="sf-badge">configurar</span>}
            </strong>
            <span>{prov.detail}</span>
          </div>
        </div>
      ))}

      {s.provider === 'claude-code' && (
        <>
          <div className="sf-field">
            <label>Executável do Claude Code (opcional)</label>
            <input className="sf-input sf-mono" placeholder="detectado automaticamente (PATH ou extensão do VS Code)" value={s.claudeCode.bin ?? ''} onChange={(e) => set({ claudeCode: { ...s.claudeCode, bin: e.target.value || undefined } })} />
          </div>
          <div className="sf-field">
            <label>Modelo (opcional)</label>
            <input className="sf-input sf-mono" placeholder="o padrão da sua conta" value={s.claudeCode.model ?? ''} onChange={(e) => set({ claudeCode: { ...s.claudeCode, model: e.target.value || undefined } })} />
            <small>Roda com --tools Read,Grep,Glob, sem MCP e ignorando configurações .claude/ do repositório Magento.</small>
          </div>
        </>
      )}
      {s.provider === 'anthropic' && (
        <>
          <div className="sf-field">
            <label>Chave da API</label>
            <input className="sf-input sf-mono" type="password" placeholder="sk-ant-… (fica só em memória; ou use ANTHROPIC_API_KEY)" value={anthropicKey} onChange={(e) => setAnthropicKey(e.target.value)} />
          </div>
          <div className="sf-row">
            <div className="sf-field" style={{ flex: 1 }}>
              <label>Modelo</label>
              <input className="sf-input sf-mono" value={s.anthropic.model} onChange={(e) => set({ anthropic: { ...s.anthropic, model: e.target.value } })} />
            </div>
            <div className="sf-field" style={{ flex: 1 }}>
              <label>Esforço</label>
              <select className="sf-input" value={s.anthropic.effort} onChange={(e) => set({ anthropic: { ...s.anthropic, effort: e.target.value } })}>
                {['low', 'medium', 'high', 'xhigh', 'max'].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </div>
          </div>
        </>
      )}
      {s.provider === 'openai-compatible' && (
        <>
          <div className="sf-field">
            <label>URL base</label>
            <input className="sf-input sf-mono" value={s.openai.baseUrl} onChange={(e) => set({ openai: { ...s.openai, baseUrl: e.target.value } })} />
            <small>Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1. O modelo precisa suportar tool calling.</small>
          </div>
          <div className="sf-row">
            <div className="sf-field" style={{ flex: 1 }}>
              <label>Modelo</label>
              <input className="sf-input sf-mono" value={s.openai.model} onChange={(e) => set({ openai: { ...s.openai, model: e.target.value } })} />
            </div>
            <div className="sf-field" style={{ flex: 1 }}>
              <label>Chave (opcional)</label>
              <input className="sf-input sf-mono" type="password" value={openaiKey} onChange={(e) => setOpenaiKey(e.target.value)} />
            </div>
          </div>
        </>
      )}
      <div className="sf-row" style={{ justifyContent: 'flex-end' }}>
        {msg && <span className="sf-muted" style={{ marginRight: 'auto' }}>{msg}</span>}
        <button className="sf-btn primary" onClick={save}>
          Salvar
        </button>
      </div>
    </div>
  )
}

interface EnvRow {
  key: string
  secret: boolean
  /** undefined: a saved secret that is kept as it is */
  value?: string
  hasValue: boolean
}

/** Mirrors WorkspaceSettingsService.view (apps/api/src/settings/workspace-settings.service.ts) */
interface WsSettings {
  id: string
  name: string
  status: Workspace['status']
  analyzedAt?: string
  source: Workspace['source']
  folder: string
  root?: string
  edition?: string
  version?: string
  candidates: { path: string; relative: string; version?: string; edition?: string }[]
  vendors: { name: string; modules: number }[]
  ownVendors: string[]
  repo: { configured?: string; effective: string | null; automatic: boolean; branch?: string; remotes: string[]; message?: string }
  env: EnvRow[]
}

const SOURCE_LABEL = (s: Workspace['source']) =>
  s.type === 'local' ? 'Pasta local' : s.type === 'git' ? `Clone do Agentic Toolkit de ${s.url}${s.branch ? ` (${s.branch})` : ''}` : `Arquivo .zip (${s.fileName})`

/**
 * Configurações → Workspace: the folder, the project inside it, the git repository and the
 * variables. The initial setup writes these same settings. Changing what is analysed (folder,
 * project, vendors) starts a new analysis.
 */
function WorkspaceSettings() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const focus = params.get('secao')
  const { refreshWorkspaces } = useShell()
  const [saved, setSaved] = useState<WsSettings | null>(null)
  const [name, setName] = useState('')
  const [localPath, setLocalPath] = useState('')
  const [root, setRoot] = useState('')
  const [own, setOwn] = useState<string[]>([])
  const [repoPath, setRepoPath] = useState('')
  const [env, setEnv] = useState<EnvRow[]>([])
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ tone: 'green' | 'red' | 'orange'; text: string } | null>(null)

  const reset = (s: WsSettings) => {
    setSaved(s)
    setName(s.name)
    setLocalPath(s.folder)
    setRoot(s.root ?? '')
    setOwn(s.ownVendors)
    setRepoPath(s.repo.configured ?? '')
    setEnv(s.env.map((e) => ({ ...e })))
  }

  const load = useCallback(
    () =>
      api
        .get<WsSettings>(`/workspaces/${id}/settings`)
        .then(reset)
        .catch((e) => setMsg({ tone: 'red', text: (e as Error).message })),
    [id],
  )
  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!focus || !saved) return
    const el = document.getElementById(`secao-${focus}`)
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    el?.classList.add('focus')
    const t = window.setTimeout(() => el?.classList.remove('focus'), 2200)
    return () => window.clearTimeout(t)
  }, [focus, saved])

  if (!saved) return <div className="sf-card" style={{ marginBottom: 16 }}>{msg ? <div className="sf-error">{msg.text}</div> : <span className="sf-spinner" />}</div>

  const sameList = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join()
  const envChanged = JSON.stringify(env) !== JSON.stringify(saved.env)
  const analysedChange = localPath.trim() !== saved.folder || (root && root !== (saved.root ?? '')) || !sameList(own, saved.ownVendors)
  const dirty = name.trim() !== saved.name || analysedChange || repoPath.trim() !== (saved.repo.configured ?? '') || envChanged

  /** After a change in what is analysed, the setup screen follows the analysis and comes back here */
  const followAnalysis = () => {
    notifySettingsChanged()
    refreshWorkspaces().finally(() => navigate(`/connect/${id}?retorno=settings`))
  }

  const save = async () => {
    setBusy('save')
    setMsg(null)
    try {
      const body: Record<string, unknown> = {}
      if (name.trim() !== saved.name) body.name = name.trim()
      if (localPath.trim() !== saved.folder) body.localPath = localPath.trim()
      if (root && root !== (saved.root ?? '')) body.root = root
      if (!sameList(own, saved.ownVendors)) body.ownVendors = own
      if (repoPath.trim() !== (saved.repo.configured ?? '')) body.repoPath = repoPath.trim()
      if (envChanged) body.env = env.map((e) => ({ key: e.key.trim(), secret: e.secret, ...(e.value !== undefined ? { value: e.value } : {}) }))
      const r = await api.put<{ settings: WsSettings; jobId?: string; needsRoot: boolean }>(`/workspaces/${id}/settings`, body)
      reset(r.settings)
      notifySettingsChanged()
      await refreshWorkspaces()
      if (r.jobId) return followAnalysis()
      if (r.needsRoot) return navigate(`/connect/${id}`)
      setMsg({ tone: 'green', text: 'Configurações salvas.' })
    } catch (e) {
      setMsg({ tone: 'red', text: (e as Error).message })
    } finally {
      setBusy('')
    }
  }

  const sync = async () => {
    setBusy('sync')
    setMsg(null)
    try {
      const auth: GitAuth = token ? { method: 'token', token } : { method: 'system' }
      await api.post(`/workspaces/${id}/settings/sync`, { auth })
      setToken('')
      followAnalysis()
    } catch (e) {
      setMsg({ tone: 'red', text: (e as Error).message })
      setBusy('')
    }
  }

  const setRow = (i: number, patch: Partial<EnvRow>) => setEnv(env.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const local = saved.source.type === 'local'

  return (
    <div className="sf-card sf-ws-settings">
      <section className="sf-ws-section" id="secao-origem">
        <h3>Workspace e pasta local</h3>
        <p>Onde está o código que o Agentic Toolkit lê. As telas de análise só leem esta pasta.</p>
        <div className="sf-ws-grid">
          <span>Nome</span>
          <input className="sf-input" value={name} onChange={(e) => setName(e.target.value)} />
          <span>Origem</span>
          <span className="sf-mono" style={{ fontSize: 12.5, overflowWrap: 'anywhere' }}>
            {SOURCE_LABEL(saved.source)}
          </span>
          <span>{local ? 'Pasta local' : 'Pasta local (opcional)'}</span>
          <div>
            <input className="sf-input sf-mono" value={localPath} placeholder="C:\caminho\do\seu\clone" onChange={(e) => setLocalPath(e.target.value)} />
            {!local && (
              <small className="sf-faint" style={{ display: 'block', marginTop: 4 }}>
                Hoje o código é uma cópia feita pelo Agentic Toolkit ({saved.folder}). Informe a pasta do seu clone de trabalho para o workspace passar a ler essa pasta; a cópia é apagada e uma nova análise começa.
              </small>
            )}
          </div>
          <span>Sincronizar</span>
          <div className="sf-row" style={{ flexWrap: 'wrap' }}>
            {saved.source.type === 'git' && (
              <input className="sf-input sf-mono" type="password" style={{ maxWidth: 260 }} placeholder="token (se não usar o git da máquina)" value={token} onChange={(e) => setToken(e.target.value)} />
            )}
            <button className="sf-btn small" disabled={Boolean(busy) || dirty} onClick={sync} title={dirty ? 'Salve as alterações antes' : undefined}>
              {busy === 'sync' ? <span className="sf-spinner" /> : '↻'} {saved.source.type === 'git' ? 'Buscar atualizações (git fetch) e analisar' : 'Ler a pasta de novo e analisar'}
            </button>
            <span className="sf-faint" style={{ fontSize: 12 }}>
              {saved.analyzedAt ? `Última análise: ${new Date(saved.analyzedAt).toLocaleString('pt-BR')}` : 'Ainda não analisado'}
            </span>
          </div>
        </div>
      </section>

      <section className="sf-ws-section" id="secao-projeto">
        <h3>Pasta do projeto</h3>
        <p>A instalação dentro da pasta (a raiz do Magento ou a pasta com cartridges/) e os vendors do seu time. Mudar qualquer um inicia uma nova análise.</p>
        <div className="sf-ws-grid">
          <span>Projeto</span>
          {saved.candidates.length > 1 || (saved.candidates.length === 1 && saved.candidates[0].path !== saved.root) ? (
            <select className="sf-input sf-mono" value={root} onChange={(e) => setRoot(e.target.value)}>
              {!saved.candidates.some((c) => c.path === root) && root && <option value={root}>{root}</option>}
              {saved.candidates.map((c) => (
                <option key={c.path} value={c.path}>
                  {c.relative === '.' ? c.path : c.relative} {c.version ? `· ${c.edition ?? ''} ${c.version}` : ''}
                </option>
              ))}
            </select>
          ) : (
            <span className="sf-mono" style={{ fontSize: 12.5, overflowWrap: 'anywhere' }}>
              {saved.root ?? '—'} {saved.version && <span className="sf-badge">{saved.edition} {saved.version}</span>}
            </span>
          )}
          {saved.vendors.length > 0 && (
            <>
              <span>Vendors do seu time</span>
              <div className="sf-chips">
                {saved.vendors.map((v) => (
                  <button key={v.name} className={`sf-chip ${own.includes(v.name) ? 'on' : ''}`} onClick={() => setOwn((o) => (o.includes(v.name) ? o.filter((x) => x !== v.name) : [...o, v.name]))}>
                    {own.includes(v.name) ? '✓ ' : ''}
                    {v.name}
                    <b>{v.modules}</b>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <section className="sf-ws-section" id="secao-repositorio">
        <h3>Repositório git</h3>
        <p>Usado pela tela Git e pelo desenvolvimento das tarefas (branches e worktrees). Por padrão é o repositório que contém o projeto; informe outro caminho se o seu clone estiver em outra pasta.</p>
        <div className="sf-ws-grid">
          <span>Situação</span>
          {saved.repo.effective ? (
            <span className="sf-callout green" style={{ fontSize: 12.5 }}>
              <span className="sf-mono">{saved.repo.effective}</span>
              {saved.repo.branch ? ` · branch ${saved.repo.branch}` : ''} · {saved.repo.remotes.length ? `remotos: ${saved.repo.remotes.join(', ')}` : 'sem remoto (sem fetch e sem push)'}
              {saved.repo.automatic ? ' · detectado automaticamente' : ''}
            </span>
          ) : (
            <span className="sf-callout orange" style={{ fontSize: 12.5 }}>
              {saved.repo.message}
            </span>
          )}
          <span>Caminho do repositório</span>
          <input className="sf-input sf-mono" value={repoPath} placeholder="automático: o repositório que contém o projeto" onChange={(e) => setRepoPath(e.target.value)} />
        </div>
      </section>

      <section className="sf-ws-section" id="secao-variaveis">
        <h3>Variáveis de ambiente</h3>
        <p>
          Entregues aos comandos que rodam o projeto no desenvolvimento das tarefas (a sessão do Claude Code no worktree). Ficam no diretório de dados do Agentic Toolkit, nunca no
          projeto. Valores secretos não voltam para a tela depois de salvos.
        </p>
        {env.map((r, i) => (
          <div key={i} className="sf-ws-env">
            <input className="sf-input sf-mono" placeholder="NOME" value={r.key} onChange={(e) => setRow(i, { key: e.target.value })} />
            <input
              className="sf-input sf-mono"
              type={r.secret ? 'password' : 'text'}
              placeholder={r.secret && r.hasValue && r.value === undefined ? '•••••• (guardado; digite para trocar)' : 'valor'}
              value={r.value ?? ''}
              onChange={(e) => setRow(i, { value: e.target.value })}
            />
            <label className="sf-row" style={{ gap: 4, fontSize: 12.5 }}>
              <input type="checkbox" checked={r.secret} onChange={(e) => setRow(i, { secret: e.target.checked, ...(e.target.checked ? {} : { value: r.value ?? '' }) })} /> secreto
            </label>
            <button className="sf-link" aria-label={`Remover ${r.key}`} onClick={() => setEnv(env.filter((_, k) => k !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button className="sf-btn small" onClick={() => setEnv([...env, { key: '', secret: false, value: '', hasValue: false }])} disabled={env.length >= 40}>
          + Variável
        </button>
      </section>

      <div className="sf-ws-foot">
        {msg && (
          <span className={`sf-callout ${msg.tone}`} style={{ marginRight: 'auto', padding: '6px 10px' }}>
            {msg.text}
          </span>
        )}
        {dirty && analysedChange && <span className="sf-faint" style={{ fontSize: 12 }}>Salvar inicia uma nova análise.</span>}
        <button className="sf-btn" disabled={!dirty || Boolean(busy)} onClick={() => reset(saved)}>
          Descartar
        </button>
        <button className="sf-btn primary" disabled={!dirty || Boolean(busy)} onClick={save}>
          {busy === 'save' ? <span className="sf-spinner" /> : null} Salvar alterações
        </button>
      </div>
    </div>
  )
}

function DangerZone() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { workspaces, refreshWorkspaces } = useShell()
  const ws = workspaces.find((w) => w.id === id)
  if (!ws) return null
  return (
    <div className="sf-card">
      <h2>Remover o workspace</h2>
      <span className="sub">
        Apaga do Agentic Toolkit o mapa, as anotações, os cards{ws.source.type !== 'local' ? ' e a cópia do código' : ''}. {ws.source.type === 'local' ? 'A pasta local, as branches e os worktrees não são tocados.' : ''}
      </span>
      <button
        className="sf-btn small danger"
        onClick={async () => {
          if (!confirm(`Remover ${ws.name} do Agentic Toolkit?`)) return
          await api.del(`/workspaces/${id}`)
          await refreshWorkspaces()
          navigate('/')
        }}
      >
        Remover
      </button>
    </div>
  )
}
