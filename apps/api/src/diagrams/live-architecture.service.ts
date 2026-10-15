import { BadRequestException, Injectable } from '@nestjs/common'
import fs from 'node:fs'
import path from 'node:path'
import { MapStore } from '../analysis/map-store.service'
import { OverviewService } from '../analysis/overview.service'
import { JobsService } from '../jobs/jobs.service'
import { SfccService } from '../techs/sfcc/sfcc.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { DiagramGeneratorService } from './diagram-generator.service'
import { DiagramsService } from './diagrams.service'
import type { Graph, GraphEdge, GraphNode } from './graph'

/** What a node of the live architecture stands for, shown when it is clicked */
export interface NodeDetail {
  title: string
  lines: string[]
}

interface Stored {
  /** Positions the person dragged nodes to: kept while the content updates */
  positions: Record<string, { x: number; y: number }>
  /** The version Claude drew, and the analysis it was based on */
  claude?: { diagramId: string; basedOn: string | null; at: string }
  /** Draw again with Claude by itself after each new analysis */
  autoClaude?: boolean
}

// same grid as the diagram editor (apps/web/src/shell/diagrams/graph.ts)
const EL_W = 200
const CELL_W = 240
const CELL_H = 150
const GAP = 90
const MAX_MODULES = 24
const MAX_SERVICES = 16

type MapItem = { id: string; kind: string; title: string; module: string; origin: string; zone: string; details: Record<string, unknown> }

const KIND_LABEL: Record<string, [string, string]> = {
  rest: ['endpoint REST', 'endpoints REST'],
  graphql: ['operação GraphQL', 'operações GraphQL'],
  plugin: ['plugin', 'plugins'],
  preference: ['preference', 'preferences'],
  observer: ['observer', 'observers'],
  cron: ['cron', 'crons'],
  queue: ['fila', 'filas'],
  route: ['rota', 'rotas'],
}
const plural = (n: number, kind: string) => `${n} ${(KIND_LABEL[kind] ?? [kind, kind])[n === 1 ? 0 : 1]}`
const safeId = (prefix: string, s: string) => `${prefix}_${s.replace(/[^A-Za-z0-9_-]+/g, '_')}`.slice(0, 40)

/** A boundary with its children laid out in a grid; returns the boundary size */
function grid(children: GraphNode[], cols: number) {
  children.forEach((c, i) => {
    c.x = 32 + (i % cols) * CELL_W
    c.y = 64 + Math.floor(i / cols) * CELL_H
  })
  const rows = Math.max(1, Math.ceil(children.length / cols))
  return { w: Math.max(420, 32 + Math.min(cols, Math.max(children.length, 1)) * CELL_W), h: Math.max(260, 64 + rows * CELL_H + 24) }
}

/** Places rows of top-level elements (people, boundaries, external systems) one under the other */
function stack(rows: { nodes: GraphNode[]; sizes: { w: number; h: number }[] }[]) {
  let y = 0
  for (const row of rows) {
    if (!row.nodes.length) continue
    const total = row.sizes.reduce((s, z) => s + z.w, 0) + GAP * (row.nodes.length - 1)
    let x = Math.max(0, (1600 - total) / 2)
    row.nodes.forEach((n, i) => {
      n.x = Math.round(x)
      n.y = y
      x += row.sizes[i].w + GAP
    })
    y += Math.max(...row.sizes.map((s) => s.h)) + GAP
  }
}

/**
 * Lays out a C4 graph that came without positions (Claude's) in layers: people on top, then the
 * boundaries (several per row while they fit), then the systems that stand alone.
 */
export function layered(graph: Graph): Graph {
  if (graph.nodes.some((n) => n.x !== undefined && n.y !== undefined)) return graph
  const nodes = graph.nodes.map((n) => ({ ...n }))
  const isBoundary = new Set(nodes.filter((n) => n.type === 'boundary').map((n) => n.id))
  const top = nodes.filter((n) => !n.parent || !isBoundary.has(n.parent))
  const sizes = new Map<string, { w: number; h: number }>()
  for (const b of top.filter((n) => n.type === 'boundary')) {
    const kids = nodes.filter((n) => n.parent === b.id)
    sizes.set(b.id, grid(kids, kids.length <= 4 ? Math.max(kids.length, 1) : kids.length <= 9 ? 3 : 4))
  }
  const sizeOf = (n: GraphNode) => sizes.get(n.id) ?? { w: EL_W, h: 120 }
  const rows: { nodes: GraphNode[]; sizes: { w: number; h: number }[] }[] = []
  const people = top.filter((n) => n.type === 'person')
  rows.push({ nodes: people, sizes: people.map(sizeOf) })
  let row: GraphNode[] = []
  let width = 0
  for (const b of top.filter((n) => n.type === 'boundary')) {
    const w = sizeOf(b).w
    if (row.length && width + GAP + w > 1600) {
      rows.push({ nodes: row, sizes: row.map(sizeOf) })
      row = []
      width = 0
    }
    row.push(b)
    width += (row.length > 1 ? GAP : 0) + w
  }
  if (row.length) rows.push({ nodes: row, sizes: row.map(sizeOf) })
  const loose = top.filter((n) => n.type !== 'person' && n.type !== 'boundary')
  for (let i = 0; i < loose.length; i += 6) rows.push({ nodes: loose.slice(i, i + 6), sizes: loose.slice(i, i + 6).map(sizeOf) })
  stack(rows)
  return { ...graph, nodes }
}

/**
 * The architecture of the platform drawn from the project's mapping, with no AI: people, the
 * platform's containers, the project's modules (Adobe Commerce) or cartridge path (Salesforce B2C)
 * and the external services found in the code. It follows each new analysis by itself; the person
 * can arrange it, and Claude can draw a richer version on top of it.
 */
@Injectable()
export class LiveArchitectureService {
  private readonly cache = new Map<string, { key: string; graph: Graph; details: Record<string, NodeDetail>; summary: string }>()
  /** Claude drawing now, per workspace */
  private readonly running = new Map<string, string>()

  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly maps: MapStore,
    private readonly overview: OverviewService,
    private readonly sfcc: SfccService,
    private readonly diagrams: DiagramsService,
    private readonly generator: DiagramGeneratorService,
    private readonly jobs: JobsService,
  ) {}

  private file(id: string) {
    return path.join(this.workspaces.dataDirOf(id), 'live-architecture.json')
  }
  private read(id: string): Stored {
    try {
      const s = JSON.parse(fs.readFileSync(this.file(id), 'utf8')) as Stored
      return { positions: s.positions ?? {}, claude: s.claude, autoClaude: s.autoClaude }
    } catch {
      return { positions: {} }
    }
  }
  private write(id: string, s: Stored) {
    fs.writeFileSync(`${this.file(id)}.tmp`, JSON.stringify(s, null, 2))
    fs.renameSync(`${this.file(id)}.tmp`, this.file(id))
  }

  // ---- Adobe Commerce ----------------------------------------------------------------------------

  private async adobe(id: string) {
    const ws = this.workspaces.get(id)
    const o = await this.overview.compute(id)
    const map = (this.maps.readMap(id) as { items?: MapItem[] } | null)?.items ?? []
    const items = map.filter((i) => i.origin !== 'native')
    const count = (kind: string, pred: (i: MapItem) => boolean = () => true) => items.filter((i) => i.kind === kind && pred(i)).length
    const details: Record<string, NodeDetail> = {}
    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []
    const edge = (source: string, target: string, label?: string, tech?: string, dashed?: boolean) => {
      if (nodes.some((n) => n.id === source) && nodes.some((n) => n.id === target) && !edges.some((e) => e.source === source && e.target === target)) {
        edges.push({ id: `e${edges.length + 1}`, source, target, label, tech, dashed })
      }
    }

    // people and callers
    const people: GraphNode[] = [
      { id: 'p_cliente', type: 'person', title: 'Cliente', description: 'Navega e compra na loja' },
      { id: 'p_equipe', type: 'person', title: 'Equipe da loja', description: 'Opera pedidos, catálogo e configuração no admin' },
    ]
    const apis = count('rest') + count('graphql')
    if (apis) people.push({ id: 'x_api', type: 'external', title: 'Sistemas integrados', description: 'Chamam as APIs customizadas da loja' })

    // the platform
    const theme = o.frontend.hyva ? 'Hyvä' : o.frontend.breeze ? 'Breeze' : (o.frontend.themes as { name?: string }[] | undefined)?.find((t) => t.name && !/^Magento\//.test(t.name))?.name ?? 'Luma'
    const platform: GraphNode[] = [
      { id: 'c_store', type: 'container', title: 'Storefront', tech: `PHP · tema ${theme}`, description: `${plural(count('route', (i) => i.details.area === 'frontend'), 'route')} do projeto`, parent: 'b_loja' },
      { id: 'c_admin', type: 'container', title: 'Admin', tech: 'PHP', description: `${plural(count('route', (i) => i.details.area === 'adminhtml'), 'route')} do projeto`, parent: 'b_loja' },
    ]
    if (count('rest')) platform.push({ id: 'c_rest', type: 'container', title: 'API REST', tech: 'webapi.xml', description: `${plural(count('rest'), 'rest')}${o.integration.anonymousWrites ? `, ${o.integration.anonymousWrites} de escrita sem autenticação` : ''}`, parent: 'b_loja' })
    if (count('graphql')) platform.push({ id: 'c_graphql', type: 'container', title: 'API GraphQL', tech: 'schema.graphqls', description: plural(count('graphql'), 'graphql'), parent: 'b_loja' })
    if (count('cron') || count('queue')) platform.push({ id: 'c_jobs', type: 'container', title: 'Crons & consumers', tech: 'bin/magento cron:run', description: [count('cron') && plural(count('cron'), 'cron'), count('queue') && plural(count('queue'), 'queue')].filter(Boolean).join(' · '), parent: 'b_loja' })
    platform.push({ id: 'd_db', type: 'db', title: 'Banco de dados', tech: 'MySQL / MariaDB', description: 'Catálogo, pedidos, clientes e configuração', parent: 'b_loja' })
    const services = ((o.infrastructure.docker as { services?: string[] } | null)?.services ?? []).map((s) => s.toLowerCase())
    if (o.infrastructure.searchEngine) platform.push({ id: 'd_search', type: 'db', title: 'Busca', tech: String(o.infrastructure.searchEngine), description: 'Catálogo e navegação por filtros', parent: 'b_loja' })
    if (o.infrastructure.rabbitmq) platform.push({ id: 'q_mq', type: 'queue', title: 'Filas', tech: 'RabbitMQ', description: 'Mensagens processadas pelos consumers', parent: 'b_loja' })
    if (services.some((s) => s.includes('redis') || s.includes('valkey'))) platform.push({ id: 'd_cache', type: 'db', title: 'Cache e sessão', tech: 'Redis', parent: 'b_loja' })
    if (services.some((s) => s.includes('varnish'))) platform.push({ id: 'c_varnish', type: 'container', title: 'Cache de página', tech: 'Varnish', parent: 'b_loja' })
    const loja: GraphNode = { id: 'b_loja', type: 'boundary', title: `${ws.name} · ${ws.edition ?? 'Adobe Commerce'} ${ws.version ?? ''}`.trim() }
    const lojaSize = grid(platform, 4)

    // the project's modules (own, then third-party), by what they plug into
    const byModule = new Map<string, MapItem[]>()
    for (const i of items) byModule.set(i.module, [...(byModule.get(i.module) ?? []), i])
    const ranked = [...byModule].sort((a, b) => Number(b[1][0].origin === 'custom') - Number(a[1][0].origin === 'custom') || b[1].length - a[1].length)
    const shown = ranked.slice(0, MAX_MODULES)
    const modules: GraphNode[] = shown.map(([name, list]) => {
      const kinds = new Map<string, number>()
      for (const i of list) kinds.set(i.kind, (kinds.get(i.kind) ?? 0) + 1)
      const nodeId = safeId('m', name)
      details[nodeId] = { title: name, lines: list.slice(0, 40).map((i) => `${(KIND_LABEL[i.kind] ?? [i.kind])[0]}: ${i.title}`) }
      return {
        id: nodeId,
        type: list[0].origin === 'custom' ? 'container' : 'external',
        title: name,
        tech: list[0].origin === 'custom' ? 'módulo do projeto' : 'extensão de terceiro',
        description: [...kinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => plural(n, k)).join(' · '),
        parent: 'b_mod',
      }
    })
    if (ranked.length > shown.length) modules.push({ id: 'm_more', type: 'container', title: `+ ${ranked.length - shown.length} módulos`, description: 'com menos pontos de integração', parent: 'b_mod' })
    const modBoundary: GraphNode = { id: 'b_mod', type: 'boundary', title: `Módulos e extensões (${o.modules.byOrigin.custom ?? 0} do projeto)` }
    const modSize = grid(modules, 5)

    nodes.push(...people, loja, ...platform, ...(modules.length ? [modBoundary, ...modules] : []))
    stack([
      { nodes: people, sizes: people.map(() => ({ w: EL_W, h: 120 })) },
      { nodes: [loja], sizes: [lojaSize] },
      { nodes: modules.length ? [modBoundary] : [], sizes: [modSize] },
    ])

    edge('p_cliente', 'c_store', 'Navega e compra', 'HTTPS')
    edge('p_equipe', 'c_admin', 'Opera', 'HTTPS')
    edge('x_api', 'c_rest', 'Integra', 'REST')
    edge('x_api', 'c_graphql', 'Consulta', 'GraphQL')
    for (const c of ['c_store', 'c_admin', 'c_rest', 'c_graphql', 'c_jobs']) edge(c, 'd_db', 'Lê e grava', 'SQL')
    edge('c_store', 'd_search', 'Busca', 'HTTP')
    edge('c_jobs', 'q_mq', 'Consome', 'AMQP')
    for (const [name, list] of shown) {
      const m = safeId('m', name)
      const has = (k: string, pred: (i: MapItem) => boolean = () => true) => list.some((i) => i.kind === k && pred(i))
      if (has('route', (i) => i.details.area === 'frontend')) edge('c_store', m, 'rotas')
      if (has('route', (i) => i.details.area === 'adminhtml')) edge('c_admin', m, 'telas')
      if (has('rest')) edge('c_rest', m, 'endpoints')
      if (has('graphql')) edge('c_graphql', m, 'resolvers')
      if (has('cron') || has('queue')) edge('c_jobs', m, has('queue') ? 'consumers' : 'crons', undefined, true)
    }

    details.c_store = { title: 'Storefront', lines: items.filter((i) => i.kind === 'route' && i.details.area === 'frontend').slice(0, 40).map((i) => `rota ${i.title} (${i.module})`) }
    details.c_admin = { title: 'Admin', lines: items.filter((i) => i.kind === 'route' && i.details.area === 'adminhtml').slice(0, 40).map((i) => `rota ${i.title} (${i.module})`) }
    details.c_rest = { title: 'API REST', lines: items.filter((i) => i.kind === 'rest').slice(0, 60).map((i) => `${i.title} (${i.module})`) }
    details.c_graphql = { title: 'API GraphQL', lines: items.filter((i) => i.kind === 'graphql').slice(0, 60).map((i) => `${i.title} (${i.module})`) }
    details.c_jobs = { title: 'Crons & consumers', lines: items.filter((i) => i.kind === 'cron' || i.kind === 'queue').slice(0, 60).map((i) => `${(KIND_LABEL[i.kind] ?? [i.kind])[0]}: ${i.title} (${i.module})`) }
    return { nodes, edges, details }
  }

  // ---- Salesforce B2C ------------------------------------------------------------------------------

  private sfccGraph(id: string) {
    const ws = this.workspaces.get(id)
    const o = this.sfcc.overview(id)
    const details: Record<string, NodeDetail> = {}
    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []
    const edge = (source: string, target: string, label?: string, tech?: string, dashed?: boolean) => {
      if (nodes.some((n) => n.id === source) && nodes.some((n) => n.id === target) && !edges.some((e) => e.source === source && e.target === target)) {
        edges.push({ id: `e${edges.length + 1}`, source, target, label, tech, dashed })
      }
    }

    const people: GraphNode[] = [
      { id: 'p_cliente', type: 'person', title: 'Cliente', description: 'Navega e compra na loja' },
      { id: 'p_equipe', type: 'person', title: 'Equipe da loja', description: 'Catálogo, promoções, conteúdo e configuração no Business Manager' },
    ]
    const ocapiHooks = o.hooks.filter((h) => /^dw\.ocapi\./.test(h.name))
    const platform: GraphNode[] = [
      { id: 'c_store', type: 'container', title: 'Storefront', tech: o.storefront.detail ? `${o.storefront.type} · ${o.storefront.detail}` : o.storefront.type, description: `${o.counts.controllers} controllers, ${o.counts.routes} rotas, ${o.counts.templates} templates ISML`, parent: 'b_b2c' },
      { id: 'c_bm', type: 'container', title: 'Business Manager', tech: 'B2C Commerce', description: `${o.sites.length} site(s): ${o.sites.slice(0, 4).join(', ') || '—'}`, parent: 'b_b2c' },
    ]
    if (o.jobs.length) platform.push({ id: 'c_jobs', type: 'container', title: 'Jobs', tech: 'steptypes / jobs.xml', description: `${o.jobs.length} job(s)`, parent: 'b_b2c' })
    if (ocapiHooks.length) platform.push({ id: 'c_api', type: 'container', title: 'SCAPI / OCAPI', tech: 'hooks dw.ocapi.*', description: `${ocapiHooks.length} hook(s) do projeto`, parent: 'b_b2c' })
    platform.push({ id: 'd_data', type: 'db', title: 'Dados da instância', tech: 'B2C Commerce', description: `Catálogo, pedidos, clientes${o.attributes.length ? `; atributos em ${o.attributes.length} tipo(s)` : ''}`, parent: 'b_b2c' })
    const b2c: GraphNode = { id: 'b_b2c', type: 'boundary', title: `${ws.name} · Salesforce B2C Commerce` }
    const b2cSize = grid(platform, 3)

    // the cartridge path: the order the platform resolves files in
    const pathOrder = o.cartridgePaths[0]?.path ?? []
    const names = [...pathOrder.filter((c) => o.cartridges.some((x) => x.name === c)), ...o.cartridges.map((c) => c.name).filter((c) => !pathOrder.includes(c))]
    const role = (name: string) => (name === 'app_storefront_base' || /^modules$/.test(name) ? 'base SFRA' : /^(int|plugin|link|bm)_/.test(name) ? 'terceiro / integração' : 'projeto')
    const carts: GraphNode[] = names.map((name, i) => {
      const c = o.cartridges.find((x) => x.name === name)!
      const nodeId = safeId('k', name)
      const ctrl = o.controllers.filter((x) => x.cartridge === name)
      details[nodeId] = {
        title: name,
        lines: [
          ...ctrl.flatMap((x) => x.routes.map((r) => `${r.method} ${x.file.split('/').pop()?.replace(/\.(js|ds)$/, '')}-${r.name}`)).slice(0, 40),
          ...o.hooks.filter((h) => h.cartridge === name).map((h) => `hook ${h.name}`),
          ...o.serviceUses.filter((s) => s.cartridge === name).map((s) => `serviço ${s.service}`),
        ],
      }
      return {
        id: nodeId,
        type: role(name) === 'projeto' ? 'container' : 'external',
        title: `${pathOrder.length && i < pathOrder.length ? `${i + 1}. ` : ''}${name}`,
        tech: role(name),
        description: [`${c.controllers} controllers`, `${c.templates} templates`, `${c.scripts} scripts`, c.hooks ? `${c.hooks} hooks` : ''].filter(Boolean).join(' · '),
        parent: 'b_carts',
      }
    })
    const cartsBoundary: GraphNode = { id: 'b_carts', type: 'boundary', title: pathOrder.length ? `Cartridge path (${o.cartridgePaths[0].site})` : 'Cartuchos' }
    const cartsSize = grid(carts, 4)

    // external services called from the code
    const serviceIds = o.services.slice(0, MAX_SERVICES)
    const externals: GraphNode[] = serviceIds.map((s) => ({ id: safeId('s', s), type: 'external', title: s, tech: 'dw.svc (LocalServiceRegistry)', description: `usado em ${o.serviceUses.filter((u) => u.service === s).map((u) => u.cartridge).join(', ') || '—'}` }))

    nodes.push(...people, b2c, ...platform, ...(carts.length ? [cartsBoundary, ...carts] : []), ...externals)
    stack([
      { nodes: people, sizes: people.map(() => ({ w: EL_W, h: 120 })) },
      { nodes: [b2c], sizes: [b2cSize] },
      { nodes: carts.length ? [cartsBoundary] : [], sizes: [cartsSize] },
      { nodes: externals, sizes: externals.map(() => ({ w: EL_W, h: 120 })) },
    ])
    // external services in rows of 6
    externals.forEach((n, i) => {
      if (i < 6) return
      n.x = externals[i % 6].x
      n.y = (externals[i % 6].y ?? 0) + Math.floor(i / 6) * (CELL_H + 20)
    })

    edge('p_cliente', 'c_store', 'Navega e compra', 'HTTPS')
    edge('p_equipe', 'c_bm', 'Opera', 'HTTPS')
    // boundaries have no connection points: the arrows go to the first cartridge of the path
    const first = carts[0]?.id
    const firstOwn = carts.find((c) => c.tech === 'projeto')?.id ?? first
    if (first) edge('c_store', first, 'Executa os controllers na ordem do path')
    if (firstOwn) edge('c_api', firstOwn, 'Hooks')
    if (firstOwn) edge('c_jobs', firstOwn, 'Steps dos jobs', undefined, true)
    for (const c of ['c_store', 'c_bm', 'c_jobs', 'c_api']) edge(c, 'd_data', 'Lê e grava')
    for (const u of o.serviceUses) edge(safeId('k', u.cartridge), safeId('s', u.service), 'Chama', 'HTTP')

    details.c_store = { title: 'Storefront', lines: o.controllers.flatMap((x) => x.routes.map((r) => `${x.cartridge}: ${r.method} ${x.file.split('/').pop()?.replace(/\.(js|ds)$/, '')}-${r.name}`)).slice(0, 60) }
    details.c_jobs = { title: 'Jobs', lines: o.jobs.map((j) => `${j.id} (${j.file})`) }
    details.c_api = { title: 'SCAPI / OCAPI', lines: ocapiHooks.map((h) => `${h.name} (${h.cartridge})`) }
    details.c_bm = { title: 'Business Manager', lines: [...o.sites.map((s) => `site ${s}`), ...o.attributes.map((a) => `${a.count} atributo(s) em ${a.type}`)] }
    return { nodes, edges, details }
  }

  // ---- the live view -------------------------------------------------------------------------------

  /** A text summary of the graph, for Claude to build on */
  private summarize(graph: Graph) {
    const title = (id: string) => graph.nodes.find((n) => n.id === id)?.title ?? id
    return [
      ...graph.nodes.map((n) => `- [${n.type}] ${n.title}${n.tech ? ` (${n.tech})` : ''}${n.parent ? ` dentro de "${title(n.parent)}"` : ''}${n.description ? `: ${n.description}` : ''}`),
      ...graph.edges.map((e) => `- ${title(e.source)} → ${title(e.target)}${e.label ? `: ${e.label}` : ''}${e.tech ? ` [${e.tech}]` : ''}`),
    ].join('\n')
  }

  private async build(id: string) {
    const ws = this.workspaces.get(id)
    if (ws.status !== 'analyzed' || !ws.root) throw new BadRequestException('Analise o projeto antes de ver a arquitetura')
    const key = `${ws.analyzedAt ?? ''}|${ws.root}`
    const cached = this.cache.get(id)
    if (cached?.key === key) return cached
    const { nodes, edges, details } = ws.tech === 'salesforce-b2c' ? this.sfccGraph(id) : await this.adobe(id)
    const graph: Graph = { version: 1, family: 'c4', nodes, edges }
    const built = { key, graph, details, summary: this.summarize(graph) }
    this.cache.set(id, built)
    return built
  }

  /** The architecture as the mapping shows it now, with the person's arrangement on top */
  async view(id: string) {
    const ws = this.workspaces.get(id)
    const built = await this.build(id)
    const stored = this.read(id)
    const graph: Graph = { ...built.graph, nodes: built.graph.nodes.map((n) => ({ ...n, ...(stored.positions[n.id] ?? {}) })) }
    const basedOn = ws.analyzedAt ?? null
    const claudeDiagram = stored.claude ? this.diagrams.list(id).find((d) => d!.id === stored.claude!.diagramId) : undefined
    const jobId = this.running.get(id)
    const job = jobId ? this.jobs.get(jobId) : undefined
    if (job && job.status !== 'running') this.running.delete(id)
    const runningNow = job?.status === 'running'
    const stale = Boolean(stored.claude && stored.claude.basedOn !== basedOn)
    // optional: draw again with Claude after each new analysis
    if (stored.autoClaude && !runningNow && (!claudeDiagram || stale)) {
      try {
        await this.drawWithClaude(id)
      } catch {
        // Claude Code missing: the mapping view still works
      }
    }
    const jobNow = this.running.get(id)
    return {
      tech: ws.tech,
      basedOn,
      graph,
      details: built.details,
      arranged: Object.keys(stored.positions).length > 0,
      autoClaude: Boolean(stored.autoClaude),
      claude: claudeDiagram ? { diagramId: claudeDiagram.id, name: claudeDiagram.name, basedOn: stored.claude!.basedOn, at: stored.claude!.at, stale } : null,
      claudeJob: jobNow ?? null,
    }
  }

  savePositions(id: string, positions: unknown) {
    if (!positions || typeof positions !== 'object') throw new BadRequestException('Posições inválidas')
    const stored = this.read(id)
    for (const [nodeId, p] of Object.entries(positions as Record<string, unknown>)) {
      const { x, y } = (p ?? {}) as { x?: unknown; y?: unknown }
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(nodeId) || typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 100_000 || Math.abs(y) > 100_000) throw new BadRequestException('Posição inválida')
      stored.positions[nodeId] = { x: Math.round(x), y: Math.round(y) }
    }
    this.write(id, stored)
    return { ok: true }
  }

  resetPositions(id: string) {
    this.write(id, { ...this.read(id), positions: {} })
    return { ok: true }
  }

  setAuto(id: string, on: unknown) {
    this.write(id, { ...this.read(id), autoClaude: Boolean(on) })
    return { autoClaude: Boolean(on) }
  }

  /** Copies a version into Diagramas, to edit freely */
  async toDiagram(id: string, from: unknown) {
    const ws = this.workspaces.get(id)
    if (from === 'claude') {
      const stored = this.read(id)
      if (!stored.claude) throw new BadRequestException('O Claude ainda não desenhou esta arquitetura')
      return { diagramId: stored.claude.diagramId }
    }
    const { graph } = await this.view(id)
    const d = this.diagrams.create(id, { name: `Arquitetura viva · ${ws.name} · ${new Date().toLocaleDateString('pt-BR')}`, kind: 'c4', mode: 'canvas', source: JSON.stringify(graph) })
    return { diagramId: d.id }
  }

  /** Claude draws a richer version: the mapping as the base, the code read for what it cannot see */
  async drawWithClaude(id: string) {
    const running = this.running.get(id)
    const job = running ? this.jobs.get(running) : undefined
    if (job?.status === 'running') return { jobId: running! }
    const ws = this.workspaces.get(id)
    const built = await this.build(id)
    const basedOn = ws.analyzedAt ?? null
    const request = [
      `Arquitetura viva de ${ws.name}: modelo C4 de contêineres completo da plataforma, como ela está hoje no código.`,
      'Parta deste levantamento, feito do mapeamento do projeto (é a base: mantenha o que estiver certo e complete):',
      built.summary,
      'Complete lendo o código: as integrações com sistemas externos (ERP, OMS, PIM, pagamento, frete, antifraude, marketing), com direção, gatilho (síncrono, cron/job, fila, webhook) e protocolo; os módulos ou cartuchos que fazem cada uma; e os dados que trafegam. Agrupe por fronteiras (a loja, os sistemas do cliente, os SaaS). Nomes reais do código.',
    ].join('\n\n')
    const started = this.generator.start(id, { request, scenario: 'custom', type: 'c4-container' }, (diagram) => {
      // Claude sends no positions: arrange it in layers, like the mapping view
      try {
        const saved = this.diagrams.get(id, diagram.id)
        this.diagrams.save(id, diagram.id, { mode: 'canvas', source: JSON.stringify(layered(JSON.parse(saved.source) as Graph)) })
      } catch {
        // the editor's own layout still works
      }
      this.write(id, { ...this.read(id), claude: { diagramId: diagram.id, basedOn, at: new Date().toISOString() } })
    })
    this.running.set(id, started.jobId)
    return started
  }
}
