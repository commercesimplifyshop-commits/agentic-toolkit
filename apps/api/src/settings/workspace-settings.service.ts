import { BadRequestException, Injectable } from '@nestjs/common'
import path from 'node:path'
import { AiService } from '../ai/ai.service'
import { AnalysisService } from '../analysis/analysis.service'
import { GitOpsService } from '../gitops/gitops.service'
import { CommandRunner } from '../readonly/command-runner.service'
import { GitService, type GitAuth } from '../workspaces/git.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { WorkspaceEnvService, type EnvVarView } from './workspace-env.service'

/** Where a missing prerequisite is fixed: a section of Configurações */
export type SettingsSection = 'origem' | 'projeto' | 'repositorio' | 'variaveis' | 'ia'

export interface Prerequisite {
  id: 'analysis' | 'git' | 'git-remote' | 'claude-code' | 'ai'
  label: string
  ok: boolean
  detail: string
  fix: { section: SettingsSection; label: string }
}

export interface SettingsPatch {
  name?: string
  /** A local folder for the workspace (links a clone or .zip workspace to the engineer's folder) */
  localPath?: string
  /** Project root inside the folder */
  root?: string
  /** Git repository for Git and development; '' goes back to automatic */
  repoPath?: string
  ownVendors?: string[]
  env?: unknown
}

/**
 * Configurações → Workspace: the folder, the project inside it, the git repository and the
 * variables of a workspace, plus what each feature needs from them. The initial setup writes the
 * same settings. A change in what is analysed (folder, project or vendors) starts a new analysis.
 */
@Injectable()
export class WorkspaceSettingsService {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly env: WorkspaceEnvService,
    private readonly gitops: GitOpsService,
    private readonly ai: AiService,
    private readonly analysis: AnalysisService,
    private readonly runner: CommandRunner,
    private readonly git: GitService,
  ) {}

  /** The repository the Git screen and the tasks use, or why there is none */
  private async repo(id: string) {
    const ws = this.workspaces.get(id)
    try {
      const root = await this.gitops.repoRoot(id)
      const out = async (args: string[]) => {
        const r = await this.runner.run('git', args, { cwd: root, timeoutMs: 20_000 })
        return r.code === 0 ? r.stdout.trim() : ''
      }
      const branch = await out(['rev-parse', '--abbrev-ref', 'HEAD'])
      const remotes = (await out(['remote'])).split('\n').filter(Boolean)
      return { configured: ws.repoPath, effective: root, automatic: !ws.repoPath, branch, remotes, message: undefined as string | undefined }
    } catch (e) {
      return { configured: ws.repoPath, effective: null, automatic: !ws.repoPath, branch: undefined, remotes: [] as string[], message: (e as Error).message }
    }
  }

  async view(id: string) {
    const ws = this.workspaces.get(id)
    const detection = this.workspaces.detection(id)
    return {
      id: ws.id,
      name: ws.name,
      tech: ws.tech,
      status: ws.status,
      error: ws.error,
      analyzedAt: ws.analyzedAt,
      jobId: ws.jobId,
      source: ws.source,
      folder: ws.checkoutDir,
      root: ws.root,
      edition: ws.edition,
      version: ws.version,
      candidates: [
        ...(detection.match ? [{ path: detection.path, relative: '.', version: detection.version, edition: detection.edition }] : []),
        ...detection.candidates,
      ],
      vendors: ws.root ? this.workspaces.inspect(ws.root, ws.tech).vendors : detection.vendors,
      ownVendors: ws.ownVendors,
      repo: await this.repo(id),
      env: this.env.view(id) as EnvVarView[],
    }
  }

  /**
   * Saves what changed. When the folder, the project or the vendors change on an analysed
   * workspace, a new analysis starts and its job id comes back.
   */
  async update(id: string, patch: SettingsPatch) {
    const ws = this.workspaces.get(id)
    const wasAnalysed = ws.status === 'analyzed' || Boolean(ws.analyzedAt)
    let reanalyse = false

    if (typeof patch.name === 'string' && patch.name.trim()) this.workspaces.update(ws, { name: patch.name.trim().slice(0, 80) })
    if (typeof patch.localPath === 'string' && patch.localPath.trim() && path.resolve(patch.localPath.trim()) !== path.resolve(ws.checkoutDir)) {
      this.workspaces.linkLocal(id, patch.localPath.trim())
      reanalyse = true
    }
    if (typeof patch.root === 'string' && patch.root.trim() && path.resolve(patch.root.trim()) !== (ws.root && path.resolve(ws.root))) {
      this.workspaces.configure(id, { root: patch.root.trim() })
      reanalyse = true
    }
    if (Array.isArray(patch.ownVendors)) {
      const next = patch.ownVendors.filter((v): v is string => typeof v === 'string' && /^\w+$/.test(v))
      if ([...next].sort().join() !== [...ws.ownVendors].sort().join()) {
        this.workspaces.configure(id, { ownVendors: next })
        reanalyse = true
      }
    }
    if (typeof patch.repoPath === 'string') this.workspaces.setRepoPath(id, patch.repoPath.trim() || undefined)
    if (patch.env !== undefined) this.env.save(id, patch.env)

    let jobId: string | undefined
    const now = this.workspaces.get(id)
    if (reanalyse && wasAnalysed && now.root && now.status !== 'needs-root' && now.status !== 'error') jobId = this.analysis.run(id).jobId
    return { settings: await this.view(id), jobId, needsRoot: now.status === 'needs-root' }
  }

  /** Brings the code up to date and analyses it again: git fetch for a clone, a new reading for a local folder */
  async sync(id: string, auth: GitAuth = { method: 'system' }) {
    const ws = this.workspaces.get(id)
    if (ws.source.type === 'git') await this.git.fetch(ws.checkoutDir, ws.source.url, auth, ws.source.branch)
    if (!ws.root) throw new BadRequestException('Escolha a pasta do projeto antes de sincronizar')
    return { jobId: this.analysis.run(id).jobId }
  }

  /** What each feature may need, checked now */
  async prerequisites(id: string): Promise<Prerequisite[]> {
    const ws = this.workspaces.get(id)
    const repo = await this.repo(id)
    const bin = this.ai.claudeBinary()
    const providers = await this.ai.providers()
    const active = providers.providers.find((p) => p.id === providers.active)
    return [
      {
        id: 'analysis',
        label: 'Projeto analisado',
        ok: ws.status === 'analyzed',
        detail: ws.status === 'analyzed' ? `Analisado em ${ws.analyzedAt ?? '—'}` : ws.status === 'analyzing' ? 'A análise está em andamento.' : 'O projeto ainda não foi analisado.',
        fix: { section: 'projeto', label: 'Configurar o projeto' },
      },
      {
        id: 'git',
        label: 'Repositório git',
        ok: Boolean(repo.effective),
        detail: repo.effective ? `${repo.effective}${repo.branch ? ` (branch ${repo.branch})` : ''}` : repo.message ?? 'Nenhum repositório git encontrado.',
        fix: { section: 'repositorio', label: 'Configurar o repositório' },
      },
      {
        id: 'git-remote',
        label: 'Remoto do repositório',
        ok: repo.remotes.length > 0,
        detail: repo.remotes.length ? repo.remotes.join(', ') : repo.effective ? 'O repositório não tem remoto: não dá para atualizar a base nem fazer push.' : 'Sem repositório git.',
        fix: { section: 'repositorio', label: 'Configurar o repositório' },
      },
      {
        id: 'claude-code',
        label: 'Claude Code',
        ok: Boolean(bin),
        detail: bin ? bin : 'Claude Code não encontrado nesta máquina. Instale (claude.com/claude-code) ou informe o caminho do executável.',
        fix: { section: 'ia', label: 'Configurar o Claude Code' },
      },
      {
        id: 'ai',
        label: 'Provedor de IA',
        ok: Boolean(active?.available),
        detail: active?.available ? active.name : `${active?.name ?? 'O provedor escolhido'} não está configurado.`,
        fix: { section: 'ia', label: 'Configurar a IA' },
      },
    ]
  }
}
