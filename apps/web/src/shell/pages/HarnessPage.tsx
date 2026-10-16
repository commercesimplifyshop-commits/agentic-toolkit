import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'

/** Mirrors HarnessService.view (apps/api/src/ai/harness.service.ts) */
interface Harness {
  tech: string
  configured: { provider: 'claude-code' | 'anthropic' | 'openai-compatible'; runtime: string; model: string; effort?: string; endpoint: string; auth: string; available: boolean; models?: string[] }
  claudeCode: null | {
    binary: string
    probed: boolean
    version?: string
    model?: string
    permissionMode?: string
    apiKeySource?: string
    outputStyle?: string
    plugins?: string[]
    skills?: string[]
    agents?: string[]
    slashCommands?: number
    mcpServers?: { name: string; status?: string }[]
  }
  claudeCodeFlags: { settingSources: string; mcp: string; session: string; denied: string[] }
  features: { id: string; title: string; runs: 'modelo' | 'claude-code'; engine: string; access: string; tools: string[]; where: string; notes?: string; toolkitSkills: string[] }[]
  at: string
}

const PROVIDER: Record<string, string> = { 'claude-code': 'Claude Code local', anthropic: 'API da Anthropic', 'openai-compatible': 'Modelo compatível com OpenAI' }
const ACCESS_TONE: Record<string, string> = { leitura: 'hn-read', 'escrita no worktree': 'hn-write', 'ferramentas do app (MCP)': 'hn-app', 'conector Claude Docs': 'hn-app' }

function Chips({ items, max = 12 }: { items: string[]; max?: number }) {
  return (
    <div className="sf-hn-chips">
      {items.slice(0, max).map((x) => (
        <span key={x}>{x}</span>
      ))}
      {items.length > max && <span className="more">+{items.length - max}</span>}
    </div>
  )
}

function Row({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="sf-hn-row">
      <span>{label}</span>
      <strong>{value ?? '—'}</strong>
    </div>
  )
}

/** The box of the Claude Code CLI: what it reported when it started */
function ClaudeBox({ c, flags, note }: { c: NonNullable<Harness['claudeCode']>; flags: Harness['claudeCodeFlags']; note: string }) {
  return (
    <div className="sf-hn-box hn-harness">
      <div className="sf-hn-kind">Harness</div>
      <h3>Claude Code CLI {c.version ?? ''}</h3>
      <span className="sub">{note}</span>
      <Row label="Modelo" value={c.model} />
      <Row label="Autenticação" value={c.apiKeySource === 'none' ? 'login da conta (assinatura)' : c.apiKeySource ? `chave de API (${c.apiKeySource})` : '—'} />
      <Row label="Modo de permissão" value={c.permissionMode} />
      <Row label="Execução" value="-p, sem sessão salva" />
      <div className="sf-hn-sub">Configurações: {flags.settingSources}</div>
      <div className="sf-hn-sub">Plugins carregados ({c.plugins?.length ?? 0})</div>
      <Chips items={c.plugins ?? []} />
      <div className="sf-hn-sub">Skills disponíveis ({c.skills?.length ?? 0}) + as do toolkit em cada funcionalidade</div>
      <Chips items={c.skills ?? []} max={8} />
      <div className="sf-hn-sub">Subagentes ({c.agents?.length ?? 0}) · comandos {c.slashCommands ?? 0}</div>
      <Chips items={c.agents ?? []} />
      <div className="sf-hn-sub">MCP: {flags.mcp}{c.mcpServers?.length ? ` (${c.mcpServers.map((m) => m.name).join(', ')})` : ''}; o Assistente usa só o MCP do app</div>
    </div>
  )
}

/** IA → Harness da IA: the architecture of the harness of the configured model, drawn from what it reports */
export function HarnessPage() {
  const { id = '' } = useParams()
  const [h, setH] = useState<Harness | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(
    async (refresh = false) => {
      setBusy(true)
      try {
        setH(await api.get<Harness>(`/workspaces/${id}/ai/harness${refresh ? '?refresh=1' : ''}`))
        setError('')
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [id],
  )
  useEffect(() => {
    void load()
  }, [load])

  if (error && !h) return <div className="sf-page"><div className="sf-callout red">{error}</div></div>
  if (!h) return <div className="sf-page"><span className="sf-spinner" /> Lendo o harness da IA…</div>

  const cfg = h.configured
  const isClaude = cfg.provider === 'claude-code'
  const follows = h.features.filter((f) => f.runs === 'modelo')
  const always = h.features.filter((f) => f.runs === 'claude-code')
  const byAccess = [...new Set(h.features.map((f) => f.access))].map((access) => ({
    access,
    tools: [...new Set(h.features.filter((f) => f.access === access).flatMap((f) => f.tools))],
    features: h.features.filter((f) => f.access === access).map((f) => f.title),
  }))

  return (
    <div className="sf-page sf-harness">
      <div className="sf-page-head">
        <div className="sf-page-icon">◇</div>
        <div className="sf-page-title">
          <h1>Harness da IA</h1>
          <p>
            O que roda o modelo configurado, o que ele carrega e o que cada funcionalidade libera. Lido do próprio harness ({isClaude ? 'o Claude Code se apresenta e é interrompido antes de responder' : 'configuração do app e do servidor do modelo'}) em{' '}
            {new Date(h.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.
          </p>
        </div>
        <div className="sf-actions">
          <Link className="sf-btn" to={`/w/${id}/settings?secao=ia`}>
            Configurar a IA
          </Link>
          <button className="sf-btn" onClick={() => load(true)} disabled={busy}>
            {busy ? <span className="sf-spinner" /> : '↻'} Ler de novo
          </button>
        </div>
      </div>

      <div className="sf-card sf-hn-diagram">
        <div className="sf-hn-legend">
          <span className="hn-app">App</span>
          <span className="hn-harness">Harness</span>
          <span className="hn-read">Leitura</span>
          <span className="hn-write">Escrita</span>
          <span className="hn-model">Modelo</span>
          <span className="hn-res">Recursos</span>
        </div>

        <div className="sf-hn-layer">
          <div className="sf-hn-layer-title">Agentic Toolkit · funcionalidades que usam IA</div>
          <div className="sf-hn-split">
            <div className="sf-hn-box hn-app">
              <div className="sf-hn-kind">Seguem o modelo configurado</div>
              <Chips items={follows.map((f) => f.title)} />
            </div>
            <div className="sf-hn-box hn-app">
              <div className="sf-hn-kind">{isClaude ? 'Também no Claude Code' : 'Sempre no Claude Code, qualquer que seja o modelo configurado'}</div>
              <Chips items={always.map((f) => f.title)} />
            </div>
          </div>
        </div>
        <div className="sf-hn-arrow">↓ cada chamada com as ferramentas e as skills da funcionalidade</div>

        <div className="sf-hn-layer">
          <div className="sf-hn-layer-title">Harness · {PROVIDER[cfg.provider]}</div>
          <div className="sf-hn-split">
            {isClaude && h.claudeCode ? (
              <ClaudeBox c={h.claudeCode} flags={h.claudeCodeFlags} note="Atende todas as funcionalidades." />
            ) : (
              <>
                <div className="sf-hn-box hn-harness">
                  <div className="sf-hn-kind">Harness do modelo configurado</div>
                  <h3>{cfg.runtime}</h3>
                  <span className="sub">Atende: {follows.map((f) => f.title).join(', ')}</span>
                  <Row label="Modelo" value={cfg.model} />
                  {cfg.effort && <Row label="Esforço" value={cfg.effort} />}
                  <Row label="Endereço" value={cfg.endpoint} />
                  <Row label="Autenticação" value={cfg.auth} />
                  <Row label="Situação" value={cfg.available ? 'disponível' : 'indisponível'} />
                  <div className="sf-hn-sub">Ferramentas: o app executa cada chamada de ferramenta e devolve o resultado ao modelo (até 24 passos no Assistente, 14 no Pergunte ao código).</div>
                  {cfg.models && cfg.models.length > 0 && (
                    <>
                      <div className="sf-hn-sub">Modelos no servidor ({cfg.models.length})</div>
                      <Chips items={cfg.models} max={8} />
                    </>
                  )}
                </div>
                {h.claudeCode ? <ClaudeBox c={h.claudeCode} flags={h.claudeCodeFlags} note={`Atende: ${always.map((f) => f.title).join(', ')}.`} /> : <div className="sf-hn-box hn-harness off">Claude Code não encontrado: {always.map((f) => f.title).join(', ')} não funcionam sem ele.</div>}
              </>
            )}
          </div>
        </div>
        <div className="sf-hn-arrow">↓ ferramentas liberadas por chamada · bloqueadas sempre: {h.claudeCodeFlags.denied.join(', ')}</div>

        <div className="sf-hn-layer">
          <div className="sf-hn-layer-title">Ferramentas e permissões</div>
          <div className="sf-hn-split">
            {byAccess.map((a) => (
              <div key={a.access} className={`sf-hn-box ${ACCESS_TONE[a.access] ?? 'hn-read'}`}>
                <div className="sf-hn-kind">{a.access}</div>
                <Chips items={a.tools} />
                <span className="sub">{a.features.join(' · ')}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="sf-hn-arrow">↓</div>

        <div className="sf-hn-layer">
          <div className="sf-hn-layer-title">Modelo e recursos</div>
          <div className="sf-hn-split">
            <div className="sf-hn-box hn-model">
              <div className="sf-hn-kind">Modelo</div>
              <h3>{cfg.model}</h3>
              <span className="sub">{cfg.endpoint}</span>
            </div>
            {!isClaude && h.claudeCode?.model && (
              <div className="sf-hn-box hn-model">
                <div className="sf-hn-kind">Modelo do Claude Code</div>
                <h3>{h.claudeCode.model}</h3>
                <span className="sub">nas funcionalidades que sempre usam o Claude Code</span>
              </div>
            )}
            <div className="sf-hn-box hn-res">
              <div className="sf-hn-kind">Código do projeto</div>
              <h3>Somente leitura</h3>
              <span className="sub">env.php, auth.json, dw.json e chaves nunca são lidos</span>
            </div>
            <div className="sf-hn-box hn-res">
              <div className="sf-hn-kind">Worktrees das tarefas</div>
              <h3>Escrita</h3>
              <span className="sub">só no Desenvolvimento de tarefa, numa branch própria</span>
            </div>
            <div className="sf-hn-box hn-res">
              <div className="sf-hn-kind">Dados do toolkit</div>
              <h3>Mapa, cards, diagramas</h3>
              <span className="sub">tudo o que a IA cria fica aqui</span>
            </div>
          </div>
        </div>
      </div>

      <div className="sf-card">
        <h2>O que cada funcionalidade usa</h2>
        <table className="sf-table">
          <thead>
            <tr>
              <th>Funcionalidade</th>
              <th>Motor</th>
              <th>Acesso</th>
              <th>Ferramentas</th>
              <th>Onde trabalha</th>
              <th>Skills do toolkit</th>
            </tr>
          </thead>
          <tbody>
            {h.features.map((f) => (
              <tr key={f.id}>
                <td>
                  <strong>{f.title}</strong>
                  {f.notes && <div className="sf-faint" style={{ fontSize: 11.5 }}>{f.notes}</div>}
                </td>
                <td>{f.engine}</td>
                <td>
                  <span className={`sf-hn-pill ${ACCESS_TONE[f.access] ?? 'hn-read'}`}>{f.access}</span>
                </td>
                <td className="sf-mono" style={{ fontSize: 11.5 }}>
                  {f.tools.join(', ')}
                </td>
                <td style={{ fontSize: 12 }}>{f.where}</td>
                <td style={{ fontSize: 12 }} title={f.toolkitSkills.join(', ')}>
                  {f.toolkitSkills.length ? `${f.toolkitSkills.length}: ${f.toolkitSkills.slice(0, 3).join(', ')}${f.toolkitSkills.length > 3 ? '…' : ''}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
