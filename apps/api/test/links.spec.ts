import { ReadOnlyViolation } from '../src/readonly/path-guard'
import { ACTIONS, type ActionContext } from '../src/readonly/actions'
import { DATA_DIR } from '../src/config/paths'
import { LinksService } from '../src/links/links.service'
import { TOOL_CATALOG, TOOL_KINDS } from '../src/links/tool-catalog'
import { parseJsonReply, sanitizePlans, MAX_PLANS } from '../src/links/tool-plan'
import { WorkspacesService } from '../src/workspaces/workspaces.service'
import fs from 'node:fs'
import path from 'node:path'

/** Each test gets its own folder inside the data dir (the only place Agentic Toolkit writes) */
function dataDir() {
  return path.join(DATA_DIR, `test-links-${Math.random().toString(36).slice(2, 10)}`)
}

function linksFor(dir: string) {
  const workspaces = { dataDirOf: () => dir, rootOf: () => path.join(dir, '..', 'magento-root-not-used') } as unknown as WorkspacesService
  return new LinksService(workspaces)
}

describe('Tool catalog', () => {
  it('describes every kind the link table accepts', () => {
    for (const kind of TOOL_KINDS) expect(TOOL_CATALOG).toMatch(new RegExp(`^- ${kind}:`, 'm'))
  })
})

describe('Claude suggestions (sanitizePlans)', () => {
  it('keeps well-formed diagrams and boards', () => {
    const plans = sanitizePlans([
      { kind: 'diagram', type: 'c4-container', request: 'Serviços e filas do checkout', reason: 'Nova fila' },
      { kind: 'board', name: 'Esboço da tela', reason: 'Tela nova' },
    ])
    expect(plans).toHaveLength(2)
    expect(plans[0]).toMatchObject({ kind: 'diagram', type: 'c4-container' })
    expect(plans[1]).toMatchObject({ kind: 'board', name: 'Esboço da tela' })
  })

  it('drops unknown kinds and diagram types instead of creating them', () => {
    const plans = sanitizePlans([
      { kind: 'doc', reason: 'não existe' },
      { kind: 'diagram', type: 'pizza', request: 'qualquer coisa', reason: 'tipo inventado' },
      { kind: 'diagram', type: 'flow', request: 'x', reason: 'pedido curto demais' },
    ])
    expect(plans).toEqual([])
  })

  it('never returns more than the maximum per run, and a default board title', () => {
    const many = Array.from({ length: 10 }, () => ({ kind: 'board', reason: 'r' }))
    const plans = sanitizePlans(many)
    expect(plans).toHaveLength(MAX_PLANS)
    expect(plans[0]).toMatchObject({ name: 'Quadro da mudança' })
  })

  it('finds the JSON reply even inside a code fence or with text around it', () => {
    expect(parseJsonReply('Claro:\n```json\n{"tools": []}\n```')).toEqual({ tools: [] })
    expect(parseJsonReply('nada aqui')).toBeNull()
    expect(parseJsonReply('{quebrado')).toBeNull()
  })
})

describe('Link table (LinksService)', () => {
  it('links once per change, kind and tool, and lists by change or by tool', () => {
    const dir = dataDir()
    try {
      const links = linksFor(dir)
      const a = links.add('ws', { change: 'pix-expiracao', kind: 'diagram', refId: 'pix-abc1', title: 'Pix', createdBy: 'claude' })
      const again = links.add('ws', { change: 'pix-expiracao', kind: 'diagram', refId: 'pix-abc1', title: 'Pix', createdBy: 'claude' })
      links.add('ws', { change: 'outra', kind: 'board', refId: 'quadro-9f2e', title: 'Quadro', createdBy: 'usuário' })
      expect(again.id).toBe(a.id)
      expect(links.list('ws', { change: 'pix-expiracao' })).toHaveLength(1)
      expect(links.list('ws', { kind: 'board', refId: 'quadro-9f2e' })).toHaveLength(1)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('removes the links of a deleted tool or change, and nothing else', () => {
    const dir = dataDir()
    try {
      const links = linksFor(dir)
      links.add('ws', { change: 'a-mudanca', kind: 'diagram', refId: 'diag-0001', title: 'D', createdBy: 'claude' })
      links.add('ws', { change: 'a-mudanca', kind: 'board', refId: 'quad-0002', title: 'Q', createdBy: 'claude' })
      links.add('ws', { change: 'b-mudanca', kind: 'diagram', refId: 'diag-0001', title: 'D', createdBy: 'usuário' })

      links.removeRef('ws', 'diagram', 'diag-0001')
      expect(links.list('ws').map((l) => `${l.change}:${l.kind}`)).toEqual(['a-mudanca:board'])

      links.removeChange('ws', 'a-mudanca')
      expect(links.list('ws')).toEqual([])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses malformed change names, kinds and tool ids', () => {
    const dir = dataDir()
    try {
      const links = linksFor(dir)
      expect(() => links.add('ws', { change: '../etc', kind: 'diagram', refId: 'diag-0001', title: 'x' })).toThrow()
      expect(() => links.add('ws', { change: 'ok-name', kind: 'doc' as 'diagram', refId: 'diag-0001', title: 'x' })).toThrow()
      expect(() => links.add('ws', { change: 'ok-name', kind: 'diagram', refId: 'X;rm', title: 'x' })).toThrow()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('Link routes are guarded', () => {
  const ctx = (params: Record<string, string>, body?: unknown, query: Record<string, unknown> = {}): ActionContext =>
    ({
      req: { params, body, query } as unknown as ActionContext['req'],
      workspaceRoot: () => DATA_DIR,
    }) as ActionContext

  it('rejects a link with an unknown kind before it reaches the handler', () => {
    expect(() => ACTIONS['links.add'].validate!(ctx({ id: 'ws-test-01' }, { change: 'ok-name', kind: 'doc', refId: 'diag-0001' }))).toThrow(ReadOnlyViolation)
  })

  it('accepts a well-formed link and keeps removal to link ids only', () => {
    expect(() => ACTIONS['links.add'].validate!(ctx({ id: 'ws-test-01' }, { change: 'ok-name', kind: 'board', refId: 'quad-0002' }))).not.toThrow()
    expect(() => ACTIONS['links.remove'].validate!(ctx({ id: 'ws-test-01', linkId: '../../x' }))).toThrow(ReadOnlyViolation)
  })

  it('limits what Claude may create in one step', () => {
    const tools = Array.from({ length: 4 }, () => ({ kind: 'board' }))
    expect(() => ACTIONS['links.create'].validate!(ctx({ id: 'ws-test-01' }, { change: 'ok-name', tools }))).toThrow(ReadOnlyViolation)
  })

  it('revision is read-only and bounded', () => {
    expect(ACTIONS['openspec.revise'].kind).toBe('read')
    expect(() => ACTIONS['openspec.revise'].validate!(ctx({ id: 'ws-test-01' }, { path: 'openspec/changes/x/proposal.md', instruction: 'ok' }))).toThrow(ReadOnlyViolation)
  })
})
