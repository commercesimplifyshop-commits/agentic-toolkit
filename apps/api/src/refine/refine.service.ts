import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { AiService } from '../ai/ai.service'
import { GitOpsService } from '../gitops/gitops.service'
import { OpenSpecExploreService, parseJsonReply } from '../openspec/openspec-explore.service'
import { AuditService } from '../readonly/audit.service'
import { CLAUDE_SECRET_FILES, CommandRunner } from '../readonly/command-runner.service'
import { WorkspaceEnvService } from '../settings/workspace-env.service'
import { DOC_HOSTS } from '../techs/sfcc/knowledge'
import { SfccService } from '../techs/sfcc/sfcc.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { refineProfile } from './profiles'
import { skillsInEvent, withSkills } from '../skills/claude-skills'
import { SkillsService } from '../skills/skills.service'

export interface Turn {
  role: 'user' | 'assistant'
  content: string
  at: string
  attachments?: { id: string; name: string }[]
  /** Skills Claude loaded for this answer */
  skills?: string[]
}

export interface Split {
  title: string
  scope: string
}

/** One concept of the "Para quem vem do Adobe" guide */
export interface LearningItem {
  topic: string
  adobe: string
  sfcc: string
  why: string
  docs: { title: string; url: string }[]
}

/** The refined card: what goes into Jira or Azure DevOps, and what Claude follows to develop */
export interface Refinement {
  title: string
  /** Context, problem and business goal, for someone who does not know the code */
  business: string
  /** The solution: approach, files that change, decisions, data, how to test. The main part of the card. */
  technical: string
  /** Ordered, verifiable steps: the development follows them and the progress counts them */
  plan: string[]
  acceptance: string[]
  observations: string[]
  /** Salesforce B2C: what is done in the Business Manager or imported, outside the code */
  platformSteps?: string[]
  /** Salesforce B2C: the guide for engineers who come from Adobe Commerce */
  learning?: LearningItem[]
  /** Skills Claude loaded to write the card */
  skills?: string[]
  complexity: { level: 'baixa' | 'media' | 'alta'; reasoning: string; recommendSplit: boolean; splits: Split[] }
  generatedAt: string
}

export interface DevState {
  status: 'executando' | 'concluido' | 'falhou' | 'cancelado' | 'interrompido'
  startedAt: string
  finishedAt?: string
  /** 0-100, from the plan steps Claude reports as done */
  progress: number
  done: number
  total: number
  /** The step being worked on */
  step?: string
  /** Last things Claude did (edits, commands, notes) */
  activity: { at: string; text: string }[]
  summary?: string
  error?: string
  costUsd?: number
  /** Skills Claude loaded during the development */
  skills?: string[]
}

export type CardStatus = 'refinando' | 'refinado' | 'dividido' | 'pronto' | 'desenvolvendo' | 'concluido' | 'falhou' | 'interrompido'

export interface Card {
  id: string
  title: string
  status: CardStatus
  parentId?: string
  childIds?: string[]
  createdAt: string
  updatedAt: string
  /** What Claude is doing right now for this card ("conversando", "refinando"), if anything */
  busy?: string
  error?: string
  messages: Turn[]
  refinement?: Refinement
  git?: { branch: string; base?: string; path: string; preparedAt: string }
  dev?: DevState
}

const CARD_ID = /^[a-f0-9]{10}$/
const MAX_MESSAGE = 20_000
const MAX_TURNS_IN_PROMPT = 14
const DEV_TOOLS = 'Read,Grep,Glob,Edit,MultiEdit,Write,Bash,TodoWrite'
const DEV_TIMEOUT_MS = 4 * 60 * 60_000
/** The task may change code, never the credential files */
const DEV_DENIED = [...CLAUDE_SECRET_FILES, ...CLAUDE_SECRET_FILES.map((r) => r.replace('Read(', 'Edit(')), ...CLAUDE_SECRET_FILES.map((r) => r.replace('Read(', 'Write('))].join(',')

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const list = (v: unknown, max: number, each: number) => (Array.isArray(v) ? v.map((x) => str(x, each)).filter(Boolean).slice(0, max) : [])

/**
 * Refinement cards: a raw demand becomes a refined task (business, technical description, plan,
 * acceptance criteria, points of attention), may be split, gets its own branch and worktree, and
 * can be developed by Claude in a session of its own while the card shows the progress.
 */
@Injectable()
export class RefineService implements OnApplicationBootstrap {
  private readonly log = new Logger('Refinamento')
  /** Development sessions running now, by `${workspace}:${card}` */
  private readonly running = new Map<string, AbortController>()

  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly explore: OpenSpecExploreService,
    private readonly gitops: GitOpsService,
    private readonly ai: AiService,
    private readonly runner: CommandRunner,
    private readonly audit: AuditService,
    private readonly env: WorkspaceEnvService,
    private readonly sfcc: SfccService,
    private readonly skills: SkillsService,
  ) {}

  private profile(id: string) {
    return refineProfile(this.workspaces.get(id).tech)
  }

  /** A session cut by a restart cannot resume: the card says so instead of showing it running forever */
  onApplicationBootstrap() {
    for (const ws of this.workspaces.list()) {
      let dir: string
      try {
        dir = this.dir(ws.id)
      } catch {
        continue
      }
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
        try {
          const card = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Card
          let changed = false
          if (card.dev?.status === 'executando') {
            card.dev = { ...card.dev, status: 'interrompido', finishedAt: new Date().toISOString(), error: 'A aplicação foi reiniciada durante o desenvolvimento' }
            card.status = 'interrompido'
            changed = true
          }
          if (card.busy) {
            card.busy = undefined
            changed = true
          }
          if (changed) this.save(ws.id, card)
        } catch {
          // an unreadable card is skipped
        }
      }
    }
  }

  private dir(id: string) {
    const dir = path.join(this.workspaces.dataDirOf(id), 'refine')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  private file(id: string, cardId: string) {
    if (!CARD_ID.test(cardId)) throw new BadRequestException('Card inválido')
    return path.join(this.dir(id), `${cardId}.json`)
  }

  private save(id: string, card: Card) {
    card.updatedAt = new Date().toISOString()
    const file = this.file(id, card.id)
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(card, null, 2))
    fs.renameSync(`${file}.tmp`, file)
  }

  get(id: string, cardId: string): Card {
    const file = this.file(id, cardId)
    if (!fs.existsSync(file)) throw new NotFoundException('Card não encontrado')
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Card
  }

  /** Every card, without the conversation: the board */
  list(id: string) {
    const dir = this.dir(id)
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const c = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Card
          return {
            id: c.id,
            title: c.title,
            status: c.status,
            parentId: c.parentId,
            childIds: c.childIds,
            busy: c.busy,
            updatedAt: c.updatedAt,
            complexity: c.refinement?.complexity.level,
            git: c.git,
            dev: c.dev ? { status: c.dev.status, progress: c.dev.progress, done: c.dev.done, total: c.dev.total, step: c.dev.step, last: c.dev.activity.at(-1)?.text } : undefined,
          }
        } catch {
          return null
        }
      })
      .filter(Boolean)
      .sort((a, b) => (b!.updatedAt > a!.updatedAt ? 1 : -1))
  }

  private newCard(title: string, parentId?: string): Card {
    const now = new Date().toISOString()
    return { id: randomBytes(5).toString('hex'), title: title.slice(0, 120) || 'Nova demanda', status: 'refinando', parentId, createdAt: now, updatedAt: now, messages: [] }
  }

  private attachmentsOf(id: string, input?: { id: string; name?: string }[]) {
    return (input ?? []).slice(0, 6).map((a) => {
      this.explore.attachmentFile(id, a.id)
      return { id: a.id, name: String(a.name ?? a.id).replace(/[^\w.\- ]+/g, '').slice(0, 120) || a.id }
    })
  }

  private transcript(turns: Turn[]) {
    return turns
      .map((t) => `${t.role === 'user' ? 'Usuário' : 'Você'}: ${t.content}${t.attachments?.length ? `\n[imagens anexadas: ${t.attachments.map((a) => a.name).join(', ')}]` : ''}`)
      .join('\n\n')
  }

  private projectLine(id: string) {
    const ws = this.workspaces.get(id)
    const line = `Projeto: ${ws.name}${ws.edition ? ` (${ws.edition}${ws.version ? ` ${ws.version}` : ''})` : ''}.`
    if (ws.tech !== 'salesforce-b2c') return line
    try {
      return `${line}\n${this.sfcc.promptContext(id)}`
    } catch {
      return line
    }
  }

  /** One turn of the conversation: Claude reads the code and the images, and answers */
  private async converse(id: string, card: Card, message: string, attachments: { id: string; name: string }[]) {
    const earlier = card.messages.flatMap((m) => m.attachments ?? [])
    const prompt = [
      this.projectLine(id),
      card.parentId ? 'Esta tarefa é uma parte de uma demanda maior: refine só o escopo desta parte.' : '',
      card.messages.length ? `Conversa até aqui:\n${this.transcript(card.messages.slice(-MAX_TURNS_IN_PROMPT))}` : '',
      earlier.length ? `Imagens de mensagens anteriores (leia se precisar):\n${this.explore.imageLines(id, earlier).join('\n')}` : '',
      `Nova mensagem do usuário:\n${message}`,
      attachments.length ? `Imagens anexadas nesta mensagem (leia cada uma com a ferramenta Read antes de responder):\n${this.explore.imageLines(id, attachments).join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
    const now = new Date().toISOString()
    const answer = await this.explore.ask(id, this.profile(id).stance, prompt, 'refine')
    const reply = answer.text.trim() || '(sem resposta)'
    card.messages.push(
      { role: 'user', content: message, at: now, ...(attachments.length ? { attachments } : {}) },
      { role: 'assistant', content: reply, at: new Date().toISOString(), ...(answer.skills.length ? { skills: answer.skills } : {}) },
    )
  }

  /** A new demand: the card is created with the first turn of the conversation already answered */
  async create(id: string, input: { message?: string; attachments?: { id: string; name?: string }[] }) {
    const attachments = this.attachmentsOf(id, input.attachments)
    const message = (input.message ?? '').trim() || (attachments.length ? '(imagens anexadas)' : '')
    if (message.length < 2 || message.length > MAX_MESSAGE) throw new BadRequestException(`Descreva a demanda (até ${MAX_MESSAGE} caracteres) ou anexe uma imagem`)
    const card = this.newCard(message.split('\n')[0].slice(0, 80))
    card.busy = 'conversando'
    this.save(id, card)
    try {
      await this.converse(id, card, message, attachments)
    } finally {
      card.busy = undefined
      this.save(id, card)
    }
    return card
  }

  async message(id: string, cardId: string, input: { message?: string; attachments?: { id: string; name?: string }[] }) {
    const card = this.get(id, cardId)
    if (card.busy) throw new ConflictException(`O Claude ainda está ${card.busy} neste card`)
    const attachments = this.attachmentsOf(id, input.attachments)
    const message = (input.message ?? '').trim() || (attachments.length ? '(imagens anexadas)' : '')
    if (message.length < 2 || message.length > MAX_MESSAGE) throw new BadRequestException(`Mensagem entre 2 e ${MAX_MESSAGE} caracteres`)
    card.busy = 'conversando'
    this.save(id, card)
    try {
      await this.converse(id, card, message, attachments)
    } finally {
      card.busy = undefined
      this.save(id, card)
    }
    return card
  }

  /** Writes the refined card from the conversation: business, technical description, plan, criteria, complexity */
  async refine(id: string, cardId: string) {
    const card = this.get(id, cardId)
    if (card.busy) throw new ConflictException(`O Claude ainda está ${card.busy} neste card`)
    if (card.messages.length < 2) throw new BadRequestException('Converse com o Claude sobre a demanda antes de gerar o card')
    card.busy = 'refinando'
    card.error = undefined
    this.save(id, card)
    try {
      const images = card.messages.flatMap((m) => m.attachments ?? [])
      const prompt = [
        this.projectLine(id),
        card.parentId ? 'Esta tarefa é uma parte de uma demanda maior: o card cobre só o escopo desta parte; não recomende dividir de novo sem necessidade.' : '',
        images.length ? `Imagens anexadas na conversa (leia cada uma com a ferramenta Read):\n${this.explore.imageLines(id, images).join('\n')}` : '',
        `Conversa de refinamento:\n${this.transcript(card.messages.slice(-60))}`,
      ]
        .filter(Boolean)
        .join('\n\n')
      const { text, skills } = await this.explore.ask(id, this.profile(id).rules, prompt, 'refine')
      const raw = parseJsonReply(text)
      if (!raw) {
        this.log.warn(`Card ${card.id}: resposta sem JSON legível (${text.length} caracteres): ${text.slice(0, 300)}`)
        throw new BadRequestException('O Claude não devolveu o card em um formato legível. Tente de novo.')
      }
      card.refinement = { ...this.sanitize(raw, this.profile(id).learning), ...(skills.length ? { skills } : {}) }
      card.title = card.refinement.title || card.title
      if (card.status === 'refinando') card.status = 'refinado'
    } catch (e) {
      card.error = (e as Error).message
      throw e
    } finally {
      card.busy = undefined
      this.save(id, card)
    }
    return card
  }

  private sanitize(raw: Record<string, unknown>, learning = false): Refinement {
    const c = (raw.complexity ?? {}) as Record<string, unknown>
    const level = ['baixa', 'media', 'alta'].includes(String(c.level)) ? (String(c.level) as Refinement['complexity']['level']) : 'media'
    const splits = Array.isArray(c.splits)
      ? (c.splits as unknown[])
          .map((s) => ({ title: str((s as Record<string, unknown>)?.title, 120), scope: str((s as Record<string, unknown>)?.scope, 2000) }))
          .filter((s) => s.title && s.scope)
          .slice(0, 4)
      : []
    const technical = str(raw.technical, 40_000)
    const plan = list(raw.plan, 12, 400)
    if (!technical || plan.length === 0) throw new BadRequestException('O card veio sem descrição técnica ou sem plano. Tente gerar de novo.')
    return {
      title: str(raw.title, 120),
      business: str(raw.business, 20_000),
      technical,
      plan,
      acceptance: list(raw.acceptance, 20, 600),
      observations: list(raw.observations, 20, 600),
      ...(learning ? { platformSteps: list(raw.platformSteps, 20, 600), learning: learningOf(raw.learning) } : {}),
      complexity: { level, reasoning: str(c.reasoning, 2000), recommendSplit: Boolean(c.recommendSplit) && splits.length >= 2, splits },
      generatedAt: new Date().toISOString(),
    }
  }

  /** Manual edits of the refined card (it is the engineer's card, Claude only drafts it) */
  update(id: string, cardId: string, patch: Partial<Pick<Refinement, 'business' | 'technical' | 'plan' | 'acceptance' | 'observations' | 'platformSteps'>> & { title?: string }) {
    const card = this.get(id, cardId)
    if (patch.title !== undefined) card.title = str(patch.title, 120) || card.title
    if (card.refinement) {
      if (patch.business !== undefined) card.refinement.business = str(patch.business, 20_000)
      if (patch.technical !== undefined) card.refinement.technical = str(patch.technical, 40_000)
      if (patch.plan !== undefined) card.refinement.plan = list(patch.plan, 12, 400)
      if (patch.acceptance !== undefined) card.refinement.acceptance = list(patch.acceptance, 20, 600)
      if (patch.observations !== undefined) card.refinement.observations = list(patch.observations, 20, 600)
      if (patch.platformSteps !== undefined) card.refinement.platformSteps = list(patch.platformSteps, 20, 600)
      if (patch.title !== undefined) card.refinement.title = card.title
    }
    this.save(id, card)
    return card
  }

  /**
   * Splits a card into parts. Each part becomes its own card and goes through the same refinement,
   * with its own scope, in the background; the board shows each one as it is refined.
   */
  split(id: string, cardId: string, splits: Split[]) {
    const parent = this.get(id, cardId)
    const parts = (splits ?? []).map((s) => ({ title: str(s?.title, 120), scope: str(s?.scope, 2000) })).filter((s) => s.title && s.scope)
    if (parts.length < 2 || parts.length > 6) throw new BadRequestException('Divida em 2 a 6 partes, cada uma com título e escopo')
    const context = [parent.refinement?.business, parent.refinement?.technical].filter(Boolean).join('\n\n').slice(0, 12_000)
    const children = parts.map((p) => {
      const child = this.newCard(p.title, parent.id)
      child.busy = 'refinando'
      this.save(id, child)
      return { child, seed: `Esta é uma parte da demanda "${parent.title}".\n\nParte: ${p.title}\nEscopo desta parte: ${p.scope}\n\nContexto da demanda original:\n${context || this.transcript(parent.messages.slice(-6))}` }
    })
    parent.childIds = [...(parent.childIds ?? []), ...children.map((c) => c.child.id)]
    parent.status = 'dividido'
    this.save(id, parent)
    // the same refinement, part by part: a conversation turn about the scope, then the card
    void (async () => {
      for (const { child, seed } of children) {
        try {
          const card = this.get(id, child.id)
          await this.converse(id, card, seed, [])
          card.busy = undefined
          this.save(id, card)
          await this.refine(id, child.id)
        } catch (e) {
          const card = this.get(id, child.id)
          card.busy = undefined
          card.error = (e as Error).message
          this.save(id, card)
        }
      }
    })()
    return { parent, children: children.map((c) => c.child.id) }
  }

  remove(id: string, cardId: string) {
    const card = this.get(id, cardId)
    if (this.running.has(`${id}:${cardId}`)) throw new ConflictException('Pare o desenvolvimento antes de excluir o card')
    fs.unlinkSync(this.file(id, cardId))
    if (card.parentId) {
      try {
        const parent = this.get(id, card.parentId)
        parent.childIds = (parent.childIds ?? []).filter((c) => c !== cardId)
        this.save(id, parent)
      } catch {
        // the parent was removed already
      }
    }
    return { ok: true }
  }

  /**
   * Prepares the task's branch: a new one from a base (optionally brought up to date first) or an
   * existing one, each in a worktree next to the project. The card keeps where it is.
   */
  async prepareGit(id: string, cardId: string, input: { mode: 'new' | 'existing'; branch: string; base?: string; updateBase?: boolean }) {
    const card = this.get(id, cardId)
    if (!card.refinement) throw new BadRequestException('Gere o card refinado antes de preparar o git')
    const branch = this.gitops.requireBranchName(input.branch)
    let wt: { path: string; branch: string; reused: boolean }
    if (input.mode === 'new') {
      const base = this.gitops.requireBranchName(input.base)
      if (input.updateBase) await this.gitops.updateBase(id, base)
      wt = await this.gitops.addWorktree(id, { branch, base })
    } else {
      wt = await this.gitops.addWorktree(id, { branch })
    }
    card.git = { branch, base: input.mode === 'new' ? input.base : undefined, path: wt.path, preparedAt: new Date().toISOString() }
    if (!['desenvolvendo', 'concluido'].includes(card.status)) card.status = 'pronto'
    this.save(id, card)
    this.audit.record({ action: 'refine.git', kind: 'repo-write', method: 'GIT', url: `card ${card.id}`, workspace: id, verdict: 'allowed', detail: `${input.mode === 'new' ? `branch ${branch} a partir de ${input.base}` : `branch ${branch}`} em ${wt.path}` })
    return card
  }

  /** Starts Claude on the task, in its worktree, following the technical description. Returns at once. */
  develop(id: string, cardId: string) {
    const card = this.get(id, cardId)
    if (!card.refinement) throw new BadRequestException('Gere o card refinado antes de desenvolver')
    if (!card.git || !fs.existsSync(card.git.path)) throw new BadRequestException('Prepare a branch e o worktree da tarefa antes de desenvolver')
    const key = `${id}:${cardId}`
    if (this.running.has(key)) throw new ConflictException('O Claude já está desenvolvendo esta tarefa')
    // an upload running from this worktree keeps a copy of dw.json next to the cartridges
    if (fs.existsSync(path.join(card.git.path, 'cartridges', 'dw.json'))) throw new ConflictException('Há um upload para a instância rodando a partir desta tarefa: pare o upload antes de desenvolver')
    const bin = this.ai.claudeBinary()
    if (!bin) throw new BadRequestException('Claude Code não encontrado nesta máquina')

    const plan = card.refinement.plan
    card.status = 'desenvolvendo'
    card.dev = { status: 'executando', startedAt: new Date().toISOString(), progress: 0, done: 0, total: plan.length, step: plan[0], activity: [] }
    this.save(id, card)
    this.audit.record({ action: 'refine.develop', kind: 'repo-write', method: 'CLAUDE', url: `card ${card.id}`, workspace: id, verdict: 'allowed', detail: `desenvolvimento em ${card.git.path} (${card.git.branch})` })

    const ctrl = new AbortController()
    this.running.set(key, ctrl)
    void this.runDevelopment(id, card, bin, ctrl).finally(() => this.running.delete(key))
    return card
  }

  cancel(id: string, cardId: string) {
    const ctrl = this.running.get(`${id}:${cardId}`)
    if (!ctrl) return { cancelled: false }
    ctrl.abort()
    return { cancelled: true }
  }

  private devPrompt(id: string, card: Card) {
    const r = card.refinement!
    const n = r.plan.length
    const rules = this.profile(id).devRules(devContext(card.git!.path))
    return [
      `Você vai desenvolver esta tarefa no worktree atual (${card.git!.path}), na branch ${card.git!.branch}. A descrição técnica é a solução combinada no refinamento: siga-a.`,
      '',
      `# ${card.title}`,
      '',
      '## Descrição de negócio',
      r.business || '(não informada)',
      '',
      '## Descrição técnica',
      r.technical,
      '',
      `## Plano (${n} passos)`,
      ...r.plan.map((p, i) => `${i + 1}. ${p}`),
      '',
      '## Critérios de aceite',
      ...(r.acceptance.length ? r.acceptance.map((a) => `- ${a}`) : ['- (não informados)']),
      ...(r.observations.length ? ['', '## Pontos de atenção', ...r.observations.map((o) => `- ${o}`)] : []),
      ...(r.platformSteps?.length ? ['', '## Passos no Business Manager (feitos por uma pessoa, fora do código)', ...r.platformSteps.map((o) => `- ${o}`)] : []),
      '',
      '## Como trabalhar',
      '1. Leia o código envolvido antes de alterar.',
      `2. Execute o plano na ordem. Ao concluir cada passo, escreva uma linha sozinha no formato: PROGRESSO: <número do passo>/${n} - <nome do passo>`,
      ...rules.map((rule, i) => `${i + 3}. ${rule}`),
      `${rules.length + 3}. No fim, faça commit de tudo na branch ${card.git!.branch} com a mensagem "${card.title.replace(/"/g, "'")}" (sem push) e termine com um resumo: o que foi feito, arquivos alterados, como testar e o que ficou pendente.`,
      'Se faltar uma informação essencial, registre como pendência no resumo em vez de inventar.',
    ].join('\n')
  }

  /** Claude Code with write tools, in the task's worktree; its stream feeds the card's progress */
  private async runDevelopment(id: string, start: Card, bin: string, ctrl: AbortController) {
    const total = start.refinement!.plan.length
    const wt = start.git!.path
    // The session's state lives here; it is written over the latest card on disk, so edits made meanwhile are kept
    const dev: DevState = { ...start.dev! }
    let status: CardStatus = 'desenvolvendo'
    let lastSave = 0
    const flush = (force = false) => {
      if (!force && Date.now() - lastSave < 1500) return
      lastSave = Date.now()
      try {
        const card = this.get(id, start.id)
        card.dev = dev
        card.status = status
        this.save(id, card)
      } catch {
        // the card was deleted meanwhile
      }
    }
    const note = (text: string) => {
      dev.activity.push({ at: new Date().toISOString(), text: text.slice(0, 300) })
      if (dev.activity.length > 40) dev.activity.splice(0, dev.activity.length - 40)
    }
    const rel = (p: unknown) => {
      const s = String(p ?? '')
      return path.isAbsolute(s) ? path.relative(wt, s) || s : s
    }

    let result: { is_error?: boolean; result?: string; total_cost_usd?: number } | null = null
    const onLine = (line: string) => {
      let ev: Record<string, unknown>
      try {
        ev = JSON.parse(line)
      } catch {
        return
      }
      for (const skill of skillsInEvent(ev)) {
        dev.skills = [...new Set([...(dev.skills ?? []), skill])]
        note(`⚡ Skill: ${this.skills.record({ workspace: id, feature: 'develop', skill }).title}`)
      }
      if (ev.type === 'result') {
        result = ev as typeof result
        return
      }
      if (ev.type !== 'assistant') return
      const blocks = ((ev.message as { content?: unknown[] })?.content ?? []) as Record<string, unknown>[]
      for (const b of blocks) {
        if (b.type === 'text') {
          const text = String(b.text ?? '')
          for (const m of text.matchAll(/PROGRESSO:\s*(\d+)\s*\/\s*(\d+)\s*(?:-\s*(.*))?/g)) {
            const done = Math.min(Number(m[1]), total)
            if (done > dev.done) {
              dev.done = done
              dev.progress = Math.min(99, Math.round((done / Math.max(total, 1)) * 100))
              dev.step = start.refinement!.plan[done] ?? 'Revisando e fazendo o commit'
              note(`Passo ${done}/${total} concluído${m[3] ? `: ${m[3].trim()}` : ''}`)
            }
          }
          const clean = text.replace(/PROGRESSO:.*$/gm, '').trim()
          if (clean) note(clean.split('\n')[0])
        } else if (b.type === 'tool_use') {
          const input = (b.input ?? {}) as Record<string, unknown>
          const name = String(b.name)
          if (['Edit', 'MultiEdit', 'Write'].includes(name)) note(`Editando ${rel(input.file_path)}`)
          else if (name === 'Bash') note(`Executando: ${String(input.command ?? '').slice(0, 160)}`)
          else if (name === 'Read') note(`Lendo ${rel(input.file_path)}`)
          else if (name === 'Grep' || name === 'Glob') note(`Buscando ${String(input.pattern ?? '')}`)
          else if (name === 'TodoWrite' && Array.isArray(input.todos) && dev.done === 0) {
            // before the first progress marker, the to-do list gives an estimate
            const todos = input.todos as { status?: string }[]
            const completed = todos.filter((t) => t.status === 'completed').length
            if (todos.length) dev.progress = Math.max(dev.progress, Math.min(95, Math.round((completed / todos.length) * 100)))
          }
        }
      }
      flush()
    }

    try {
      const res = await this.runner.run(
        'claude',
        withSkills(
          ['-p', '--output-format', 'stream-json', '--verbose', '--tools', DEV_TOOLS, '--allowedTools', DEV_TOOLS, '--disallowedTools', DEV_DENIED, '--permission-mode', 'acceptEdits', '--add-dir', this.explore.attachmentsDir(id)],
          this.skills.session(this.workspaces.get(id).tech, 'develop'),
        ),
        { executable: bin, cwd: wt, stdin: this.devPrompt(id, start), timeoutMs: DEV_TIMEOUT_MS, onLine, signal: ctrl.signal, env: this.env.values(id) },
      )
      const final = result as { is_error?: boolean; result?: string; total_cost_usd?: number } | null
      dev.finishedAt = new Date().toISOString()
      if (ctrl.signal.aborted) {
        dev.status = 'cancelado'
        status = 'interrompido'
        dev.error = 'Desenvolvimento interrompido por quem pediu'
      } else if (final && !final.is_error && res.code === 0) {
        dev.status = 'concluido'
        dev.progress = 100
        dev.done = total
        dev.step = undefined
        status = 'concluido'
      } else {
        dev.status = 'falhou'
        status = 'falhou'
        dev.error = (final?.result ?? res.stderr ?? '').slice(0, 600) || `Claude Code terminou com código ${res.code}`
      }
      // the progress markers are for the card's bar, not for the summary
      dev.summary = final?.result?.replace(/^PROGRESSO:.*$\n?/gm, '').trim().slice(0, 20_000)
      dev.costUsd = final?.total_cost_usd
    } catch (e) {
      dev.status = 'falhou'
      dev.finishedAt = new Date().toISOString()
      dev.error = (e as Error).message
      status = 'falhou'
      this.log.warn(`Desenvolvimento do card ${start.id} falhou: ${(e as Error).message}`)
    } finally {
      flush(true)
    }
  }
}

/** The guide items Claude wrote, with links only to documentation hosts */
function learningOf(v: unknown): LearningItem[] {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => {
      const o = (x ?? {}) as Record<string, unknown>
      const docs = (Array.isArray(o.docs) ? o.docs : [])
        .map((d) => ({ title: str((d as Record<string, unknown>)?.title, 160), url: str((d as Record<string, unknown>)?.url, 400) }))
        .filter((d) => {
          try {
            const u = new URL(d.url)
            return u.protocol === 'https:' && DOC_HOSTS.includes(u.hostname)
          } catch {
            return false
          }
        })
        .slice(0, 3)
      return { topic: str(o.topic, 120), adobe: str(o.adobe, 800), sfcc: str(o.sfcc, 800), why: str(o.why, 1200), docs }
    })
    .filter((i) => i.topic && i.sfcc)
    .slice(0, 8)
}

/** What the development session can rely on in the worktree */
function devContext(dir: string) {
  let scripts: Record<string, string> = {}
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
    scripts = pkg.scripts ?? {}
  } catch {
    // no package.json
  }
  return { scripts, hasNodeModules: fs.existsSync(path.join(dir, 'node_modules')) }
}
