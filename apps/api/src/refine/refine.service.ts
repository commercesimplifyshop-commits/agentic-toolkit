import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { AiService } from '../ai/ai.service'
import { GitOpsService } from '../gitops/gitops.service'
import { OpenSpecExploreService, parseJsonReply } from '../openspec/openspec-explore.service'
import { AuditService } from '../readonly/audit.service'
import { CommandRunner } from '../readonly/command-runner.service'
import { WorkspaceEnvService } from '../settings/workspace-env.service'
import { WorkspacesService } from '../workspaces/workspaces.service'

export interface Turn {
  role: 'user' | 'assistant'
  content: string
  at: string
  attachments?: { id: string; name: string }[]
}

export interface Split {
  title: string
  scope: string
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

/** The refinement conversation: Claude reads the code and helps turn a raw demand into a clear task. It never writes. */
const REFINE_STANCE = [
  'Você ajuda um engenheiro a refinar uma demanda de desenvolvimento deste projeto. A demanda costuma chegar crua: texto de ticket, prints, pedido do cliente.',
  '1. Resuma o que entendeu e o objetivo de negócio.',
  '2. Investigue o código (Read, Grep, Glob) para responder o que o código já responde: módulos, classes, templates, configurações e integrações envolvidos. Cite arquivos como `caminho:linha`.',
  '3. Aponte o que falta decidir (regras de negócio, critérios de aceite, telas, casos de borda, dados, integrações) e faça no máximo 3 perguntas objetivas por vez.',
  '4. Esboce a solução técnica: como faremos, quais arquivos mudam e por quê. Avalie a complexidade e diga se vale dividir em tarefas menores (entregas independentes, ou mais de um dia de trabalho).',
  '5. Quando estiver claro, diga que o próximo passo é "Gerar card refinado".',
  'Se o usuário anexar imagens, leia cada uma com a ferramenta Read. Seja direto; responda em português do Brasil.',
  'Você NÃO implementa e NÃO escreve arquivos nesta etapa. Nunca escreva senhas, tokens ou valores de app/etc/env.php.',
].join('\n')

const REFINE_RULES = [
  'Você escreve o card refinado de uma tarefa de desenvolvimento, em português do Brasil, a partir de uma conversa de refinamento. O card vai para o Jira ou o Azure DevOps, e a descrição técnica guiará o desenvolvimento.',
  'Responda SOMENTE com um bloco ```json, sem texto antes ou depois:',
  '{"title": "título curto e objetivo", "business": "markdown", "technical": "markdown", "plan": ["passo"], "acceptance": ["critério"], "observations": ["ponto de atenção"], "complexity": {"level": "baixa|media|alta", "reasoning": "por quê", "recommendSplit": true, "splits": [{"title": "...", "scope": "..."}]}}',
  'business: contexto, problema e objetivo de negócio, para quem não conhece o código.',
  'technical (a parte principal): a solução. Abordagem; componentes e arquivos que mudam, com caminhos reais; o que muda em cada um; decisões e alternativas descartadas; dados e configurações (db_schema, di.xml, layout, admin, cartuchos); como testar.',
  'plan: de 3 a 12 passos na ordem de execução, cada um entregável e verificável. O desenvolvimento segue esses passos.',
  'acceptance: critérios observáveis e verificáveis (use Dado/Quando/Então quando ajudar).',
  'observations: riscos, dependências, dúvidas em aberto e cuidados de deploy. Lista vazia se não houver.',
  'complexity: recomende dividir (recommendSplit true) quando houver entregas independentes ou o trabalho passar de um dia; então proponha de 2 a 4 partes, cada uma com escopo próprio e entregável sozinha. Sem recomendação, deixe splits vazio.',
  'Confirme nomes no código (Read, Grep, Glob); não invente integrações. Leia as imagens anexadas com Read. Nunca inclua senhas, tokens ou valores de app/etc/env.php.',
].join('\n')

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
  ) {}

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
    return `Projeto: ${ws.name}${ws.edition ? ` (${ws.edition}${ws.version ? ` ${ws.version}` : ''})` : ''}.`
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
    const reply = (await this.explore.ask(id, REFINE_STANCE, prompt)).trim() || '(sem resposta)'
    card.messages.push({ role: 'user', content: message, at: now, ...(attachments.length ? { attachments } : {}) }, { role: 'assistant', content: reply, at: new Date().toISOString() })
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
      const text = await this.explore.ask(id, REFINE_RULES, prompt)
      const raw = parseJsonReply(text)
      if (!raw) {
        this.log.warn(`Card ${card.id}: resposta sem JSON legível (${text.length} caracteres): ${text.slice(0, 300)}`)
        throw new BadRequestException('O Claude não devolveu o card em um formato legível. Tente de novo.')
      }
      card.refinement = this.sanitize(raw)
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

  private sanitize(raw: Record<string, unknown>): Refinement {
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
      complexity: { level, reasoning: str(c.reasoning, 2000), recommendSplit: Boolean(c.recommendSplit) && splits.length >= 2, splits },
      generatedAt: new Date().toISOString(),
    }
  }

  /** Manual edits of the refined card (it is the engineer's card, Claude only drafts it) */
  update(id: string, cardId: string, patch: Partial<Pick<Refinement, 'business' | 'technical' | 'plan' | 'acceptance' | 'observations'>> & { title?: string }) {
    const card = this.get(id, cardId)
    if (patch.title !== undefined) card.title = str(patch.title, 120) || card.title
    if (card.refinement) {
      if (patch.business !== undefined) card.refinement.business = str(patch.business, 20_000)
      if (patch.technical !== undefined) card.refinement.technical = str(patch.technical, 40_000)
      if (patch.plan !== undefined) card.refinement.plan = list(patch.plan, 12, 400)
      if (patch.acceptance !== undefined) card.refinement.acceptance = list(patch.acceptance, 20, 600)
      if (patch.observations !== undefined) card.refinement.observations = list(patch.observations, 20, 600)
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

  private devPrompt(card: Card) {
    const r = card.refinement!
    const n = r.plan.length
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
      '',
      '## Como trabalhar',
      '1. Leia o código envolvido antes de alterar.',
      `2. Execute o plano na ordem. Ao concluir cada passo, escreva uma linha sozinha no formato: PROGRESSO: <número do passo>/${n} - <nome do passo>`,
      '3. Siga o padrão do projeto: código nos módulos (ou cartuchos) próprios, sem editar vendor/ nem o core.',
      '4. Verifique o que alterou: php -l nos arquivos PHP alterados e os testes automatizados do módulo, se existirem.',
      `5. No fim, faça commit de tudo na branch ${card.git!.branch} com a mensagem "${card.title.replace(/"/g, "'")}" (sem push) e termine com um resumo: o que foi feito, arquivos alterados, como testar e o que ficou pendente.`,
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
        ['-p', '--output-format', 'stream-json', '--verbose', '--tools', DEV_TOOLS, '--allowedTools', DEV_TOOLS, '--permission-mode', 'acceptEdits', '--add-dir', this.explore.attachmentsDir(id)],
        { executable: bin, cwd: wt, stdin: this.devPrompt(start), timeoutMs: DEV_TIMEOUT_MS, onLine, signal: ctrl.signal, env: this.env.values(id) },
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
      dev.summary = final?.result?.slice(0, 20_000)
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
