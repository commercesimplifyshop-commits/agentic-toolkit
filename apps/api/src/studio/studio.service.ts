import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { AiService } from '../ai/ai.service'
import { CORE_DIR, HOST, PORT } from '../config/paths'
import { McpSettingsService } from '../mcp/mcp-settings.service'
import { CLAUDE_SECRET_FILES, CommandRunner } from '../readonly/command-runner.service'
import { WorkspacesService } from '../workspaces/workspaces.service'

export const STUDIO_MODES = ['plan', 'auto', 'acceptEdits'] as const
export type StudioMode = (typeof STUDIO_MODES)[number]
export const STUDIO_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
/** Aliases the CLI accepts, or a full model name */
export const STUDIO_MODEL = /^[a-z0-9][a-z0-9.\-[\]]{1,60}$/i

export type StudioEvent = { t: 'text'; text: string } | { t: 'tool'; name: string; detail?: string } | { t: 'note'; text: string }

export interface StudioFile {
  id: string
  name: string
  type: string
  size: number
}

export interface StudioTurn {
  id: string
  at: string
  text: string
  attachments: StudioFile[]
  model?: string
  mode: StudioMode
  effort?: string
  web: boolean
  status: 'running' | 'done' | 'error' | 'cancelled'
  events: StudioEvent[]
  error?: string
  costUsd?: number
  durationMs?: number
}

export interface StudioSession {
  id: string
  title: string
  /** toolkit: the Agentic Toolkit itself (developer mode on); workspace: the project of the workspace */
  target: 'toolkit' | 'workspace'
  workspaceId: string
  claudeSessionId: string
  started: boolean
  branch?: string
  /** The commit the conversation started from: the changes are shown against it */
  baseCommit?: string
  turns: StudioTurn[]
  createdAt: string
  updatedAt: string
}

const DIR = path.join(CORE_DIR, 'studio')
const SESSION_ID = /^[a-f0-9]{12}$/
const FILE_ID = /^[a-f0-9]{16}(\.[a-z0-9]{1,8})?$/
const MAX_FILE = 20 * 1024 * 1024
/** Never pushed to in a project of the workspace, whatever the agent tries */
const PROTECTED_BRANCHES = ['main', 'master']
/** The Agentic Toolkit is developed on main: its conversations commit and push the branch the checkout is on */
export const protectedBranches = (target: StudioSession['target']) => (target === 'toolkit' ? [] : PROTECTED_BRANCHES)

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

/** A short line for each tool the agent used: the file, the command, the search */
function detailOf(input: Record<string, unknown> | undefined) {
  if (!input) return undefined
  const v = input.file_path ?? input.path ?? input.command ?? input.pattern ?? input.url ?? input.query ?? input.description ?? input.prompt
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').slice(0, 200) : undefined
}

/**
 * The development studio: conversations with Claude Code working straight on the checkout of the
 * Agentic Toolkit (developer mode on) or of the workspace's project, with the same harness as an
 * IDE session — every built-in tool, the user's and the project's settings, the web, a session
 * resumed at each message. It commits and pushes the branch: on the toolkit, the one the checkout is on
 * (main); on a project, never main or master.
 */
@Injectable()
export class StudioService {
  private readonly live = new Map<string, { turn: StudioTurn; stop: AbortController }>()

  constructor(
    private readonly ai: AiService,
    private readonly runner: CommandRunner,
    private readonly workspaces: WorkspacesService,
    private readonly mcp: McpSettingsService,
  ) {
    fs.mkdirSync(DIR, { recursive: true })
  }

  /** The checkout of the Agentic Toolkit this server runs from */
  toolkitRoot() {
    const root = path.resolve(__dirname, '..', '..', '..', '..')
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { name?: string }
      if (pkg.name === 'agentic-toolkit' && fs.existsSync(path.join(root, '.git'))) return root
    } catch {
      // not a checkout
    }
    return null
  }

  private rootOf(s: StudioSession) {
    if (s.target === 'toolkit') {
      const r = this.toolkitRoot()
      if (!r) throw new BadRequestException('Este servidor não roda de um checkout git do Agentic Toolkit: não há código do app para alterar')
      return r
    }
    return this.workspaces.rootOf(s.workspaceId)
  }

  private file(id: string) {
    if (!SESSION_ID.test(id)) throw new BadRequestException('Conversa inválida')
    return path.join(DIR, `${id}.json`)
  }
  filesDir(id: string) {
    if (!SESSION_ID.test(id)) throw new BadRequestException('Conversa inválida')
    return path.join(DIR, id, 'files')
  }
  private read(id: string): StudioSession {
    const file = this.file(id)
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as StudioSession
    } catch {
      throw new NotFoundException('Conversa não encontrada')
    }
  }
  private save(s: StudioSession) {
    s.updatedAt = new Date().toISOString()
    fs.writeFileSync(`${this.file(s.id)}.tmp`, JSON.stringify(s, null, 2))
    fs.renameSync(`${this.file(s.id)}.tmp`, this.file(s.id))
  }

  /** A conversation with the running turn merged in, as the screen follows it */
  get(id: string) {
    const s = this.read(id)
    const running = this.live.get(id)
    if (running) s.turns = [...s.turns.filter((t) => t.id !== running.turn.id), running.turn]
    return { ...s, running: Boolean(running), targetName: s.target === 'toolkit' ? 'Agentic Toolkit' : this.workspaces.get(s.workspaceId).name }
  }

  list(workspaceId: string) {
    return fs
      .readdirSync(DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const s = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) as StudioSession
          return s.workspaceId === workspaceId || s.target === 'toolkit' ? { id: s.id, title: s.title, target: s.target, branch: s.branch, turns: s.turns.length, updatedAt: s.updatedAt, running: this.live.has(s.id) } : null
        } catch {
          return null
        }
      })
      .filter(Boolean)
      .sort((a, b) => (a!.updatedAt < b!.updatedAt ? 1 : -1))
  }

  create(workspaceId: string, target: unknown, title: unknown) {
    this.workspaces.get(workspaceId)
    if (target !== 'toolkit' && target !== 'workspace') throw new BadRequestException('Escolha o código: toolkit ou workspace')
    const now = new Date().toISOString()
    const s: StudioSession = {
      id: randomBytes(6).toString('hex'),
      title: (typeof title === 'string' && title.trim() ? title.trim() : 'Nova conversa').slice(0, 80),
      target,
      workspaceId,
      claudeSessionId: randomUUID(),
      started: false,
      turns: [],
      createdAt: now,
      updatedAt: now,
    }
    this.rootOf(s)
    this.save(s)
    return this.get(s.id)
  }

  remove(id: string) {
    if (this.live.has(id)) throw new ConflictException('A conversa está rodando: pare antes de excluir')
    fs.rmSync(this.file(id), { force: true })
    fs.rmSync(path.join(DIR, id), { recursive: true, force: true })
    return { ok: true }
  }

  /** A file attached to the conversation (image, log, spec…): the agent reads it with Read */
  attach(id: string, file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined) {
    this.read(id)
    if (!file) throw new BadRequestException('Envie um arquivo')
    if (file.size > MAX_FILE) throw new BadRequestException('Arquivo de até 20 MB')
    const ext = (path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '').slice(0, 9)
    const fid = `${randomBytes(8).toString('hex')}${ext}`
    const dir = this.filesDir(id)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, fid), file.buffer)
    const name = file.originalname.replace(/[^\w.\- ()]+/g, '_').slice(0, 120)
    fs.writeFileSync(path.join(dir, `${fid}.meta.json`), JSON.stringify({ name, type: file.mimetype, size: file.size }))
    return { id: fid, name, type: file.mimetype, size: file.size } as StudioFile
  }

  private fileInfo(id: string, fid: string): StudioFile {
    if (!FILE_ID.test(fid)) throw new BadRequestException('Anexo inválido')
    const p = path.join(this.filesDir(id), fid)
    if (!fs.existsSync(p)) throw new BadRequestException('Anexo não encontrado')
    const meta = JSON.parse(fs.readFileSync(`${p}.meta.json`, 'utf8')) as Omit<StudioFile, 'id'>
    return { id: fid, ...meta }
  }

  private async git(root: string, args: string[]) {
    const res = await this.runner.run('git', args, { cwd: root, timeoutMs: 60_000 })
    return res.stdout.trim()
  }

  /** The branch each code is on right now: the commit when detached, null outside a git checkout */
  async branches(workspaceId: string) {
    const of = async (root: () => string | null) => {
      try {
        const r = root()
        if (!r) return null
        // symbolic-ref also names the branch of a repository with no commits yet
        return (await this.git(r, ['symbolic-ref', '--short', '-q', 'HEAD'])) || (await this.git(r, ['rev-parse', '--short', '-q', '--verify', 'HEAD'])) || null
      } catch {
        return null
      }
    }
    const [toolkit, workspace] = await Promise.all([of(() => this.toolkitRoot()), of(() => this.workspaces.rootOf(workspaceId))])
    return { toolkit, workspace }
  }

  /** On main or master, the conversation works on a branch of its own in the same checkout */
  private async ensureBranch(s: StudioSession, root: string) {
    try {
      const current = await this.git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
      if (!s.baseCommit) s.baseCommit = await this.git(root, ['rev-parse', 'HEAD'])
      if (protectedBranches(s.target).includes(current)) {
        const name = `studio/${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${slug(s.title) || s.id}`
        await this.git(root, ['switch', '-c', name])
        s.branch = name
      } else s.branch = current
    } catch {
      // not a git repository: the agent works without branches
    }
  }

  send(id: string, input: { text?: unknown; attachments?: unknown; model?: unknown; mode?: unknown; effort?: unknown; web?: unknown }) {
    const s = this.read(id)
    if (this.live.has(id)) throw new ConflictException('O agente ainda está trabalhando nesta conversa')
    const text = typeof input.text === 'string' ? input.text.trim() : ''
    const files = (Array.isArray(input.attachments) ? input.attachments : []).slice(0, 10).map((f) => this.fileInfo(id, String(f)))
    if (!text && !files.length) throw new BadRequestException('Escreva o pedido ou anexe um arquivo')
    if (text.length > 20_000) throw new BadRequestException('Mensagem de até 20000 caracteres')
    const mode = (STUDIO_MODES as readonly string[]).includes(String(input.mode)) ? (input.mode as StudioMode) : 'auto'
    const model = typeof input.model === 'string' && input.model ? input.model : undefined
    if (model && !STUDIO_MODEL.test(model)) throw new BadRequestException('Modelo inválido')
    const effort = typeof input.effort === 'string' && (STUDIO_EFFORTS as readonly string[]).includes(input.effort) ? input.effort : undefined
    const web = input.web !== false
    const root = this.rootOf(s)
    const bin = this.ai.claudeBinary()
    if (!bin) throw new BadRequestException('Claude Code não encontrado nesta máquina')
    if (!s.started && s.title === 'Nova conversa' && text) s.title = text.split('\n')[0].slice(0, 80)

    const turn: StudioTurn = { id: randomBytes(5).toString('hex'), at: new Date().toISOString(), text, attachments: files, model, mode, effort, web, status: 'running', events: [] }
    const stop = new AbortController()
    this.live.set(id, { turn, stop })
    void this.run(s, root, bin, turn, stop).finally(() => this.live.delete(id))
    return this.get(id)
  }

  private async run(s: StudioSession, root: string, bin: string, turn: StudioTurn, stop: AbortController) {
    const started = Date.now()
    try {
      if (!s.started) await this.ensureBranch(s, root)
      const filesDir = this.filesDir(s.id)
      fs.mkdirSync(filesDir, { recursive: true })
      const host = HOST === '0.0.0.0' || HOST === '::' ? '127.0.0.1' : HOST
      const mcpConfig = path.join(DIR, s.id, 'mcp.json')
      fs.writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { 'agentic-toolkit': { type: 'http', url: `http://${host}:${PORT}/api/mcp`, headers: { Authorization: `Bearer ${this.mcp.internalToken}` } } } }))
      const branch = s.branch ?? '(sem git)'
      const denied = [
        ...CLAUDE_SECRET_FILES,
        'Read(**/auth.json)',
        ...protectedBranches(s.target).flatMap((b) => [`Bash(git push origin ${b}:*)`, `Bash(git push -u origin ${b}:*)`, `Bash(git push --set-upstream origin ${b}:*)`]),
        'Bash(git push --force:*)',
        'Bash(git push -f:*)',
        'Bash(git push origin --force:*)',
        ...(turn.web ? [] : ['WebFetch', 'WebSearch']),
      ]
      const system = [
        `Você é o agente de desenvolvimento do Estúdio do Agentic Toolkit. Trabalha direto no checkout de ${s.target === 'toolkit' ? 'o próprio Agentic Toolkit (o app que a pessoa está usando)' : `o projeto do workspace "${this.workspaces.get(s.workspaceId).name}"`}, em ${root}, na branch ${branch}.`,
        'Trabalhe como numa sessão do Claude Code na IDE: entenda o pedido, leia o código, altere, rode o build e os testes, e diga o que fez.',
        `Git: ao concluir uma mudança que funciona, faça commit com uma mensagem clara e depois push da branch atual (git push -u origin ${branch}). ${s.target === 'toolkit' ? 'O Agentic Toolkit é desenvolvido na branch main: trabalhe na branch atual sem criar outra.' : 'Nunca faça push em main ou master.'} Nunca use --force e nunca reescreva o histórico.`,
        s.target === 'toolkit'
          ? 'Este é o código do app que está servindo esta conversa. Depois de alterar, rode "npm run build" na raiz e os testes da API ("npm test -w @agentic-toolkit/api"). Mudanças na web valem ao recarregar a página; mudanças na API só depois de reiniciar o servidor, o que a pessoa faz pelo botão "Reiniciar servidor" da prévia. Nunca encerre nem reinicie o servidor você mesmo (porta ' + PORT + ').'
          : 'É o código do projeto do cliente. Nunca leia app/etc/env.php, auth.json, dw.json nem chaves.',
        turn.mode === 'plan' ? 'Modo planejar: investigue e escreva o plano, sem alterar arquivos. A pessoa decide se segue.' : '',
        'O servidor MCP "agentic-toolkit" dá acesso às funcionalidades do app (mapa do projeto, diagramas, tarefas, interface).',
        'Responda em português.',
      ]
        .filter(Boolean)
        .join('\n')
      const prompt = [turn.text, turn.attachments.length ? `Arquivos anexados (leia com Read):\n${turn.attachments.map((f) => `- ${path.join(filesDir, f.id)} (${f.name}, ${f.type || 'arquivo'})`).join('\n')}` : ''].filter(Boolean).join('\n\n')
      const args = [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        ...(s.started ? ['--resume', s.claudeSessionId] : ['--session-id', s.claudeSessionId]),
        '--permission-mode',
        turn.mode,
        '--setting-sources',
        'user,project,local',
        '--add-dir',
        filesDir,
        '--mcp-config',
        mcpConfig,
        '--disallowedTools',
        denied.join(','),
        '--append-system-prompt',
        system,
        ...(turn.model ? ['--model', turn.model] : []),
        ...(turn.effort ? ['--effort', turn.effort] : []),
      ]
      let result: { is_error?: boolean; result?: string; total_cost_usd?: number; subtype?: string } | null = null
      await this.runner.run('claude', args, {
        executable: bin,
        cwd: root,
        stdin: prompt,
        timeoutMs: 4 * 60 * 60_000,
        signal: stop.signal,
        onLine: (line) => {
          let ev: { type?: string; message?: { content?: { type: string; text?: string; name?: string; input?: Record<string, unknown> }[] }; result?: string; is_error?: boolean; total_cost_usd?: number; subtype?: string }
          try {
            ev = JSON.parse(line)
          } catch {
            return
          }
          if (ev.type === 'assistant') {
            for (const b of ev.message?.content ?? []) {
              if (b.type === 'text' && b.text?.trim()) turn.events.push({ t: 'text', text: b.text })
              if (b.type === 'tool_use' && b.name) turn.events.push({ t: 'tool', name: b.name.replace('mcp__agentic-toolkit__', 'app: '), detail: detailOf(b.input) })
            }
            if (turn.events.length > 600) turn.events.splice(0, turn.events.length - 600)
          }
          if (ev.type === 'result') result = ev
        },
      })
      s.started = true
      const r = result as { is_error?: boolean; result?: string; total_cost_usd?: number; subtype?: string } | null
      if (r?.is_error) throw new Error(r.result ?? r.subtype ?? 'erro do Claude Code')
      // the last message is the answer; earlier texts are the commentary while working
      if (r?.result && !turn.events.some((e) => e.t === 'text' && e.text === r.result)) turn.events.push({ t: 'text', text: r.result })
      turn.costUsd = r?.total_cost_usd
      turn.status = 'done'
    } catch (e) {
      turn.status = stop.signal.aborted ? 'cancelled' : 'error'
      turn.error = stop.signal.aborted ? 'Parado pela pessoa' : (e as Error).message.slice(0, 800)
      // a session the CLI created is resumed next time, even if the turn failed
      if (!s.started && fs.existsSync(this.file(s.id))) s.started = turn.events.length > 0
    } finally {
      turn.durationMs = Date.now() - started
      const fresh = (() => {
        try {
          return this.read(s.id)
        } catch {
          return null
        }
      })()
      if (fresh) {
        fresh.turns = [...fresh.turns.filter((t) => t.id !== turn.id), turn]
        fresh.started = s.started
        fresh.branch = s.branch
        fresh.baseCommit = s.baseCommit
        fresh.title = s.title
        this.save(fresh)
      }
    }
  }

  cancel(id: string) {
    const running = this.live.get(id)
    if (!running) return { ok: true }
    running.stop.abort()
    return { ok: true }
  }

  /** What changed since the conversation started: the files, and the diff of one */
  async changes(id: string, file?: string) {
    const s = this.read(id)
    const root = this.rootOf(s)
    try {
      const branch = await this.git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
      const base = s.baseCommit ?? 'HEAD'
      if (file) {
        if (path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) throw new BadRequestException('Caminho inválido')
        const tracked = await this.git(root, ['diff', base, '--', file])
        if (tracked) return { file, diff: tracked }
        // a new file not added yet: shown whole
        const p = path.join(root, file)
        return { file, diff: fs.existsSync(p) && fs.statSync(p).size < 400_000 ? fs.readFileSync(p, 'utf8').split('\n').map((l) => `+${l}`).join('\n') : '' }
      }
      const stat = await this.git(root, ['diff', '--numstat', base])
      const untracked = await this.git(root, ['ls-files', '--others', '--exclude-standard'])
      const files = [
        ...stat
          .split('\n')
          .filter(Boolean)
          .map((l) => {
            const [add, del, f] = l.split('\t')
            return { file: f, added: Number(add) || 0, removed: Number(del) || 0, status: 'alterado' }
          }),
        ...untracked
          .split('\n')
          .filter(Boolean)
          .slice(0, 200)
          .map((f) => ({ file: f, added: 0, removed: 0, status: 'novo' })),
      ]
      const commits = s.baseCommit ? (await this.git(root, ['log', '--oneline', `${s.baseCommit}..HEAD`])).split('\n').filter(Boolean) : []
      let ahead: number | null = null
      try {
        ahead = Number(await this.git(root, ['rev-list', '--count', `origin/${branch}..HEAD`]))
      } catch {
        ahead = null
      }
      return { branch, base: s.baseCommit, files, commits, pushed: ahead === 0, ahead }
    } catch (e) {
      if (e instanceof BadRequestException) throw e
      return { branch: null, base: null, files: [], commits: [], pushed: false, ahead: null, error: 'Não foi possível ler o git deste código' }
    }
  }
}
