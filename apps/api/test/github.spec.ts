import { GitHubService, parseGitHubRemote } from '../src/gitops/github.service'
import type { GitOpsService } from '../src/gitops/gitops.service'
import type { AuditService } from '../src/readonly/audit.service'
import type { CommandRunner, RunOptions } from '../src/readonly/command-runner.service'

const FAKE_TOKEN = 'gho_' + 'x'.repeat(36)

/** A GitHub that answers from a table, and records what was asked */
function fakeGitHub(routes: Record<string, (body?: unknown) => [number, unknown]>) {
  const calls: { method: string; url: string; auth?: string; body?: unknown }[] = []
  const fetchMock = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, auth: (init.headers as Record<string, string>)?.authorization, body })
    const key = `${method} ${url.replace('https://api.github.com', '')}`
    const route = Object.entries(routes).find(([k]) => key.startsWith(k))
    const [status, data] = route ? route[1](body) : [404, { message: 'Not Found' }]
    return { ok: status < 400, status, headers: new Headers(), text: async () => JSON.stringify(data) } as Response
  }) as typeof fetch
  return { calls, fetchMock }
}

function service(opts: { remote?: string; credentialOut?: string } = {}) {
  const runs: { args: string[]; opts: RunOptions }[] = []
  const runner = {
    run: async (_cmd: string, args: string[], o: RunOptions) => {
      runs.push({ args, opts: o })
      if (args[0] === 'remote') return { code: 0, stdout: opts.remote ?? 'origin\thttps://github.com/loja/storefront.git (fetch)\norigin\thttps://github.com/loja/storefront.git (push)\n', stderr: '' }
      if (args[0] === 'credential') return { code: opts.credentialOut ? 0 : 1, stdout: opts.credentialOut ?? '', stderr: '' }
      return { code: 1, stdout: '', stderr: '' }
    },
  } as unknown as CommandRunner
  const audit = { record: jest.fn() } as unknown as AuditService
  const gitops = { repoRoot: async () => '/repo' } as unknown as GitOpsService
  return { svc: new GitHubService(gitops, runner, audit), runs, audit }
}

const PR = {
  number: 7,
  title: 'Frete grátis acima de R$ 299',
  body: 'Implementa a mensagem no carrinho',
  state: 'open',
  draft: false,
  merged: false,
  html_url: 'https://github.com/loja/storefront/pull/7',
  user: { login: 'dev1', avatar_url: '' },
  head: { ref: 'feature/frete', sha: 'a'.repeat(40) },
  base: { ref: 'develop' },
  created_at: '2026-10-14T10:00:00Z',
  updated_at: '2026-10-15T10:00:00Z',
  additions: 12,
  deletions: 2,
  changed_files: 1,
  commits: 2,
  requested_reviewers: [{ login: 'revisora' }],
  labels: [],
}

describe('GitHub do repositório', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  it('recognises GitHub remotes in every URL form, and nothing else', () => {
    expect(parseGitHubRemote('https://github.com/loja/storefront.git')).toMatchObject({ host: 'github.com', owner: 'loja', repo: 'storefront', api: 'https://api.github.com' })
    expect(parseGitHubRemote('git@github.com:loja/storefront.git')).toMatchObject({ owner: 'loja', repo: 'storefront' })
    expect(parseGitHubRemote('ssh://git@github.com/loja/storefront')).toMatchObject({ owner: 'loja', repo: 'storefront' })
    expect(parseGitHubRemote('https://user:tok@github.com/loja/storefront.git')).toMatchObject({ owner: 'loja' })
    expect(parseGitHubRemote('https://github.empresa.com/time/loja.git')).toMatchObject({ api: 'https://github.empresa.com/api/v3' })
    expect(parseGitHubRemote('https://bitbucket.org/loja/storefront.git')).toBeNull()
    expect(parseGitHubRemote('https://dev.azure.com/org/proj/_git/loja')).toBeNull()
  })

  it('says so when the remote is not GitHub', async () => {
    const { svc } = service({ remote: 'origin\thttps://bitbucket.org/loja/x.git (fetch)\n' })
    expect(await svc.status('w')).toMatchObject({ github: false })
  })

  it('lists pull requests without a credential (public repositories) and marks the ones waiting for me', async () => {
    const { svc } = service()
    const gh = fakeGitHub({ 'GET /repos/loja/storefront/pulls?state=open': () => [200, [PR]], 'GET /user': () => [200, { login: 'revisora' }] })
    global.fetch = gh.fetchMock
    expect((await svc.list('w'))[0]).toMatchObject({ number: 7, awaitingMe: false, head: 'feature/frete' })
    expect(gh.calls[0].auth).toBeUndefined()
    await svc.connect('w', { source: 'token', token: FAKE_TOKEN })
    expect((await svc.list('w'))[0].awaitingMe).toBe(true)
    expect(gh.calls.at(-1)!.auth).toBe(`Bearer ${FAKE_TOKEN}`)
  })

  it('connects with the git credential of this machine without ever prompting, and never shows the token', async () => {
    const { svc, runs, audit } = service({ credentialOut: `protocol=https\nhost=github.com\nusername=x\npassword=${FAKE_TOKEN}\n` })
    global.fetch = fakeGitHub({ 'GET /user': () => [200, { login: 'revisora' }] }).fetchMock
    const status = await svc.connect('w', { source: 'git-credential' })
    expect(status).toMatchObject({ connected: true, login: 'revisora', source: 'git-credential' })
    expect(JSON.stringify(status)).not.toContain(FAKE_TOKEN)
    const cred = runs.find((r) => r.args[0] === 'credential')!
    expect(cred.opts.env).toMatchObject({ GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' })
    expect(cred.opts.stdin).toBe('protocol=https\nhost=github.com\n\n')
    expect(JSON.stringify((audit.record as jest.Mock).mock.calls)).not.toContain(FAKE_TOKEN)
  })

  it('fails clearly when git has no credential for the host', async () => {
    const { svc } = service()
    await expect(svc.connect('w', { source: 'git-credential' })).rejects.toThrow('não tem uma credencial salva')
  })

  it('brings the review view: files with the patch, reviews, line comments and checks', async () => {
    const { svc } = service()
    global.fetch = fakeGitHub({
      'GET /repos/loja/storefront/pulls/7/files': () => [200, [{ filename: 'cartridges/app_loja/cartridge/scripts/frete.js', status: 'added', additions: 12, deletions: 0, patch: '@@ -0,0 +1,2 @@\n+a\n+b', blob_url: 'u' }]],
      'GET /repos/loja/storefront/pulls/7/reviews': () => [200, [{ id: 1, user: { login: 'revisora', avatar_url: '' }, state: 'COMMENTED', body: 'ok', submitted_at: '2026-10-15T11:00:00Z', html_url: 'r' }]],
      'GET /repos/loja/storefront/pulls/7/comments': () => [200, [{ id: 9, user: { login: 'revisora', avatar_url: '' }, body: 'Use Resource.msg', path: 'cartridges/app_loja/cartridge/scripts/frete.js', line: 2, original_line: 2, side: 'RIGHT', start_line: null, created_at: '2026-10-15T11:00:00Z', html_url: 'c', diff_hunk: '' }]],
      'GET /repos/loja/storefront/issues/7/comments': () => [200, []],
      'GET /repos/loja/storefront/commits/': () => [200, { check_runs: [{ name: 'lint', status: 'completed', conclusion: 'success', html_url: 'k' }] }],
      'GET /repos/loja/storefront/pulls/7': () => [200, PR],
    }).fetchMock
    const view = await svc.pull('w', '7')
    expect(view.pr).toMatchObject({ number: 7, headSha: 'a'.repeat(40), head: 'feature/frete', base: 'develop' })
    expect(view.files[0].patch).toContain('@@')
    expect(view.comments[0]).toMatchObject({ line: 2, side: 'RIGHT', outdated: false })
    expect(view.checks[0].conclusion).toBe('success')
    expect(view.canReview).toBe(false)
  })

  it('submits a review with line comments on the reviewed commit, only with a credential', async () => {
    const { svc, audit } = service()
    const gh = fakeGitHub({ 'GET /user': () => [200, { login: 'revisora' }], 'POST /repos/loja/storefront/pulls/7/reviews': () => [200, { id: 55, state: 'CHANGES_REQUESTED', html_url: 'h' }] })
    global.fetch = gh.fetchMock
    await expect(svc.review('w', '7', { event: 'APPROVE' })).rejects.toThrow('Conecte')
    await svc.connect('w', { source: 'token', token: FAKE_TOKEN })
    await expect(svc.review('w', '7', { event: 'MERGE' })).rejects.toThrow()
    await expect(svc.review('w', '7', { event: 'REQUEST_CHANGES' })).rejects.toThrow('Explique')
    await expect(svc.review('w', '7', { event: 'COMMENT', comments: [{ path: 'a.js', line: 0, side: 'RIGHT', body: 'x' }] })).rejects.toThrow('inválido')
    const r = await svc.review('w', '7', { event: 'REQUEST_CHANGES', body: 'Faltam testes', commitId: 'a'.repeat(40), comments: [{ path: 'a.js', line: 3, side: 'RIGHT', body: 'Texto fixo: use Resource.msg' }] })
    expect(r).toEqual({ id: 55, state: 'CHANGES_REQUESTED', url: 'h' })
    const sent = gh.calls.find((c) => c.method === 'POST')!
    expect(sent.body).toEqual({ event: 'REQUEST_CHANGES', body: 'Faltam testes', commit_id: 'a'.repeat(40), comments: [{ path: 'a.js', line: 3, side: 'RIGHT', body: 'Texto fixo: use Resource.msg' }] })
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'git.prs.review', kind: 'external' }))
  })

  it('shows what GitHub says when it refuses (e.g. approving your own pull request)', async () => {
    const { svc } = service()
    global.fetch = fakeGitHub({ 'GET /user': () => [200, { login: 'dev1' }], 'POST /repos/loja/storefront/pulls/7/reviews': () => [422, { message: 'Unprocessable Entity', errors: [{ message: 'Can not approve your own pull request' }] }] }).fetchMock
    await svc.connect('w', { source: 'token', token: FAKE_TOKEN })
    await expect(svc.review('w', '7', { event: 'APPROVE' })).rejects.toThrow('Can not approve your own pull request')
  })
})
