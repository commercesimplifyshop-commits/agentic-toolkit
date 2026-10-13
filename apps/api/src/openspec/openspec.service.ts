import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../config/paths'
import { CommandRunner } from '../readonly/command-runner.service'
import { assertWritableTarget } from '../readonly/path-guard'
import { ReadOnlyFs } from '../readonly/readonly-fs.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { parseDelta, parseSpec, parseTasks, section, titleOf, type ParsedTasks } from './openspec-parse'

export const CHANGE_STATUS = ['planejamento', 'em-andamento', 'revisao', 'impedida', 'pronta', 'arquivada'] as const
export const SPEC_STATUS = ['estavel', 'em-alteracao', 'rascunho', 'aprovada', 'obsoleta'] as const
export type ManualChangeStatus = 'revisao' | 'impedida'
export type ManualSpecStatus = 'rascunho' | 'aprovada' | 'obsoleta'

/** Manual status and the mapped folder, kept in Agentic Toolkit's data dir only (never in the repo). */
interface Overrides {
  mapPath?: string
  changes: Record<string, ManualChangeStatus>
  specs: Record<string, ManualSpecStatus>
}

interface CliInfo {
  entry: string
  version: string
}

interface CliValidation {
  changes: Record<string, { valid: boolean; issues: { level: string; message: string }[] }>
  specs: Record<string, { valid: boolean; issues: { level: string; message: string }[] }>
}

/** "add-pix" → "Add pix": a readable title when the proposal has none */
const humanize = (name: string) => {
  const t = name.replace(/[-_]+/g, ' ').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

const SKIP = ['node_modules', '.git', 'vendor', 'generated', 'pub', 'var', 'dev', 'setup', 'update']
const MAX_TEXT = 300_000

/**
 * Reads the OpenSpec folder of an installation (specs, changes, tasks, deltas) and
 * turns it into the dashboard model. It never writes to the repository: installing,
 * creating, applying or archiving are prompts for the user's Claude Code in the terminal.
 */
@Injectable()
export class OpenSpecService {
  private cliCache: { at: number; value: CliInfo | null } | null = null
  private validationCache = new Map<string, { at: number; value: CliValidation | null }>()

  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly rofs: ReadOnlyFs,
    private readonly runner: CommandRunner,
  ) {}

  // ---- layout and overrides -------------------------------------------------------------

  private overridesFile(id: string) {
    return path.join(this.workspaces.dataDirOf(id), 'openspec.json')
  }

  overrides(id: string): Overrides {
    try {
      const o = JSON.parse(fs.readFileSync(this.overridesFile(id), 'utf8')) as Partial<Overrides>
      return { mapPath: o.mapPath, changes: o.changes ?? {}, specs: o.specs ?? {} }
    } catch {
      return { changes: {}, specs: {} }
    }
  }

  private saveOverrides(id: string, o: Overrides) {
    const file = this.overridesFile(id)
    assertWritableTarget(file, [this.workspaces.rootOf(id)])
    fs.writeFileSync(file, JSON.stringify(o, null, 2))
  }

  /** Folder of the OpenSpec tree, relative to the Magento root (default "openspec"). */
  layout(id: string) {
    const base = this.workspaces.rootOf(id)
    const mapPath = this.overrides(id).mapPath
    const rel = mapPath ? `${mapPath}/openspec` : 'openspec'
    const installed = this.rofs.exists(base, `${rel}/config.yaml`) || this.rofs.isDir(base, `${rel}/specs`) || this.rofs.isDir(base, `${rel}/changes`)
    return { base, rel, mapped: Boolean(mapPath), installed }
  }

  /** Where the CLI runs: the folder that contains the openspec/ tree. */
  private projectDir(base: string, rel: string) {
    const parent = path.posix.dirname(rel)
    return parent === '.' ? base : path.join(base, parent)
  }

  // ---- CLI ----------------------------------------------------------------------------------

  /** Finds the OpenSpec CLI (npm global or AGENTIC_TOOLKIT_OPENSPEC_BIN). Null when not installed. */
  cli(): CliInfo | null {
    if (this.cliCache && Date.now() - this.cliCache.at < 60_000) return this.cliCache.value
    const candidates: string[] = []
    if (process.env.AGENTIC_TOOLKIT_OPENSPEC_BIN) candidates.push(process.env.AGENTIC_TOOLKIT_OPENSPEC_BIN)
    for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
      // npm global installs keep the package next to the shim (Windows) or under ../lib (Unix)
      candidates.push(path.join(dir, 'node_modules', '@fission-ai', 'openspec', 'bin', 'openspec.js'))
      candidates.push(path.join(dir, '..', 'lib', 'node_modules', '@fission-ai', 'openspec', 'bin', 'openspec.js'))
    }
    const entry = candidates.find((c) => /[\\/]@fission-ai[\\/]openspec[\\/]bin[\\/]openspec\.js$/.test(c) && fs.existsSync(c))
    let value: CliInfo | null = null
    if (entry) {
      // Version is read asynchronously in cliVersion(); the entry alone is enough to run commands
      value = { entry, version: '' }
    }
    this.cliCache = { at: Date.now(), value }
    return value
  }

  async cliVersion(): Promise<string> {
    const info = this.cli()
    if (!info) return ''
    if (info.version) return info.version
    try {
      const res = await this.runner.run('openspec', ['--version'], { executable: info.entry, cwd: DATA_DIR, timeoutMs: 20_000 })
      info.version = res.stdout.trim().split('\n').pop() ?? ''
    } catch {
      info.version = '?'
    }
    return info.version
  }

  /** `openspec validate --all --json`, cached for 20 seconds per installation. */
  private async validation(id: string): Promise<CliValidation | null> {
    const cached = this.validationCache.get(id)
    if (cached && Date.now() - cached.at < 20_000) return cached.value
    const info = this.cli()
    const { base, rel, installed } = this.layout(id)
    let value: CliValidation | null = null
    if (info && installed) {
      try {
        const res = await this.runner.run('openspec', ['validate', '--all', '--json', '--no-interactive'], {
          executable: info.entry,
          cwd: this.projectDir(base, rel),
          timeoutMs: 60_000,
          protectedRoots: [base],
        })
        const parsed = JSON.parse(res.stdout) as { items: { id: string; type: string; valid: boolean; issues: { level: string; message: string }[] }[] }
        value = { changes: {}, specs: {} }
        for (const it of parsed.items) (it.type === 'change' ? value.changes : value.specs)[it.id] = { valid: it.valid, issues: it.issues }
      } catch {
        value = null
      }
    }
    this.validationCache.set(id, { at: Date.now(), value })
    return value
  }

  /** Called after a write, so the next overview re-reads the tree and re-validates it. */
  invalidate(id: string) {
    this.validationCache.delete(id)
  }

  // ---- reading the tree -----------------------------------------------------------------------

  private text(base: string, rel: string): string | null {
    try {
      return this.rofs.read(base, rel, MAX_TEXT).content
    } catch {
      return null
    }
  }

  /** Every file under the OpenSpec tree, relative to the Magento root. */
  private files(base: string, rel: string): string[] {
    return this.rofs.walk(base, rel, { maxFiles: 5000, skip: SKIP }).filter((f) => f.startsWith(`${rel}/`))
  }

  private specFiles(files: string[], rel: string) {
    const prefix = `${rel}/specs/`
    return files
      .filter((f) => f.startsWith(prefix) && f.endsWith('/spec.md'))
      .map((f) => ({ capability: f.slice(prefix.length, -'/spec.md'.length), file: f }))
  }

  /** Active changes and archived ones, from the folder names under changes/. */
  private changeNames(files: string[], rel: string) {
    const prefix = `${rel}/changes/`
    const active = new Set<string>()
    const archived = new Set<string>()
    for (const f of files) {
      if (!f.startsWith(prefix)) continue
      const rest = f.slice(prefix.length).split('/')
      if (rest.length < 2) continue
      if (rest[0] === 'archive') {
        if (rest.length >= 3) archived.add(rest[1])
      } else active.add(rest[0])
    }
    return { active: [...active].sort(), archived: [...archived].sort().reverse() }
  }

  private deriveChangeStatus(tasks: ParsedTasks, archived = false): 'planejamento' | 'em-andamento' | 'pronta' | 'arquivada' {
    if (archived) return 'arquivada'
    if (tasks.total > 0 && tasks.done === tasks.total) return 'pronta'
    if (tasks.done > 0) return 'em-andamento'
    return 'planejamento'
  }

  // ---- public model ----------------------------------------------------------------------------

  async overview(id: string) {
    const { base, rel, installed, mapped } = this.layout(id)
    const cli = this.cli()
    const cliVersion = cli ? await this.cliVersion() : ''
    const base_ = { installed, mapped, dir: rel, root: base, cli: { available: Boolean(cli), version: cliVersion } }
    if (!installed) return { ...base_, summary: null, specs: [], changes: [], archived: [] }

    const o = this.overrides(id)
    const files = this.files(base, rel)
    const names = this.changeNames(files, rel)
    const validation = await this.validation(id)

    // Changes
    const changes = names.active.map((name) => {
      const cdir = `${rel}/changes/${name}`
      const proposal = this.text(base, `${cdir}/proposal.md`) ?? ''
      const tasks = parseTasks(this.text(base, `${cdir}/tasks.md`) ?? '')
      const deltas = this.specFiles(files.filter((f) => f.startsWith(`${cdir}/`)), cdir).map((s) => ({
        capability: s.capability,
        ...parseDelta(this.text(base, s.file) ?? ''),
      }))
      const derived = this.deriveChangeStatus(tasks)
      const manual = o.changes[name]
      return {
        id: name,
        title: titleOf(proposal, humanize(name)),
        why: section(proposal, 'Why'),
        derivedStatus: derived,
        manualStatus: manual ?? null,
        status: manual ?? derived,
        tasks: { total: tasks.total, done: tasks.done },
        deltas,
        specs: deltas.map((d) => d.capability),
        files: files.filter((f) => f.startsWith(`${cdir}/`)).map((f) => f.slice(cdir.length + 1)).filter((f) => !f.startsWith('.')).sort(),
        stages: {
          proposal: this.text(base, `${cdir}/proposal.md`) !== null,
          design: this.text(base, `${cdir}/design.md`) !== null,
          tasks: this.text(base, `${cdir}/tasks.md`) !== null,
        },
        skipSpecs: /skip_specs:\s*true/.test(this.text(base, `${cdir}/.openspec.yaml`) ?? ''),
        validation: validation?.changes[name] ?? null,
      }
    })

    // Specs
    const activeTouching = new Map<string, string[]>()
    for (const c of changes) for (const cap of c.specs) activeTouching.set(cap, [...(activeTouching.get(cap) ?? []), c.id])
    const specs = this.specFiles(files, `${rel}`).map((s) => {
      const capFile = s.file.replace(/^/, '')
      const parsed = parseSpec(this.text(base, capFile) ?? '')
      const touching = activeTouching.get(s.capability) ?? []
      const derived = touching.length ? 'em-alteracao' : 'estavel'
      const manual = o.specs[s.capability]
      return {
        id: s.capability,
        title: s.capability,
        purpose: parsed.purpose,
        derivedStatus: derived,
        manualStatus: manual ?? null,
        status: manual ?? derived,
        requirements: parsed.requirements.length,
        scenarios: parsed.requirements.reduce((n, r) => n + r.scenarios.length, 0),
        withoutScenario: parsed.requirements.filter((r) => r.scenarios.length === 0).length,
        changes: touching,
        validation: validation?.specs[s.capability] ?? null,
      }
    })

    const archived = names.archived.map((name) => {
      const dir = `${rel}/changes/archive/${name}`
      const proposal = this.text(base, `${dir}/proposal.md`) ?? ''
      return { id: name, title: titleOf(proposal, humanize(name.replace(/^\d{4}-\d{2}-\d{2}-/, ''))) }
    })

    const sum = (f: (c: (typeof changes)[number]) => number) => changes.reduce((n, c) => n + f(c), 0)
    const requirements = specs.reduce((n, s) => n + s.requirements, 0)
    const summary = {
      specs: specs.length,
      requirements,
      scenarios: specs.reduce((n, s) => n + s.scenarios, 0),
      withoutScenario: specs.reduce((n, s) => n + s.withoutScenario, 0),
      activeChanges: changes.length,
      archivedChanges: archived.length,
      tasksTotal: sum((c) => c.tasks.total),
      tasksDone: sum((c) => c.tasks.done),
      validationErrors: validation ? [...Object.values(validation.changes), ...Object.values(validation.specs)].filter((v) => !v.valid).length : null,
    }
    return { ...base_, summary, specs, changes, archived }
  }

  change(id: string, name: string) {
    const { base, rel, installed } = this.layout(id)
    if (!installed) throw new NotFoundException('OpenSpec não está instalado nesta instalação')
    const dir = `${rel}/changes/${name}`
    const proposal = this.text(base, `${dir}/proposal.md`)
    const tasksMd = this.text(base, `${dir}/tasks.md`)
    const files = this.files(base, dir)
    if (proposal === null && tasksMd === null && !files.length) throw new NotFoundException('Mudança não encontrada')
    const deltas = this.specFiles(files, dir).map((s) => ({ capability: s.capability, content: this.text(base, s.file) ?? '' }))
    return {
      id: name,
      dir,
      files: files.filter((f) => f.startsWith(`${dir}/`)).map((f) => f.slice(dir.length + 1)).filter((f) => !f.startsWith('.')).sort(),
      proposal: proposal ?? '',
      tasks: { raw: tasksMd ?? '', ...parseTasks(tasksMd ?? '') },
      deltas,
    }
  }

  spec(id: string, capability: string) {
    const { base, rel, installed } = this.layout(id)
    if (!installed) throw new NotFoundException('OpenSpec não está instalado nesta instalação')
    const file = `${rel}/specs/${capability}/spec.md`
    const content = this.text(base, file)
    if (content === null) throw new NotFoundException('Spec não encontrada')
    return { id: capability, content, parsed: parseSpec(content) }
  }

  // ---- manual status and mapping ----------------------------------------------------------------

  setStatus(id: string, body: { kind: 'change' | 'spec'; item: string; status: string | null }) {
    const o = this.overrides(id)
    if (body.kind === 'change') {
      if (body.status !== null && !['revisao', 'impedida'].includes(body.status)) throw new BadRequestException('Status manual de mudança inválido')
      if (body.status) o.changes[body.item] = body.status as ManualChangeStatus
      else delete o.changes[body.item]
    } else {
      if (body.status !== null && !['rascunho', 'aprovada', 'obsoleta'].includes(body.status)) throw new BadRequestException('Status manual de spec inválido')
      if (body.status) o.specs[body.item] = body.status as ManualSpecStatus
      else delete o.specs[body.item]
    }
    this.saveOverrides(id, o)
    return { ok: true }
  }

  /** Maps a folder of the Magento root as the OpenSpec tree ("" = the default openspec/). */
  setMapping(id: string, mapPath: string) {
    const clean = mapPath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    if (clean.startsWith('/') || /^[A-Za-z]:/.test(clean) || clean.split('/').includes('..')) throw new BadRequestException('Use um caminho relativo à raiz da instalação, sem ..')
    const { base } = this.layout(id)
    const target = clean ? `${clean}/openspec` : 'openspec'
    const hasTree = this.rofs.exists(base, `${target}/config.yaml`) || this.rofs.isDir(base, `${target}/specs`) || this.rofs.isDir(base, `${target}/changes`)
    if (!hasTree) throw new BadRequestException(`Não encontrei um OpenSpec em "${target}" (esperado: config.yaml, specs/ ou changes/)`)
    const o = this.overrides(id)
    o.mapPath = clean || undefined
    this.saveOverrides(id, o)
    this.validationCache.delete(id)
    return { ok: true, dir: target }
  }

  // ---- prompts for the user's Claude Code (run in their terminal, not here) -----------------------

  prompt(id: string, kind: string, change?: string) {
    const ws = this.workspaces.get(id)
    const context = `Projeto: ${ws.name}${ws.version ? ` (${ws.edition ?? 'Magento'} ${ws.version})` : ''}. Pasta: ${this.workspaces.rootOf(id)}.`
    const guard = 'Não altere código da aplicação além do que a tarefa exigir, e pergunte antes de tocar em arquivos fora da pasta do OpenSpec.'
    const safe = (name?: string) => {
      if (!name || !/^[a-z0-9][a-z0-9-]{0,80}$/.test(name)) throw new BadRequestException('Nome de mudança inválido')
      return name
    }
    switch (kind) {
      case 'install':
        return {
          title: 'Instalar o OpenSpec neste projeto',
          text: [
            context,
            'Instale e configure o OpenSpec neste projeto, passo a passo, mostrando o resultado de cada comando:',
            '1. Verifique o CLI com `openspec --version`. Se não existir, instale com `npm install -g @fission-ai/openspec`.',
            '2. Na raiz deste projeto rode `openspec init --tools claude`. Ele cria a pasta `openspec/` e os comandos do Claude em `.claude/`.',
            '3. Confirme com `openspec list --specs` e `openspec validate --all`.',
            '4. Me mostre a saída e o que foi criado. Não altere mais nada.',
            guard,
          ].join('\n'),
        }
      case 'propose':
        return {
          title: 'Nova mudança',
          text: [
            context,
            'Crie uma proposta de mudança com o OpenSpec. Descrição da mudança: [descreva aqui o que você quer].',
            'Use o comando `/opsx:propose "<descrição>"`. Antes, rode `openspec list --specs` para reaproveitar capacidades que já existem.',
            guard,
          ].join('\n'),
        }
      case 'apply': {
        const name = safe(change)
        return {
          title: `Implementar ${name}`,
          text: [
            context,
            `Implemente a mudança \`${name}\` com \`/opsx:apply ${name}\`.`,
            `Siga as tarefas de \`openspec/changes/${name}/tasks.md\` e marque cada uma como concluída assim que terminar.`,
            guard,
          ].join('\n'),
        }
      }
      case 'validate': {
        const name = safe(change)
        return {
          title: `Verificar ${name}`,
          text: [
            context,
            `Verifique a mudança \`${name}\` com \`/opsx:verify ${name}\`: a implementação precisa bater com os artefatos (proposta, specs e tarefas) antes de arquivar.`,
            'Se o comando /opsx:verify não existir, rode `openspec config profile` para ativar o workflow de verify e me avise antes.',
            'Se houver divergências, corrija-as nos artefatos ou na implementação conforme o que o usuário decidir, e me mostre o resultado final.',
            guard,
          ].join('\n'),
        }
      }
      case 'archive': {
        const name = safe(change)
        return {
          title: `Arquivar ${name}`,
          text: [
            context,
            `Antes de arquivar, confirme que todas as tarefas de \`openspec/changes/${name}/tasks.md\` estão concluídas e que \`openspec validate ${name}\` passa.`,
            `Depois arquive com \`/opsx:archive ${name}\` e me mostre o que foi atualizado nas specs.`,
            guard,
          ].join('\n'),
        }
      }
      default:
        throw new BadRequestException('Ação de prompt desconhecida')
    }
  }
}
