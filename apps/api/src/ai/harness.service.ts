import { Injectable } from '@nestjs/common'
import fs from 'node:fs'
import path from 'node:path'
import { CORE_DIR } from '../config/paths'
import { MCP_TOOLS } from '../mcp/mcp-tools'
import { CLAUDE_DENIED_TOOLS, CLAUDE_DOCS_TOOLS, CLAUDE_READONLY_TOOLS, CommandRunner } from '../readonly/command-runner.service'
import { SkillsService } from '../skills/skills.service'
import type { SkillFeature } from '../skills/catalog'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { AiService, type ProviderId } from './ai.service'
import { READONLY_TOOLS } from './readonly-tools'

/**
 * How each feature calls the AI. Mirrors the flags of each call (ai.service, refine.service,
 * diagram-generator, docs.service, openspec-*, links/claude-call, ui-assistant): keep in sync.
 */
interface Profile {
  id: string
  title: string
  /** "modelo": follows the provider set in Configurações; "claude-code": always the local Claude Code */
  runs: 'modelo' | 'claude-code'
  access: 'leitura' | 'escrita no worktree' | 'conector Claude Docs' | 'ferramentas do app (MCP)'
  /** The tools with Claude Code */
  claudeTools: string[]
  /** The tools with the Anthropic API or an OpenAI-compatible model (only for the features that follow the provider) */
  apiTools?: string[]
  where: string
  skills?: SkillFeature
  notes?: string
}

const PROFILES: Profile[] = [
  { id: 'ask', title: 'Pergunte ao código', runs: 'modelo', access: 'leitura', claudeTools: CLAUDE_READONLY_TOOLS, apiTools: READONLY_TOOLS.map((t) => t.name), where: 'raiz do projeto + mapa de integrações + tarefas citadas', skills: 'ask' },
  { id: 'assistant', title: 'Assistente', runs: 'modelo', access: 'ferramentas do app (MCP)', claudeTools: [`${MCP_TOOLS.length} ferramentas do MCP do app (sem ferramentas nativas)`], apiTools: [`${MCP_TOOLS.length} ferramentas do MCP do app`], where: 'pasta vazia do toolkit; tudo passa pela API do app', notes: 'Com o Claude Code, conecta-se ao MCP do próprio app com um token interno.' },
  { id: 'refine', title: 'Refinamento (conversa e card)', runs: 'claude-code', access: 'leitura', claudeTools: CLAUDE_READONLY_TOOLS, where: 'raiz do projeto + imagens anexadas', skills: 'refine' },
  { id: 'develop', title: 'Desenvolvimento de tarefa', runs: 'claude-code', access: 'escrita no worktree', claudeTools: ['Read', 'Grep', 'Glob', 'Edit', 'MultiEdit', 'Write', 'Bash', 'TodoWrite'], where: 'worktree da tarefa (branch própria)', skills: 'develop', notes: 'Aceita edições sem perguntar (acceptEdits); nunca abre env.php nem dw.json.' },
  { id: 'diagrams', title: 'Diagramas e Arquitetura viva', runs: 'claude-code', access: 'leitura', claudeTools: CLAUDE_READONLY_TOOLS, where: 'raiz do projeto', skills: 'diagrams' },
  { id: 'docs', title: 'Documentação', runs: 'claude-code', access: 'leitura', claudeTools: CLAUDE_READONLY_TOOLS, where: 'raiz do projeto', skills: 'docs', notes: `Publicar no Claude Docs usa outra chamada, só com o conector: ${CLAUDE_DOCS_TOOLS.length} ferramentas.` },
  { id: 'openspec', title: 'OpenSpec', runs: 'claude-code', access: 'leitura', claudeTools: CLAUDE_READONLY_TOOLS, where: 'raiz do projeto', skills: 'openspec' },
]

/** What the Claude Code CLI reports when it starts (the "init" event of stream-json) */
export interface ClaudeInit {
  version?: string
  model?: string
  permissionMode?: string
  apiKeySource?: string
  outputStyle?: string
  plugins: string[]
  skills: string[]
  agents: string[]
  slashCommands: number
  mcpServers: { name: string; status?: string }[]
  at: string
}

const CACHE_FILE = path.join(CORE_DIR, 'harness-cache.json')
const CACHE_MS = 30 * 60_000

/**
 * The harness of the AI the app uses: the runtime that drives the model (the Claude Code CLI, or the
 * app's own tool loop for the Anthropic API and OpenAI-compatible models), what it loads, and how each
 * feature calls it. It reflects the provider set in Configurações → Inteligência artificial.
 */
@Injectable()
export class HarnessService {
  constructor(
    private readonly ai: AiService,
    private readonly runner: CommandRunner,
    private readonly skills: SkillsService,
    private readonly workspaces: WorkspacesService,
  ) {}

  /** Starts the CLI as the app does and stops it right after it reports itself: no answer is generated */
  private async probeClaude(refresh: boolean): Promise<ClaudeInit | null> {
    const bin = this.ai.claudeBinary()
    if (!bin) return null
    const model = this.ai.settings().claudeCode.model
    try {
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as ClaudeInit & { bin: string; modelSetting?: string }
      if (!refresh && cached.bin === bin && cached.modelSetting === model && Date.now() - Date.parse(cached.at) < CACHE_MS) return cached
    } catch {
      // nothing cached
    }
    const cwd = path.join(CORE_DIR, '..', 'cache', 'assistant')
    fs.mkdirSync(cwd, { recursive: true })
    const stop = new AbortController()
    let init: ClaudeInit | null = null
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--tools', '', '--setting-sources', 'user', '--strict-mcp-config', '--no-session-persistence', ...(model ? ['--model', model] : [])]
    await this.runner
      .run('claude', args, {
        executable: bin,
        cwd,
        stdin: 'ok',
        timeoutMs: 60_000,
        signal: stop.signal,
        onLine: (line) => {
          let ev: Record<string, unknown>
          try {
            ev = JSON.parse(line)
          } catch {
            return
          }
          if (ev.type !== 'system' || ev.subtype !== 'init') return
          const names = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : String((x as { name?: string })?.name ?? ''))).filter(Boolean) : [])
          init = {
            version: ev.claude_code_version as string | undefined,
            model: ev.model as string | undefined,
            permissionMode: ev.permissionMode as string | undefined,
            apiKeySource: ev.apiKeySource as string | undefined,
            outputStyle: ev.output_style as string | undefined,
            plugins: names(ev.plugins),
            skills: names(ev.skills),
            agents: names(ev.agents),
            slashCommands: Array.isArray(ev.slash_commands) ? ev.slash_commands.length : 0,
            mcpServers: Array.isArray(ev.mcp_servers) ? (ev.mcp_servers as { name: string; status?: string }[]).map((m) => ({ name: m.name, status: m.status })) : [],
            at: new Date().toISOString(),
          }
          stop.abort()
        },
      })
      .catch(() => undefined)
    if (init) fs.writeFileSync(CACHE_FILE, JSON.stringify({ ...(init as ClaudeInit), bin, modelSetting: model }))
    return init
  }

  private async openAiModels(baseUrl: string) {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(2000) })
      if (!res.ok) return { reachable: false, models: [] as string[] }
      const data = (await res.json()) as { data?: { id: string }[] }
      return { reachable: true, models: (data.data ?? []).map((m) => m.id).slice(0, 30) }
    } catch {
      return { reachable: false, models: [] as string[] }
    }
  }

  async view(workspaceId: string, refresh = false) {
    const ws = this.workspaces.get(workspaceId)
    const s = this.ai.settings()
    const provider: ProviderId = s.provider
    const bin = this.ai.claudeBinary()
    // Claude Code is probed when it is the provider, or when it is needed by the features that always use it
    const claude = bin ? await this.probeClaude(refresh) : null
    const configured =
      provider === 'claude-code'
        ? { provider, runtime: 'Claude Code CLI (modo -p, sem sessão salva)', model: claude?.model ?? s.claudeCode.model ?? 'padrão da conta', endpoint: 'Anthropic, pela sua conta do Claude Code', auth: claude?.apiKeySource === 'none' ? 'login da sua conta (assinatura)' : claude?.apiKeySource ? `chave de API (${claude.apiKeySource})` : 'desconhecida', available: Boolean(bin) }
        : provider === 'anthropic'
          ? { provider, runtime: 'Laço de ferramentas no servidor do app (SDK da Anthropic)', model: s.anthropic.model, effort: s.anthropic.effort, endpoint: 'api.anthropic.com', auth: this.ai.anthropicKey() ? (process.env.ANTHROPIC_API_KEY && !this.ai.anthropicKeyInMemory() ? 'chave em ANTHROPIC_API_KEY' : 'chave em memória') : 'sem chave configurada', available: Boolean(this.ai.anthropicKey()) }
          : { provider, runtime: 'Laço de ferramentas no servidor do app (chat/completions com tool calling)', model: s.openai.model, endpoint: s.openai.baseUrl, auth: this.ai.openAiKey() ? 'chave em memória' : 'sem chave', ...(await this.openAiModels(s.openai.baseUrl).then((m) => ({ available: m.reachable, models: m.models }))) }
    const features = PROFILES.map((p) => {
      const followsClaude = p.runs === 'claude-code' || provider === 'claude-code'
      return {
        id: p.id,
        title: p.title,
        runs: p.runs,
        engine: followsClaude ? 'Claude Code' : provider === 'anthropic' ? `API da Anthropic (${s.anthropic.model})` : `${s.openai.model} (compatível com OpenAI)`,
        access: p.access,
        tools: followsClaude ? p.claudeTools : (p.apiTools ?? []),
        where: p.where,
        notes: p.notes,
        toolkitSkills: p.skills ? this.skills.skillsFor(ws.tech, p.skills).map((d) => d.title) : [],
      }
    })
    return {
      tech: ws.tech,
      configured,
      claudeCode: bin ? { binary: bin, ...(claude ?? {}), probed: Boolean(claude) } : null,
      claudeCodeFlags: {
        settingSources: 'user: carrega os plugins, skills e configurações do seu usuário',
        mcp: '--strict-mcp-config: ignora os servidores MCP da sua máquina',
        session: '--no-session-persistence: nada fica no histórico do Claude Code',
        denied: CLAUDE_DENIED_TOOLS,
      },
      features,
      at: claude?.at ?? new Date().toISOString(),
    }
  }
}
