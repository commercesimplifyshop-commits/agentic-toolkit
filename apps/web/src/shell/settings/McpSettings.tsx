import { useEffect, useState } from 'react'
import { api } from '../api'

/** Mirrors McpController.view (apps/api/src/mcp/mcp.controller.ts) */
interface McpView {
  enabled: boolean
  token: string
  url: string
  bridge: string
  node: string
  updatedAt?: string
  groups: { id: string; title: string; description: string; enabled: boolean }[]
  tools: { name: string; title: string; group: string; description: string; writes: boolean }[]
}

type Client = 'claude-code' | 'claude-desktop' | 'cursor' | 'vscode' | 'gemini' | 'codex' | 'http'
const CLIENTS: { id: Client; label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'claude-desktop', label: 'Claude Desktop' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'vscode', label: 'VS Code (Copilot)' },
  { id: 'gemini', label: 'Gemini CLI' },
  { id: 'codex', label: 'Codex CLI' },
  { id: 'http', label: 'Outro cliente' },
]

const NAME = 'agentic-toolkit'

/** How to connect each client: where it goes and what to paste */
function snippet(c: Client, v: McpView, token: string): { where: string; code: string } {
  const json = (o: unknown) => JSON.stringify(o, null, 2)
  const headers = { Authorization: `Bearer ${token}` }
  const stdio = { command: v.node, args: [v.bridge], env: { AGENTIC_MCP_URL: v.url, AGENTIC_MCP_TOKEN: token } }
  switch (c) {
    case 'claude-code':
      return { where: 'No terminal (vale para todos os projetos com --scope user):', code: `claude mcp add --transport http --scope user ${NAME} ${v.url} --header "Authorization: Bearer ${token}"` }
    case 'claude-desktop':
      return { where: 'Em Settings → Developer → Edit Config (claude_desktop_config.json), dentro de "mcpServers". Usa a ponte local, porque o Claude Desktop inicia programas:', code: json({ mcpServers: { [NAME]: stdio } }) }
    case 'cursor':
      return { where: 'Em ~/.cursor/mcp.json (ou .cursor/mcp.json no projeto):', code: json({ mcpServers: { [NAME]: { url: v.url, headers } } }) }
    case 'vscode':
      return { where: 'Em .vscode/mcp.json, ou no comando "MCP: Open User Configuration":', code: json({ servers: { [NAME]: { type: 'http', url: v.url, headers } } }) }
    case 'gemini':
      return { where: 'Em ~/.gemini/settings.json, dentro de "mcpServers":', code: json({ mcpServers: { [NAME]: { httpUrl: v.url, headers } } }) }
    case 'codex':
      return {
        where: 'Em ~/.codex/config.toml (usa a ponte local):',
        code: `[mcp_servers.${NAME.replace(/-/g, '_')}]\ncommand = ${JSON.stringify(v.node)}\nargs = [${JSON.stringify(v.bridge)}]\nenv = { AGENTIC_MCP_URL = ${JSON.stringify(v.url)}, AGENTIC_MCP_TOKEN = ${JSON.stringify(token)} }`,
      }
    default:
      return {
        where: 'Qualquer cliente MCP com transporte Streamable HTTP. Para clientes que só iniciam programas, use a ponte stdio com as variáveis abaixo:',
        code: `URL:    ${v.url}\nHeader: Authorization: Bearer ${token}\n\nPonte stdio: ${v.node} ${v.bridge}\n  AGENTIC_MCP_URL=${v.url}\n  AGENTIC_MCP_TOKEN=${token}`,
      }
  }
}

/**
 * Configurações → MCP: connects Claude, or another AI, to the Agentic Toolkit. Off until turned on;
 * every client sends the token; the groups decide what the AI can do. Writing to the code is never
 * one of them, and every call is audited.
 */
export function McpSettings() {
  const [v, setV] = useState<McpView | null>(null)
  const [show, setShow] = useState(false)
  const [client, setClient] = useState<Client>('claude-code')
  const [msg, setMsg] = useState('')
  const [test, setTest] = useState('')

  useEffect(() => {
    api.get<McpView>('/mcp/settings').then(setV).catch((e) => setMsg((e as Error).message))
  }, [])
  if (!v) return <div className="sf-card">{msg ? <div className="sf-callout red">{msg}</div> : <span className="sf-spinner" />}</div>

  const save = async (body: Record<string, unknown>) => {
    try {
      setV(await api.put<McpView>('/mcp/settings', body))
      setMsg('Salvo.')
      setTest('')
    } catch (e) {
      setMsg((e as Error).message)
    }
  }
  const rotate = async () => {
    if (!window.confirm('Gerar um novo token? Os clientes configurados com o atual param de funcionar até receberem o novo.')) return
    setV(await api.post<McpView>('/mcp/token'))
    setShow(true)
    setMsg('Novo token gerado: atualize os clientes.')
  }
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => setMsg('Copiado.'), () => setMsg('Não foi possível copiar: selecione e copie.'))
  const runTest = async () => {
    setTest('Testando…')
    try {
      const res = await fetch('/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${v.token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
      const data = await res.json()
      setTest(res.ok ? `Conectado: ${data.result.tools.length} ferramentas disponíveis para a IA.` : `Falhou (${res.status}): ${data.error ?? ''}`)
    } catch (e) {
      setTest(`Falhou: ${(e as Error).message}`)
    }
  }

  const token = show ? v.token : `${v.token.slice(0, 8)}${'•'.repeat(24)}`
  const s = snippet(client, v, show ? v.token : '<TOKEN>')

  return (
    <div className="sf-card">
      <div className="sf-card-head">
        <div>
          <h2>MCP · conectar o Claude ou outra IA</h2>
          <span className="sub" style={{ marginBottom: 0 }}>
            O MCP (Model Context Protocol) é o padrão aberto que o Claude, o Cursor, o Copilot, o Gemini e o Codex usam para falar com ferramentas externas. Ligado, este app vira um servidor MCP: a IA conectada pode ajustar a interface, consultar o projeto e, se você permitir, disparar análises. Nunca escreve no código, e toda chamada fica na auditoria.
          </span>
        </div>
        <label className="sf-switch" title={v.enabled ? 'Desligar o MCP' : 'Ligar o MCP'}>
          <input type="checkbox" checked={v.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
          <span>{v.enabled ? 'Ligado' : 'Desligado'}</span>
        </label>
      </div>

      <div className="sf-mcp-steps">
        <div>
          <b>1</b> Ligue o MCP e escolha o que a IA pode fazer
        </div>
        <div>
          <b>2</b> Copie a configuração do seu cliente (ela já leva o endereço e o token)
        </div>
        <div>
          <b>3</b> Reinicie o cliente e peça, por exemplo: “desative o Fluxo 3D no Agentic Toolkit”
        </div>
      </div>

      <div className="sf-row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="sf-field" style={{ flex: '1 1 260px' }}>
          <label>Endereço</label>
          <div className="sf-row" style={{ gap: 6 }}>
            <input className="sf-input sf-mono" readOnly value={v.url} />
            <button className="sf-btn small" onClick={() => copy(v.url)}>
              Copiar
            </button>
          </div>
        </div>
        <div className="sf-field" style={{ flex: '1 1 320px' }}>
          <label>Token (cada cliente envia como Authorization: Bearer)</label>
          <div className="sf-row" style={{ gap: 6 }}>
            <input className="sf-input sf-mono" readOnly value={token} />
            <button className="sf-btn small" onClick={() => setShow((x) => !x)}>
              {show ? 'Ocultar' : 'Mostrar'}
            </button>
            <button className="sf-btn small" onClick={() => copy(v.token)}>
              Copiar
            </button>
            <button className="sf-btn small" onClick={rotate} title="Invalida o token atual">
              Novo
            </button>
          </div>
        </div>
      </div>

      <h3 style={{ marginTop: 14 }}>O que a IA pode fazer</h3>
      {v.groups.map((g) => (
        <label key={g.id} className="sf-ui-toggle">
          <input type="checkbox" checked={g.enabled} onChange={(e) => save({ groups: { [g.id]: e.target.checked } })} />
          <span>
            <strong>{g.title}</strong>
            <small>{g.description}</small>
            <small className="sf-mono" style={{ opacity: 0.8 }}>
              {v.tools
                .filter((t) => t.group === g.id)
                .map((t) => t.name)
                .join(' · ')}
            </small>
          </span>
        </label>
      ))}
      <small className="sf-faint">Sempre disponível: guia (explica cada funcionalidade para a IA). Nenhuma ferramenta grava no código do projeto, faz push ou mexe em branches.</small>

      <h3 style={{ marginTop: 16 }}>Conectar um cliente</h3>
      <div className="sf-row" style={{ gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        {CLIENTS.map((c) => (
          <button key={c.id} className={`sf-tab ${client === c.id ? 'on' : ''}`} onClick={() => setClient(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="sf-faint" style={{ fontSize: 12.5, marginBottom: 6 }}>
        {s.where}
      </div>
      <pre className="sf-mcp-code">{s.code}</pre>
      <div className="sf-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="sf-btn small" onClick={() => copy(snippet(client, v, v.token).code)}>
          Copiar com o token
        </button>
        <button className="sf-btn small" disabled={!v.enabled} onClick={runTest} title={v.enabled ? 'Chama o MCP como um cliente faria' : 'Ligue o MCP primeiro'}>
          Testar conexão
        </button>
        {test && <span className="sf-muted" style={{ fontSize: 12.5 }}>{test}</span>}
        {msg && (
          <span className="sf-muted" style={{ fontSize: 12.5, marginLeft: 'auto' }}>
            {msg}
          </span>
        )}
      </div>
      {!v.enabled && <div className="sf-callout blue" style={{ marginTop: 10, fontSize: 12.5 }}>O MCP está desligado: os clientes recebem “desligado” até você ligar.</div>}
      <small className="sf-faint" style={{ display: 'block', marginTop: 8 }}>
        O app precisa estar aberto (servidor rodando) para a IA conectar. O endereço só responde nesta máquina.
      </small>
    </div>
  )
}
