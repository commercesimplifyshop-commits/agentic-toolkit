import Anthropic from '@anthropic-ai/sdk'
import { runClaudeWatchingSkills, withSkills } from '../skills/claude-skills'
import { SkillsService } from '../skills/skills.service'
import { TaskContextService, type LinkedTask, type TaskMaterial } from '../refine/task-context.service'
import { BadRequestException, Injectable } from '@nestjs/common'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MapStore } from '../analysis/map-store.service'
import { OverviewService } from '../analysis/overview.service'
import { CORE_DIR } from '../config/paths'
import { CLAUDE_DENIED_TOOLS, CLAUDE_READONLY_TOOLS, CommandRunner } from '../readonly/command-runner.service'
import { ReadOnlyFs } from '../readonly/readonly-fs.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { executeTool, READONLY_TOOLS, systemPromptFor } from './readonly-tools'

export type ProviderId = 'anthropic' | 'claude-code' | 'openai-compatible'

export interface AiSettings {
  provider: ProviderId
  anthropic: { model: string; effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' }
  openai: { baseUrl: string; model: string }
  claudeCode: { bin?: string; model?: string }
}

export interface AskResult {
  answer: string
  provider: ProviderId
  model?: string
  toolCalls: { name: string; input: unknown }[]
  stopReason?: string
  /** Skills Claude Code loaded for this answer */
  skills?: { name: string; title: string }[]
  /** Refinement tasks the question was linked to */
  tasks?: LinkedTask[]
}

/** Earlier turns of the conversation, so a follow-up question keeps its context */
export interface AskTurn {
  question: string
  answer: string
}
const MAX_HISTORY = 6

const SETTINGS_FILE = path.join(CORE_DIR, 'settings.json')
const DEFAULTS: AiSettings = {
  provider: 'claude-code',
  anthropic: { model: 'claude-opus-5-5', effort: 'medium' },
  openai: { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:14b' },
  claudeCode: {},
}
const MAX_TOOL_ROUNDS = 14

@Injectable()
export class AiService {
  /** API keys live in memory only (or in env vars); they are never written to disk. */
  private keys: { anthropic?: string; openai?: string } = {}

  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly rofs: ReadOnlyFs,
    private readonly maps: MapStore,
    private readonly overview: OverviewService,
    private readonly runner: CommandRunner,
    private readonly skills: SkillsService,
    private readonly tasks: TaskContextService,
  ) {}

  settings(): AiSettings {
    try {
      return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }
    } catch {
      return DEFAULTS
    }
  }

  saveSettings(input: Partial<AiSettings> & { anthropicApiKey?: string; openaiApiKey?: string }) {
    const { anthropicApiKey, openaiApiKey, ...rest } = input
    if (anthropicApiKey !== undefined) this.keys.anthropic = anthropicApiKey || undefined
    if (openaiApiKey !== undefined) this.keys.openai = openaiApiKey || undefined
    const next = { ...this.settings(), ...rest }
    if (!['anthropic', 'claude-code', 'openai-compatible'].includes(next.provider)) throw new BadRequestException('Provedor inválido')
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2))
    return this.providers()
  }

  /** Where the Claude Code binary is: setting, env, PATH, or the VS Code extension. */
  claudeBinary(): string | null {
    const candidates = [this.settings().claudeCode.bin, process.env.AGENTIC_TOOLKIT_CLAUDE_BIN].filter(Boolean) as string[]
    const exe = process.platform === 'win32' ? ['claude.exe'] : ['claude']
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) for (const e of exe) candidates.push(path.join(dir, e))
    candidates.push(path.join(os.homedir(), '.local', 'bin', exe[0]), path.join(os.homedir(), '.claude', 'local', exe[0]))
    for (const extRoot of [path.join(os.homedir(), '.vscode', 'extensions'), path.join(os.homedir(), '.cursor', 'extensions')]) {
      try {
        const ext = fs
          .readdirSync(extRoot)
          .filter((d) => d.startsWith('anthropic.claude-code-'))
          .sort()
          .reverse()
        for (const d of ext) candidates.push(path.join(extRoot, d, 'resources', 'native-binary', exe[0]))
      } catch {
        // extension folder not present
      }
    }
    return candidates.find((c) => fs.existsSync(c)) ?? null
  }

  async providers() {
    const s = this.settings()
    const bin = this.claudeBinary()
    return {
      active: s.provider,
      settings: s,
      providers: [
        {
          id: 'claude-code',
          name: 'Claude Code local',
          available: Boolean(bin),
          detail: bin ? `Usa a sua sessão do Claude Code (${bin}). Ferramentas liberadas: ${CLAUDE_READONLY_TOOLS.join(', ')}.` : 'Claude Code não encontrado. Instale (claude.com/claude-code) ou informe o caminho do executável.',
        },
        {
          id: 'anthropic',
          name: 'API da Anthropic',
          available: Boolean(this.keys.anthropic ?? process.env.ANTHROPIC_API_KEY),
          detail: `Modelo ${s.anthropic.model}, esforço ${s.anthropic.effort}. A chave fica só em memória (ou em ANTHROPIC_API_KEY).`,
        },
        {
          id: 'openai-compatible',
          name: 'Modelo local / compatível com OpenAI',
          available: await this.reachable(s.openai.baseUrl),
          detail: `${s.openai.model} em ${s.openai.baseUrl} (Ollama, LM Studio, vLLM…).`,
        },
      ],
    }
  }

  /** Quick liveness probe of an OpenAI-compatible server (GET /models). */
  private async reachable(baseUrl: string) {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(1500) })
      return res.ok
    } catch {
      return false
    }
  }

  private async context(id: string) {
    const root = this.workspaces.rootOf(id)
    const ws = this.workspaces.get(id)
    let summary = ''
    try {
      const o = await this.overview.compute(id)
      summary = [
        `Instalação: ${ws.name} · ${o.magento.edition ?? ''} ${o.magento.version ?? ''}`,
        `Módulos habilitados: ${o.modules.enabled} (core ${o.modules.byOrigin.core}, customizados ${o.modules.byOrigin.custom}, terceiros ${o.modules.byOrigin['composer-thirdparty'] + o.modules.byOrigin['appcode-thirdparty']})`,
        `Vendors próprios: ${ws.ownVendors.join(', ') || '—'}`,
        `Destaques: ${o.highlights.slice(0, 6).map((h: { title: string }) => h.title).join('; ')}`,
      ].join('\n')
    } catch {
      summary = `Instalação: ${ws.name} · ${ws.edition ?? ''} ${ws.version ?? ''}`
    }
    return { root, summary, tech: ws.tech, map: this.maps.readMap(id), notes: this.maps.readAnnotations(id) }
  }

  async ask(id: string, question: string, opts: { cards?: string[]; history?: AskTurn[] } = {}): Promise<AskResult> {
    const s = this.settings()
    const ctx = await this.context(id)
    const material = await this.tasks.prepare(id, question, opts.cards)
    const history = (opts.history ?? []).slice(-MAX_HISTORY)
    const prompt = [
      ctx.summary,
      material.blocks,
      material.elsewhere.length ? `O usuário colou link(s) de tarefa de outro workspace, que esta conversa não acessa: ${material.elsewhere.join(', ')}. Diga isso se for relevante.` : '',
      history.length ? `Conversa até aqui:\n${history.map((t) => `Usuário: ${t.question}\nVocê: ${t.answer.slice(0, 3000)}`).join('\n\n')}` : '',
      `Pergunta: ${question}`,
    ]
      .filter(Boolean)
      .join('\n\n')
    const result =
      s.provider === 'claude-code'
        ? await this.askClaudeCode(ctx.root, this.maps.dir(id), id, prompt, material)
        : s.provider === 'anthropic'
          ? await this.askAnthropic(ctx, prompt)
          : await this.askOpenAiCompatible(ctx, prompt)
    return { ...result, tasks: material.linked }
  }

  // ---- Anthropic API: manual tool loop over read-only tools ------------------------

  private async askAnthropic(ctx: Awaited<ReturnType<AiService['context']>>, question: string): Promise<AskResult> {
    const s = this.settings().anthropic
    const apiKey = this.keys.anthropic ?? process.env.ANTHROPIC_API_KEY
    const client = new Anthropic(apiKey ? { apiKey } : {})
    const tools: Anthropic.Beta.BetaTool[] = READONLY_TOOLS.map((t) => ({ ...t, strict: true }))
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: question }]
    const toolCalls: AskResult['toolCalls'] = []

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await client.beta.messages.create({
        model: s.model,
        max_tokens: 16000,
        system: systemPromptFor(ctx.tech),
        thinking: { type: 'adaptive' },
        output_config: { effort: s.effort },
        tools,
        messages,
        // A declined request is retried server-side on Anthropic's recommended fallback model
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      } as Anthropic.Beta.MessageCreateParamsNonStreaming)

      if (response.stop_reason === 'refusal') {
        return { answer: 'O modelo recusou esta pergunta.', provider: 'anthropic', model: response.model, toolCalls, stopReason: 'refusal' }
      }
      if (response.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content })
        continue
      }
      const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
      if (uses.length === 0 || response.stop_reason !== 'tool_use') {
        const answer = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
        return { answer, provider: 'anthropic', model: response.model, toolCalls, stopReason: response.stop_reason ?? undefined }
      }
      messages.push({ role: 'assistant', content: response.content })
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = uses.map((u) => {
        const input = (u.input ?? {}) as Record<string, unknown>
        toolCalls.push({ name: u.name, input })
        return { type: 'tool_result', tool_use_id: u.id, content: executeTool(u.name, input, { rofs: this.rofs, ...ctx }).slice(0, 60_000) }
      })
      messages.push({ role: 'user', content: results })
    }
    return { answer: 'Limite de passos de investigação atingido; refine a pergunta.', provider: 'anthropic', model: s.model, toolCalls }
  }

  // ---- Claude Code local: read-only tool set, runs inside the Magento root -------------

  private async askClaudeCode(root: string, mapsDir: string, id: string, prompt: string, material: TaskMaterial): Promise<AskResult> {
    const bin = this.claudeBinary()
    if (!bin) throw new BadRequestException('Claude Code não encontrado nesta máquina')
    const s = this.settings().claudeCode
    const args = [
      '-p',
      '--output-format',
      'json',
      '--tools',
      CLAUDE_READONLY_TOOLS.join(','),
      '--allowedTools',
      CLAUDE_READONLY_TOOLS.join(','),
      '--disallowedTools',
      CLAUDE_DENIED_TOOLS.join(','),
      '--setting-sources',
      'user',
      '--strict-mcp-config',
      '--no-session-persistence',
      // Read access to the extracted map (inside Agentic Toolkit's data dir) instead of the search_map tool
      '--add-dir',
      mapsDir,
      // the tasks of the Refinement (index and one file each) and the worktrees of the linked ones
      '--add-dir',
      material.dir,
      ...material.worktrees.flatMap((w) => ['--add-dir', w]),
      '--append-system-prompt',
      `${systemPromptFor(this.workspaces.get(id).tech).replace(
        'Comece pelo mapa de integrações (search_map)',
        `Comece pelo mapa de integrações: ${path.join(mapsDir, `${id}.json`)} (JSON com items[]: id, kind, title, module, origin, zone, file, line, details) e as anotações em ${path.join(mapsDir, `${id}.annotations.json`)}; use Grep neles`,
      )}\n\n${this.tasks.guide(material)}`,
    ]
    if (s.model) args.push('--model', s.model)
    const session = this.skills.session(this.workspaces.get(id).tech, 'ask')
    const res = await runClaudeWatchingSkills(
      this.runner,
      withSkills(args, session),
      { executable: bin, cwd: root, stdin: prompt, timeoutMs: 10 * 60_000, protectedRoots: [root] },
      (skill) => this.skills.record({ workspace: id, feature: 'ask', skill }),
    )
    let parsed: { result?: string; is_error?: boolean; num_turns?: number } = {}
    try {
      parsed = JSON.parse(res.stdout)
    } catch {
      throw new BadRequestException(`Claude Code falhou: ${(res.stderr || res.stdout).slice(0, 400)}`)
    }
    if (parsed.is_error) throw new BadRequestException(`Claude Code: ${parsed.result ?? 'erro'}`)
    const skills = [...new Set(res.skills)].map((name) => ({ name, title: this.skills.titleOf(name) }))
    return { answer: parsed.result ?? '', provider: 'claude-code', model: s.model, toolCalls: [], stopReason: `${parsed.num_turns ?? '?'} turnos`, skills }
  }

  // ---- OpenAI-compatible endpoints (Ollama, LM Studio…): same read-only tools ------

  private async askOpenAiCompatible(ctx: Awaited<ReturnType<AiService['context']>>, question: string): Promise<AskResult> {
    const s = this.settings().openai
    const url = `${s.baseUrl.replace(/\/$/, '')}/chat/completions`
    const tools = READONLY_TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }))
    type Msg = { role: string; content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[]; tool_call_id?: string }
    const messages: Msg[] = [
      { role: 'system', content: systemPromptFor(ctx.tech) },
      { role: 'user', content: question },
    ]
    const toolCalls: AskResult['toolCalls'] = []
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(this.keys.openai ? { Authorization: `Bearer ${this.keys.openai}` } : {}) },
        body: JSON.stringify({ model: s.model, messages, tools }),
        signal: AbortSignal.timeout(5 * 60_000),
      })
      if (!res.ok) throw new BadRequestException(`Modelo local respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`)
      const data = (await res.json()) as { choices: { message: Msg; finish_reason: string }[] }
      const msg = data.choices[0].message
      messages.push(msg)
      if (!msg.tool_calls?.length) return { answer: msg.content ?? '', provider: 'openai-compatible', model: s.model, toolCalls, stopReason: data.choices[0].finish_reason }
      for (const call of msg.tool_calls) {
        let input: Record<string, unknown> = {}
        try {
          input = JSON.parse(call.function.arguments || '{}')
        } catch {
          input = {}
        }
        toolCalls.push({ name: call.function.name, input })
        messages.push({ role: 'tool', tool_call_id: call.id, content: executeTool(call.function.name, input, { rofs: this.rofs, ...ctx }).slice(0, 60_000) })
      }
    }
    return { answer: 'Limite de passos de investigação atingido.', provider: 'openai-compatible', model: s.model, toolCalls }
  }
}
