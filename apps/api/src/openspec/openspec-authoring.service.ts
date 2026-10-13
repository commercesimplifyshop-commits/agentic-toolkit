import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { AiService } from '../ai/ai.service'
import { checkRepoWrite } from '../readonly/repo-exceptions'
import { CLAUDE_DENIED_TOOLS, CommandRunner } from '../readonly/command-runner.service'
import { ReadOnlyFs } from '../readonly/readonly-fs.service'
import { RepoWriter, sha256 } from '../readonly/repo-writer.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { LinksService } from '../links/links.service'
import { askClaudeReadonly } from '../links/claude-call'
import { TOOL_CATALOG } from '../links/tool-catalog'
import { parseJsonReply, sanitizePlans } from '../links/tool-plan'
import { OpenSpecService } from './openspec.service'

/** The metadata OpenSpec reads: schema plus the explicit "no spec changes" marker. */
const SKIP_SPECS_YAML = (skip: boolean) => ['schema: spec-driven', ...(skip ? ['skip_specs: true'] : []), ''].join('\n')

const CAPABILITY = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/
const CHANGE_NAME = /^[a-z0-9][a-z0-9-]{1,80}$/
const PLAN_TTL_MS = 15 * 60_000
const MAX_READ = 512 * 1024

/** Templates follow OpenSpec's own spec-driven schema (proposal, delta spec, tasks). */
export const TEMPLATES = {
  proposal: (why: string, changes: string[], newCaps: string[], modCaps: string[]) =>
    [
      '# Proposal',
      '',
      '## Why',
      '',
      why.trim(),
      '',
      '## What Changes',
      '',
      ...(changes.length ? changes.map((c) => `- ${c}`) : ['- <!-- o que muda -->']),
      '',
      '## Capabilities',
      '',
      '### New Capabilities',
      ...(newCaps.length ? newCaps.map((c) => `- \`${c}\`: <!-- o que a capacidade cobre -->`) : ['<!-- nenhuma -->']),
      '',
      '### Modified Capabilities',
      ...(modCaps.length ? modCaps.map((c) => `- \`${c}\`: <!-- qual requisito muda -->`) : ['<!-- nenhuma -->']),
      '',
      '## Impact',
      '',
      '<!-- código, APIs, dependências ou sistemas afetados -->',
      '',
    ].join('\n'),
  tasks: () => ['# Tasks', '', '## 1. Implementação', '', '- [ ] 1.1 Descreva a primeira tarefa', ''].join('\n'),
  delta: (kind: 'new' | 'modified', purpose: string) =>
    [
      '# Spec Delta',
      '',
      ...(kind === 'new' ? ['## Purpose', '', purpose.trim() || '<!-- uma ou duas frases, 50+ caracteres -->', ''] : []),
      kind === 'new' ? '## ADDED Requirements' : '## MODIFIED Requirements',
      '',
      '### Requirement: Requisito a definir',
      'O sistema MUST definir este requisito antes de arquivar a mudança.',
      '',
      '#### Scenario: Cenário a definir',
      '- **WHEN** a condição acontecer',
      '- **THEN** o resultado esperado ocorre',
      '',
    ].join('\n'),
  spec: (capability: string, purpose: string) =>
    [
      `# ${capability} Specification`,
      '',
      '## Purpose',
      '',
      purpose.trim() || '<!-- uma ou duas frases sobre o comportamento que esta capacidade garante -->',
      '',
      '## Requirements',
      '',
      '### Requirement: <!-- nome do requisito -->',
      '<!-- texto do requisito, com MUST ou SHALL -->',
      '',
      '#### Scenario: <!-- nome do cenário -->',
      '- **WHEN** <!-- condição -->',
      '- **THEN** <!-- resultado esperado -->',
      '',
    ].join('\n'),
}

@Injectable()
export class OpenSpecAuthoringService {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly rofs: ReadOnlyFs,
    private readonly runner: CommandRunner,
    private readonly writer: RepoWriter,
    private readonly openspec: OpenSpecService,
    private readonly ai: AiService,
    private readonly links: LinksService,
  ) {}

  private where(id: string) {
    const { base, rel, installed } = this.openspec.layout(id)
    return { base, rel, installed }
  }

  private requireEditable(rel: string, openspecDir: string) {
    const check = checkRepoWrite('openspec', rel, openspecDir)
    if (!check.ok) throw new BadRequestException(check.reason)
  }

  // ---- files ----------------------------------------------------------------------------

  /** Folder of one change, relative to the installation root */
  changeDir(id: string, name: string) {
    if (!CHANGE_NAME.test(name)) throw new BadRequestException('Nome de mudança inválido')
    const { rel: dir } = this.where(id)
    return `${dir}/changes/${name}`
  }

  read(id: string, rel: string) {
    const { base, rel: dir } = this.where(id)
    this.requireEditable(rel, dir)
    try {
      const content = this.rofs.read(base, rel, MAX_READ).content
      return { path: rel, content, sha: sha256(content) }
    } catch {
      throw new NotFoundException(`Não encontrei ${rel}`)
    }
  }

  save(id: string, body: { path: string; content: string; expectedSha?: string; create?: boolean }) {
    const { rel: dir } = this.where(id)
    const r = this.writer.write(id, {
      exception: 'openspec',
      rel: body.path,
      content: body.content,
      openspecDir: dir,
      create: Boolean(body.create),
      expectedSha: body.expectedSha,
      action: 'openspec.save',
    })
    this.openspec.invalidate(id)
    return { path: body.path, ...r }
  }

  // ---- creation from templates -------------------------------------------------------------

  private changeExists(base: string, dir: string, name: string) {
    if (this.rofs.isDir(base, `${dir}/changes/${name}`)) return true
    const archived = this.rofs.isDir(base, `${dir}/changes/archive`) ? this.rofs.list(base, `${dir}/changes/archive`) : []
    return archived.some((e) => e.name.endsWith(`-${name}`))
  }

  createChange(
    id: string,
    body: { name: string; why: string; whatChanges: string[]; newCapabilities: string[]; modifiedCapabilities: string[]; purposes?: Record<string, string>; skipSpecs?: boolean },
  ) {
    const { base, rel: dir } = this.where(id)
    if (!CHANGE_NAME.test(body.name)) throw new BadRequestException('Nome da mudança: use letras minúsculas, números e hífens (ex.: adicionar-pix)')
    if (!body.why?.trim()) throw new BadRequestException('Explique o porquê da mudança')
    const hasCaps = body.newCapabilities.length + body.modifiedCapabilities.length > 0
    if (!hasCaps && !body.skipSpecs) {
      throw new BadRequestException('Informe ao menos uma capacidade alterada, ou marque que a mudança não altera specs (documentação, refatoração, ferramentas)')
    }
    if (hasCaps && body.skipSpecs) throw new BadRequestException('Uma mudança que altera specs não pode ser marcada como sem mudança de spec')
    for (const c of [...body.newCapabilities, ...body.modifiedCapabilities]) {
      if (!CAPABILITY.test(c)) throw new BadRequestException(`Capacidade "${c}" inválida (use caminhos como checkout ou pagamento/pix)`)
    }
    if (body.modifiedCapabilities.some((c) => !this.rofs.exists(base, `${dir}/specs/${c}/spec.md`))) {
      throw new BadRequestException('Uma capacidade modificada precisa já existir em specs/')
    }
    if (body.newCapabilities.some((c) => this.rofs.exists(base, `${dir}/specs/${c}/spec.md`))) {
      throw new BadRequestException('Uma capacidade nova já existe: mova-a para "modificadas" ou escolha outro nome')
    }
    if (this.changeExists(base, dir, body.name)) throw new ConflictException(`Já existe uma mudança chamada ${body.name}`)

    const root = `${dir}/changes/${body.name}`
    const created: string[] = []
    const put = (rel: string, content: string) => {
      this.writer.write(id, { exception: 'openspec', rel, content, openspecDir: dir, create: true, action: 'openspec.create-change' })
      created.push(rel)
    }
    put(`${root}/proposal.md`, TEMPLATES.proposal(body.why, body.whatChanges.filter(Boolean), body.newCapabilities, body.modifiedCapabilities))
    put(`${root}/tasks.md`, TEMPLATES.tasks())
    for (const c of body.newCapabilities) put(`${root}/specs/${c}/spec.md`, TEMPLATES.delta('new', body.purposes?.[c] ?? ''))
    for (const c of body.modifiedCapabilities) put(`${root}/specs/${c}/spec.md`, TEMPLATES.delta('modified', ''))
    if (body.skipSpecs) put(`${root}/.openspec.yaml`, SKIP_SPECS_YAML(true))
    this.openspec.invalidate(id)
    return { name: body.name, created }
  }

  /**
   * Marks (or unmarks) an existing change as having no spec changes, through the
   * .openspec.yaml file OpenSpec reads. Only this file is touched.
   */
  setSkipSpecs(id: string, name: string, skip: boolean) {
    const { base, rel: dir } = this.where(id)
    if (!CHANGE_NAME.test(name)) throw new BadRequestException('Nome de mudança inválido')
    const rel = `${dir}/changes/${name}/.openspec.yaml`
    // OpenSpec refuses skip_specs when delta files exist, so the marker is only allowed on changes without deltas
    if (skip && this.rofs.list(base, `${dir}/changes/${name}`).some((e) => e.name === 'specs')) {
      throw new BadRequestException('Esta mudança já tem deltas de spec. Edite-os ou remova-os antes de marcar como sem mudança de spec.')
    }
    const exists = this.rofs.exists(base, rel)
    const current = exists ? this.rofs.read(base, rel, MAX_READ).content : null
    const r = this.writer.write(id, {
      exception: 'openspec',
      rel,
      content: SKIP_SPECS_YAML(skip),
      openspecDir: dir,
      create: !exists,
      expectedSha: current === null ? undefined : sha256(current),
      action: 'openspec.skip-specs',
    })
    this.openspec.invalidate(id)
    return { path: rel, ...r }
  }

  createSpec(id: string, body: { capability: string; purpose: string }) {
    const { base, rel: dir } = this.where(id)
    if (!CAPABILITY.test(body.capability)) throw new BadRequestException('Capacidade inválida (use caminhos como checkout ou pagamento/pix)')
    const rel = `${dir}/specs/${body.capability}/spec.md`
    if (this.rofs.exists(base, rel)) throw new ConflictException(`A spec ${body.capability} já existe`)
    const r = this.writer.write(id, {
      exception: 'openspec',
      rel,
      content: TEMPLATES.spec(body.capability, body.purpose ?? ''),
      openspecDir: dir,
      create: true,
      action: 'openspec.create-spec',
    })
    this.openspec.invalidate(id)
    return { path: rel, ...r }
  }

  /**
   * Deletes an active change. The user must type its name (confirm). A copy of every file is
   * kept in Agentic Toolkit's data dir first, so it can be recovered from this machine.
   */
  deleteChange(id: string, name: string, confirm: string) {
    const { base, rel: dir } = this.where(id)
    if (!CHANGE_NAME.test(name)) throw new BadRequestException('Nome de mudança inválido')
    if (confirm !== name) throw new BadRequestException(`Para excluir, digite o nome exato da mudança: ${name}`)
    if (name === 'archive') throw new BadRequestException('Mudança arquivada não pode ser excluída')
    const folder = `${dir}/changes/${name}`
    if (!this.rofs.isDir(base, folder)) throw new NotFoundException(`A mudança ${name} não existe ou já está arquivada`)

    this.links.removeChange(id, name)
    const files = this.rofs.walk(base, folder, { maxFiles: 2000, skip: [] }).filter((f) => f.startsWith(`${folder}/`))
    const backup = path.join(this.workspaces.dataDirOf(id), 'trash', 'changes', `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
    for (const f of files) {
      const content = this.rofs.read(base, f, MAX_READ).content
      const target = path.join(backup, f.slice(folder.length + 1))
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, content, 'utf8')
    }
    for (const f of files) this.writer.remove(id, { exception: 'openspec', rel: f, openspecDir: dir, action: 'openspec.delete-change' })
    this.openspec.invalidate(id)
    return { deleted: name, files: files.length, backup }
  }

  // ---- install through the OpenSpec CLI, in a staging folder, then copied by RepoWriter -----

  private planDir(id: string) {
    const dir = path.join(this.workspaces.dataDirOf(id), 'staging', 'plans')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  private walk(dir: string, prefix = ''): string[] {
    const out: string[] = []
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) out.push(...this.walk(path.join(dir, e.name), rel))
      else if (e.isFile()) out.push(rel)
    }
    return out
  }

  /** Runs `openspec init --tools claude .` in a staging folder and lists what it would copy. */
  async installPreview(id: string) {
    const { base, installed } = this.where(id)
    if (installed) throw new ConflictException('O OpenSpec já está instalado nesta instalação')
    const cli = this.openspec.cli()
    if (!cli) throw new BadRequestException('CLI do OpenSpec não encontrado. Instale com: npm install -g @fission-ai/openspec')
    const version = await this.openspec.cliVersion()

    const staging = path.join(this.workspaces.dataDirOf(id), 'staging', `install-${randomBytes(4).toString('hex')}`)
    fs.mkdirSync(staging, { recursive: true })
    try {
      await this.runner.run('openspec', ['init', '--tools', 'claude', '.'], { executable: cli.entry, cwd: staging, timeoutMs: 180_000, protectedRoots: [base] })
      const all = this.walk(staging)
      const files: { path: string; content: string }[] = []
      const ignored: { path: string; reason: string }[] = []
      for (const rel of all) {
        const check = checkRepoWrite('openspec', rel, 'openspec')
        if (!check.ok) {
          ignored.push({ path: rel, reason: check.reason ?? 'fora da lista de exceções' })
          continue
        }
        files.push({ path: rel, content: fs.readFileSync(path.join(staging, rel), 'utf8') })
      }
      if (!files.some((f) => f.path === 'openspec/config.yaml')) throw new BadRequestException('O OpenSpec não gerou openspec/config.yaml. Veja a instalação do CLI.')
      const planId = randomBytes(8).toString('hex')
      fs.writeFileSync(path.join(this.planDir(id), `${planId}.json`), JSON.stringify({ createdAt: Date.now(), files }))
      return {
        planId,
        cliVersion: version,
        files: files.map((f) => ({ path: f.path, bytes: Buffer.byteLength(f.content, 'utf8') })),
        ignored,
        expiresInMinutes: PLAN_TTL_MS / 60_000,
      }
    } finally {
      fs.rmSync(staging, { recursive: true, force: true })
    }
  }

  installApply(id: string, planId: string) {
    if (!/^[a-f0-9]{16}$/.test(planId)) throw new BadRequestException('Prévia inválida')
    const { installed } = this.where(id)
    if (installed) throw new ConflictException('O OpenSpec já foi instalado')
    const file = path.join(this.planDir(id), `${planId}.json`)
    if (!fs.existsSync(file)) throw new NotFoundException('Prévia não encontrada. Gere a instalação de novo.')
    const plan = JSON.parse(fs.readFileSync(file, 'utf8')) as { createdAt: number; files: { path: string; content: string }[] }
    fs.rmSync(file, { force: true })
    if (Date.now() - plan.createdAt > PLAN_TTL_MS) throw new BadRequestException('A prévia expirou. Gere a instalação de novo.')

    const written: string[] = []
    for (const f of plan.files) {
      this.writer.write(id, { exception: 'openspec', rel: f.path, content: f.content, openspecDir: 'openspec', create: true, action: 'openspec.install' })
      written.push(f.path)
    }
    this.openspec.invalidate(id)
    return { written }
  }

  // ---- drafts by Claude: text only, nothing is saved here ------------------------------------

  async draft(id: string, body: { kind: 'proposal' | 'tasks' | 'spec'; request: string; capability?: string }) {
    const bin = this.ai.claudeBinary()
    if (!bin) throw new BadRequestException('Claude Code não encontrado nesta máquina')
    const root = this.workspaces.rootOf(id)
    const { rel: dir } = this.where(id)
    const template = body.kind === 'proposal' ? TEMPLATES.proposal('<porquê>', ['<mudança>'], ['<capacidade>'], []) : body.kind === 'tasks' ? TEMPLATES.tasks() : TEMPLATES.spec(body.capability ?? '<capacidade>', '')
    let existing = ''
    if (body.kind === 'spec' && body.capability && CAPABILITY.test(body.capability)) {
      try {
        existing = this.rofs.read(root, `${dir}/specs/${body.capability}/spec.md`, 100_000).content
      } catch {
        existing = ''
      }
    }
    const system = [
      'Você escreve artefatos do OpenSpec (spec-driven) em português do Brasil.',
      'Responda SOMENTE com o conteúdo Markdown do arquivo, sem texto antes ou depois e sem cercas de código.',
      'Siga exatamente a estrutura do modelo. Use o código (Read, Grep, Glob) para nomes reais de módulos e comportamentos. Não invente integrações.',
      'Specs descrevem comportamento observável (MUST/SHALL, cenários WHEN/THEN), não implementação.',
    ].join('\n')
    const prompt = [
      `Modelo do arquivo:\n${template}`,
      existing ? `Spec atual (não repita o que já está correto; ajuste o necessário):\n${existing}` : '',
      `Pedido: ${body.request.trim()}`,
    ]
      .filter(Boolean)
      .join('\n\n')
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
      system,
    ]
    const res = await this.runner.run('claude', args, { executable: bin, cwd: root, stdin: prompt, timeoutMs: 5 * 60_000, protectedRoots: [root] })
    let parsed: { result?: string; is_error?: boolean } = {}
    try {
      parsed = JSON.parse(res.stdout)
    } catch {
      throw new BadRequestException(`Claude Code falhou: ${(res.stderr || res.stdout).slice(0, 300)}`)
    }
    if (parsed.is_error) throw new BadRequestException(`Claude Code: ${(parsed.result ?? 'erro').slice(0, 300)}`)
    const text = (parsed.result ?? '').replace(/^```(?:markdown|md)?\s*\n/, '').replace(/\n```\s*$/, '').trim() + '\n'
    return { text }
  }

  /** Revises one OpenSpec file from a request in plain language. Returns the proposed text and the tools it needs; saves nothing. */
  async revise(id: string, body: { path: string; instruction: string }) {
    const bin = this.ai.claudeBinary()
    if (!bin) throw new BadRequestException('Claude Code não encontrado nesta máquina')
    const root = this.workspaces.rootOf(id)
    const current = this.read(id, body.path)
    const system = [
      'Você revisa um arquivo do OpenSpec (spec-driven) em português do Brasil, a pedido do usuário.',
      'Responda SOMENTE com um objeto JSON: {"markdown": "<arquivo completo já revisado>", "tools": [...]}, sem texto antes ou depois.',
      'Mude só o que o pedido exige e mantenha o resto igual, inclusive a estrutura de seções.',
      'Specs descrevem comportamento observável (MUST/SHALL, cenários WHEN/THEN), não implementação. Use o código (Read, Grep, Glob) para nomes reais; não invente integrações.',
      'Em "tools", liste as ferramentas que esta revisão passa a exigir (use [] se nenhuma). Não crie nada você mesmo.',
      TOOL_CATALOG,
    ].join('\n')
    const prompt = `Arquivo atual (${body.path}):\n${current.content}\n\nPedido: ${body.instruction.trim()}`
    const reply = await askClaudeReadonly(this.runner, bin, root, system, prompt)
    const parsed = parseJsonReply(reply)
    if (!parsed || typeof parsed.markdown !== 'string' || !parsed.markdown.trim()) throw new BadRequestException('O Claude não devolveu a revisão no formato esperado. Tente de novo.')
    const text = parsed.markdown.endsWith('\n') ? parsed.markdown : `${parsed.markdown}\n`
    return { path: body.path, sha: current.sha, current: current.content, text, tools: sanitizePlans(parsed.tools) }
  }
}
