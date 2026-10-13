import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { AiService } from '../ai/ai.service'
import { CLAUDE_DENIED_TOOLS, CommandRunner } from '../readonly/command-runner.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { OpenSpecService } from './openspec.service'

interface Turn {
  role: 'user' | 'assistant'
  content: string
  at: string
}

export interface ExploreSession {
  id: string
  createdAt: string
  updatedAt: string
  messages: Turn[]
  /** Change created from this conversation (the card keeps the link) */
  linkedChange?: string
}

/** Stance of OpenSpec's explore mode: think, investigate, never implement, ask before any write. */
const STANCE = [
  'Você é um parceiro de pensamento para explorar ideias sobre este projeto, no modo "explore" do OpenSpec.',
  'Pense em voz alta, seja curioso e faça uma pergunta focada por vez quando ela destravar uma decisão. Não force um roteiro nem um formato fixo.',
  'Investigue o código de verdade (Read, Grep, Glob) antes de perguntar algo que o código já responde. Cite arquivos como `caminho:linha`.',
  'Use diagramas em ASCII quando ajudarem a pensar.',
  'Você NÃO implementa e NÃO escreve arquivos. Se o usuário pedir implementação, diga que o modo explore não implementa e que o caminho é uma mudança (/opsx:propose).',
  'Quando o entendimento estiver claro, sugira o "porquê" e as capacidades prováveis de uma mudança. Quem decide criar a mudança é o usuário, pelo botão "Capturar como mudança" na tela.',
  'Nunca escreva senhas, tokens ou valores de app/etc/env.php.',
].join('\n')

const SESSION_ID = /^[a-f0-9]{12}$/
const KEBAB = /^[a-z0-9][a-z0-9-]{1,80}$/
const CAPABILITY_PATH = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/

export interface ProposeDraft {
  name: string
  why: string
  whatChanges: string[]
  newCapabilities: string[]
  modifiedCapabilities: string[]
  purposes: Record<string, string>
  /** Why the draft was adjusted (e.g. a capability that already exists) */
  notes: string[]
}
const MAX_TURNS_IN_PROMPT = 12

@Injectable()
export class OpenSpecExploreService {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly ai: AiService,
    private readonly runner: CommandRunner,
    private readonly openspec: OpenSpecService,
  ) {}

  private dir(id: string) {
    const dir = path.join(this.workspaces.dataDirOf(id), 'explore')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  private file(id: string, sid: string) {
    if (!SESSION_ID.test(sid)) throw new BadRequestException('Conversa inválida')
    return path.join(this.dir(id), `${sid}.json`)
  }

  private save(id: string, s: ExploreSession) {
    fs.writeFileSync(this.file(id, s.id), JSON.stringify(s, null, 2))
  }

  sessions(id: string) {
    const dir = this.dir(id)
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as ExploreSession
          const first = s.messages.find((m) => m.role === 'user')?.content ?? 'Conversa sem mensagens'
          return { id: s.id, title: first.slice(0, 70), updatedAt: s.updatedAt, turns: s.messages.length, linkedChange: s.linkedChange ?? null }
        } catch {
          return null
        }
      })
      .filter(Boolean)
      .sort((a, b) => (b!.updatedAt > a!.updatedAt ? 1 : -1))
  }

  /**
   * Connection check for the chat header. Two steps: the Claude Code binary answers
   * `--version`, then a one-word question proves the session works. Costs almost nothing.
   */
  async connection(id: string) {
    const checkedAt = new Date().toISOString()
    const bin = this.ai.claudeBinary()
    if (!bin) return { ok: false, checkedAt, message: 'Claude Code não encontrado nesta máquina. Instale-o ou informe o caminho em Configurações.' }
    const root = this.workspaces.rootOf(id)
    let version = ''
    try {
      const v = await this.runner.run('claude', ['--version'], { executable: bin, cwd: root, timeoutMs: 20_000, protectedRoots: [root] })
      version = v.stdout.trim().split('\n').pop() ?? ''
      if (v.code !== 0) return { ok: false, checkedAt, message: `O Claude Code não respondeu à versão (código ${v.code}).` }
    } catch (e) {
      return { ok: false, checkedAt, message: `Não consegui executar o Claude Code: ${(e as Error).message}` }
    }
    try {
      const res = await this.runner.run(
        'claude',
        ['-p', '--output-format', 'json', '--tools', 'Read', '--allowedTools', 'Read', '--disallowedTools', CLAUDE_DENIED_TOOLS.join(','), '--setting-sources', 'user', '--strict-mcp-config', '--no-session-persistence'],
        { executable: bin, cwd: root, stdin: 'Responda apenas com a palavra: ok', timeoutMs: 60_000, protectedRoots: [root] },
      )
      const parsed = JSON.parse(res.stdout || '{}') as { result?: string; is_error?: boolean }
      if (parsed.is_error) return { ok: false, checkedAt, version, message: `Claude Code respondeu com erro: ${(parsed.result ?? '').slice(0, 200)}` }
      return { ok: true, checkedAt, version, message: version ? `Conectado · ${version}` : 'Conectado ao Claude Code' }
    } catch (e) {
      const msg = (e as Error).message
      const hint = /login|auth|unauthori|api key|credential/i.test(msg) ? ' Verifique se o Claude Code está logado.' : ''
      return { ok: false, checkedAt, version, message: `Sem resposta do Claude Code: ${msg.slice(0, 200)}.${hint}` }
    }
  }

  /**
   * Facilitator: reads the whole conversation and drafts the proposal fields (name, why,
   * what changes, capabilities). The draft is only returned; the form asks the user to confirm.
   */
  async proposeDraft(id: string, sid: string): Promise<ProposeDraft> {
    const session = this.session(id, sid)
    if (session.messages.length < 2) throw new BadRequestException('Explore a ideia um pouco antes de propor')
    const bin = this.ai.claudeBinary()
    if (!bin) throw new BadRequestException('Claude Code não encontrado nesta máquina')
    const root = this.workspaces.rootOf(id)
    const ov = await this.openspec.overview(id)
    const existing = ov.specs.map((s) => s.id)

    const transcript = session.messages.slice(-40).map((t) => `${t.role === 'user' ? 'Usuário' : 'Você'}: ${t.content}`).join('\n\n')
    const system = [
      'Você transforma uma conversa de exploração em um rascunho de proposta do OpenSpec, em português do Brasil.',
      'Responda SOMENTE com um bloco ```json, sem texto antes ou depois, com o objeto:',
      '{"name": "kebab-case curto", "why": "porquê, 1-3 frases", "whatChanges": ["item", ...], "newCapabilities": [{"path": "caminho/kebab", "purpose": "50+ caracteres"}], "modifiedCapabilities": ["caminho existente"]}',
      'Capacidades são comportamentos do sistema (ex.: checkout, pagamento/pix), não tarefas. Reuse as existentes quando couberem. Não invente integrações que a conversa não mostrou.',
      'Se a mudança não altera comportamento de nenhuma spec, deixe as duas listas vazias.',
    ].join('\n')
    const prompt = [
      `Specs que já existem: ${existing.length ? existing.join(', ') : 'nenhuma'}`,
      `Conversa de exploração:\n${transcript}`,
    ].join('\n\n')
    const args = ['-p', '--output-format', 'json', '--tools', 'Read,Grep,Glob', '--allowedTools', 'Read,Grep,Glob', '--disallowedTools', CLAUDE_DENIED_TOOLS.join(','), '--setting-sources', 'user', '--strict-mcp-config', '--no-session-persistence', '--append-system-prompt', system]
    const res = await this.runner.run('claude', args, { executable: bin, cwd: root, stdin: prompt, timeoutMs: 5 * 60_000, protectedRoots: [root] })
    let parsed: { result?: string; is_error?: boolean } = {}
    try {
      parsed = JSON.parse(res.stdout)
    } catch {
      throw new BadRequestException(`Claude Code falhou: ${(res.stderr || res.stdout).slice(0, 300)}`)
    }
    if (parsed.is_error) throw new BadRequestException(`Claude Code: ${(parsed.result ?? 'erro').slice(0, 300)}`)
    const text = parsed.result ?? ''
    const block = text.match(/```json\s*\n([\s\S]*?)```/) ?? text.match(/\{[\s\S]*\}/)
    let raw: Record<string, unknown> = {}
    try {
      raw = JSON.parse(block ? (block[1] ?? block[0]) : '{}')
    } catch {
      throw new BadRequestException('O Claude não devolveu um rascunho legível. Tente de novo.')
    }
    return this.sanitizeDraft(raw, existing)
  }

  /** Keeps the draft inside OpenSpec's rules: kebab names, new capabilities not yet specified, modified ones that exist. */
  private sanitizeDraft(raw: Record<string, unknown>, existing: string[]): ProposeDraft {
    const notes: string[] = []
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
    const name = str(raw.name, 80).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
    const why = str(raw.why, 1500)
    const whatChanges = Array.isArray(raw.whatChanges) ? raw.whatChanges.map((x) => str(x, 200)).filter(Boolean).slice(0, 12) : []
    const purposes: Record<string, string> = {}
    const newCaps: string[] = []
    const modCaps: string[] = []
    const addNew = (path: string, purpose: string) => {
      if (!CAPABILITY_PATH.test(path)) return notes.push(`Capacidade "${path}" ignorada: nome inválido`)
      if (existing.includes(path)) {
        if (!modCaps.includes(path)) modCaps.push(path)
        notes.push(`"${path}" já existe, então foi tratada como modificada`)
        return
      }
      if (!newCaps.includes(path)) newCaps.push(path)
      purposes[path] = purpose
    }
    if (Array.isArray(raw.newCapabilities)) {
      for (const c of raw.newCapabilities as unknown[]) {
        if (typeof c === 'string') addNew(c.trim(), '')
        else if (c && typeof c === 'object') addNew(str((c as { path?: unknown }).path, 160), str((c as { purpose?: unknown }).purpose, 400))
      }
    }
    if (Array.isArray(raw.modifiedCapabilities)) {
      for (const c of raw.modifiedCapabilities as unknown[]) {
        const path = typeof c === 'string' ? c.trim() : ''
        if (existing.includes(path)) modCaps.push(path)
        else if (path) notes.push(`"${path}" não existe entre as specs: ignorada como modificada`)
      }
    }
    return {
      name: KEBAB.test(name) ? name : '',
      why,
      whatChanges,
      newCapabilities: newCaps,
      modifiedCapabilities: [...new Set(modCaps)],
      purposes,
      notes,
    }
  }

  /** Records which change was created from this conversation. Only Agentic Toolkit's copy changes. */
  link(id: string, sid: string, change: string) {
    const s = this.session(id, sid)
    s.linkedChange = change
    this.save(id, s)
    return { ok: true }
  }

  /** Removes a conversation from Agentic Toolkit's data dir (never the repository). */
  remove(id: string, sid: string) {
    const file = this.file(id, sid)
    if (!fs.existsSync(file)) throw new NotFoundException('Conversa não encontrada')
    fs.unlinkSync(file)
    return { ok: true }
  }

  session(id: string, sid: string): ExploreSession {
    const file = this.file(id, sid)
    if (!fs.existsSync(file)) throw new NotFoundException('Conversa não encontrada')
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  }

  /** What the conversation can know about the project without reading every file. */
  private async context(id: string) {
    const ov = await this.openspec.overview(id)
    if (!ov.installed) return 'O OpenSpec ainda não está instalado nesta instalação. Responda sem contexto de specs e mudanças.'
    const specs = ov.specs.slice(0, 40).map((s) => `- ${s.id}: ${s.purpose.slice(0, 160) || '(sem propósito)'}`)
    const changes = ov.changes.slice(0, 20).map((c) => `- ${c.id} (${c.status}): ${c.why.slice(0, 160) || c.title}`)
    return [
      `Specs existentes (${ov.specs.length}):`,
      ...(specs.length ? specs : ['- nenhuma']),
      `Mudanças ativas (${ov.changes.length}):`,
      ...(changes.length ? changes : ['- nenhuma']),
    ].join('\n')
  }

  async send(id: string, input: { sessionId?: string; message: string }) {
    const message = input.message.trim()
    if (message.length < 2 || message.length > 4000) throw new BadRequestException('Mensagem entre 2 e 4000 caracteres')
    const bin = this.ai.claudeBinary()
    if (!bin) throw new BadRequestException('Claude Code não encontrado nesta máquina')
    const root = this.workspaces.rootOf(id)

    const now = new Date().toISOString()
    const session: ExploreSession = input.sessionId
      ? this.session(id, input.sessionId)
      : { id: randomBytes(6).toString('hex'), createdAt: now, updatedAt: now, messages: [] }

    const transcript = session.messages
      .slice(-MAX_TURNS_IN_PROMPT)
      .map((t) => `${t.role === 'user' ? 'Usuário' : 'Você'}: ${t.content}`)
      .join('\n\n')
    const prompt = [await this.context(id), transcript ? `Conversa até aqui:\n${transcript}` : '', `Nova mensagem do usuário:\n${message}`].filter(Boolean).join('\n\n')

    const args = [
      '-p',
      '--output-format',
      'json',
      '--tools',
      'Read,Grep,Glob',
      '--allowedTools',
      'Read,Grep,Glob',
      '--disallowedTools',
      CLAUDE_DENIED_TOOLS.join(','),
      '--setting-sources',
      'user',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--append-system-prompt',
      STANCE,
    ]
    const res = await this.runner.run('claude', args, { executable: bin, cwd: root, stdin: prompt, timeoutMs: 5 * 60_000, protectedRoots: [root] })
    let parsed: { result?: string; is_error?: boolean } = {}
    try {
      parsed = JSON.parse(res.stdout)
    } catch {
      throw new BadRequestException(`Claude Code falhou: ${(res.stderr || res.stdout).slice(0, 300)}`)
    }
    if (parsed.is_error) throw new BadRequestException(`Claude Code: ${(parsed.result ?? 'erro').slice(0, 300)}`)

    const reply = (parsed.result ?? '').trim() || '(sem resposta)'
    session.messages.push({ role: 'user', content: message, at: now }, { role: 'assistant', content: reply, at: new Date().toISOString() })
    session.updatedAt = new Date().toISOString()
    this.save(id, session)
    return session
  }
}
