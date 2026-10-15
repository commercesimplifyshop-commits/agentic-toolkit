import { BadRequestException, ConflictException, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DATA_DIR } from '../../config/paths'
import { AuditService } from '../../readonly/audit.service'
import { CommandRunner } from '../../readonly/command-runner.service'
import { RefineService } from '../../refine/refine.service'
import { WorkspacesService } from '../../workspaces/workspaces.service'

/** What the screen may know about dw.json: never a username, password or passphrase */
export interface DwJsonView {
  found: boolean
  /** Where it was read from: the task's worktree or the project */
  from?: 'tarefa' | 'projeto'
  hostname?: string
  codeVersion?: string
  hasUsername: boolean
  hasPassword: boolean
  twoFactor: boolean
  cartridges?: string[]
  error?: string
}

export interface UploadTool {
  id: 'sgmf-watch' | 'sgmf-upload' | 'dwupload' | 'prophet' | 'sfcc-ci' | 'b2c-tools'
  name: string
  /** Where it was found: a package.json script, a VS Code setting, an installed extension */
  where: string
  how: string
  commands: string[]
}

export interface UploadRun {
  mode: 'upload' | 'watch'
  target: string
  targetLabel: string
  cartridges: string[]
  status: 'executando' | 'concluido' | 'falhou' | 'parado'
  startedAt: string
  finishedAt?: string
  log: { at: string; text: string }[]
  error?: string
}

const CARTRIDGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/
const WATCH_TIMEOUT_MS = 10 * 60 * 60_000
const UPLOAD_TIMEOUT_MS = 20 * 60_000
const ANSI = /\u001b\[[0-9;]*m/g

/**
 * Upload of cartridges to a Salesforce B2C instance (sandbox), with the project's own dwupload, the
 * tool behind "npm run watch" and "npm run uploadCartridge" in SFRA. The credentials stay in dw.json:
 * the app reads only what it can show, and dwupload reads the file itself.
 */
@Injectable()
export class SfccUploadService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Upload SFCC')
  private readonly runs = new Map<string, UploadRun>()
  private readonly controllers = new Map<string, AbortController>()

  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly refine: RefineService,
    private readonly runner: CommandRunner,
    private readonly audit: AuditService,
  ) {}

  /** dw.json copies the app placed next to the cartridges, so a restart still removes them */
  private tempFile() {
    return path.join(DATA_DIR, 'sfcc-upload-temp.json')
  }
  private temps(): string[] {
    try {
      return JSON.parse(fs.readFileSync(this.tempFile(), 'utf8')) as string[]
    } catch {
      return []
    }
  }
  private setTemps(list: string[]) {
    fs.mkdirSync(path.dirname(this.tempFile()), { recursive: true })
    fs.writeFileSync(this.tempFile(), JSON.stringify(list))
  }

  onApplicationBootstrap() {
    for (const f of this.temps()) fs.rmSync(f, { force: true })
    this.setTemps([])
  }

  onApplicationShutdown() {
    for (const c of this.controllers.values()) c.abort()
  }

  private sfccWorkspace(id: string) {
    const ws = this.workspaces.get(id)
    if (ws.tech !== 'salesforce-b2c') throw new BadRequestException('O upload de cartuchos é só para projetos Salesforce B2C Commerce')
    if (!ws.root) throw new BadRequestException('Escolha a pasta do projeto antes do upload')
    return ws as typeof ws & { root: string }
  }

  /** The folder the cartridges are sent from: the task's worktree, or the project */
  private target(id: string, cardId?: string) {
    const ws = this.sfccWorkspace(id)
    if (!cardId) return { dir: ws.root, label: 'Projeto', base: undefined as string | undefined, card: undefined as string | undefined }
    const card = this.refine.get(id, cardId)
    if (!card.git || !fs.existsSync(card.git.path)) throw new BadRequestException('Esta tarefa ainda não tem worktree: prepare o git no card')
    return { dir: card.git.path, label: `Tarefa: ${card.title} (${card.git.branch})`, base: card.git.base, card: card.title, developing: card.dev?.status === 'executando' }
  }

  /** dw.json of the task, else the project's */
  private dwJsonPath(id: string, targetDir: string) {
    const ws = this.sfccWorkspace(id)
    const own = path.join(targetDir, 'dw.json')
    if (fs.existsSync(own)) return { file: own, from: targetDir === ws.root ? ('projeto' as const) : ('tarefa' as const) }
    const project = path.join(ws.root, 'dw.json')
    if (fs.existsSync(project)) return { file: project, from: 'projeto' as const }
    return null
  }

  private readDw(file: string) {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
  }

  private dwView(id: string, targetDir: string): DwJsonView {
    const found = this.dwJsonPath(id, targetDir)
    if (!found) return { found: false, hasUsername: false, hasPassword: false, twoFactor: false }
    try {
      const dw = this.readDw(found.file)
      const text = (k: string) => (typeof dw[k] === 'string' && (dw[k] as string).trim() ? (dw[k] as string).trim() : undefined)
      const cartridges = Array.isArray(dw.cartridge) ? (dw.cartridge as unknown[]).map(String) : typeof dw.cartridge === 'string' ? dw.cartridge.split(/[,:]/).map((c) => c.trim()).filter(Boolean) : undefined
      return {
        found: true,
        from: found.from,
        hostname: text('hostname'),
        codeVersion: text('code-version') ?? text('codeVersion'),
        hasUsername: Boolean(text('username')),
        hasPassword: Boolean(text('password')),
        twoFactor: Boolean(text('p12')),
        cartridges,
      }
    } catch {
      return { found: true, from: found.from, hasUsername: false, hasPassword: false, twoFactor: false, error: 'dw.json não é um JSON válido' }
    }
  }

  /** The project's dwupload: next to the cartridges or under sgmf-scripts */
  private dwupload(id: string, targetDir: string) {
    const ws = this.sfccWorkspace(id)
    for (const dir of [targetDir, ws.root]) {
      for (const rel of ['node_modules/dwupload/index.js', 'node_modules/sgmf-scripts/node_modules/dwupload/index.js']) {
        const file = path.join(dir, rel)
        if (fs.existsSync(file)) return file
      }
    }
    return null
  }

  private scripts(dir: string): Record<string, string> {
    try {
      return (JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {}
    } catch {
      return {}
    }
  }

  /** Upload tools of the project, each with how it works */
  tools(id: string, targetDir: string): UploadTool[] {
    const ws = this.sfccWorkspace(id)
    const scripts = { ...this.scripts(ws.root), ...this.scripts(targetDir) }
    const byCmd = (re: RegExp) => Object.entries(scripts).filter(([, cmd]) => re.test(cmd))
    const tools: UploadTool[] = []

    const watch = byCmd(/sgmf-scripts\s+--watch/)
    if (watch.length) {
      tools.push({
        id: 'sgmf-watch',
        name: 'Upload automático do SFRA (sgmf-scripts --watch)',
        where: `package.json: ${watch.map(([k]) => `npm run ${k}`).join(', ')}`,
        how: 'Fica observando a pasta cartridges/: compila o JS e o SCSS do cliente (webpack) e, a cada arquivo salvo, sobe só esse arquivo para a code version do dw.json com o dwupload. Roda no terminal até você parar (Ctrl+C). Precisa do dw.json na raiz do projeto e do npm install feito.',
        commands: watch.map(([k]) => `npm run ${k}`),
      })
    }
    const upload = byCmd(/sgmf-scripts\s+--upload(Cartridge)?\b/)
    if (upload.length) {
      tools.push({
        id: 'sgmf-upload',
        name: 'Upload de cartuchos do SFRA (sgmf-scripts --uploadCartridge)',
        where: `package.json: ${upload.map(([k]) => `npm run ${k}`).join(', ')}`,
        how: 'Sobe cartuchos inteiros de uma vez: zipa cada cartucho, envia para a code version do dw.json por WebDAV e descompacta lá. Use depois de trocar de branch ou quando muitos arquivos mudaram.',
        commands: upload.map(([k]) => `npm run ${k}`),
      })
    }
    if (this.dwupload(id, targetDir)) {
      tools.push({
        id: 'dwupload',
        name: 'dwupload',
        where: 'node_modules do projeto (vem com o sgmf-scripts)',
        how: 'É quem faz o envio de verdade, usado pelos comandos acima e por esta tela. Lê hostname, usuário, senha e code-version do dw.json da pasta onde roda. "dwupload --cartridge X" envia o cartucho inteiro; "dwupload watch --cartridge X" envia cada arquivo alterado.',
        commands: ['cd cartridges', 'npx dwupload --cartridge <cartucho>', 'npx dwupload watch --cartridge <cartucho>'],
      })
    }
    const vscode = ['.vscode/settings.json', '.vscode/extensions.json'].some((f) => {
      try {
        return /prophet/i.test(fs.readFileSync(path.join(ws.root, f), 'utf8'))
      } catch {
        return false
      }
    })
    let installed = false
    try {
      installed = fs.readdirSync(path.join(os.homedir(), '.vscode', 'extensions')).some((d) => /^sqrtt\.prophet-/i.test(d))
    } catch {
      // no VS Code extensions folder
    }
    if (vscode || installed) {
      tools.push({
        id: 'prophet',
        name: 'Prophet (extensão do VS Code)',
        where: installed ? 'extensão instalada no VS Code' : 'configurada em .vscode/ do projeto',
        how: 'Sobe automaticamente cada arquivo salvo no VS Code, usando o dw.json da raiz do workspace aberto. Liga e desliga em "extension.prophet.upload.enabled"; o comando "Prophet: Clean project / Upload all" sobe tudo. Também faz debug de scripts na sandbox.',
        commands: ['Ctrl+Shift+P → Prophet: Enable Upload', 'Ctrl+Shift+P → Prophet: Clean project / Upload all'],
      })
    }
    const ci = byCmd(/\bsfcc-ci\b/)
    if (ci.length) {
      tools.push({ id: 'sfcc-ci', name: 'sfcc-ci', where: `package.json: ${ci.map(([k]) => `npm run ${k}`).join(', ')}`, how: 'CLI da Salesforce para CI: sobe a code version como zip (code:deploy) e ativa (code:activate). Usa um API client do Account Manager, não o dw.json de usuário.', commands: ci.map(([k]) => `npm run ${k}`) })
    }
    const b2c = byCmd(/\bb2c-tools\b/)
    if (b2c.length) {
      tools.push({ id: 'b2c-tools', name: 'b2c-tools', where: `package.json: ${b2c.map(([k]) => `npm run ${k}`).join(', ')}`, how: 'Ferramenta de linha de comando para code deploy, imports e jobs, configurada pelo dw.json ou dw.js.', commands: b2c.map(([k]) => `npm run ${k}`) })
    }
    return tools
  }

  /** Cartridges of the target, the ones changed in the task first */
  private async cartridges(targetDir: string, base?: string) {
    let names: string[] = []
    try {
      names = fs
        .readdirSync(path.join(targetDir, 'cartridges'), { withFileTypes: true })
        .filter((e) => e.isDirectory() && CARTRIDGE_NAME.test(e.name) && fs.existsSync(path.join(targetDir, 'cartridges', e.name, 'cartridge')))
        .map((e) => e.name)
    } catch {
      return []
    }
    const changed = new Map<string, Set<string>>()
    const add = (file: string) => {
      const m = file.replace(/\\/g, '/').match(/^cartridges\/([^/]+)\/(.*)$/)
      if (!m) return
      if (!changed.has(m[1])) changed.set(m[1], new Set())
      changed.get(m[1])!.add(m[2])
    }
    const git = async (args: string[]) => {
      const r = await this.runner.run('git', args, { cwd: targetDir, timeoutMs: 20_000 }).catch(() => null)
      return r && r.code === 0 ? r.stdout : ''
    }
    for (const line of (await git(['status', '--porcelain', '--untracked-files=all', '--', 'cartridges'])).split('\n')) if (line.trim()) add(line.slice(3).replace(/^"|"$/g, '').split(' -> ').pop()!)
    if (base) for (const line of (await git(['diff', '--name-only', `${base}...HEAD`, '--', 'cartridges'])).split('\n')) if (line.trim()) add(line.trim())
    return names
      .map((name) => {
        const files = [...(changed.get(name) ?? [])]
        const clientChanged = files.some((f) => f.startsWith('cartridge/client/'))
        return {
          name,
          changed: files.length,
          clientChanged,
          hasStatic: fs.existsSync(path.join(targetDir, 'cartridges', name, 'cartridge', 'static')),
        }
      })
      .sort((a, b) => b.changed - a.changed || a.name.localeCompare(b.name))
  }

  async status(id: string, cardId?: string) {
    const t = this.target(id, cardId)
    const run = this.runs.get(id)
    return {
      target: { dir: t.dir, label: t.label, cardId: cardId ?? null },
      dw: this.dwView(id, t.dir),
      dwupload: Boolean(this.dwupload(id, t.dir)),
      tools: this.tools(id, t.dir),
      cartridges: await this.cartridges(t.dir, t.base),
      run: run ?? null,
    }
  }

  private requireCartridges(targetDir: string, names: unknown) {
    if (!Array.isArray(names) || names.length === 0 || names.length > 30) throw new BadRequestException('Escolha de 1 a 30 cartuchos')
    return names.map((n) => {
      const name = String(n)
      if (!CARTRIDGE_NAME.test(name) || !fs.existsSync(path.join(targetDir, 'cartridges', name, 'cartridge'))) throw new BadRequestException(`Cartucho inválido: ${name}`)
      return name
    })
  }

  /** Starts an upload (all at once) or the automatic upload (watch); returns at once */
  async start(id: string, input: { cardId?: string; cartridges?: unknown; mode?: string }) {
    const mode = input.mode === 'watch' ? 'watch' : 'upload'
    if (this.controllers.has(id)) throw new ConflictException('Já há um upload em andamento neste projeto: pare antes de começar outro')
    const t = this.target(id, input.cardId)
    if ('developing' in t && t.developing) throw new ConflictException('O Claude está desenvolvendo esta tarefa: espere terminar antes do upload')
    const cartridges = this.requireCartridges(t.dir, input.cartridges)
    const dw = this.dwView(id, t.dir)
    if (!dw.found) throw new BadRequestException('dw.json não encontrado na raiz do projeto')
    if (dw.error) throw new BadRequestException(dw.error)
    if (!dw.hostname) throw new BadRequestException('dw.json sem hostname')
    if (!dw.hasUsername && !dw.twoFactor) throw new BadRequestException('dw.json sem usuário')
    const exe = this.dwupload(id, t.dir)
    if (!exe) throw new BadRequestException('dwupload não está instalado: rode npm install na pasta do projeto')

    const cwd = path.join(t.dir, 'cartridges')
    const source = this.dwJsonPath(id, t.dir)!.file
    const copy = path.join(cwd, 'dw.json')
    const placed = !fs.existsSync(copy)
    if (placed) {
      // dwupload reads dw.json from the folder it runs in; the copy must never be committed
      const ignored = await this.runner.run('git', ['check-ignore', '-q', 'cartridges/dw.json'], { cwd: t.dir, timeoutMs: 20_000 }).catch(() => null)
      const isRepo = await this.runner.run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: t.dir, timeoutMs: 20_000 }).catch(() => null)
      if (isRepo?.code === 0 && ignored?.code !== 0) throw new BadRequestException('O .gitignore não ignora dw.json: adicione "dw.json" ao .gitignore antes, para a cópia temporária usada no upload nunca entrar num commit')
      fs.copyFileSync(source, copy)
      this.setTemps([...this.temps(), copy])
    }

    const run: UploadRun = { mode, target: t.dir, targetLabel: t.label, cartridges, status: 'executando', startedAt: new Date().toISOString(), log: [] }
    this.runs.set(id, run)
    const ctrl = new AbortController()
    this.controllers.set(id, ctrl)
    this.audit.record({
      action: mode === 'watch' ? 'sfcc.upload.watch' : 'sfcc.upload.run',
      kind: 'external',
      method: 'WEBDAV',
      url: `${dw.hostname} (${dw.codeVersion ?? 'version1'})`,
      workspace: id,
      verdict: 'allowed',
      detail: `${mode === 'watch' ? 'upload automático' : 'upload'} de ${cartridges.join(', ')} a partir de ${t.dir}`,
    })

    // secrets that must never reach the screen, even inside an error message
    const secrets = (() => {
      try {
        const raw = this.readDw(source)
        return ['password', 'passphrase', 'username'].map((k) => (typeof raw[k] === 'string' ? (raw[k] as string) : '')).filter((v) => v.length >= 3)
      } catch {
        return []
      }
    })()
    const note = (line: string) => {
      let text = line.replace(ANSI, '').trim()
      for (const s of secrets) text = text.split(s).join('••••')
      if (!text) return
      run.log.push({ at: new Date().toISOString(), text: text.slice(0, 500) })
      if (run.log.length > 300) run.log.splice(0, run.log.length - 300)
    }
    note(`${mode === 'watch' ? 'Upload automático' : 'Upload'} para ${dw.hostname}, code version ${dw.codeVersion ?? 'version1'}: ${cartridges.join(', ')}`)

    const args = [...(mode === 'watch' ? ['watch'] : []), ...cartridges.flatMap((c) => ['--cartridge', c])]
    void this.runner
      .run('dwupload', args, { executable: exe, cwd, timeoutMs: mode === 'watch' ? WATCH_TIMEOUT_MS : UPLOAD_TIMEOUT_MS, onLine: note, signal: ctrl.signal })
      .then((res) => {
        run.finishedAt = new Date().toISOString()
        if (ctrl.signal.aborted) run.status = 'parado'
        else if (res.code === 0) run.status = 'concluido'
        else {
          run.status = 'falhou'
          run.error = run.log.at(-1)?.text ?? `dwupload terminou com código ${res.code}`
        }
      })
      .catch((e) => {
        run.status = 'falhou'
        run.finishedAt = new Date().toISOString()
        run.error = (e as Error).message
        this.log.warn(`Upload falhou: ${(e as Error).message}`)
      })
      .finally(() => {
        this.controllers.delete(id)
        if (placed) {
          fs.rmSync(copy, { force: true })
          this.setTemps(this.temps().filter((f) => f !== copy))
        }
        note(run.status === 'concluido' ? 'Upload concluído.' : run.status === 'parado' ? 'Upload parado.' : `Upload falhou${run.error ? `: ${run.error}` : '.'}`)
      })
    return run
  }

  /** What the upload needs from the project, for the prerequisites of each screen */
  prerequisites(id: string) {
    const ws = this.sfccWorkspace(id)
    const dw = this.dwView(id, ws.root)
    const dwOk = dw.found && !dw.error && Boolean(dw.hostname) && (dw.hasUsername || dw.twoFactor)
    const fix = { section: 'projeto' as const, label: 'Ver como configurar', to: 'sfcc/upload' }
    return [
      {
        id: 'sfcc-dw' as const,
        label: 'dw.json da sandbox',
        ok: dwOk,
        detail: !dw.found ? 'dw.json não encontrado na raiz do projeto.' : dw.error ?? (dwOk ? `${dw.hostname} (code version ${dw.codeVersion ?? 'version1'})` : 'dw.json sem hostname ou sem usuário.'),
        fix,
      },
      {
        id: 'sfcc-dwupload' as const,
        label: 'Ferramenta de upload (dwupload)',
        ok: Boolean(this.dwupload(id, ws.root)),
        detail: this.dwupload(id, ws.root) ? 'Instalada no node_modules do projeto.' : 'Não instalada: rode npm install na pasta do projeto.',
        fix,
      },
    ]
  }

  stop(id: string) {
    const ctrl = this.controllers.get(id)
    if (!ctrl) return { stopped: false }
    ctrl.abort()
    return { stopped: true }
  }
}
