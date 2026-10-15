import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { MapStore } from '../src/analysis/map-store.service'
import type { OverviewService } from '../src/analysis/overview.service'
import type { DiagramGeneratorService } from '../src/diagrams/diagram-generator.service'
import { DiagramsService } from '../src/diagrams/diagrams.service'
import { parseGraph } from '../src/diagrams/graph'
import { layered, LiveArchitectureService } from '../src/diagrams/live-architecture.service'
import type { JobsService } from '../src/jobs/jobs.service'
import { ReadOnlyFs } from '../src/readonly/readonly-fs.service'
import { SfccService } from '../src/techs/sfcc/sfcc.service'
import type { WorkspacesService } from '../src/workspaces/workspaces.service'

function sfccProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'live-sfra-')))
  const w = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), content)
  }
  w('package.json', JSON.stringify({ devDependencies: { 'sgmf-scripts': '^3.0.0' } }))
  w('cartridges/app_storefront_base/cartridge/controllers/Cart.js', "server.get('Show', function () {})\n")
  w('cartridges/app_storefront_base/cartridge/templates/default/cart/cart.isml', '<div/>')
  w('cartridges/app_loja/cartridge/controllers/Product.js', "server.append('Show', function () {})\n")
  w('cartridges/app_loja/cartridge/scripts/erp.js', "var s = LocalServiceRegistry.createService('erp.http.pedidos', {})\n")
  w('cartridges/int_frete/cartridge/scripts/frete.js', "var s = LocalServiceRegistry.createService('frete.http.cotacao', {})\n")
  w('cartridges/app_loja/package.json', '{ "hooks": "./cartridge/scripts/hooks.json" }')
  w('cartridges/app_loja/cartridge/scripts/hooks.json', JSON.stringify({ hooks: [{ name: 'dw.ocapi.shop.basket.afterPOST', script: './x' }] }))
  w('sites/RefArch/site.xml', '<site site-id="RefArch"><custom-cartridges>app_loja:int_frete:app_storefront_base</custom-cartridges></site>')
  w('jobs/jobs.xml', '<jobs><job job-id="EnviaPedidosERP"/></jobs>')
  return root
}

function service(ws: Record<string, unknown>, extra: { overview?: unknown; map?: unknown } = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'live-data-'))
  const workspaces = { get: () => ws, dataDirOf: () => data, rootOf: () => ws.root } as unknown as WorkspacesService
  const sfcc = new SfccService(workspaces, new ReadOnlyFs())
  const diagrams = new DiagramsService(workspaces)
  const overview = { compute: async () => extra.overview } as unknown as OverviewService
  const maps = { readMap: () => extra.map ?? null } as unknown as MapStore
  const generator = { start: jest.fn(() => ({ jobId: 'job1' })) } as unknown as DiagramGeneratorService
  const jobs = { get: () => ({ status: 'running' }) } as unknown as JobsService
  return { svc: new LiveArchitectureService(workspaces, maps, overview, sfcc, diagrams, generator, jobs), generator, data }
}

describe('Arquitetura viva', () => {
  it('draws a Salesforce B2C project from its mapping: cartridge path in order, services and who calls them', async () => {
    const root = sfccProject()
    const { svc } = service({ id: 'w', name: 'loja', tech: 'salesforce-b2c', status: 'analyzed', root, analyzedAt: '2026-10-15T10:00:00Z' })
    try {
      const v = await svc.view('w')
      expect(() => parseGraph(v.graph)).not.toThrow()
      const titles = v.graph.nodes.map((n) => n.title)
      expect(titles).toEqual(expect.arrayContaining(['1. app_loja', '2. int_frete', '3. app_storefront_base', 'erp.http.pedidos', 'frete.http.cotacao', 'Jobs', 'SCAPI / OCAPI']))
      const id = (t: string) => v.graph.nodes.find((n) => n.title === t)!.id
      expect(v.graph.edges.some((e) => e.source === id('1. app_loja') && e.target === id('erp.http.pedidos'))).toBe(true)
      expect(v.graph.edges.some((e) => e.source === id('2. int_frete') && e.target === id('frete.http.cotacao'))).toBe(true)
      // boundaries have no connection points in the editor: no arrow may point to one
      const boundaries = new Set(v.graph.nodes.filter((n) => n.type === 'boundary').map((n) => n.id))
      expect(v.graph.edges.every((e) => !boundaries.has(e.source) && !boundaries.has(e.target))).toBe(true)
      expect(v.details[id('1. app_loja')].lines).toEqual(expect.arrayContaining(['serviço erp.http.pedidos', 'hook dw.ocapi.shop.basket.afterPOST']))
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('draws an Adobe Commerce store from its mapping: stack, APIs, crons and the modules each one reaches', async () => {
    const items = [
      { id: '1', kind: 'rest', title: 'POST /V1/erp/pedidos', module: 'Loja_Erp', origin: 'custom', zone: 'integracoes', details: { method: 'POST' } },
      { id: '2', kind: 'cron', title: 'loja_erp_envia', module: 'Loja_Erp', origin: 'custom', zone: 'integracoes', details: {} },
      { id: '3', kind: 'route', title: '/frete', module: 'Loja_Frete', origin: 'custom', zone: 'checkout', details: { area: 'frontend' } },
      { id: '4', kind: 'observer', title: 'sales_order_place_after', module: 'Vendor_Pagamento', origin: 'thirdparty', zone: 'checkout', details: {} },
      { id: '5', kind: 'plugin', title: 'Cart', module: 'Magento_Checkout', origin: 'native', zone: 'carrinho', details: {} },
    ]
    const overview = {
      frontend: { hyva: true, breeze: false, themes: [] },
      infrastructure: { docker: { services: ['redis', 'varnish'] }, searchEngine: 'OpenSearch 2', rabbitmq: true },
      integration: { anonymousWrites: 0 },
      modules: { byOrigin: { custom: 2 } },
    }
    const { svc, generator } = service({ id: 'w', name: 'loja', tech: 'adobe-commerce', status: 'analyzed', root: '/x', edition: 'Adobe Commerce', version: '2.4.8', ownVendors: ['Loja'], analyzedAt: '2026-10-15T10:00:00Z' }, { overview, map: { items } })
    const v = await svc.view('w')
    expect(() => parseGraph(v.graph)).not.toThrow()
    const byTitle = (t: string) => v.graph.nodes.find((n) => n.title === t)
    expect(byTitle('Storefront')?.tech).toContain('Hyvä')
    expect(byTitle('Busca')?.tech).toBe('OpenSearch 2')
    expect(byTitle('Filas')?.tech).toBe('RabbitMQ')
    expect(byTitle('Cache de página')).toBeTruthy()
    expect(byTitle('Loja_Erp')?.description).toBe('1 endpoint REST · 1 cron')
    expect(byTitle('Vendor_Pagamento')?.type).toBe('external')
    expect(byTitle('Magento_Checkout')).toBeUndefined()
    const e = (from: string, to: string) => v.graph.edges.some((x) => x.source === byTitle(from)!.id && x.target === byTitle(to)!.id)
    expect(e('API REST', 'Loja_Erp')).toBe(true)
    expect(e('Crons & consumers', 'Loja_Erp')).toBe(true)
    expect(e('Storefront', 'Loja_Frete')).toBe(true)

    // the arrangement the person makes stays; Claude's request starts from the mapping
    svc.savePositions('w', { [byTitle('Storefront')!.id]: { x: 999, y: 111 } })
    expect((await svc.view('w')).graph.nodes.find((n) => n.title === 'Storefront')).toMatchObject({ x: 999, y: 111 })
    expect(() => svc.savePositions('w', { '../x': { x: 1, y: 1 } })).toThrow()
    await svc.drawWithClaude('w')
    const request = (generator.start as jest.Mock).mock.calls[0][1].request as string
    expect(request).toContain('Loja_Erp')
    expect(request).toContain('integrações com sistemas externos')
  })

  it("lays out Claude's drawing in layers, with no boundary over another", () => {
    const graph = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'claude-c4-sfra.json'), 'utf8'))
    const out = layered(graph)
    expect(() => parseGraph(out)).not.toThrow()
    const top = out.nodes.filter((n) => !n.parent)
    expect(top.every((n) => typeof n.x === 'number' && typeof n.y === 'number')).toBe(true)
    // people above everything else
    const peopleY = Math.max(...top.filter((n) => n.type === 'person').map((n) => n.y!))
    expect(top.filter((n) => n.type !== 'person').every((n) => n.y! > peopleY)).toBe(true)
    // boundaries do not overlap: sized from their children like the editor does
    const box = (b: (typeof top)[number]) => {
      const kids = out.nodes.filter((n) => n.parent === b.id)
      const w = Math.max(420, Math.max(...kids.map((k) => k.x!)) + 200 + 32)
      const h = Math.max(260, Math.max(...kids.map((k) => k.y!)) + 120 + 32)
      return { x1: b.x!, y1: b.y!, x2: b.x! + w, y2: b.y! + h }
    }
    const boxes = top.filter((n) => n.type === 'boundary').map(box)
    for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) expect(a.x2 <= b.x1 || b.x2 <= a.x1 || a.y2 <= b.y1 || b.y2 <= a.y1).toBe(true)
    // a drawing that already has positions is left alone
    expect(layered(out)).toBe(out)
  })

  it('needs an analysed project', async () => {
    const { svc } = service({ id: 'w', name: 'x', tech: 'adobe-commerce', status: 'ready', root: '/x' })
    await expect(svc.view('w')).rejects.toThrow('Analise o projeto')
  })
})
