import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { MapStore } from '../src/analysis/map-store.service'
import type { OverviewService } from '../src/analysis/overview.service'
import type { DiagramGeneratorService } from '../src/diagrams/diagram-generator.service'
import { DiagramsService } from '../src/diagrams/diagrams.service'
import { parseGraph } from '../src/diagrams/graph'
import { LiveArchitectureService } from '../src/diagrams/live-architecture.service'
import { BOX_H, BOX_W, referenceLayout } from '../src/diagrams/reference-layout'
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
  it('draws the macro architecture of a Salesforce B2C store: personas, platform and the external systems, with cartridges only as evidence', async () => {
    const root = sfccProject()
    const { svc } = service({ id: 'w', name: 'loja', tech: 'salesforce-b2c', status: 'analyzed', root, analyzedAt: '2026-10-15T10:00:00Z' })
    try {
      const v = await svc.view('w')
      expect(() => parseGraph(v.graph)).not.toThrow()
      const titles = v.graph.nodes.map((n) => n.title)
      expect(titles).toEqual(expect.arrayContaining(['Cliente', 'Equipe da loja', 'Apps e sistemas', 'eCDN', 'Storefront · SFRA', 'Business Manager', 'APIs e processamento', 'SCAPI / OCAPI', 'Jobs', 'Salesforce B2C Commerce', 'Catálogo', 'Cestas e pedidos', 'Sistemas do cliente', 'Serviços SaaS e parceiros', 'Frete']))
      // no cartridge, controller or service id is drawn as a box
      expect(titles.some((t) => /app_loja|int_frete|app_storefront_base|\.http\./.test(t))).toBe(false)
      const node = (t: string) => v.graph.nodes.find((n) => n.title === t)!
      expect(node('Storefront · SFRA').description).toBe('Cartridge path: app_loja → int_frete → app_storefront_base')
      // the parts of the store carry the project's routes
      expect(node('Página de produto')).toMatchObject({ parent: 'b_store', tech: '1 rota do projeto' })
      expect(node('Carrinho').tech).toBe('base SFRA')
      expect(node('Business Manager').parent).toBe('b_core')
      // the cartridges and services are the evidence of each external system, at the sides
      expect(v.graph.nodes.some((n) => n.type === 'external' && n.parent === 'b_cliente')).toBe(true)
      expect(v.details[node('Frete').id].lines.join(' ')).toContain('frete.http.cotacao')
      expect(v.graph.edges.some((e) => e.source === node('Checkout').id && e.target === node('Frete').id)).toBe(true)
      expect(v.graph.edges.some((e) => e.source === 'b_api' && e.target === 'b_core')).toBe(true)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('draws the macro architecture of an Adobe Commerce store, with modules, plugins and observers only as evidence', async () => {
    const items = [
      { id: '1', kind: 'rest', title: 'POST /V1/erp/pedidos', module: 'Loja_Erp', origin: 'custom', zone: 'integracoes', details: { method: 'POST' } },
      { id: '2', kind: 'cron', title: 'loja_erp_envia', module: 'Loja_Erp', origin: 'custom', zone: 'integracoes', details: {} },
      { id: '3', kind: 'route', title: '/frenet', module: 'Frenet_Shipping', origin: 'thirdparty', zone: 'checkout', details: { area: 'frontend' } },
      { id: '4', kind: 'observer', title: 'sales_order_place_after', module: 'Adyen_Payment', origin: 'thirdparty', zone: 'checkout', details: {} },
      { id: '5', kind: 'route', title: '/adyen', module: 'Adyen_Payment', origin: 'thirdparty', zone: 'checkout', details: { area: 'frontend' } },
      { id: '6', kind: 'plugin', title: 'Cart', module: 'Loja_Checkout', origin: 'custom', zone: 'checkout', details: { target: 'Magento\\Quote\\Model\\Quote' } },
      { id: '7', kind: 'plugin', title: 'Company', module: 'Magento_Company', origin: 'native', zone: 'outros', details: {} },
      { id: '8', kind: 'plugin', title: 'Search', module: 'Magento_LiveSearch', origin: 'native', zone: 'outros', details: {} },
    ]
    const overview = {
      magento: { cloud: false },
      frontend: { hyva: true, breeze: false, themes: [], graphql: true },
      infrastructure: { docker: { services: ['redis', 'varnish'] }, searchEngine: 'OpenSearch 2', rabbitmq: true },
      integration: { anonymousWrites: 0 },
      modules: { byOrigin: { custom: 2 } },
      extensions: { list: [{ name: 'clearsale/module-integration', version: '3.1.0' }] },
    }
    const { svc, generator, data } = service({ id: 'w', name: 'loja', tech: 'adobe-commerce', status: 'analyzed', root: '/x', edition: 'Adobe Commerce', version: '2.4.8', ownVendors: ['Loja'], analyzedAt: '2026-10-15T10:00:00Z' }, { overview, map: { items } })
    const v = await svc.view('w')
    expect(() => parseGraph(v.graph)).not.toThrow()
    const byTitle = (t: string) => v.graph.nodes.find((n) => n.title === t)
    const e0 = (from: string, to: string) => v.graph.edges.find((x) => x.source === byTitle(from)!.id && x.target === byTitle(to)!.id)
    // personas, the platform in layers and the external systems at the sides
    expect(byTitle('Comprador B2B')?.type).toBe('person')
    expect(byTitle('Storefront · tema Hyvä')?.id).toBe('b_store')
    expect(byTitle('Checkout')).toMatchObject({ parent: 'b_store', tech: '4 customizações' })
    expect(byTitle('Carrinho')?.tech).toBe('nativo')
    expect(byTitle('API REST')).toMatchObject({ parent: 'b_api', tech: '1 endpoint do projeto' })
    expect(byTitle('GraphQL')?.parent).toBe('b_api')
    expect(byTitle('Crons')?.tech).toBe('1 cron do projeto')
    expect(byTitle('Webhooks de entrada')?.parent).toBe('b_api')
    expect(byTitle('Adobe Commerce 2.4.8')?.id).toBe('b_core')
    expect(byTitle('Carrinho e checkout')).toMatchObject({ parent: 'b_core', tech: '1 customização' })
    expect(byTitle('B2B')?.parent).toBe('b_core')
    // the admin is inside the platform, and the team goes straight to it
    expect(byTitle('Admin')?.parent).toBe('b_core')
    expect(e0('Equipe da loja', 'Admin')).toBeTruthy()
    expect(byTitle('Live Search')).toMatchObject({ parent: 'b_core', tech: 'SaaS Adobe' })
    expect(byTitle('Busca')).toMatchObject({ parent: 'b_infra', tech: 'OpenSearch 2' })
    expect(byTitle('Filas')?.tech).toBe('RabbitMQ')
    expect(byTitle('Cache de página')?.tech).toBe('Varnish')
    expect(byTitle('ERP')?.parent).toBe('b_cliente')
    expect(byTitle('Adyen')?.parent).toBe('b_saas')
    expect(byTitle('Frenet')?.tech).toBe('Frete')
    expect(byTitle('ClearSale')?.tech).toBe('Antifraude')
    // no module is drawn: they are the evidence
    expect(v.graph.nodes.some((n) => /^(Loja|Adyen|Frenet|Magento)_/.test(n.title))).toBe(false)
    expect(v.details[byTitle('Adyen')!.id].lines.join(' ')).toContain('módulo Adyen_Payment')
    const e = (from: string, to: string) => v.graph.edges.find((x) => x.source === byTitle(from)!.id && x.target === byTitle(to)!.id)
    expect(e('Crons', 'ERP')?.dashed).toBe(true)
    expect(e('ERP', 'API REST')).toBeTruthy()
    expect(e('Checkout', 'Adyen')?.label).toBe('Autoriza o pagamento')
    expect(e('Adyen', 'Webhooks de entrada')?.label).toBe('Notifica')
    expect(e('Checkout', 'Frenet')?.label).toBe('Cota o frete')
    expect(e('APIs e processamento', 'Adobe Commerce 2.4.8')).toBeTruthy()
    // the layers stack: storefront, APIs, core, infrastructure; client systems left, partners right
    const at = (nodeId: string) => v.graph.nodes.find((n) => n.id === nodeId)!
    expect(at('b_store').y! < at('b_api').y! && at('b_api').y! < at('b_core').y! && at('b_core').y! < at('b_infra').y!).toBe(true)
    expect(at('b_cliente').x!).toBeLessThan(0)
    expect(at('b_saas').x!).toBeGreaterThan(at('b_core').x!)

    // the arrangement the person makes stays; Claude gets the macro brief with the evidence
    svc.savePositions('w', { b_store: { x: 999, y: 111 } })
    expect((await svc.view('w')).graph.nodes.find((n) => n.id === 'b_store')).toMatchObject({ x: 999, y: 111 })
    // a position saved while the box was in another layer does not hold
    svc.savePositions('w', { t_cart: { x: 5, y: 6 } })
    const file = path.join(data, 'live-architecture.json')
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(saved.positions.t_cart.in).toBe('b_store')
    fs.writeFileSync(file, JSON.stringify({ ...saved, positions: { ...saved.positions, t_cart: { x: 5, y: 6, in: null }, c_admin: { x: 1, y: 2 } } }))
    const after = (await svc.view('w')).graph.nodes
    expect(after.find((n) => n.id === 't_cart')).not.toMatchObject({ x: 5, y: 6 })
    expect(after.find((n) => n.id === 'c_admin')).not.toMatchObject({ x: 1, y: 2 })
    expect(() => svc.savePositions('w', { '../x': { x: 1, y: 1 } })).toThrow()
    await svc.drawWithClaude('w')
    const request = (generator.start as jest.Mock).mock.calls[0][1].request as string
    expect(request).toContain('MACRO')
    expect(request).toContain('Arquitetura de referência')
    expect(request).toContain('b_store')
    expect(request).toContain('NÃO desenhe módulos')
    expect(request).toContain('módulo Loja_Erp')
  })

  it("lays out Claude's drawing as the reference architecture, with no layer over another", () => {
    const graph = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'claude-c4-sfra.json'), 'utf8'))
    const out = referenceLayout(graph)
    expect(() => parseGraph(out)).not.toThrow()
    const top = out.nodes.filter((n) => !n.parent)
    expect(top.every((n) => typeof n.x === 'number' && typeof n.y === 'number')).toBe(true)
    // people above everything else
    const peopleY = Math.max(...top.filter((n) => n.type === 'person').map((n) => n.y!))
    expect(top.filter((n) => n.type !== 'person').every((n) => n.y! > peopleY)).toBe(true)
    // layers do not overlap: sized around their boxes like the live view does
    const box = (b: (typeof top)[number]) => {
      const kids = out.nodes.filter((n) => n.parent === b.id)
      const left = Math.min(...kids.map((k) => k.x!))
      return { x1: b.x!, y1: b.y!, x2: b.x! + Math.max(...kids.map((k) => k.x! + BOX_W)) + left, y2: b.y! + Math.max(...kids.map((k) => k.y! + BOX_H)) + 24 }
    }
    const boxes = top.filter((n) => n.type === 'boundary' && out.nodes.some((k) => k.parent === n.id)).map(box)
    for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) expect(a.x2 <= b.x1 || b.x2 <= a.x1 || a.y2 <= b.y1 || b.y2 <= a.y1).toBe(true)
  })

  it('needs an analysed project', async () => {
    const { svc } = service({ id: 'w', name: 'x', tech: 'adobe-commerce', status: 'ready', root: '/x' })
    await expect(svc.view('w')).rejects.toThrow('Analise o projeto')
  })
})
