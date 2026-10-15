import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CommandRunner } from '../src/readonly/command-runner.service'
import { TaskContextService } from '../src/refine/task-context.service'
import type { WorkspacesService } from '../src/workspaces/workspaces.service'

const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/** A project with a task developed in its own worktree, and the card the Refinement saved for it */
function fixture() {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'taskctx-')))
  const project = path.join(top, 'loja')
  const data = path.join(top, 'data')
  fs.mkdirSync(project)
  sh(project, 'init', '-q', '-b', 'develop')
  sh(project, 'config', 'user.email', 't@example.com')
  sh(project, 'config', 'user.name', 'T')
  fs.writeFileSync(path.join(project, 'README.md'), '# loja\n')
  sh(project, 'add', '.')
  sh(project, 'commit', '-q', '-m', 'inicial')
  const wt = path.join(top, 'loja-worktrees', 'feature-frete')
  sh(project, 'worktree', 'add', '-q', '-b', 'feature/frete', wt, 'develop')
  fs.writeFileSync(path.join(wt, 'frete.js'), 'module.exports = 299\n')
  sh(wt, 'add', '.')
  sh(wt, 'commit', '-q', '-m', 'frete')
  fs.writeFileSync(path.join(wt, 'pendente.js'), '\n')

  const now = new Date().toISOString()
  const card = {
    id: 'a1b2c3d4e5',
    title: 'Frete grátis acima de R$ 299',
    status: 'concluido',
    createdAt: now,
    updatedAt: now,
    messages: [],
    refinement: { title: 'Frete grátis', business: 'Aumentar o ticket médio', technical: 'Promoção no BM e mensagem no carrinho', plan: ['Criar helper', 'Exibir mensagem'], acceptance: ['Dado R$ 300, então frete 0'], observations: [], complexity: { level: 'baixa', reasoning: '', recommendSplit: false, splits: [] }, generatedAt: now },
    git: { branch: 'feature/frete', base: 'develop', path: wt, preparedAt: now },
    dev: { status: 'concluido', startedAt: now, progress: 100, done: 2, total: 2, activity: [], summary: 'Helper criado e mensagem exibida.' },
  }
  fs.mkdirSync(path.join(data, 'refine'), { recursive: true })
  fs.writeFileSync(path.join(data, 'refine', `${card.id}.json`), JSON.stringify(card))
  fs.writeFileSync(path.join(data, 'refine', 'ffffffffff.json'), JSON.stringify({ ...card, id: 'ffffffffff', title: 'Outra tarefa', git: undefined, dev: undefined }))
  const workspaces = { dataDirOf: () => data } as unknown as WorkspacesService
  return { top, wt, card, svc: new TaskContextService(workspaces, new CommandRunner()) }
}

describe('Tarefas do Refinamento no "Pergunte ao código"', () => {
  let fx: ReturnType<typeof fixture>
  beforeAll(() => {
    fx = fixture()
  })
  afterAll(() => fs.rmSync(fx.top, { recursive: true, force: true }))

  it('finds a card from its link, its id or the screen, and only in this workspace', () => {
    expect(fx.svc.resolve('loja-1', 'veja http://127.0.0.1:4310/w/loja-1/refinamento/a1b2c3d4e5 por favor').cards.map((c) => c.id)).toEqual(['a1b2c3d4e5'])
    expect(fx.svc.resolve('loja-1', 'o que a tarefa a1b2c3d4e5 mudou?').cards).toHaveLength(1)
    expect(fx.svc.resolve('loja-1', 'explique', ['ffffffffff']).cards.map((c) => c.id)).toEqual(['ffffffffff'])
    const other = fx.svc.resolve('loja-1', 'http://127.0.0.1:4310/w/outra-loja/refinamento/a1b2c3d4e5')
    expect(other.cards).toHaveLength(0)
    expect(other.elsewhere).toHaveLength(1)
    expect(fx.svc.resolve('loja-1', 'nada aqui, só 0123456789 solto').cards).toHaveLength(0)
  })

  it('gives the linked task in full, with the files its branch changed and its worktree', async () => {
    const m = await fx.svc.prepare('loja-1', 'revise /w/loja-1/refinamento/a1b2c3d4e5')
    expect(m.linked).toEqual([{ id: 'a1b2c3d4e5', title: 'Frete grátis acima de R$ 299', status: 'concluido', branch: 'feature/frete' }])
    expect(m.blocks).toContain('Promoção no BM e mensagem no carrinho')
    expect(m.blocks).toContain('[feito] Criar helper')
    expect(m.blocks).toContain('frete.js (criado)')
    expect(m.blocks).toContain('pendente.js (não commitado)')
    expect(m.blocks).toContain('Helper criado e mensagem exibida.')
    expect(m.worktrees).toEqual([fx.wt])
  })

  it('writes an index of every task so Claude can find one by name', async () => {
    const m = await fx.svc.prepare('loja-1', 'procure a tarefa do frete')
    expect(m.linked).toHaveLength(0)
    const index = fs.readFileSync(path.join(m.dir, 'tarefas.md'), 'utf8')
    expect(index).toContain('a1b2c3d4e5 | Frete grátis acima de R$ 299 | concluido | feature/frete')
    expect(index).toContain('ffffffffff | Outra tarefa')
    expect(fs.readFileSync(path.join(m.dir, 'a1b2c3d4e5.md'), 'utf8')).toContain(`Worktree (onde está o código desta tarefa): ${fx.wt}`)
    expect(fx.svc.guide(m)).toContain('tarefas.md')
  })
})
