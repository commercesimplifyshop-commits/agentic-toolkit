import Anthropic from '@anthropic-ai/sdk'
import { BadRequestException, Injectable } from '@nestjs/common'
import fs from 'node:fs'
import path from 'node:path'
import { AiService } from '../ai/ai.service'
import { CORE_DIR, HOST, PORT } from '../config/paths'
import { JobsService, type Job } from '../jobs/jobs.service'
import { McpSettingsService } from '../mcp/mcp-settings.service'
import { guide, MCP_TOOLS } from '../mcp/mcp-tools'
import { McpService } from '../mcp/mcp.service'
import { CommandRunner } from '../readonly/command-runner.service'

export interface AssistantTurn {
  message: string
  reply: string
}

/** Where the person is when they ask: "this diagram", "this task" */
export interface AssistantContext {
  workspace?: string
  path?: string
  /** The developer mode is on in the person's browser: the request is to change the app, not to use it */
  devMode?: boolean
}

const MAX_ROUNDS = 24
const SERVER = 'agentic-toolkit'

/** The tools that change the app itself (names, texts, theme, menu, blocks, CSS): only with the developer mode on */
export const CHANGES_THE_APP = new Set(MCP_TOOLS.filter((t) => t.group === 'interface' && t.writes).map((t) => t.name))

/** The tools the assistant gets: without the developer mode, none of those that change the app */
export function assistantTools(devMode: boolean) {
  return MCP_TOOLS.filter((t) => devMode || !CHANGES_THE_APP.has(t.name))
}

/** What the screen the person is on says about "this" */
export function describeContext(ctx: AssistantContext) {
  if (!ctx.workspace) return 'A pessoa não está dentro de um workspace.'
  const p = (ctx.path ?? '').replace(new RegExp(`^/?w/${ctx.workspace}/?`), '')
  const [base, query = ''] = p.split('?')
  const q = new URLSearchParams(query)
  const lines = [`Workspace aberto: ${ctx.workspace}. Tela: ${base || 'Visão geral'}${query ? `?${query}` : ''}.`]
  if (base === 'diagrams' && q.get('diagram')) lines.push(`Diagrama aberto na tela ("este diagrama"): ${q.get('diagram')}.`)
  const card = /^refinamento\/([a-f0-9]{10})/.exec(base)?.[1]
  if (card) lines.push(`Tarefa aberta na tela ("esta tarefa", "este card"): ${card}.`)
  if (base === 'api-client' && q.get('route')) lines.push(`Rota aberta no Simulador de API: ${q.get('route')}.`)
  return lines.join('\n')
}

const SYSTEM = (ctx: AssistantContext) => `Você é o assistente do Agentic Toolkit, dentro do app. A pessoa pede em linguagem natural e você faz, usando as ferramentas do servidor "${SERVER}": consultar o projeto, criar e ligar itens entre as funcionalidades (diagramas, tarefas do Refinamento, Simulador de API), ajustar a interface e abrir telas.

${guide().split('\n\nFuncionalidades')[0]}

Como agir:
- Faça o pedido inteiro, encadeando as ferramentas. Ex.: "crie uma tarefa a partir deste diagrama" = ver_diagrama, criar_card com a demanda descrita a partir do diagrama e o id em diagramas, abrir_tela no card.
- Para gerar um diagrama lido do código use gerar_diagrama e depois aguardar_tarefa até receber o diagramId; se você mesmo souber desenhar (Mermaid), criar_diagrama é imediato e sem custo.
- Ao terminar, use abrir_tela para levar a pessoa ao resultado principal, quando houver um.
- No Simulador de API, preencha com valores de exemplo coerentes com o código; nunca diga que enviou: a pessoa envia.
- Não invente ids: descubra com as ferramentas de consulta. Se faltar algo essencial, pergunte.
- Responda em português, curto: o que você fez e onde ver.

${
  ctx.devMode
    ? `MODO DESENVOLVEDOR LIGADO. A pessoa quer ALTERAR o Agentic Toolkit, não usar as funcionalidades. Leia cada pedido como uma mudança na aplicação: nomes, textos, layout, posição e visibilidade de blocos, menu, cores, tema e CSS. Ex.: "os highlights em cima" = mover o bloco highlights para o topo; "tire a atividade" = ocultar o bloco; "deixe mais azul" = mudar_tema. Antes de mudar o visual, consulte ver_interface (e guia_de_estilo para cores). Só use as funcionalidades (diagramas, tarefas, simulador, consultas) se o pedido for claramente sobre elas. Mudar o comportamento de uma funcionalidade ou criar uma nova exige alterar o código do app: diga isso e sugira uma tarefa no Refinamento.`
    : `MODO DESENVOLVEDOR DESLIGADO. A pessoa quer USAR as funcionalidades: consultar o projeto, gerar diagramas, criar e refinar tarefas, preencher o simulador, abrir telas. Você não tem as ferramentas que alteram a aplicação (nomes, textos, layout, blocos, menu, cores, CSS). Se o pedido for alterar a aplicação, não tente: responda que alterações na aplicação são feitas com o modo desenvolvedor ligado (botão ⚒ no menu fixo à esquerda, ou Ctrl+Shift+D) e que, ligado, é só pedir de novo.`
}

Contexto da tela:
${describeContext(ctx)}${ctx.devMode ? '\nModo desenvolvedor: ligado.' : '\nModo desenvolvedor: desligado.'}`

/**
 * The global assistant: an agent over the same tools the MCP offers, run with the AI configured in
 * the app. With Claude Code it connects to the app's own MCP with an internal token; with the
 * Anthropic API or an OpenAI-compatible model the tool loop runs here. Every tool goes through the
 * app's API, so the read-only rules and the audit apply.
 */
@Injectable()
export class UiAssistantService {
  constructor(
    private readonly ai: AiService,
    private readonly mcp: McpService,
    private readonly mcpSettings: McpSettingsService,
    private readonly jobs: JobsService,
    private readonly runner: CommandRunner,
  ) {}

  start(message: unknown, history: unknown, context: unknown) {
    if (typeof message !== 'string' || !message.trim()) throw new BadRequestException('Escreva o que você quer fazer')
    if (message.length > 4000) throw new BadRequestException('Pedido longo demais (até 4000 caracteres)')
    const turns = (Array.isArray(history) ? history : []).slice(-6).filter((t): t is AssistantTurn => typeof t?.message === 'string' && typeof t?.reply === 'string')
    const c = (context ?? {}) as Record<string, unknown>
    const ctx: AssistantContext = { workspace: typeof c.workspace === 'string' && /^[a-z0-9-]{3,64}$/.test(c.workspace) ? c.workspace : undefined, path: typeof c.path === 'string' ? c.path.slice(0, 400) : undefined, devMode: c.devMode === true }
    const job = this.jobs.create('assistente', ctx.workspace ?? '-', [{ id: 'run', label: 'Assistente' }])
    const prompt = [turns.length ? `Conversa até aqui:\n${turns.map((t) => `Pessoa: ${t.message}\nVocê: ${t.reply}`).join('\n\n')}` : '', `Pedido: ${message.trim()}`].filter(Boolean).join('\n\n')
    this.jobs.run(job, async () => {
      this.jobs.step(job, 'run', 'running')
      const provider = this.ai.settings().provider
      const dev = Boolean(ctx.devMode)
      const reply = provider === 'claude-code' ? await this.viaClaudeCode(job, SYSTEM(ctx), prompt, dev) : provider === 'anthropic' ? await this.viaAnthropic(job, SYSTEM(ctx), prompt, dev) : await this.viaOpenAi(job, SYSTEM(ctx), prompt, dev)
      job.result = { reply: reply.trim() || 'Pronto.', provider }
      this.jobs.step(job, 'run', 'done')
    })
    return { jobId: job.id }
  }

  /** Runs a tool of the in-process loops; one that changes the app is refused without the developer mode, even if the model asks for it */
  private call(name: string, args: Record<string, unknown>, dev: boolean) {
    if (!dev && CHANGES_THE_APP.has(name)) throw new Error('Alterar a aplicação exige o modo desenvolvedor ligado (botão ⚒ no menu fixo, ou Ctrl+Shift+D).')
    return this.mcp.callTool(name, args)
  }

  private title(name: string) {
    return MCP_TOOLS.find((t) => t.name === name)?.title ?? name
  }

  // ---- Claude Code: connects to the app's own MCP -------------------------------------------------

  private async viaClaudeCode(job: Job, system: string, prompt: string, dev: boolean) {
    const bin = this.ai.claudeBinary()
    if (!bin) throw new BadRequestException('Claude Code não encontrado nesta máquina')
    const cwd = path.join(CORE_DIR, '..', 'cache', 'assistant')
    fs.mkdirSync(cwd, { recursive: true })
    const host = HOST === '0.0.0.0' || HOST === '::' ? '127.0.0.1' : HOST
    const config = path.join(cwd, `mcp-${job.id}.json`)
    fs.writeFileSync(config, JSON.stringify({ mcpServers: { [SERVER]: { type: 'http', url: `http://${host}:${PORT}/api/mcp`, headers: { Authorization: `Bearer ${this.mcpSettings.internalToken}` } } } }))
    // without the developer mode the tools that change the app are not allowed, and are denied outright
    const allowed = assistantTools(dev)
      .map((t) => `mcp__${SERVER}__${t.name}`)
      .join(',')
    const denied = dev ? [] : [...CHANGES_THE_APP].map((n) => `mcp__${SERVER}__${n}`)
    const model = this.ai.settings().claudeCode.model
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--tools', '', '--allowedTools', allowed, ...(denied.length ? ['--disallowedTools', denied.join(',')] : []), '--mcp-config', config, '--strict-mcp-config', '--setting-sources', 'user', '--no-session-persistence', '--append-system-prompt', system, ...(model ? ['--model', model] : [])]
    let result = ''
    let error = ''
    try {
      await this.runner.run('claude', args, {
        executable: bin,
        cwd,
        stdin: prompt,
        timeoutMs: 20 * 60_000,
        // the long tools already return in under a minute; this is the margin
        env: { MCP_TOOL_TIMEOUT: '120000' },
        onLine: (line) => {
          let ev: { type?: string; subtype?: string; result?: string; is_error?: boolean; message?: { content?: { type: string; name?: string; text?: string }[] } }
          try {
            ev = JSON.parse(line)
          } catch {
            return
          }
          if (ev.type === 'assistant') for (const b of ev.message?.content ?? []) if (b.type === 'tool_use' && b.name) this.jobs.log(job, `⚙ ${this.title(b.name.replace(`mcp__${SERVER}__`, ''))}`)
          if (ev.type === 'result') {
            result = ev.result ?? ''
            if (ev.is_error) error = ev.result ?? ev.subtype ?? 'erro'
          }
        },
      })
    } finally {
      fs.rmSync(config, { force: true })
    }
    if (error) throw new BadRequestException(`Claude Code: ${error.slice(0, 400)}`)
    return result
  }

  // ---- Anthropic API: tool loop here --------------------------------------------------------------

  private async viaAnthropic(job: Job, system: string, prompt: string, dev: boolean) {
    const s = this.ai.settings().anthropic
    const apiKey = this.ai.anthropicKey()
    if (!apiKey) throw new BadRequestException('Configure a chave da API da Anthropic em Configurações → Inteligência artificial')
    const client = new Anthropic({ apiKey })
    const tools = assistantTools(dev).map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema }))
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }]
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await client.messages.create({ model: s.model, max_tokens: 8000, system, tools, messages })
      const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      if (res.stop_reason !== 'tool_use' || !uses.length) return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
      messages.push({ role: 'assistant', content: res.content })
      const results: Anthropic.ToolResultBlockParam[] = []
      for (const u of uses) {
        this.jobs.log(job, `⚙ ${this.title(u.name)}`)
        try {
          results.push({ type: 'tool_result', tool_use_id: u.id, content: await this.call(u.name, u.input as Record<string, unknown>, dev) })
        } catch (e) {
          results.push({ type: 'tool_result', tool_use_id: u.id, content: (e as Error).message, is_error: true })
        }
      }
      messages.push({ role: 'user', content: results })
    }
    return 'Parei: passos demais para este pedido. Divida em partes menores.'
  }

  // ---- OpenAI-compatible models: function calling here --------------------------------------------

  private async viaOpenAi(job: Job, system: string, prompt: string, dev: boolean) {
    const s = this.ai.settings().openai
    type Msg = { role: string; content: string | null; tool_calls?: { id: string; type?: string; function: { name: string; arguments: string } }[]; tool_call_id?: string }
    const messages: Msg[] = [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ]
    const tools = assistantTools(dev).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }))
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await fetch(`${s.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(this.ai.openAiKey() ? { Authorization: `Bearer ${this.ai.openAiKey()}` } : {}) },
        body: JSON.stringify({ model: s.model, messages, tools }),
        signal: AbortSignal.timeout(5 * 60_000),
      })
      if (!res.ok) throw new BadRequestException(`Modelo respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`)
      const msg = ((await res.json()) as { choices: { message: Msg }[] }).choices[0].message
      messages.push(msg)
      if (!msg.tool_calls?.length) return msg.content ?? ''
      for (const call of msg.tool_calls) {
        this.jobs.log(job, `⚙ ${this.title(call.function.name)}`)
        let content: string
        try {
          content = await this.call(call.function.name, JSON.parse(call.function.arguments || '{}'), dev)
        } catch (e) {
          content = `Erro: ${(e as Error).message}`
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content })
      }
    }
    return 'Parei: passos demais para este pedido. Divida em partes menores.'
  }
}
