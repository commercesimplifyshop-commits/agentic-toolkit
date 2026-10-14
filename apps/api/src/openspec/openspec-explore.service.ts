import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { AiService } from '../ai/ai.service'
import { assertWritableTarget } from '../readonly/path-guard'
import { CLAUDE_DENIED_TOOLS, CommandRunner } from '../readonly/command-runner.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { OpenSpecService } from './openspec.service'

interface Turn {
  role: 'user' | 'assistant'
  content: string
  at: string
  /** Images sent with this message */
  attachments?: { id: string; name: string }[]
}

export interface ExploreSession {
  id: string
  createdAt: string
  updatedAt: string
  messages: Turn[]
  /** Change created from this conversation (the card keeps the link) */
  linkedChange?: string
}

/**
 * Stance of the conversation: OpenSpec's explore mode, focused on refining a task that arrived
 * unrefined. It reads the code, asks what is missing, and never implements or writes.
 */
const STANCE = [
  'Você ajuda um engenheiro a refinar uma tarefa deste projeto antes de virar uma mudança do OpenSpec (modo "explore").',
  'A tarefa costuma chegar mal refinada (texto de ticket, prints, pedido do cliente). Seu trabalho é transformá-la em algo claro:',
  '1. Comece resumindo o que entendeu e o objetivo de negócio.',
  '2. Investigue o código (Read, Grep, Glob) para responder o que o código já responde: módulos, classes, templates, configurações e integrações envolvidos. Cite arquivos como `caminho:linha`.',
  '3. Aponte o que falta decidir (critérios de aceite, regras de negócio, telas, casos de borda, dados, integrações) e faça no máximo 3 perguntas objetivas por vez.',
  '4. Quando houver informação suficiente, apresente o refinamento: Objetivo, Critérios de aceite (lista verificável), Fora de escopo, Impacto técnico (arquivos e módulos), Riscos e Dúvidas em aberto. Diga que o próximo passo é o botão "Transformar em proposta".',
  'Se o usuário anexar imagens, leia cada uma com a ferramenta Read e use o que elas mostram.',
  'Use diagramas em ASCII quando ajudarem. Seja direto; responda em português do Brasil.',
  'Você NÃO implementa e NÃO escreve arquivos. Se pedirem implementação, explique que o caminho é transformar a conversa em proposta.',
  'Nunca escreva senhas, tokens ou valores de app/etc/env.php.',
].join('\n')

const SESSION_ID = /^[a-f0-9]{12}$/
const KEBAB = /^[a-z0-9][a-z0-9-]{1,80}$/

/** Images the engineer attaches to the conversation (prints of the ticket, of a screen) */
export interface Attachment {
  id: string
  name: string
  type: string
  size: number
}

const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
const MAX_ATTACHMENTS_PER_MESSAGE = 6
const ATTACHMENT_ID = /^[a-f0-9]{16}\.(png|jpg|gif|webp)$/
const MAX_MESSAGE = 20_000

/** The real file type, from its first bytes: the browser's declared type is not trusted */
function sniffImage(buf: Buffer): string | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.length > 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('ascii'))) return 'gif'
  if (buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp'
  return null
}

/** A complete change, written by Claude from the conversation: every file, ready to review */
export interface ProposalPackage {
  name: string
  summary: string
  /** Paths relative to the change folder: proposal.md, design.md, tasks.md, specs/<capability>/spec.md */
  files: Record<string, string>
  /** What was adjusted, so the engineer knows (a renamed change, an ignored file) */
  notes: string[]
}

const PACKAGE_FILE = /^(proposal\.md|design\.md|tasks\.md|specs\/[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*\/spec\.md)$/
const MAX_FILE_CHARS = 200_000
const MAX_TURNS_IN_PROMPT = 12

/**
 * The JSON object in a reply from Claude. The object's markdown fields often carry code fences of
 * their own, so the outermost braces are tried before the ```json fence.
 */
export function parseJsonReply(text: string): Record<string, unknown> | null {
  const candidates: string[] = []
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1))
  const fenced = text.match(/```json\s*\n([\s\S]*)```/)
  if (fenced) candidates.push(fenced[1])
  for (const c of candidates) {
    try {
      const v = JSON.parse(c)
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
    } catch {
      // next candidate
    }
  }
  return null
}

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

  /** Folder of the images attached to conversations (in the data dir) */
  attachmentsDir(id: string) {
    const dir = path.join(this.dir(id), 'attachments')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  /** Stores an image in Agentic Toolkit's data dir (never in the repository). The real type is checked from its bytes. */
  saveAttachment(id: string, file?: { originalname: string; size: number; buffer: Buffer }): Attachment {
    if (!file?.buffer?.length) throw new BadRequestException('Envie uma imagem')
    if (file.size > MAX_ATTACHMENT_BYTES) throw new BadRequestException('Imagem maior que 5 MB')
    const ext = sniffImage(file.buffer)
    if (!ext) throw new BadRequestException('Envie imagens PNG, JPG, GIF ou WEBP')
    const attId = `${randomBytes(8).toString('hex')}.${ext}`
    const target = path.join(this.attachmentsDir(id), attId)
    assertWritableTarget(target, [this.workspaces.rootOf(id)])
    fs.writeFileSync(target, file.buffer)
    const type = Object.entries(IMAGE_EXT).find(([, e]) => e === ext)![0]
    const name = file.originalname.replace(/[^\w.\- ]+/g, '').slice(0, 120) || attId
    return { id: attId, name, type, size: file.size }
  }

  /** Absolute path of a stored image */
  attachmentFile(id: string, attId: string): string {
    if (!ATTACHMENT_ID.test(attId)) throw new BadRequestException('Anexo inválido')
    const file = path.join(this.attachmentsDir(id), attId)
    if (!fs.existsSync(file)) throw new NotFoundException('Anexo não encontrado')
    return file
  }

  /** Where the images are, one per line; Claude reads them with the Read tool. Missing files are skipped. */
  imageLines(id: string, list: { id: string; name: string }[]) {
    return list.flatMap((a) => {
      try {
        return [`- ${this.attachmentFile(id, a.id)} (${a.name})`]
      } catch {
        return []
      }
    })
  }

  /** One read-only Claude Code call; the attachments folder is readable so it can open the images */
  async ask(id: string, system: string, prompt: string): Promise<string> {
    const bin = this.ai.claudeBinary()
    if (!bin) throw new BadRequestException('Claude Code não encontrado nesta máquina')
    const root = this.workspaces.rootOf(id)
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
      '--add-dir',
      this.attachmentsDir(id),
      '--append-system-prompt',
      system,
    ]
    const res = await this.runner.run('claude', args, { executable: bin, cwd: root, stdin: prompt, timeoutMs: 8 * 60_000, protectedRoots: [root] })
    let parsed: { result?: string; is_error?: boolean } = {}
    try {
      parsed = JSON.parse(res.stdout)
    } catch {
      throw new BadRequestException(`Claude Code falhou: ${(res.stderr || res.stdout).slice(0, 300)}`)
    }
    if (parsed.is_error) throw new BadRequestException(`Claude Code: ${(parsed.result ?? 'erro').slice(0, 300)}`)
    return parsed.result ?? ''
  }

  private transcriptOf(turns: Turn[]) {
    return turns
      .map((t) => `${t.role === 'user' ? 'Usuário' : 'Você'}: ${t.content}${t.attachments?.length ? `\n[imagens anexadas: ${t.attachments.map((a) => a.name).join(', ')}]` : ''}`)
      .join('\n\n')
  }

  /**
   * Turns the refinement conversation into a complete change: proposal, design when needed,
   * tasks with numbered subtasks, and spec deltas with requirements and scenarios. Nothing is
   * written here; the engineer reviews every file before the change is created.
   */
  async proposePackage(id: string, sid: string): Promise<ProposalPackage> {
    const session = this.session(id, sid)
    if (session.messages.length < 2) throw new BadRequestException('Converse com o Claude sobre a tarefa antes de transformá-la em proposta')
    const ov = await this.openspec.overview(id)
    const existing = ov.specs.map((s) => s.id)
    const taken = new Set([...ov.changes.map((c) => c.id), ...ov.archived.map((a) => a.id.replace(/^\d{4}-\d{2}-\d{2}-/, ''))])
    const images = session.messages.flatMap((m) => m.attachments ?? [])
    const ws = this.workspaces.get(id)

    const system = [
      'Você escreve uma mudança COMPLETA do OpenSpec (schema spec-driven), em português do Brasil, a partir de uma conversa em que uma tarefa foi refinada.',
      'Responda SOMENTE com um bloco ```json, sem texto antes ou depois, com o objeto:',
      '{"name": "kebab-case curto, verbo + objeto (ex.: exibir-frete-na-pdp)", "summary": "uma frase", "files": {"proposal.md": "...", "design.md": "...", "tasks.md": "...", "specs/<capacidade>/spec.md": "..."}}',
      'proposal.md: "# Proposal" com "## Why" (problema e objetivo de negócio), "## What Changes" (lista), "## Capabilities" com "### New Capabilities" e "### Modified Capabilities" (cada item: `caminho`: o que cobre) e "## Impact" (módulos, classes, templates, configurações, APIs e dados afetados, com caminhos reais do código).',
      'design.md: só quando houver decisão técnica a registrar. "# Design" com "## Context", "## Goals / Non-Goals", "## Decisions" (com a alternativa descartada) e "## Risks / Trade-offs".',
      'tasks.md: "# Tasks" com grupos "## 1. Nome do grupo" e subtarefas "- [ ] 1.1 Descrição", pequenas e verificáveis, cada uma citando o arquivo ou a classe que muda. Cubra preparação, implementação, configuração (di.xml, layout, db_schema, admin, quando couber), testes (unitários, integração e o roteiro de teste manual) e validação final (openspec validate e conferência dos critérios de aceite). Em uma tarefa de escopo médio, espere pelo menos 3 grupos e 8 subtarefas.',
      'specs/<capacidade>/spec.md (delta): "# Spec Delta". Capacidade nova: "## Purpose" (50+ caracteres) e "## ADDED Requirements". Capacidade existente: "## MODIFIED Requirements" com o requisito inteiro reescrito. Cada requisito: "### Requirement: Nome", uma frase com MUST ou SHALL, e ao menos um "#### Scenario: Nome" com linhas "- **WHEN** ...", "- **THEN** ..." e, se preciso, "- **AND** ...". Os critérios de aceite combinados na conversa viram cenários.',
      'Capacidades são comportamentos do sistema (ex.: catalogo/frete-pdp), não tarefas. Reuse as existentes quando couberem: ' + (existing.length ? existing.join(', ') : 'nenhuma existe ainda') + '.',
      'Se a mudança não altera comportamento observável (refatoração, ferramenta, documentação), omita os arquivos de specs.',
      'Use o código (Read, Grep, Glob) para nomes reais; não invente integrações. Leia as imagens anexadas com Read. Nunca inclua senhas, tokens ou valores de app/etc/env.php.',
    ].join('\n')
    const prompt = [
      `Projeto: ${ws.name}${ws.version ? ` (${ws.edition ?? ''} ${ws.version})` : ''}.`,
      images.length ? `Imagens anexadas na conversa (leia cada uma com a ferramenta Read):\n${this.imageLines(id, images).join('\n')}` : '',
      `Conversa de refinamento:\n${this.transcriptOf(session.messages.slice(-60))}`,
    ]
      .filter(Boolean)
      .join('\n\n')
    const text = await this.ask(id, system, prompt)
    const raw = parseJsonReply(text)
    if (!raw) throw new BadRequestException('O Claude não devolveu a proposta em um formato legível. Tente de novo.')
    return this.sanitizePackage(raw, existing, taken)
  }

  /** Keeps the package inside OpenSpec's structure and flags what the engineer should look at */
  private sanitizePackage(raw: Record<string, unknown>, existing: string[], taken: Set<string>): ProposalPackage {
    const notes: string[] = []
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
    let name = str(raw.name, 80).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
    if (!KEBAB.test(name)) {
      name = 'nova-mudanca'
      notes.push('O nome sugerido não era válido; ajuste-o antes de criar')
    }
    if (taken.has(name)) {
      let n = 2
      while (taken.has(`${name}-${n}`)) n++
      notes.push(`Já existe uma mudança "${name}": o nome virou "${name}-${n}"`)
      name = `${name}-${n}`
    }
    const files: Record<string, string> = {}
    const input = raw.files && typeof raw.files === 'object' && !Array.isArray(raw.files) ? (raw.files as Record<string, unknown>) : {}
    for (const [k, v] of Object.entries(input)) {
      const key = k.replace(/^\/+/, '').trim()
      if (!PACKAGE_FILE.test(key)) {
        notes.push(`Arquivo "${k}" ignorado: fora da estrutura do OpenSpec`)
        continue
      }
      if (typeof v !== 'string' || !v.trim()) continue
      if (v.length > MAX_FILE_CHARS) {
        notes.push(`"${key}" era grande demais e foi ignorado`)
        continue
      }
      files[key] = v.endsWith('\n') ? v : `${v}\n`
    }
    if (!files['proposal.md'] || !files['tasks.md']) throw new BadRequestException('O Claude não devolveu a proposta e as tarefas. Tente de novo.')
    if (!/^- \[ \] \d+\.\d+/m.test(files['tasks.md'])) notes.push('As tarefas vieram sem subtarefas numeradas (1.1, 1.2...): revise o tasks.md')
    for (const key of Object.keys(files).filter((k) => k.startsWith('specs/'))) {
      const cap = key.slice('specs/'.length, -'/spec.md'.length)
      if (!/#### Scenario:/.test(files[key])) notes.push(`A spec "${cap}" está sem cenários: o OpenSpec exige ao menos um por requisito`)
      if (existing.includes(cap) && !/## MODIFIED Requirements/.test(files[key])) notes.push(`"${cap}" já existe: confira se os requisitos são novos (ADDED) ou alterados (MODIFIED)`)
    }
    return { name, summary: str(raw.summary, 300), files, notes }
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

  async send(id: string, input: { sessionId?: string; message?: string; attachments?: { id: string; name?: string }[] }) {
    const attachments = (input.attachments ?? []).slice(0, MAX_ATTACHMENTS_PER_MESSAGE).map((a) => {
      this.attachmentFile(id, a.id)
      return { id: a.id, name: String(a.name ?? a.id).replace(/[^\w.\- ]+/g, '').slice(0, 120) || a.id }
    })
    const message = (input.message ?? '').trim() || (attachments.length ? '(imagens anexadas)' : '')
    if (message.length < 2 || message.length > MAX_MESSAGE) throw new BadRequestException(`Mensagem entre 2 e ${MAX_MESSAGE} caracteres`)

    const now = new Date().toISOString()
    const session: ExploreSession = input.sessionId
      ? this.session(id, input.sessionId)
      : { id: randomBytes(6).toString('hex'), createdAt: now, updatedAt: now, messages: [] }

    const earlier = session.messages.flatMap((m) => m.attachments ?? [])
    const transcript = this.transcriptOf(session.messages.slice(-MAX_TURNS_IN_PROMPT))
    const prompt = [
      await this.context(id),
      transcript ? `Conversa até aqui:\n${transcript}` : '',
      earlier.length ? `Imagens de mensagens anteriores (leia se precisar):\n${this.imageLines(id, earlier).join('\n')}` : '',
      `Nova mensagem do usuário:\n${message}`,
      attachments.length ? `Imagens anexadas nesta mensagem (leia cada uma com a ferramenta Read antes de responder):\n${this.imageLines(id, attachments).join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')

    const reply = (await this.ask(id, STANCE, prompt)).trim() || '(sem resposta)'
    session.messages.push({ role: 'user', content: message, at: now, ...(attachments.length ? { attachments } : {}) }, { role: 'assistant', content: reply, at: new Date().toISOString() })
    session.updatedAt = new Date().toISOString()
    this.save(id, session)
    return session
  }
}
