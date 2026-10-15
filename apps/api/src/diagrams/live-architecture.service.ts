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
import { CATEGORY_TRIGGER, integrationName, isBundledExtension, recognise, type IntegrationCategory } from './integration-catalog'
import { LAYERS, referenceLayout } from './reference-layout'

/** What a node of the live architecture stands for, shown when it is clicked */
export interface NodeDetail {
  title: string
  lines: string[]
}

/** Version of the layout: positions dragged on an older one are dropped */
const LAYOUT = 2
/** Boxes that left the entry row for the platform layer, after positions started being kept */
const MOVED_INTO_PLATFORM = ['c_admin', 'c_bm']

interface Stored {
  /** Positions the person dragged nodes to: kept while the content updates */
  positions: Record<string, { x: number; y: number; /** the layer it was dragged in: the position only holds there */ in?: string | null }>
  layout?: number
  /** The version Claude drew, and the analysis it was based on */
  claude?: { diagramId: string; basedOn: string | null; at: string }
  /** Draw again with Claude by itself after each new analysis */
  autoClaude?: boolean
}

type MapItem = { id: string; kind: string; title: string; module: string; origin: string; zone: string; details: Record<string, unknown> }
type Found = Map<string, { name: string; category: IntegrationCategory; evidence: string[]; triggers: Set<'agendado' | 'entrada' | 'webhook'> }>

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
const custom = (n: number, none = 'nativo') => (n ? `${n} ${n === 1 ? 'customização' : 'customizações'}` : none)
const safeId = (prefix: string, s: string) => `${prefix}_${s.replace(/[^A-Za-z0-9_-]+/g, '_')}`.slice(0, 40)

/** The parts of the storefront a shopper goes through, from the map's zones */
const TOUCHPOINTS: [zone: string, id: string, title: string][] = [
  ['entrada', 't_home', 'Home e navegação'],
  ['catalogo', 't_plp', 'Catálogo e busca'],
  ['produto', 't_pdp', 'Página de produto'],
  ['carrinho', 't_cart', 'Carrinho'],
  ['checkout', 't_checkout', 'Checkout'],
]

/** The domains of Adobe Commerce, by the Magento module a customisation targets or the event it observes */
const DOMAINS: { id: string; title: string; module: RegExp; event?: RegExp; always?: boolean }[] = [
  { id: 'm_catalog', title: 'Catálogo', module: /^(Catalog|CatalogSearch|CatalogUrlRewrite|CatalogImportExport|ConfigurableProduct|Bundle|GroupedProduct|Eav|Swatches|CatalogWidget|UrlRewrite)$/, event: /^catalog_(product|category)|^controller_action_catalog/, always: true },
  { id: 'm_checkout', title: 'Carrinho e checkout', module: /^(Quote|Checkout|Multishipping|QuoteGraphQl|CheckoutAgreements)$/, event: /^(checkout_|sales_quote_|controller_action_checkout)/, always: true },
  { id: 'm_sales', title: 'Pedidos', module: /^(Sales|SalesSequence|Rma|SalesGraphQl)$/, event: /^(sales_order|order_|admin_sales_order)/, always: true },
  { id: 'm_customer', title: 'Clientes', module: /^(Customer|Newsletter|Wishlist|Review|Persistent|LoginAsCustomer)$/, event: /^(customer_|newsletter_)/, always: true },
  { id: 'm_payment', title: 'Pagamentos', module: /^(Payment|Vault|OfflinePayments|PaymentServices\w*)$/, event: /^payment_|^sales_order_payment/, always: true },
  { id: 'm_promo', title: 'Preços e promoções', module: /^(SalesRule|CatalogRule|GiftCard\w*|Reward|CustomerBalance|Directory)$/, event: /^(salesrule_|catalogrule_)/ },
  { id: 'm_stock', title: 'Estoque', module: /^(CatalogInventory|Inventory\w*|SalesInventory)$/, event: /^(cataloginventory_|inventory_)/ },
  { id: 'm_ship', title: 'Entrega', module: /^(Shipping|OfflineShipping|Ups|Usps|Fedex|Dhl)$/, event: /^(sales_order_shipment|shipment_)/ },
  { id: 'm_tax', title: 'Impostos', module: /^(Tax|Weee)$/ },
  { id: 'm_cms', title: 'Conteúdo', module: /^(Cms|PageBuilder|Widget|Banner|Theme)$/, event: /^cms_/ },
  { id: 'm_b2b', title: 'B2B', module: /^(Company|NegotiableQuote|SharedCatalog|RequisitionList|PurchaseOrder|QuickOrder|CompanyCredit)$/, event: /^(company_|negotiable_quote)/ },
]

/** Adobe services that run outside the store (SaaS), by module or composer package */
const ADOBE_SAAS: [RegExp, string, string][] = [
  [/LiveSearch|live-search/i, 'a_livesearch', 'Live Search'],
  [/ProductRecommendation|product-recommendations/i, 'a_recs', 'Product Recommendations'],
  [/CatalogService|catalog-service/i, 'a_catalogsvc', 'Catalog Service'],
  [/PaymentServices|payment-services/i, 'a_payments', 'Payment Services'],
]

/** SFRA controllers, by the part of the storefront they serve */
const SFRA_TOUCHPOINTS: [RegExp, string, string][] = [
  [/^(Home|Default|Page|Stores?|Error|Link)$/i, 't_home', 'Home e conteúdo'],
  [/^(Search|Tile)$/i, 't_plp', 'Busca e catálogo'],
  [/^Product$/i, 't_pdp', 'Página de produto'],
  [/^Cart$/i, 't_cart', 'Carrinho'],
  [/^Checkout\w*$/i, 't_checkout', 'Checkout'],
  [/^(Account|Login|Order|Address|PaymentInstruments|Wishlist|CSRF)$/i, 't_account', 'Conta do cliente'],
]

/** The domains of B2C Commerce, by the system object types of the custom attributes */
const SFCC_DOMAINS: [RegExp, string, string][] = [
  [/^(Product|Catalog|Category|ProductList)/, 'm_catalog', 'Catálogo'],
  [/^(PriceBook|Promotion|Campaign|Coupon|SourceCode)/, 'm_promo', 'Preços e promoções'],
  [/^(ProductInventory|Inventory)/, 'm_stock', 'Estoque'],
  [/^(Basket|Order|Shipment|ProductLineItem|ShippingMethod|LineItem|GiftCertificate)/, 'm_sales', 'Cestas e pedidos'],
  [/^(Profile|Customer|CustomerAddress|CustomerGroup)/, 'm_customer', 'Clientes'],
  [/^(Payment|OrderPaymentInstrument|CustomerPaymentInstrument)/, 'm_payment', 'Pagamentos'],
  [/^(Content|Folder|Library)/, 'm_cms', 'Conteúdo'],
  [/^(SitePreferences|OrganizationPreferences)/, 'm_prefs', 'Configuração do site'],
]

/**
 * The architecture of the platform drawn from the project's mapping, with no AI, in the shape of a
 * reference architecture: personas; the storefront and the parts of it a shopper goes through; the
 * APIs and processing; the commerce core with its domains; the infrastructure; and the external
 * systems at the sides. Modules, cartridges and services are the evidence, never boxes. It follows
 * each new analysis by itself; the person can arrange it, and Claude can draw a richer version.
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
      return { positions: s.layout === LAYOUT ? (s.positions ?? {}) : {}, layout: LAYOUT, claude: s.claude, autoClaude: s.autoClaude }
    } catch {
      return { positions: {}, layout: LAYOUT }
    }
  }
  private write(id: string, s: Stored) {
    fs.writeFileSync(`${this.file(id)}.tmp`, JSON.stringify({ ...s, layout: LAYOUT }, null, 2))
    fs.renameSync(`${this.file(id)}.tmp`, this.file(id))
  }

  // ---- integrations: the external systems, with the code as evidence ---------------------------------

  /**
   * Adds the external systems at the sides, as the client's systems (ERP, OMS, PIM, fiscal) and SaaS
   * partners (payment, shipping, search…), each linked to the part of the platform that reaches it:
   * the checkout, the catalogue, the crons and jobs, the API or a webhook.
   */
  private addIntegrations(
    found: Found,
    ctx: { nodes: GraphNode[]; details: Record<string, NodeDetail>; edge: (s: string, t: string, label?: string, tech?: string, dashed?: boolean) => void; to: { checkout: string; browse: string; search: string; jobs?: string; api?: string; webhook?: string; admin: string } },
  ) {
    const own = new Set<IntegrationCategory>(['ERP', 'OMS', 'PIM', 'Nota fiscal', 'Outros sistemas'])
    const groups = [
      { id: LAYERS.client, title: 'Sistemas do cliente', members: [] as GraphNode[] },
      { id: LAYERS.saas, title: 'Serviços SaaS e parceiros', members: [] as GraphNode[] },
    ]
    for (const sys of found.values()) {
      const nodeId = safeId('x', sys.name)
      const group = own.has(sys.category) ? groups[0] : groups[1]
      group.members.push({ id: nodeId, type: 'external', title: sys.name, tech: sys.category, description: `Evidência: ${sys.evidence.slice(0, 2).join('; ')}${sys.evidence.length > 2 ? '…' : ''}`.slice(0, 390), parent: group.id })
      ctx.details[nodeId] = { title: `${sys.name} · ${sys.category}`, lines: ['Evidências no código (contexto, não aparecem no desenho):', ...sys.evidence] }
    }
    for (const g of groups) if (g.members.length) ctx.nodes.push({ id: g.id, type: 'boundary', title: g.title }, ...g.members.sort((a, b) => (a.tech ?? '').localeCompare(b.tech ?? '') || a.title.localeCompare(b.title)))
    const { to } = ctx
    for (const sys of found.values()) {
      const x = safeId('x', sys.name)
      let linked = false
      if (sys.triggers.has('agendado') && to.jobs) (ctx.edge(to.jobs, x, 'Sincroniza', 'cron / fila', true), (linked = true))
      if (sys.triggers.has('entrada') && to.api) (ctx.edge(x, to.api, 'Chama a API da loja', 'REST'), (linked = true))
      if (sys.triggers.has('webhook')) (ctx.edge(x, to.webhook ?? to.browse, 'Notifica', 'webhook', true), (linked = true))
      const usual = CATEGORY_TRIGGER[sys.category]
      if (!linked || usual === 'checkout') {
        if (usual === 'agendado' && to.jobs) ctx.edge(to.jobs, x, 'Sincroniza', 'job', true)
        else if (usual === 'checkout') ctx.edge(to.checkout, x, sys.category === 'Frete' ? 'Cota o frete' : sys.category === 'Antifraude' ? 'Analisa o pedido' : sys.category === 'Impostos' ? 'Calcula impostos' : 'Autoriza o pagamento', 'HTTPS')
        else if (usual === 'agendado') ctx.edge(to.admin, x, 'Integra', 'HTTPS')
        else if (sys.category === 'Busca') ctx.edge(to.search, x, 'Busca e navegação', 'HTTPS')
        else ctx.edge(to.browse, x, 'Na navegação', 'HTTPS')
      }
    }
  }

  // ---- Adobe Commerce ----------------------------------------------------------------------------

  private async adobe(id: string) {
    const ws = this.workspaces.get(id)
    const o = await this.overview.compute(id)
    const map = (this.maps.readMap(id) as { items?: MapItem[] } | null)?.items ?? []
    const items = map.filter((i) => i.origin !== 'native')
    const modulesInUse = new Set(map.map((i) => i.module))
    const extensions = (o.extensions.list as { name: string; version?: string }[]) ?? []
    const count = (kind: string, pred: (i: MapItem) => boolean = () => true) => items.filter((i) => i.kind === kind && pred(i)).length
    const lines = (pred: (i: MapItem) => boolean, max = 40) => items.filter(pred).slice(0, max).map((i) => `${(KIND_LABEL[i.kind] ?? [i.kind])[0]}: ${i.title} (${i.module})`)
    const details: Record<string, NodeDetail> = {}
    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []
    const has = (nodeId: string) => nodes.some((n) => n.id === nodeId)
    const edge = (source: string, target: string, label?: string, tech?: string, dashed?: boolean) => {
      if (has(source) && has(target) && !edges.some((e) => e.source === source && e.target === target)) edges.push({ id: `e${edges.length + 1}`, source, target, label, tech, dashed })
    }

    // external systems: recognised from the project's modules and extensions; the modules are the evidence
    const found: Found = new Map()
    const byModule = new Map<string, MapItem[]>()
    for (const i of items) byModule.set(i.module, [...(byModule.get(i.module) ?? []), i])
    const note = (raw: string, evidence: string, list: MapItem[] = [], fallback?: string) => {
      const m = recognise(raw) ?? (fallback ? { name: fallback, category: 'Outros sistemas' as IntegrationCategory, named: false } : null)
      if (!m) return
      const sys = found.get(m.name) ?? { name: m.name, category: m.category, evidence: [], triggers: new Set() }
      if (!sys.evidence.includes(evidence)) sys.evidence.push(evidence)
      if (list.some((i) => i.kind === 'cron' || i.kind === 'queue')) sys.triggers.add('agendado')
      if (list.some((i) => i.kind === 'rest' || i.kind === 'graphql')) sys.triggers.add('entrada')
      if (list.some((i) => i.kind === 'route' && i.details.area === 'frontend') && (m.category === 'Pagamento' || m.category === 'Antifraude')) sys.triggers.add('webhook')
      found.set(m.name, sys)
    }
    for (const [module, list] of byModule) {
      const kinds = new Map<string, number>()
      for (const i of list) kinds.set(i.kind, (kinds.get(i.kind) ?? 0) + 1)
      // a project module whose name says it integrates, with no known system: still an external system
      const integrates = list[0]?.origin === 'custom' && /integra|connector|conector|sync|export|import|webhook/i.test(module)
      note(module, `módulo ${module} (${[...kinds].map(([k, n]) => plural(n, k)).join(', ')})`, list, integrates ? integrationName(module) : undefined)
    }
    for (const e of extensions) {
      // extensions bundled with Magento are installed in most stores: only the ones the project's code touches count
      const m = recognise(e.name)
      if (isBundledExtension(e.name) && !(m && found.has(m.name))) continue
      note(e.name, `extensão ${e.name}${e.version ? ` ${e.version}` : ''}`)
    }
    const triggered = (t: 'agendado' | 'entrada' | 'webhook') => [...found.values()].some((s) => s.triggers.has(t))

    // personas
    const b2b = [...modulesInUse].some((m) => /^Magento_(Company|NegotiableQuote|SharedCatalog|RequisitionList|PurchaseOrder)/.test(m))
    nodes.push({ id: 'p_cliente', type: 'person', title: 'Cliente', description: 'Navega, compra e acompanha pedidos' })
    if (b2b) nodes.push({ id: 'p_b2b', type: 'person', title: 'Comprador B2B', description: 'Conta empresa, cotações e catálogo compartilhado' })
    const apis = count('rest') + count('graphql')
    if (apis && !triggered('entrada')) nodes.push({ id: 'x_api', type: 'external', title: 'Sistemas que chamam as APIs', description: 'Apps, integrações e parceiros' })
    if ([...modulesInUse].some((m) => /marketplace|seller|vendor_?portal/i.test(m))) nodes.push({ id: 'p_seller', type: 'person', title: 'Lojista do marketplace', description: 'Gerencia produtos e pedidos no painel de seller' })
    nodes.push({ id: 'p_equipe', type: 'person', title: 'Equipe da loja', description: 'Pedidos, catálogo, promoções e configuração no admin' })

    // entry: CDN and full-page cache
    const services = ((o.infrastructure.docker as { services?: string[] } | null)?.services ?? []).map((s) => s.toLowerCase())
    if (o.magento.cloud) nodes.push({ id: 'c_cdn', type: 'container', title: 'CDN e cache de página', tech: 'Fastly' })
    else if (services.some((s) => s.includes('varnish'))) nodes.push({ id: 'c_cdn', type: 'container', title: 'Cache de página', tech: 'Varnish' })

    // storefront: the theme and the parts of the store, with what the project customised in each
    const theme = o.frontend.hyva ? 'Hyvä' : o.frontend.breeze ? 'Breeze' : (o.frontend.themes as { name?: string }[] | undefined)?.find((t) => t.name && !/^Magento\//.test(t.name))?.name ?? 'Luma'
    nodes.push({ id: LAYERS.store, type: 'boundary', title: `Storefront · tema ${theme}` })
    for (const [zone, nodeId, title] of TOUCHPOINTS) {
      nodes.push({ id: nodeId, type: 'container', title, tech: custom(items.filter((i) => i.zone === zone).length), parent: LAYERS.store })
      details[nodeId] = { title, lines: ['Customizações do projeto (contexto):', ...lines((i) => i.zone === zone)] }
    }
    if (b2b) nodes.push({ id: 't_b2b', type: 'container', title: 'Conta empresa e cotações', tech: 'B2B', parent: LAYERS.store })

    // APIs and processing
    nodes.push({ id: LAYERS.api, type: 'boundary', title: 'APIs e processamento' })
    nodes.push({ id: 'c_rest', type: 'container', title: 'API REST', tech: count('rest') ? plural(count('rest'), 'rest').replace(' REST', '') + ' do projeto' : 'nativa', parent: LAYERS.api })
    details.c_rest = { title: 'API REST', lines: lines((i) => i.kind === 'rest', 60) }
    if (o.frontend.graphql || count('graphql')) {
      nodes.push({ id: 'c_graphql', type: 'container', title: 'GraphQL', tech: count('graphql') ? plural(count('graphql'), 'graphql').replace(' GraphQL', '') + ' do projeto' : 'nativa', parent: LAYERS.api })
      details.c_graphql = { title: 'GraphQL', lines: lines((i) => i.kind === 'graphql', 60) }
    }
    if (triggered('webhook')) nodes.push({ id: 'c_webhook', type: 'container', title: 'Webhooks de entrada', tech: 'rotas de retorno', parent: LAYERS.api })
    if (count('cron')) {
      nodes.push({ id: 'c_cron', type: 'container', title: 'Crons', tech: `${plural(count('cron'), 'cron')} do projeto`, parent: LAYERS.api })
      details.c_cron = { title: 'Crons', lines: lines((i) => i.kind === 'cron', 60) }
    }
    if (count('queue') || o.infrastructure.rabbitmq) {
      nodes.push({ id: 'c_consumers', type: 'container', title: 'Consumers de fila', tech: count('queue') ? `${plural(count('queue'), 'queue')} do projeto` : 'nativos', parent: LAYERS.api })
      details.c_consumers = { title: 'Consumers de fila', lines: lines((i) => i.kind === 'queue', 60) }
    }
    const io = [...modulesInUse, ...extensions.map((e) => e.name)].some((m) => /AdobeCommerceEvents|commerce-eventing|AdobeIoEvents|adobe-io-events/i.test(m))
    if (io) nodes.push({ id: 'c_events', type: 'container', title: 'Adobe I/O Events', tech: 'SaaS Adobe', parent: LAYERS.api })

    // the commerce core: its domains, with the customisations that target each one
    nodes.push({ id: LAYERS.core, type: 'boundary', title: `${ws.edition ?? 'Adobe Commerce'} ${ws.version ?? ''}`.trim() })
    const domainOf = (i: MapItem) => {
      const target = String(i.details.target ?? i.details.for ?? '')
      const mod = /^\\?Magento\\(\w+)\\/.exec(target)?.[1]
      const event = i.kind === 'observer' ? String(i.details.event ?? i.title) : ''
      return DOMAINS.find((d) => (mod && d.module.test(mod)) || (event && d.event?.test(event)))?.id
    }
    for (const d of DOMAINS) {
      const mine = items.filter((i) => domainOf(i) === d.id)
      const inUse = [...modulesInUse].some((m) => m.startsWith('Magento_') && d.module.test(m.slice(8)))
      if (!d.always && !mine.length && !(inUse && (d.id === 'm_b2b' || d.id === 'm_stock'))) continue
      nodes.push({ id: d.id, type: 'container', title: d.title, tech: custom(mine.length), parent: LAYERS.core })
      details[d.id] = { title: d.title, lines: ['Plugins, preferences e observers do projeto neste domínio (contexto):', ...mine.slice(0, 40).map((i) => `${(KIND_LABEL[i.kind] ?? [i.kind])[0]}: ${i.title} (${i.module})`)] }
    }
    for (const [re, nodeId, title] of ADOBE_SAAS) {
      if ([...modulesInUse, ...extensions.map((e) => e.name)].some((m) => re.test(m))) nodes.push({ id: nodeId, type: 'container', title, tech: 'SaaS Adobe', parent: LAYERS.core })
    }

    // the admin is part of the platform: the last box of its layer, where the team's line comes in
    nodes.push({ id: 'c_admin', type: 'container', title: 'Admin', tech: custom(items.filter((i) => i.zone === 'admin').length), parent: LAYERS.core })
    details.c_admin = { title: 'Admin', lines: ['Customizações do projeto (contexto):', ...lines((i) => i.zone === 'admin')] }

    // infrastructure
    nodes.push({ id: LAYERS.infra, type: 'boundary', title: o.magento.cloud ? 'Infraestrutura · Adobe Commerce Cloud' : 'Infraestrutura' })
    nodes.push({ id: 'd_db', type: 'db', title: 'Banco de dados', tech: 'MySQL / MariaDB', parent: LAYERS.infra })
    if (o.infrastructure.searchEngine) nodes.push({ id: 'd_search', type: 'db', title: 'Busca', tech: String(o.infrastructure.searchEngine).replace(/^Magento_(Elasticsearch|OpenSearch)(\d*)$/i, (_m, e: string, v: string) => `${/open/i.test(e) ? 'OpenSearch' : 'Elasticsearch'}${v ? ` ${v}` : ''}`), parent: LAYERS.infra })
    if (o.infrastructure.rabbitmq) nodes.push({ id: 'q_mq', type: 'queue', title: 'Filas', tech: 'RabbitMQ', parent: LAYERS.infra })
    if (services.some((s) => s.includes('redis') || s.includes('valkey'))) nodes.push({ id: 'd_cache', type: 'db', title: 'Cache e sessão', tech: 'Redis', parent: LAYERS.infra })
    if (o.magento.cloud) nodes.push({ id: 'd_media', type: 'db', title: 'Mídia', tech: 'Armazenamento de arquivos', parent: LAYERS.infra })

    this.addIntegrations(found, { nodes, details, edge, to: { checkout: 't_checkout', browse: LAYERS.store, search: 't_plp', jobs: has('c_cron') ? 'c_cron' : has('c_consumers') ? 'c_consumers' : undefined, api: 'c_rest', webhook: has('c_webhook') ? 'c_webhook' : undefined, admin: 'c_admin' } })

    edge('p_cliente', has('c_cdn') ? 'c_cdn' : LAYERS.store, 'Navega e compra', 'HTTPS')
    edge('c_cdn', LAYERS.store, 'Encaminha o que não está em cache')
    edge('p_b2b', LAYERS.store, 'Compra como empresa', 'HTTPS')
    edge('x_api', LAYERS.api, 'Integra', 'REST / GraphQL')
    edge('p_seller', 'c_admin', 'Gerencia produtos e pedidos', 'HTTPS')
    edge('p_equipe', 'c_admin', 'Opera', 'HTTPS')
    edge(LAYERS.store, LAYERS.core, 'Renderiza com os domínios', 'PHP')
    edge(LAYERS.api, LAYERS.core, 'Expõe e processa')
    edge(LAYERS.core, LAYERS.infra, 'Lê e grava', ['SQL', has('d_search') && 'HTTP', has('q_mq') && 'AMQP'].filter(Boolean).join(' · '))

    details[LAYERS.store] = { title: `Storefront · tema ${theme}`, lines: [`Tema: ${theme}`, ...((o.frontend.themes as { name?: string }[] | undefined) ?? []).map((t) => `tema instalado: ${t.name}`).slice(0, 10)] }
    return { nodes, edges, details }
  }

  // ---- Salesforce B2C ------------------------------------------------------------------------------

  private sfccGraph(id: string) {
    const o = this.sfcc.overview(id)
    const details: Record<string, NodeDetail> = {}
    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []
    const has = (nodeId: string) => nodes.some((n) => n.id === nodeId)
    const edge = (source: string, target: string, label?: string, tech?: string, dashed?: boolean) => {
      if (has(source) && has(target) && !edges.some((e) => e.source === source && e.target === target)) edges.push({ id: `e${edges.length + 1}`, source, target, label, tech, dashed })
    }
    const ocapiHooks = o.hooks.filter((h) => /^dw\.ocapi\./.test(h.name))
    const pathOrder = o.cartridgePaths[0]?.path ?? o.cartridges.map((c) => c.name)
    const headless = o.storefront.type === 'PWA Kit'

    // external systems: from the services the code creates and the integration cartridges
    const found: Found = new Map()
    const note = (raw: string, evidence: string, opts: { scheduled?: boolean; webhook?: boolean; fallback?: string } = {}) => {
      const m = recognise(raw) ?? (opts.fallback ? { name: opts.fallback, category: 'Outros sistemas' as IntegrationCategory, named: false } : null)
      if (!m) return
      const sys = found.get(m.name) ?? { name: m.name, category: m.category, evidence: [], triggers: new Set() }
      if (!sys.evidence.includes(evidence)) sys.evidence.push(evidence)
      if (opts.scheduled) sys.triggers.add('agendado')
      if (opts.webhook) sys.triggers.add('webhook')
      found.set(m.name, sys)
    }
    const webhookCartridges = new Set(o.controllers.filter((c) => /notif|webhook|callback|retorno|postback/i.test(c.file)).map((c) => c.cartridge))
    for (const s of o.services) {
      const users = o.serviceUses.filter((u) => u.service === s).map((u) => u.cartridge)
      const recognised = recognise(s) ?? users.map((c) => recognise(c)).find(Boolean)
      note(recognised ? (recognise(s) ? s : users.find((c) => recognise(c))!) : s, `serviço ${s}${users.length ? ` (cartucho ${users.join(', ')})` : ''}`, {
        scheduled: /job|sync|export|import|feed/i.test(s),
        webhook: users.some((c) => webhookCartridges.has(c)),
        fallback: `Sistema externo (${s.split('.')[0]})`,
      })
    }
    for (const c of o.cartridges.map((x) => x.name).filter((n) => /^(int|link)_/.test(n))) note(c, `cartucho ${c}`, { webhook: webhookCartridges.has(c) })
    const triggered = (t: 'agendado' | 'entrada' | 'webhook') => [...found.values()].some((s) => s.triggers.has(t))

    // personas
    nodes.push({ id: 'p_cliente', type: 'person', title: 'Cliente', description: 'Navega, compra e acompanha pedidos' })
    if (ocapiHooks.length) nodes.push({ id: 'x_api', type: 'external', title: 'Apps e sistemas', description: 'Consomem as APIs da plataforma (SCAPI / OCAPI)' })
    nodes.push({ id: 'p_equipe', type: 'person', title: 'Equipe da loja', description: 'Catálogo, promoções, conteúdo e configuração no Business Manager' })
    nodes.push({ id: 'c_cdn', type: 'container', title: 'eCDN', tech: 'CDN e WAF da plataforma' })

    // storefront: the parts of the store, with the project's routes in each
    const own = o.controllers.filter((c) => c.cartridge !== 'app_storefront_base')
    nodes.push({ id: LAYERS.store, type: 'boundary', title: `Storefront · ${headless ? 'PWA Kit' : 'SFRA'}`, description: `Cartridge path: ${pathOrder.join(' → ') || '—'}`.slice(0, 390) })
    for (const [re, nodeId, title] of SFRA_TOUCHPOINTS) {
      const routes = own.filter((c) => re.test(path.basename(c.file).replace(/\.(js|ds)$/, ''))).flatMap((c) => c.routes.map((r) => `${c.cartridge}: ${r.method} ${path.basename(c.file).replace(/\.(js|ds)$/, '')}-${r.name}`))
      nodes.push({ id: nodeId, type: 'container', title, tech: routes.length ? `${routes.length} ${routes.length === 1 ? 'rota' : 'rotas'} do projeto` : headless ? 'PWA Kit' : 'base SFRA', parent: LAYERS.store })
      details[nodeId] = { title, lines: ['Rotas do projeto (contexto):', ...routes.slice(0, 40)] }
    }

    // APIs and processing
    nodes.push({ id: LAYERS.api, type: 'boundary', title: 'APIs e processamento' })
    nodes.push({ id: 'c_scapi', type: 'container', title: 'SCAPI / OCAPI', tech: ocapiHooks.length ? `${ocapiHooks.length} ${ocapiHooks.length === 1 ? 'hook' : 'hooks'} do projeto` : 'APIs da plataforma', parent: LAYERS.api })
    details.c_scapi = { title: 'SCAPI / OCAPI', lines: ocapiHooks.map((h) => `${h.name} (${h.cartridge})`) }
    if (triggered('webhook')) nodes.push({ id: 'c_webhook', type: 'container', title: 'Webhooks de entrada', tech: 'controllers de retorno', parent: LAYERS.api })
    if (o.jobs.length) {
      nodes.push({ id: 'c_jobs', type: 'container', title: 'Jobs', tech: `${o.jobs.length} ${o.jobs.length === 1 ? 'job' : 'jobs'} do projeto`, parent: LAYERS.api })
      details.c_jobs = { title: 'Jobs', lines: o.jobs.map((j) => `${j.id} (${j.file})`) }
    }

    // the commerce core: its domains, with the custom attributes of each
    nodes.push({ id: LAYERS.core, type: 'boundary', title: 'Salesforce B2C Commerce' })
    for (const [re, nodeId, title] of SFCC_DOMAINS) {
      const attrs = o.attributes.filter((a) => re.test(a.type))
      const n = attrs.reduce((s, a) => s + a.count, 0)
      if (nodeId === 'm_prefs' && !n) continue
      nodes.push({ id: nodeId, type: 'container', title, tech: n ? `${n} ${n === 1 ? 'atributo custom' : 'atributos custom'}` : 'nativo', parent: LAYERS.core })
      details[nodeId] = { title, lines: attrs.map((a) => `${a.count} atributo(s) custom em ${a.type}`) }
    }
    nodes.push({ id: 'c_bm', type: 'container', title: 'Business Manager', tech: `${o.sites.length} ${o.sites.length === 1 ? 'site' : 'sites'}`, parent: LAYERS.core })
    details.c_bm = { title: 'Business Manager', lines: [...o.sites.map((s) => `site ${s}`), ...o.attributes.map((a) => `${a.count} atributo(s) em ${a.type}`)] }

    this.addIntegrations(found, { nodes, details, edge, to: { checkout: 't_checkout', browse: LAYERS.store, search: 't_plp', jobs: has('c_jobs') ? 'c_jobs' : undefined, api: 'c_scapi', webhook: has('c_webhook') ? 'c_webhook' : undefined, admin: 'c_bm' } })

    edge('p_cliente', 'c_cdn', 'Navega e compra', 'HTTPS')
    edge('c_cdn', LAYERS.store, 'Encaminha')
    edge('x_api', 'c_scapi', 'Consome', 'REST')
    edge('p_equipe', 'c_bm', 'Opera', 'HTTPS')
    edge(LAYERS.store, headless ? LAYERS.api : LAYERS.core, headless ? 'Usa' : 'Usa os domínios', headless ? 'SCAPI' : 'Script API')
    edge(LAYERS.api, LAYERS.core, 'Expõe e processa')

    details[LAYERS.store] = { title: 'Storefront', lines: [`Cartridge path (contexto): ${pathOrder.join(' → ')}`, ...own.flatMap((x) => x.routes.map((r) => `${x.cartridge}: ${r.method} ${path.basename(x.file).replace(/\.(js|ds)$/, '')}-${r.name}`)).slice(0, 50)] }
    return { nodes, edges, details }
  }

  // ---- the live view -------------------------------------------------------------------------------

  /** A text summary of the graph, for Claude to build on */
  private summarize(graph: Graph, details: Record<string, NodeDetail>) {
    const title = (id: string) => graph.nodes.find((n) => n.id === id)?.title ?? id
    return [
      'Elementos:',
      ...graph.nodes.map((n) => `- [${n.type}] ${n.title}${n.tech ? ` (${n.tech})` : ''}${n.parent ? ` dentro de "${title(n.parent)}"` : ''}${n.description ? `: ${n.description}` : ''}`),
      'Conexões:',
      ...graph.edges.map((e) => `- ${title(e.source)} → ${title(e.target)}${e.label ? `: ${e.label}` : ''}${e.tech ? ` [${e.tech}]` : ''}`),
      'Evidências no código (contexto para confirmar e completar, não para desenhar):',
      ...Object.values(details).flatMap((d) => [`- ${d.title}:`, ...d.lines.slice(0, 15).map((l) => `  - ${l}`)]),
    ].join('\n')
  }

  private async build(id: string) {
    const ws = this.workspaces.get(id)
    if (ws.status !== 'analyzed' || !ws.root) throw new BadRequestException('Analise o projeto antes de ver a arquitetura')
    const key = `${ws.analyzedAt ?? ''}|${ws.root}`
    const cached = this.cache.get(id)
    if (cached?.key === key) return cached
    const { nodes, edges, details } = ws.tech === 'salesforce-b2c' ? this.sfccGraph(id) : await this.adobe(id)
    const graph = referenceLayout({ version: 1, family: 'c4', nodes, edges })
    const built = { key, graph, details, summary: this.summarize(graph, details) }
    this.cache.set(id, built)
    return built
  }

  /** The architecture as the mapping shows it now, with the person's arrangement on top */
  async view(id: string) {
    const ws = this.workspaces.get(id)
    const built = await this.build(id)
    const stored = this.read(id)
    const graph: Graph = {
      ...built.graph,
      nodes: built.graph.nodes.map((n) => {
        const p = stored.positions[n.id]
        // a box that moved into another layer starts again at its place in the new one; positions saved before
        // the layer was recorded hold, except the admin and Business Manager, which went into the platform
        const holds = p && (p.in === undefined ? !MOVED_INTO_PLATFORM.includes(n.id) : p.in === (n.parent ?? null))
        return holds ? { ...n, x: p.x, y: p.y } : n
      }),
    }
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
    const graph = this.cache.get(id)?.graph
    for (const [nodeId, p] of Object.entries(positions as Record<string, unknown>)) {
      const { x, y } = (p ?? {}) as { x?: unknown; y?: unknown }
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(nodeId) || typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 100_000 || Math.abs(y) > 100_000) throw new BadRequestException('Posição inválida')
      stored.positions[nodeId] = { x: Math.round(x), y: Math.round(y), in: graph?.nodes.find((n) => n.id === nodeId)?.parent ?? null }
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
      `Arquitetura viva de ${ws.name}: a arquitetura MACRO da plataforma (C4 de contêineres), como ela está hoje no código.`,
      'Siga a skill "Arquitetura de referência" (reference-architecture): ela define o formato, sempre o mesmo em desenhos novos e atualizações. Em resumo: desenhe no formato de uma arquitetura de referência, em camadas. Use exatamente estes ids de grupo (boundary): b_store (storefront, com as partes da loja: home, catálogo e busca, produto, carrinho, checkout, conta), b_api (APIs e processamento: REST, GraphQL, SCAPI/OCAPI, webhooks de entrada, crons, consumers, jobs), b_core (a plataforma de commerce, com seus domínios: catálogo, carrinho e checkout, pedidos, clientes, pagamentos, preços e promoções, estoque… e os serviços SaaS do fabricante, com tech "SaaS Adobe" ou "SaaS Salesforce"), b_infra (banco, busca, cache, filas; omita no Salesforce B2C), b_cliente (sistemas do cliente: ERP, OMS, PIM, nota fiscal) e b_saas (SaaS e parceiros: pagamento, frete, antifraude, marketing, atendimento…). Personas sem grupo; a CDN com id c_cdn, fora dos grupos; o admin/Business Manager com id c_admin/c_bm, como a última caixa dentro de b_core, e a equipe da loja ligada direto a ele. Caixas com títulos curtos; a contagem ou a tecnologia vai em tech. Entre as camadas da plataforma, ligue os grupos inteiros (ex.: c_cdn → b_store, b_store → b_core, b_api → b_core, b_core → b_infra), não caixa a caixa; ligue a uma caixa só a conexão com um sistema externo ou persona que entra por ela (ex.: o checkout chama o gateway de pagamento). Rótulos curtos.',
      'NÃO desenhe módulos, cartuchos, plugins, observers, preferences, controllers ou classes: eles são a evidência para descobrir, nomear e conectar os serviços e integrações, e podem aparecer só na descrição de um elemento.',
      'Parta deste levantamento, feito do mapeamento do projeto (é a base: mantenha o que estiver certo, corrija e complete):',
      built.summary,
      'Complete lendo o código: confirme cada integração, descubra as que o levantamento não reconheceu, e dê a cada conexão direção, gatilho (síncrono no checkout, cron/job, fila, webhook) e protocolo, com o dado que trafega no rótulo. Diga quando uma integração está definida mas sem chamada no código. Use os nomes reais dos sistemas.',
    ].join('\n\n')
    const started = this.generator.start(id, { request, scenario: 'custom', type: 'c4-container' }, (diagram) => {
      // arrange it in the same layers as the mapping view
      try {
        const saved = this.diagrams.get(id, diagram.id)
        this.diagrams.save(id, diagram.id, { mode: 'canvas', source: JSON.stringify(referenceLayout(JSON.parse(saved.source) as Graph)) })
      } catch {
        // the editor's own layout still works
      }
      this.write(id, { ...this.read(id), claude: { diagramId: diagram.id, basedOn, at: new Date().toISOString() } })
    })
    this.running.set(id, started.jobId)
    return started
  }
}
