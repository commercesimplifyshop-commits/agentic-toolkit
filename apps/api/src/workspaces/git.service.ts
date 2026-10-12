import { Injectable } from '@nestjs/common'
import fs from 'node:fs'
import { CommandRunner } from '../readonly/command-runner.service'

/**
 * How StoreFlow authenticates against a private repository. Secrets are used
 * only for the clone/fetch they were given for and are never written to disk:
 * tokens travel in an HTTP header passed through git's env config (not argv,
 * not the URL, not .git/config).
 */
export type GitAuth =
  | { method: 'system' }
  | { method: 'token'; token: string; username?: string }
  | { method: 'ssh-key'; keyPath: string }

export interface GitInfo {
  branch?: string
  commit?: string
  date?: string
  subject?: string
  author?: string
  contributors?: number
  remote?: string
}

/** Default HTTP username each host expects alongside a token. */
function tokenUser(url: string, explicit?: string) {
  if (explicit) return explicit
  if (/github\.com/i.test(url)) return 'x-access-token'
  if (/gitlab/i.test(url)) return 'oauth2'
  if (/bitbucket\.org/i.test(url)) return 'x-token-auth'
  return 'git'
}

/** Strips any user:password@ from a URL before it is stored or shown. */
export function sanitizeUrl(url: string) {
  return url.replace(/^(https?:\/\/)[^@/]+@/i, '$1')
}

@Injectable()
export class GitService {
  constructor(private readonly runner: CommandRunner) {}

  private authEnv(url: string, auth: GitAuth): Record<string, string> {
    if (auth.method === 'token') {
      const basic = Buffer.from(`${tokenUser(url, auth.username)}:${auth.token}`).toString('base64')
      return { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}` }
    }
    if (auth.method === 'ssh-key') {
      if (!fs.existsSync(auth.keyPath)) throw new Error(`Chave SSH não encontrada: ${auth.keyPath}`)
      const key = auth.keyPath.replace(/\\/g, '/')
      return { GIT_SSH_COMMAND: `ssh -i "${key}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes` }
    }
    // system: whatever the engineer already has (SSH agent, Git Credential Manager…)
    return {}
  }

  /** Cheap credential check before cloning: lists remote refs. */
  async checkAccess(url: string, auth: GitAuth) {
    const res = await this.runner.run('git', ['ls-remote', '--heads', sanitizeUrl(url)], { env: this.authEnv(url, auth), timeoutMs: 60_000 })
    if (res.code !== 0) throw new Error(this.explain(res.stderr))
    return res.stdout
      .split('\n')
      .map((l) => l.split('refs/heads/')[1])
      .filter(Boolean)
  }

  async clone(url: string, dest: string, opts: { branch?: string; auth: GitAuth; onLine?: (l: string) => void }) {
    const args = ['clone', '--depth', '1', '--single-branch', '--no-tags', '-c', 'core.symlinks=false']
    if (opts.branch) args.push('--branch', opts.branch)
    args.push('--progress', sanitizeUrl(url), dest)
    const res = await this.runner.run('git', args, { env: this.authEnv(url, opts.auth), onLine: opts.onLine, timeoutMs: 30 * 60_000 })
    if (res.code !== 0) throw new Error(this.explain(res.stderr))
    // Belt and braces: StoreFlow's clone can never push back
    await this.runner.run('git', ['-C', dest, 'remote', 'set-url', '--push', 'origin', 'PUSH_DISABLED_BY_STOREFLOW'])
  }

  async fetch(dest: string, url: string, auth: GitAuth, branch?: string) {
    const res = await this.runner.run('git', ['-C', dest, 'fetch', '--depth', '1', 'origin', ...(branch ? [branch] : [])], { env: this.authEnv(url, auth), timeoutMs: 15 * 60_000 })
    if (res.code !== 0) throw new Error(this.explain(res.stderr))
    await this.runner.run('git', ['-C', dest, 'checkout', '--force', 'FETCH_HEAD'])
  }

  /** Read-only facts about a checkout (works for local repos too). */
  async info(dir: string): Promise<GitInfo | null> {
    if (!fs.existsSync(`${dir}/.git`)) return null
    const q = (args: string[]) => this.runner.run('git', ['-C', dir, ...args], { timeoutMs: 30_000 }).then((r) => (r.code === 0 ? r.stdout.trim() : ''))
    const [branch, log, remote, shortlog] = await Promise.all([
      q(['branch', '--show-current']),
      q(['log', '-1', '--format=%H%x1f%cI%x1f%s%x1f%an']),
      q(['remote', 'get-url', 'origin']),
      q(['shortlog', '-sn', '--all', '--no-merges', 'HEAD']),
    ])
    const [commit, date, subject, author] = log.split('\x1f')
    return { branch, commit, date, subject, author, remote: remote ? sanitizeUrl(remote) : undefined, contributors: shortlog ? shortlog.split('\n').length : undefined }
  }

  /** Recent commits touching custom code (read-only `git log`). */
  async recentCommits(dir: string, limit = 15) {
    if (!fs.existsSync(`${dir}/.git`)) return []
    const r = await this.runner.run('git', ['-C', dir, 'log', `-${limit}`, '--format=%h%x1f%cI%x1f%an%x1f%s'], { timeoutMs: 30_000 })
    if (r.code !== 0) return []
    return r.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [hash, date, author, subject] = l.split('\x1f')
        return { hash, date, author, subject }
      })
  }

  /** Is a file tracked by git? Used to flag committed credentials. */
  async isTracked(dir: string, rel: string) {
    if (!fs.existsSync(`${dir}/.git`)) return null
    const r = await this.runner.run('git', ['-C', dir, 'ls-files', '--error-unmatch', rel], { timeoutMs: 20_000 })
    return r.code === 0
  }

  private explain(stderr: string) {
    const s = stderr.toLowerCase()
    if (s.includes('authentication failed') || s.includes('could not read username') || s.includes('403') || s.includes('401'))
      return 'Acesso negado. Verifique se o token tem permissão de leitura (Contents: Read) neste repositório ou use o git já configurado na máquina.'
    if (s.includes('permission denied (publickey)')) return 'Chave SSH recusada. Confira se a chave (ou deploy key) tem acesso de leitura ao repositório.'
    if (s.includes('repository not found') || s.includes('not found')) return 'Repositório não encontrado (ou sem acesso, para repositórios privados o GitHub responde "not found").'
    if (s.includes('remote branch') && s.includes('not found')) return 'Branch não encontrada no repositório.'
    return stderr.trim().split('\n').slice(-3).join(' ') || 'Falha no git'
  }
}
