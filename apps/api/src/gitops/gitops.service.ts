import { BadRequestException, Injectable } from '@nestjs/common'
import fs from 'node:fs'
import path from 'node:path'
import { CommandRunner } from '../readonly/command-runner.service'
import { WorkspacesService } from '../workspaces/workspaces.service'

/** Field separator in git --format output: a byte that never appears in names or messages */
const SEP = '\x1f'
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*[\s~^:?*[\\])[A-Za-z0-9._/-]{1,120}(?<!\.lock)(?<!\/)$/

export interface GitStatusFile {
  path: string
  /** Two-letter porcelain code, e.g. " M", "??", "A " */
  code: string
}

export interface GitBranch {
  name: string
  current: boolean
  upstream?: string
  ahead: number
  behind: number
  sha: string
  date: string
  subject: string
  /** Folder where the branch is checked out, if any */
  worktree?: string
}

export interface GitWorktree {
  path: string
  branch?: string
  head: string
  main: boolean
  locked: boolean
  prunable: boolean
  /** Files changed and not committed in that folder */
  changes: number
}

/** Hides credentials that may be part of a remote URL */
const safeUrl = (url: string) => url.replace(/(https?:\/\/)[^@/\s]+@/, '$1***@')

/**
 * The local git of an installation: overview and the actions to manage branches and worktrees.
 * Every command runs through CommandRunner (no shell); each worktree of a task lives next to the
 * project, in <project>-worktrees/<branch>.
 */
@Injectable()
export class GitOpsService {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly runner: CommandRunner,
  ) {}

  private async git(cwd: string, args: string[], timeoutMs = 120_000): Promise<string> {
    const res = await this.runner.run('git', args, { cwd, timeoutMs })
    if (res.code !== 0) throw new BadRequestException((res.stderr || res.stdout).trim().split('\n').slice(-3).join(' ') || `git ${args[0]} falhou`)
    return res.stdout
  }

  /** Top folder of the repository that contains the installation (the Magento root can be a subfolder) */
  async repoRoot(id: string): Promise<string> {
    const ws = this.workspaces.get(id)
    const from = ws.repoPath ?? ws.root ?? ws.checkoutDir
    const res = fs.existsSync(from) ? await this.runner.run('git', ['rev-parse', '--show-toplevel'], { cwd: from, timeoutMs: 20_000 }) : { code: 1, stdout: '' }
    if (res.code !== 0) {
      throw new BadRequestException(
        ws.repoPath
          ? `A pasta configurada como repositório (${ws.repoPath}) não é um repositório git. Corrija em Configurações → Workspace.`
          : 'Esta instalação não está em um repositório git. Informe o caminho do repositório em Configurações → Workspace para usar o Git e o desenvolvimento por tarefa.',
      )
    }
    return path.resolve(res.stdout.trim())
  }

  /** Where the worktree of a branch goes: a folder next to the project, never inside it */
  worktreePathFor(root: string, branch: string) {
    return path.join(path.dirname(root), `${path.basename(root)}-worktrees`, branch.replace(/[\\/]+/g, '-'))
  }

  requireBranchName(name: unknown): string {
    if (typeof name !== 'string' || !BRANCH.test(name)) throw new BadRequestException(`Nome de branch inválido: ${String(name)}`)
    return name
  }

  async overview(id: string) {
    let root: string
    try {
      root = await this.repoRoot(id)
    } catch (e) {
      return { repo: false as const, message: (e as Error).message }
    }
    const [statusOut, branchesOut, remoteRefs, worktreesOut, stashOut, logOut, remotesOut] = await Promise.all([
      this.git(root, ['status', '--porcelain=v1', '-b']),
      this.git(root, ['for-each-ref', `--format=%(refname:short)${SEP}%(upstream:short)${SEP}%(upstream:track)${SEP}%(objectname:short)${SEP}%(committerdate:iso8601)${SEP}%(subject)${SEP}%(HEAD)`, 'refs/heads']),
      this.git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes']),
      this.git(root, ['worktree', 'list', '--porcelain']),
      this.git(root, ['stash', 'list', `--format=%gd${SEP}%s`]),
      this.git(root, ['log', '-20', `--format=%h${SEP}%ad${SEP}%an${SEP}%s`, '--date=iso']).catch(() => ''),
      this.git(root, ['remote', '-v']),
    ])

    const statusLines = statusOut.split('\n').filter(Boolean)
    const head = statusLines[0]?.startsWith('## ') ? statusLines.shift()!.slice(3) : ''
    const files: GitStatusFile[] = statusLines.map((l) => ({ code: l.slice(0, 2), path: l.slice(3) }))

    const worktrees: GitWorktree[] = []
    for (const block of worktreesOut.split(/\n\n+/).filter(Boolean)) {
      const lines = block.split('\n')
      const get = (k: string) => lines.find((l) => l.startsWith(`${k} `))?.slice(k.length + 1)
      const wtPath = path.resolve(get('worktree') ?? '')
      worktrees.push({
        path: wtPath,
        branch: get('branch')?.replace(/^refs\/heads\//, ''),
        head: (get('HEAD') ?? '').slice(0, 8),
        main: worktrees.length === 0,
        locked: lines.some((l) => l.startsWith('locked')),
        prunable: lines.some((l) => l.startsWith('prunable')),
        changes: 0,
      })
    }
    // a worktree's own pending changes (skip folders that no longer exist)
    await Promise.all(
      worktrees.map(async (w) => {
        if (w.main || !fs.existsSync(w.path)) return
        const out = await this.git(w.path, ['status', '--porcelain']).catch(() => '')
        w.changes = out.split('\n').filter(Boolean).length
      }),
    )
    if (worktrees[0]) worktrees[0].changes = files.length

    const branches: GitBranch[] = branchesOut
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [name, upstream, track, sha, date, subject, headMark] = l.split(SEP)
        return {
          name,
          current: headMark === '*',
          upstream: upstream || undefined,
          ahead: Number(track?.match(/ahead (\d+)/)?.[1] ?? 0),
          behind: Number(track?.match(/behind (\d+)/)?.[1] ?? 0),
          sha,
          date,
          subject,
          worktree: worktrees.find((w) => w.branch === name)?.path,
        }
      })
      .sort((a, b) => Number(b.current) - Number(a.current) || b.date.localeCompare(a.date))

    const remotes = [...new Map(remotesOut.split('\n').filter(Boolean).map((l) => {
      const [name, url] = l.split(/\s+/)
      return [name, { name, url: safeUrl(url) }] as const
    })).values()]

    return {
      repo: true as const,
      root,
      current: branches.find((b) => b.current)?.name ?? (head.startsWith('HEAD') ? '(detached)' : head.split('...')[0]),
      head,
      files,
      branches,
      remoteBranches: remoteRefs.split('\n').filter((r) => r && !r.endsWith('/HEAD')).slice(0, 300),
      worktrees,
      stashes: stashOut.split('\n').filter(Boolean).map((l) => {
        const [ref, subject] = l.split(SEP)
        return { ref, subject }
      }),
      log: logOut.split('\n').filter(Boolean).map((l) => {
        const [sha, date, author, subject] = l.split(SEP)
        return { sha, date, author, subject }
      }),
      remotes,
    }
  }

  async fetch(id: string) {
    const root = await this.repoRoot(id)
    await this.git(root, ['fetch', '--all', '--prune'], 5 * 60_000)
    return { ok: true }
  }

  /** Fast-forward only: a pull never creates a merge commit or rewrites history */
  async pull(id: string, worktreePath?: string) {
    const root = await this.repoRoot(id)
    const cwd = worktreePath ? await this.requireWorktree(id, worktreePath) : root
    await this.git(cwd, ['pull', '--ff-only'], 5 * 60_000)
    return { ok: true }
  }

  async checkout(id: string, branch: string) {
    const root = await this.repoRoot(id)
    await this.git(root, ['checkout', this.requireBranchName(branch)])
    return { ok: true }
  }

  /** How the local base compares with its remote, after a fetch of that branch */
  async baseStatus(id: string, base: string) {
    const root = await this.repoRoot(id)
    this.requireBranchName(base)
    const upstream = (await this.git(root, ['for-each-ref', '--format=%(upstream:short)', `refs/heads/${base}`]).catch(() => '')).trim()
    if (!upstream) return { base, upstream: null, fetched: false, ahead: 0, behind: 0, upToDate: true, message: 'A branch base não tem remoto configurado: usada como está.' }
    const remote = upstream.split('/')[0]
    const remoteBranch = upstream.slice(remote.length + 1)
    await this.git(root, ['fetch', remote, remoteBranch], 5 * 60_000)
    const [ahead, behind] = (await this.git(root, ['rev-list', '--left-right', '--count', `${base}...${upstream}`])).trim().split(/\s+/).map(Number)
    return {
      base,
      upstream,
      fetched: true,
      ahead,
      behind,
      upToDate: behind === 0,
      message: behind === 0 ? `${base} está atualizada com ${upstream}.` : `${base} está ${behind} commit(s) atrás de ${upstream}.`,
    }
  }

  /** Brings the base up to date (fast-forward only), wherever it is checked out */
  async updateBase(id: string, base: string) {
    const root = await this.repoRoot(id)
    this.requireBranchName(base)
    const ov = await this.overview(id)
    if (!ov.repo) throw new BadRequestException(ov.message)
    const where = ov.worktrees.find((w) => w.branch === base)
    if (where) {
      await this.git(where.path, ['pull', '--ff-only'], 5 * 60_000)
    } else {
      const upstream = (await this.git(root, ['for-each-ref', '--format=%(upstream:short)', `refs/heads/${base}`])).trim()
      if (!upstream) throw new BadRequestException(`${base} não tem remoto configurado`)
      const remote = upstream.split('/')[0]
      // updates the local branch without checking it out; refuses anything but a fast-forward
      await this.git(root, ['fetch', remote, `${upstream.slice(remote.length + 1)}:${base}`], 5 * 60_000)
    }
    return this.baseStatus(id, base)
  }

  async createBranch(id: string, name: string, base: string) {
    const root = await this.repoRoot(id)
    await this.git(root, ['branch', this.requireBranchName(name), this.requireBranchName(base)])
    return { ok: true }
  }

  async deleteBranch(id: string, name: string, force = false) {
    const root = await this.repoRoot(id)
    await this.git(root, ['branch', force ? '-D' : '-d', this.requireBranchName(name)])
    return { ok: true }
  }

  /**
   * A folder for a branch, next to the project. With `base`, the branch is created from it.
   * A branch already checked out somewhere is reused there instead of failing.
   */
  async addWorktree(id: string, input: { branch: string; base?: string }) {
    const root = await this.repoRoot(id)
    const branch = this.requireBranchName(input.branch)
    const ov = await this.overview(id)
    if (!ov.repo) throw new BadRequestException(ov.message)
    const existing = ov.worktrees.find((w) => w.branch === branch)
    if (existing) return { path: existing.path, branch, reused: true }
    const target = this.worktreePathFor(root, branch)
    if (fs.existsSync(target)) throw new BadRequestException(`A pasta ${target} já existe. Remova-a ou escolha outro nome de branch.`)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const exists = ov.branches.some((b) => b.name === branch)
    if (input.base && !exists) await this.git(root, ['worktree', 'add', '-b', branch, target, this.requireBranchName(input.base)])
    else if (exists) await this.git(root, ['worktree', 'add', target, branch])
    else throw new BadRequestException(`A branch ${branch} não existe: informe a branch base para criá-la`)
    return { path: target, branch, reused: false }
  }

  private async requireWorktree(id: string, wtPath: string) {
    const ov = await this.overview(id)
    if (!ov.repo) throw new BadRequestException(ov.message)
    const w = ov.worktrees.find((x) => path.resolve(x.path) === path.resolve(wtPath))
    if (!w) throw new BadRequestException('Worktree não encontrado neste repositório')
    return w.path
  }

  async removeWorktree(id: string, wtPath: string, force = false) {
    const root = await this.repoRoot(id)
    const ov = await this.overview(id)
    if (!ov.repo) throw new BadRequestException(ov.message)
    const w = ov.worktrees.find((x) => path.resolve(x.path) === path.resolve(wtPath))
    if (!w) throw new BadRequestException('Worktree não encontrado neste repositório')
    if (w.main) throw new BadRequestException('A pasta principal do projeto não pode ser removida')
    await this.git(root, ['worktree', 'remove', ...(force ? ['--force'] : []), w.path])
    return { ok: true }
  }

  async pruneWorktrees(id: string) {
    const root = await this.repoRoot(id)
    await this.git(root, ['worktree', 'prune'])
    return { ok: true }
  }

  /** Sends a branch to its remote (origin by default), setting the upstream */
  async push(id: string, branch: string, remote = 'origin') {
    const root = await this.repoRoot(id)
    if (!/^[A-Za-z0-9._-]{1,60}$/.test(remote)) throw new BadRequestException('Remoto inválido')
    // clones made by the toolkit come with push turned off on purpose (see workspaces/git.service.ts)
    const pushUrl = (await this.git(root, ['remote', 'get-url', '--push', remote]).catch(() => '')).trim()
    if (pushUrl.startsWith('PUSH_DISABLED')) {
      throw new BadRequestException('Esta instalação é um clone feito pelo Agentic Toolkit, e nele o push fica desativado. Faça o push a partir do seu clone de trabalho, ou conecte o projeto como pasta local.')
    }
    await this.git(root, ['push', '-u', remote, this.requireBranchName(branch)], 5 * 60_000)
    return { ok: true }
  }

  /** Changed files and the diff summary of one worktree (the task's folder) */
  async worktreeStatus(id: string, wtPath: string) {
    const cwd = await this.requireWorktree(id, wtPath)
    const [status, log] = await Promise.all([this.git(cwd, ['status', '--porcelain']), this.git(cwd, ['log', '-10', `--format=%h${SEP}%ad${SEP}%s`, '--date=iso']).catch(() => '')])
    return {
      files: status.split('\n').filter(Boolean).map((l) => ({ code: l.slice(0, 2), path: l.slice(3) })),
      log: log.split('\n').filter(Boolean).map((l) => {
        const [sha, date, subject] = l.split(SEP)
        return { sha, date, subject }
      }),
    }
  }
}
