import { Injectable } from '@nestjs/common'
import { HOST, PORT } from '../config/paths'
import { McpSettingsService } from './mcp-settings.service'
import { guide, MCP_TOOLS, type ApiCall, type McpTool } from './mcp-tools'

/** Protocol versions this server speaks, newest first */
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']
const VERSION = '0.2.0'

interface RpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

/** The header that marks the calls the MCP makes, so the audit shows them as "via MCP" */
export const MCP_CLIENT_HEADER = 'x-agentic-client'

/**
 * The Agentic Toolkit as an MCP server (Streamable HTTP, stateless, JSON responses). Each tool calls
 * the app's own API on the loopback, so it passes the same read-only guard and audit as the screen.
 */
@Injectable()
export class McpService {
  constructor(private readonly settings: McpSettingsService) {}

  /** The tools the settings allow now; the in-app assistant gets all of them */
  tools(all = false): McpTool[] {
    const s = this.settings.read()
    return MCP_TOOLS.filter((t) => all || t.group === 'sempre' || s.groups[t.group])
  }

  /** Runs one tool in process (the assistant's loop for the Anthropic API and OpenAI-compatible models) */
  async callTool(name: string, args: Record<string, unknown>, client: 'mcp' | 'assistente' = 'assistente') {
    const tool = MCP_TOOLS.find((t) => t.name === name)
    if (!tool) throw new Error(`Ferramenta desconhecida: ${name}`)
    const result = await tool.run(args ?? {}, this.apiAs(client))
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
    return text.length > 60_000 ? `${text.slice(0, 60_000)}
… (cortado)` : text
  }

  private apiAs = (client: 'mcp' | 'assistente'): ApiCall => async (method, url, body) => {
    const host = HOST === '0.0.0.0' || HOST === '::' ? '127.0.0.1' : HOST
    const res = await fetch(`http://${host}:${PORT}/api${url}`, {
      method,
      headers: { [MCP_CLIENT_HEADER]: client, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15 * 60_000),
    })
    const text = await res.text()
    let data: unknown = text
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      // not JSON: returned as text
    }
    if (!res.ok) {
      const d = (data ?? {}) as { message?: unknown; error?: unknown }
      const msg = (d.message && typeof d.message !== 'object' ? d.message : d.error) ?? `Erro ${res.status}`
      throw new Error(Array.isArray(msg) ? msg.join(', ') : String(msg))
    }
    return data
  }

  /** Handles one JSON-RPC message; notifications (no id) get no answer */
  async handle(msg: RpcRequest, opts: { client?: 'mcp' | 'assistente' } = {}): Promise<Record<string, unknown> | null> {
    const client = opts.client ?? 'mcp'
    const all = client === 'assistente'
    const id = msg?.id ?? null
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result })
    const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'Requisição JSON-RPC inválida')
    const isNotification = msg.id === undefined
    if (isNotification) return null

    switch (msg.method) {
      case 'initialize': {
        const asked = String(msg.params?.protocolVersion ?? '')
        return ok({
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { listChanged: false } },
          serverInfo: { name: 'agentic-toolkit', title: 'Agentic Toolkit', version: VERSION },
          instructions: guide().split('\n\nFuncionalidades')[0] + '\n\nChame a ferramenta "guia" para ver cada funcionalidade e os blocos configuráveis.',
        })
      }
      case 'ping':
        return ok({})
      case 'tools/list':
        return ok({
          tools: this.tools(all).map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: { title: t.title, readOnlyHint: !t.writes && t.group !== 'acoes', destructiveHint: false, idempotentHint: t.group === 'interface', openWorldHint: false },
          })),
        })
      case 'tools/call': {
        const name = String(msg.params?.name ?? '')
        const tool = this.tools(all).find((t) => t.name === name)
        if (!tool) {
          const exists = MCP_TOOLS.some((t) => t.name === name)
          return fail(-32602, exists ? `A ferramenta ${name} está desligada em Configurações → MCP` : `Ferramenta desconhecida: ${name}`)
        }
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>
        const missing = (tool.inputSchema.required ?? []).filter((k) => args[k] === undefined || args[k] === '')
        if (missing.length) return ok({ content: [{ type: 'text', text: `Faltou informar: ${missing.join(', ')}` }], isError: true })
        try {
          const result = await tool.run(args, this.apiAs(client))
          const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
          return ok({ content: [{ type: 'text', text: text.length > 80_000 ? `${text.slice(0, 80_000)}\n… (cortado: refine a consulta)` : text }] })
        } catch (e) {
          return ok({ content: [{ type: 'text', text: (e as Error).message }], isError: true })
        }
      }
      case 'prompts/list':
        return ok({ prompts: [{ name: 'como-usar', title: 'Como usar o Agentic Toolkit', description: 'O guia das funcionalidades e das ferramentas deste servidor' }] })
      case 'prompts/get':
        if (msg.params?.name !== 'como-usar') return fail(-32602, 'Prompt desconhecido')
        return ok({ description: 'Guia do Agentic Toolkit', messages: [{ role: 'user', content: { type: 'text', text: guide() } }] })
      case 'resources/list':
        return ok({
          resources: [
            { uri: 'agentic://guia-de-estilo', name: 'guia-de-estilo', title: 'Guia de estilo do tema', description: 'Cores, medidas, regras de uso e contraste do tema atual', mimeType: 'text/markdown' },
            { uri: 'agentic://guia', name: 'guia', title: 'Guia do Agentic Toolkit', description: 'As funcionalidades e as ferramentas deste servidor', mimeType: 'text/markdown' },
          ],
        })
      case 'resources/read': {
        const uri = String(msg.params?.uri ?? '')
        if (uri === 'agentic://guia') return ok({ contents: [{ uri, mimeType: 'text/markdown', text: guide() }] })
        if (uri !== 'agentic://guia-de-estilo') return fail(-32002, `Recurso não encontrado: ${uri}`)
        try {
          const g = (await this.apiAs(client)('GET', '/ui/style-guide')) as { markdown: string }
          return ok({ contents: [{ uri, mimeType: 'text/markdown', text: g.markdown }] })
        } catch (e) {
          return fail(-32603, (e as Error).message)
        }
      }
      default:
        return fail(-32601, `Método não suportado: ${msg.method}`)
    }
  }
}
