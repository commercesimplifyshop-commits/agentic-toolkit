import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GitOpsService } from '../src/gitops/gitops.service'
import { parseJsonReply } from '../src/openspec/openspec-explore.service'
import { CommandRunner } from '../src/readonly/command-runner.service'
import { RefineService } from '../src/refine/refine.service'
import { WorkspaceEnvService } from '../src/settings/workspace-env.service'
import type { WorkspacesService } from '../src/workspaces/workspaces.service'

const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/** A project with an "origin" (a bare repo), a develop branch and one commit on the remote the project has not pulled yet */
function fixture() {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gitops-')))
  const remote = path.join(top, 'remote.git')
  const project = path.join(top, 'project')
  const other = path.join(top, 'other')
  sh(top, 'init', '--bare', '-b', 'develop', remote)
  for (const dir of [project, other]) {
    sh(top, 'clone', remote, dir)
    sh(dir, 'config', 'user.email', 'test@example.com')
    sh(dir, 'config', 'user.name', 'Test')
  }
  fs.writeFileSync(path.join(project, 'README.md'), '# loja\n')
  sh(project, 'add', '.')
  sh(project, 'commit', '-m', 'inicial')
  sh(project, 'push', '-u', 'origin', 'develop')
  sh(other, 'pull')
  fs.writeFileSync(path.join(other, 'novo.txt'), 'x\n')
  sh(other, 'add', '.')
  sh(other, 'commit', '-m', 'commit de outra pessoa')
  sh(other, 'push')
  const workspaces = { get: () => ({ root: project }) } as unknown as WorkspacesService
  return { top, project, svc: new GitOpsService(workspaces, new CommandRunner()) }
}

describe('Git do projeto (GitOpsService)', () => {
  let fx: ReturnType<typeof fixture>
  beforeAll(() => {
    fx = fixture()
  })
  afterAll(() => {
    // worktrees first, so Windows releases the folders
    fs.rmSync(fx.top, { recursive: true, force: true })
  })

  it('validates branch names', () => {
    for (const ok of ['feature/frete-gratis', 'develop', 'hotfix/2.4.7-p3']) expect(fx.svc.requireBranchName(ok)).toBe(ok)
    for (const bad of ['-x', 'a..b', 'a b', 'feature/', 'x.lock', 'a~1', '', 5]) expect(() => fx.svc.requireBranchName(bad)).toThrow()
  })

  it('puts the worktree of a branch next to the project, never inside it', () => {
    const p = fx.svc.worktreePathFor(fx.project, 'feature/frete')
    expect(p).toBe(path.join(path.dirname(fx.project), 'project-worktrees', 'feature-frete'))
  })

  it('shows the overview: current branch, branches and the main worktree', async () => {
    const ov = await fx.svc.overview('w')
    if (!ov.repo) throw new Error('should be a repo')
    expect(ov.current).toBe('develop')
    expect(ov.branches.map((b) => b.name)).toContain('develop')
    expect(ov.worktrees).toHaveLength(1)
    expect(ov.worktrees[0].main).toBe(true)
  })

  it('sees that the base is behind its remote and brings it up to date', async () => {
    const before = await fx.svc.baseStatus('w', 'develop')
    expect(before.upToDate).toBe(false)
    expect(before.behind).toBe(1)
    await fx.svc.updateBase('w', 'develop')
    const after = await fx.svc.baseStatus('w', 'develop')
    expect(after.upToDate).toBe(true)
    expect(fs.existsSync(path.join(fx.project, 'novo.txt'))).toBe(true)
  })

  it('creates a branch in its own worktree, pushes it and removes the worktree', async () => {
    const wt = await fx.svc.addWorktree('w', { branch: 'feature/frete', base: 'develop' })
    expect(fs.existsSync(path.join(wt.path, 'README.md'))).toBe(true)
    // the same branch again reuses the worktree
    expect((await fx.svc.addWorktree('w', { branch: 'feature/frete' })).reused).toBe(true)

    fs.writeFileSync(path.join(wt.path, 'frete.txt'), 'regra\n')
    let ov = await fx.svc.overview('w')
    if (!ov.repo) throw new Error('should be a repo')
    expect(ov.worktrees.find((w) => w.branch === 'feature/frete')?.changes).toBe(1)
    expect(ov.branches.find((b) => b.name === 'feature/frete')?.worktree).toBeTruthy()

    sh(wt.path, 'add', '.')
    sh(wt.path, 'commit', '-m', 'frete')
    await fx.svc.push('w', 'feature/frete')
    expect(sh(fx.project, 'ls-remote', '--heads', 'origin')).toContain('refs/heads/feature/frete')

    await fx.svc.removeWorktree('w', wt.path)
    ov = await fx.svc.overview('w')
    if (!ov.repo) throw new Error('should be a repo')
    expect(ov.worktrees).toHaveLength(1)
    await expect(fx.svc.removeWorktree('w', fx.project)).rejects.toThrow()
  })

  it('says so, without failing, when the folder is not a repository', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'plain-'))
    const svc = new GitOpsService({ get: () => ({ root: plain }) } as unknown as WorkspacesService, new CommandRunner())
    const ov = await svc.overview('w')
    expect(ov.repo).toBe(false)
    fs.rmSync(plain, { recursive: true, force: true })
  })
})

describe('Card refinado (RefineService.sanitize)', () => {
  const svc = new RefineService(...([null, null, null, null, null, null, null] as unknown as ConstructorParameters<typeof RefineService>))
  const sanitize = (raw: Record<string, unknown>) => (svc as unknown as { sanitize: (r: Record<string, unknown>) => { plan: string[]; complexity: { level: string; recommendSplit: boolean; splits: unknown[] } } }).sanitize(raw)

  it('requires the technical description and the plan', () => {
    expect(() => sanitize({ title: 'x', plan: ['a'] })).toThrow()
    expect(() => sanitize({ title: 'x', technical: 'como' })).toThrow()
  })

  it('normalizes the complexity and only recommends a split with two parts or more', () => {
    const one = sanitize({ technical: 't', plan: ['a', 'b'], complexity: { level: 'enorme', recommendSplit: true, splits: [{ title: 'só uma', scope: 's' }] } })
    expect(one.complexity.level).toBe('media')
    expect(one.complexity.recommendSplit).toBe(false)
    const two = sanitize({ technical: 't', plan: ['a'], complexity: { level: 'alta', recommendSplit: true, splits: [{ title: 'a', scope: 's' }, { title: 'b', scope: 's' }] } })
    expect(two.complexity).toMatchObject({ level: 'alta', recommendSplit: true })
    expect(two.complexity.splits).toHaveLength(2)
  })
})

describe('JSON in a reply from Claude (parseJsonReply)', () => {
  it('reads a ```json block whose markdown fields have code fences of their own', () => {
    const card = { title: 'x', technical: ['Troque:', '```php', 'const LIMIT = 299;', '```', 'fim'].join('\n') }
    const text = ['Segue o card:', '```json', JSON.stringify(card, null, 2), '```'].join('\n')
    expect(parseJsonReply(text)).toMatchObject({ title: 'x' })
  })
  it('returns null when there is no object', () => {
    expect(parseJsonReply('não consegui')).toBeNull()
  })
})

describe('Variáveis de ambiente do workspace (WorkspaceEnvService)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsenv-'))
  const env = new WorkspaceEnvService({ dataDirOf: () => dir } as unknown as WorkspacesService)
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('never sends a secret value back, and keeps it when the screen saves without it', () => {
    const view = env.save('w', [{ key: 'MAGENTO_BASE_URL', value: 'https://loja.test' }, { key: 'DB_PASSWORD', value: 's3nha' }])
    expect(view).toEqual([
      { key: 'MAGENTO_BASE_URL', secret: false, hasValue: true, value: 'https://loja.test' },
      { key: 'DB_PASSWORD', secret: true, hasValue: true },
    ])
    env.save('w', [{ key: 'DB_PASSWORD', secret: true }, { key: 'MAGENTO_BASE_URL', value: 'https://outra.test' }])
    expect(env.values('w')).toEqual({ DB_PASSWORD: 's3nha', MAGENTO_BASE_URL: 'https://outra.test' })
  })

  it('refuses names that would change how the tools run', () => {
    for (const key of ['PATH', 'NODE_OPTIONS', 'GIT_SSH_COMMAND', 'LD_PRELOAD', 'ANTHROPIC_API_KEY', 'path']) expect(() => env.save('w', [{ key, value: 'x' }])).toThrow()
    expect(() => env.save('w', [{ key: '1X', value: 'x' }])).toThrow()
    expect(() => env.save('w', [{ key: 'A', value: '1' }, { key: 'a', value: '2' }])).toThrow()
  })
})
