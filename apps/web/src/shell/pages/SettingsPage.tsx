import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, waitJob, type GitAuth, type Providers, type Workspace } from '../api'
import { useShell } from '../store'

export function SettingsPage() {
  return (
    <div className="sf-page">
      <div className="sf-page-head">
        <div className="sf-page-icon">⚙</div>
        <div className="sf-page-title">
          <h1>Configurações</h1>
          <p>Provedor de IA e opções desta instalação.</p>
        </div>
      </div>
      <div className="sf-grid two">
        <AiSettings />
        <WorkspaceSettings />
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

function WorkspaceSettings() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { workspaces, refreshWorkspaces, loadOverview } = useShell()
  const ws = workspaces.find((w) => w.id === id)
  const [name, setName] = useState(ws?.name ?? '')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')

  if (!ws) return null

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label)
    setMsg('')
    try {
      await fn()
      setMsg(`${label}: concluído`)
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const reanalyze = () =>
    run('Reanálise', async () => {
      const r = await api.post<{ jobId: string }>(`/workspaces/${id}/analysis`)
      await waitJob(r.jobId, () => undefined)
      await loadOverview(id, true)
    })

  const sync = () =>
    run('Sincronização', async () => {
      const auth: GitAuth = token ? { method: 'token', token } : { method: 'system' }
      await api.post(`/workspaces/${id}/sync`, { auth })
      setToken('')
      await reanalyze()
    })

  return (
    <div className="sf-card">
      <h2>Esta instalação</h2>
      <span className="sub sf-mono">{ws.root}</span>
      <div className="sf-field">
        <label>Nome</label>
        <div className="sf-row">
          <input className="sf-input" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="sf-btn" onClick={() => run('Nome', async () => (await api.put<Workspace>(`/workspaces/${id}`, { name }), refreshWorkspaces()))}>
            Salvar
          </button>
        </div>
      </div>
      <div className="sf-field">
        <label>Vendors próprios</label>
        <span className="sf-muted">{ws.ownVendors.join(', ') || '—'}</span>
        <small>Para mudar, abra a configuração da análise.</small>
        <button className="sf-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => navigate(`/connect/${id}`)}>
          Reconfigurar análise
        </button>
      </div>
      <div className="sf-row" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
        <button className="sf-btn" disabled={Boolean(busy)} onClick={reanalyze}>
          {busy === 'Reanálise' ? <span className="sf-spinner" /> : '↻'} Reanalisar
        </button>
        {ws.source.type === 'git' && (
          <>
            <input className="sf-input sf-mono" type="password" style={{ maxWidth: 240 }} placeholder="token (se não usar o git da máquina)" value={token} onChange={(e) => setToken(e.target.value)} />
            <button className="sf-btn" disabled={Boolean(busy)} onClick={sync}>
              {busy === 'Sincronização' ? <span className="sf-spinner" /> : '⇣'} Buscar atualizações (git fetch)
            </button>
          </>
        )}
      </div>
      {msg && <div className="sf-muted" style={{ marginBottom: 12 }}>{msg}</div>}
      <div className="sf-callout red">
        <div className="sf-row">
          <span style={{ flex: 1 }}>
            Remover apaga do Agentic Toolkit o mapa, as anotações{ws.source.type !== 'local' ? ' e a cópia do código' : ''}. {ws.source.type === 'local' ? 'A pasta local não é tocada.' : ''}
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
      </div>
    </div>
  )
}
