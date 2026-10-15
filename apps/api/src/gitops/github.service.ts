import { BadRequestException, Injectable } from '@nestjs/common'
import { AuditService } from '../readonly/audit.service'
import { CommandRunner } from '../readonly/command-runner.service'
import { GitOpsService } from './gitops.service'

export interface GitHubRepo {
  host: string
  owner: string
  repo: string
  /** REST API root: api.github.com, or /api/v3 on GitHub Enterprise */
  api: string
}

/** Where the credential in use came from; the token itself never leaves this process */
export type CredentialSource = 'git-credential' | 'token'

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'

export interface DraftComment {
  path: string
  line: number
  side: 'LEFT' | 'RIGHT'
  /** For a comment on several lines: the first one */
  start_line?: number
  body: string
}

const OWNER_REPO = /^[A-Za-z0-9_.-]{1,100}$/
const MAX_FILES = 300

/** owner/repo of a GitHub remote URL (https, ssh or scp-like), or null for other hosts */
export function parseGitHubRemote(url: string): GitHubRepo | null {
  const m = url.trim().match(/^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/\s]+@)([^/:\s]+)(?::\d+)?[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/)
  if (!m) return null
  const [, host, owner, repo] = m
  if (!/github/i.test(host) || !OWNER_REPO.test(owner) || !OWNER_REPO.test(repo)) return null
  return { host, owner, repo, api: host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3` }
}

/**
 * Pull requests of the project's GitHub repository: list, the review view (files with their
 * diff, reviews and comments) and submitting a review. The credential is the one the person
 * chooses on screen (the git credential of this machine, or a token), kept in memory only.
 */
@Injectable()
export class GitHubService {
  /** Credential per host, in memory: lost when the app stops, never written or sent to the screen */
  private readonly credentials = new Map<string, { token: string; source: CredentialSource; login?: string }>()

  constructor(
    private readonly gitops: GitOpsService,
    private readonly runner: CommandRunner,
    private readonly audit: AuditService,
  ) {}

  /** The GitHub repository of the project's remote (origin first) */
  async repoOf(id: string): Promise<GitHubRepo> {
    const root = await this.gitops.repoRoot(id)
    const res = await this.runner.run('git', ['remote', '-v'], { cwd: root, timeoutMs: 20_000 })
    const remotes = res.stdout
      .split('\n')
      .map((l) => l.split(/\s+/))
      .filter((p) => p[0] && p[1])
    const ordered = [...remotes.filter((r) => r[0] === 'origin'), ...remotes.filter((r) => r[0] !== 'origin')]
    for (const [, url] of ordered) {
      const gh = parseGitHubRemote(url)
      if (gh) return gh
    }
    throw new BadRequestException(remotes.length ? 'O remoto do repositório não é do GitHub. As pull requests funcionam com repositórios no GitHub.' : 'O repositório não tem remoto. Configure em Configurações → Workspace → Repositório git.')
  }

  private async request<T>(repo: GitHubRepo, method: 'GET' | 'POST', path: string, body?: unknown, token = this.credentials.get(repo.host)?.token): Promise<{ data: T; next?: string }> {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 30_000)
    try {
      const res = await fetch(path.startsWith('https://') ? path : `${repo.api}${path}`, {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'agentic-toolkit',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      })
      const text = await res.text()
      let data: unknown = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = text
      }
      if (!res.ok) {
        const msg = (data as { message?: string; errors?: { message?: string }[] })?.message ?? `HTTP ${res.status}`
        const detail = (data as { errors?: { message?: string }[] })?.errors?.map((e) => e.message).filter(Boolean).join('; ')
        if (res.status === 401) throw new BadRequestException('O GitHub recusou a credencial. Conecte de novo.')
        if (res.status === 404) throw new BadRequestException(token ? 'Repositório ou pull request não encontrado, ou a credencial não tem acesso.' : 'Repositório não encontrado. Se ele for privado, conecte uma credencial do GitHub.')
        if (res.status === 403 && /rate limit/i.test(msg)) throw new BadRequestException('Limite de requisições do GitHub atingido. Conecte uma credencial (o limite sem credencial é baixo) ou tente mais tarde.')
        throw new BadRequestException(`GitHub: ${msg}${detail ? ` (${detail})` : ''}`)
      }
      const next = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1]
      return { data: data as T, next }
    } catch (e) {
      if (e instanceof BadRequestException) throw e
      throw new BadRequestException(`Não consegui falar com o GitHub: ${(e as Error).message}`)
    } finally {
      clearTimeout(timer)
    }
  }

  /** Every page of a list, up to a limit */
  private async all<T>(repo: GitHubRepo, path: string, limit: number): Promise<T[]> {
    const out: T[] = []
    let url: string | undefined = path
    while (url && out.length < limit) {
      const page: { data: T[]; next?: string } = await this.request<T[]>(repo, 'GET', url)
      out.push(...page.data)
      url = page.next
    }
    return out.slice(0, limit)
  }

  // ---- credential ----------------------------------------------------------------------------

  /** Who is connected, for the screen: never the token */
  async status(id: string) {
    let repo: GitHubRepo
    try {
      repo = await this.repoOf(id)
    } catch (e) {
      return { github: false as const, message: (e as Error).message }
    }
    const cred = this.credentials.get(repo.host)
    return { github: true as const, host: repo.host, owner: repo.owner, repo: repo.repo, url: `https://${repo.host}/${repo.owner}/${repo.repo}`, connected: Boolean(cred), source: cred?.source, login: cred?.login }
  }

  /**
   * Connects with the credential the person chose: the one git already uses for this host on this
   * machine (Git Credential Manager or another helper), or a token typed on screen.
   */
  async connect(id: string, input: { source?: string; token?: string }) {
    const repo = await this.repoOf(id)
    let token: string
    let source: CredentialSource
    if (input.source === 'token') {
      token = String(input.token ?? '').trim()
      if (!/^[A-Za-z0-9_]{20,255}$/.test(token)) throw new BadRequestException('Token inválido')
      source = 'token'
    } else if (input.source === 'git-credential') {
      const root = await this.gitops.repoRoot(id)
      const res = await this.runner.run('git', ['credential', 'fill'], {
        cwd: root,
        stdin: `protocol=https\nhost=${repo.host}\n\n`,
        // never open a login window or ask in a terminal: either git already has it, or it fails
        env: { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
        timeoutMs: 20_000,
      })
      token = res.code === 0 ? (res.stdout.split(/\r?\n/).find((l) => l.startsWith('password='))?.slice('password='.length) ?? '') : ''
      if (!token) throw new BadRequestException(`O git desta máquina não tem uma credencial salva para ${repo.host}. Faça um push ou clone pelo git uma vez, ou use um token.`)
      source = 'git-credential'
    } else {
      throw new BadRequestException('Escolha de onde vem a credencial')
    }
    const me = await this.request<{ login: string }>(repo, 'GET', '/user', undefined, token)
    this.credentials.set(repo.host, { token, source, login: me.data.login })
    this.audit.record({ action: 'git.github.connect', kind: 'external', method: 'GITHUB', url: repo.host, workspace: id, verdict: 'allowed', detail: `conectado como ${me.data.login} (${source === 'token' ? 'token informado' : 'credencial do git'}), só em memória` })
    return this.status(id)
  }

  async disconnect(id: string) {
    const repo = await this.repoOf(id)
    this.credentials.delete(repo.host)
    return this.status(id)
  }

  // ---- pull requests ---------------------------------------------------------------------------

  async list(id: string, state: 'open' | 'closed' = 'open') {
    const repo = await this.repoOf(id)
    const me = this.credentials.get(repo.host)?.login
    type Pr = { number: number; title: string; state: string; draft: boolean; html_url: string; user: { login: string; avatar_url: string }; head: { ref: string; sha: string }; base: { ref: string }; created_at: string; updated_at: string; requested_reviewers: { login: string }[]; labels: { name: string; color: string }[] }
    const prs = (await this.request<Pr[]>(repo, 'GET', `/repos/${repo.owner}/${repo.repo}/pulls?state=${state}&sort=updated&direction=desc&per_page=50`)).data
    return prs.map((p) => ({
      number: p.number,
      title: p.title,
      state: p.state,
      draft: p.draft,
      url: p.html_url,
      author: p.user.login,
      avatar: p.user.avatar_url,
      head: p.head.ref,
      base: p.base.ref,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      reviewers: p.requested_reviewers.map((r) => r.login),
      awaitingMe: Boolean(me && p.requested_reviewers.some((r) => r.login === me)),
      labels: p.labels.map((l) => ({ name: l.name, color: l.color })),
    }))
  }

  private requireNumber(n: unknown) {
    const num = Number(n)
    if (!Number.isInteger(num) || num < 1) throw new BadRequestException('Pull request inválida')
    return num
  }

  /** The review view: the PR, its files with the diff, reviews, comments and checks */
  async pull(id: string, n: unknown) {
    const repo = await this.repoOf(id)
    const num = this.requireNumber(n)
    const base = `/repos/${repo.owner}/${repo.repo}`
    type Pr = { number: number; title: string; body: string | null; state: string; draft: boolean; merged: boolean; mergeable_state?: string; html_url: string; user: { login: string; avatar_url: string }; head: { ref: string; sha: string }; base: { ref: string }; created_at: string; updated_at: string; additions: number; deletions: number; changed_files: number; commits: number; requested_reviewers: { login: string }[] }
    const pr = (await this.request<Pr>(repo, 'GET', `${base}/pulls/${num}`)).data
    type File = { filename: string; previous_filename?: string; status: string; additions: number; deletions: number; patch?: string; blob_url: string }
    type Review = { id: number; user: { login: string; avatar_url: string } | null; state: string; body: string; submitted_at?: string; html_url: string }
    type ReviewComment = { id: number; in_reply_to_id?: number; user: { login: string; avatar_url: string } | null; body: string; path: string; line: number | null; original_line: number | null; side: 'LEFT' | 'RIGHT'; start_line: number | null; created_at: string; html_url: string; diff_hunk: string }
    type IssueComment = { id: number; user: { login: string; avatar_url: string } | null; body: string; created_at: string; html_url: string }
    const [files, reviews, comments, conversation, checks] = await Promise.all([
      this.all<File>(repo, `${base}/pulls/${num}/files?per_page=100`, MAX_FILES),
      this.all<Review>(repo, `${base}/pulls/${num}/reviews?per_page=100`, 300),
      this.all<ReviewComment>(repo, `${base}/pulls/${num}/comments?per_page=100`, 500),
      this.all<IssueComment>(repo, `${base}/issues/${num}/comments?per_page=100`, 300),
      this.request<{ check_runs: { name: string; status: string; conclusion: string | null; html_url: string }[] }>(repo, 'GET', `${base}/commits/${pr.head.sha}/check-runs?per_page=50`)
        .then((r) => r.data.check_runs)
        .catch(() => []),
    ])
    const who = (u: { login: string; avatar_url: string } | null) => ({ login: u?.login ?? 'ghost', avatar: u?.avatar_url })
    const me = this.credentials.get(repo.host)?.login
    return {
      repo: `${repo.owner}/${repo.repo}`,
      me,
      canReview: Boolean(me),
      isAuthor: Boolean(me && me === pr.user.login),
      pr: {
        number: pr.number,
        title: pr.title,
        body: pr.body ?? '',
        state: pr.merged ? 'merged' : pr.state,
        draft: pr.draft,
        url: pr.html_url,
        author: who(pr.user),
        head: pr.head.ref,
        headSha: pr.head.sha,
        base: pr.base.ref,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changed_files,
        commits: pr.commits,
        mergeable: pr.mergeable_state,
        reviewers: pr.requested_reviewers.map((r) => r.login),
      },
      files: files.map((f) => ({ path: f.filename, previous: f.previous_filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch ?? null, url: f.blob_url })),
      truncated: pr.changed_files > files.length,
      reviews: reviews.filter((r) => r.state !== 'PENDING').map((r) => ({ id: r.id, author: who(r.user), state: r.state, body: r.body, at: r.submitted_at, url: r.html_url })),
      comments: comments.map((c) => ({ id: c.id, replyTo: c.in_reply_to_id, author: who(c.user), body: c.body, path: c.path, line: c.line, originalLine: c.original_line, side: c.side, startLine: c.start_line, at: c.created_at, url: c.html_url, outdated: c.line === null, hunk: c.diff_hunk })),
      conversation: conversation.map((c) => ({ id: c.id, author: who(c.user), body: c.body, at: c.created_at, url: c.html_url })),
      checks: checks.map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion, url: c.html_url })),
    }
  }

  private requireCredential(repo: GitHubRepo) {
    const cred = this.credentials.get(repo.host)
    if (!cred) throw new BadRequestException('Conecte uma credencial do GitHub para revisar')
    return cred
  }

  /** Submits a review: approve, request changes or comment, with the line comments drafted on screen */
  async review(id: string, n: unknown, input: { event?: unknown; body?: unknown; comments?: unknown; commitId?: unknown }) {
    const repo = await this.repoOf(id)
    const cred = this.requireCredential(repo)
    const num = this.requireNumber(n)
    const event = String(input.event) as ReviewEvent
    if (!['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(event)) throw new BadRequestException('Escolha aprovar, solicitar alterações ou comentar')
    const body = typeof input.body === 'string' ? input.body.trim().slice(0, 60_000) : ''
    const comments = (Array.isArray(input.comments) ? input.comments : []).slice(0, 100).map((c) => {
      const d = (c ?? {}) as Record<string, unknown>
      const line = Number(d.line)
      const start = d.start_line === undefined ? undefined : Number(d.start_line)
      const text = String(d.body ?? '').trim()
      if (typeof d.path !== 'string' || !d.path || !Number.isInteger(line) || line < 1 || !['LEFT', 'RIGHT'].includes(String(d.side)) || !text) throw new BadRequestException('Comentário de linha inválido')
      return { path: d.path, line, side: d.side as 'LEFT' | 'RIGHT', ...(start && Number.isInteger(start) && start < line ? { start_line: start, start_side: d.side as 'LEFT' | 'RIGHT' } : {}), body: text.slice(0, 60_000) }
    })
    if (event === 'REQUEST_CHANGES' && !body && !comments.length) throw new BadRequestException('Explique o que precisa mudar (um resumo ou comentários nas linhas)')
    if (event === 'COMMENT' && !body && !comments.length) throw new BadRequestException('Escreva um comentário')
    const commitId = typeof input.commitId === 'string' && /^[0-9a-f]{40}$/.test(input.commitId) ? input.commitId : undefined
    const res = await this.request<{ id: number; state: string; html_url: string }>(repo, 'POST', `/repos/${repo.owner}/${repo.repo}/pulls/${num}/reviews`, {
      event,
      ...(body ? { body } : {}),
      ...(comments.length ? { comments } : {}),
      ...(commitId ? { commit_id: commitId } : {}),
    })
    this.audit.record({ action: 'git.prs.review', kind: 'external', method: 'GITHUB', url: `${repo.owner}/${repo.repo}#${num}`, workspace: id, verdict: 'allowed', detail: `${event} por ${cred.login} com ${comments.length} comentário(s) de linha` })
    return { id: res.data.id, state: res.data.state, url: res.data.html_url }
  }

  /** Answers a line comment in its thread */
  async reply(id: string, n: unknown, commentId: unknown, input: { body?: unknown }) {
    const repo = await this.repoOf(id)
    const cred = this.requireCredential(repo)
    const num = this.requireNumber(n)
    const cid = Number(commentId)
    const body = typeof input.body === 'string' ? input.body.trim() : ''
    if (!Number.isInteger(cid) || cid < 1 || !body) throw new BadRequestException('Resposta inválida')
    const res = await this.request<{ id: number; html_url: string }>(repo, 'POST', `/repos/${repo.owner}/${repo.repo}/pulls/${num}/comments/${cid}/replies`, { body: body.slice(0, 60_000) })
    this.audit.record({ action: 'git.prs.review', kind: 'external', method: 'GITHUB', url: `${repo.owner}/${repo.repo}#${num}`, workspace: id, verdict: 'allowed', detail: `resposta de ${cred.login} a um comentário` })
    return { id: res.data.id, url: res.data.html_url }
  }
}
