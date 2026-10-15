/**
 * The external systems an e-commerce project usually talks to, recognised from the names in the
 * code: Magento modules (Vendor_Module), Salesforce B2C cartridges (int_x, link_x) and service ids
 * (erp.sap.pedidos). The macro architecture draws these systems; the module, cartridge or service
 * is only the evidence of where the integration lives.
 */

export type IntegrationCategory =
  | 'Pagamento'
  | 'Frete'
  | 'ERP'
  | 'OMS'
  | 'PIM'
  | 'Antifraude'
  | 'Busca'
  | 'Marketing e CRM'
  | 'Recomendação'
  | 'Avaliações'
  | 'Analytics e tags'
  | 'Nota fiscal'
  | 'Marketplaces'
  | 'Atendimento'
  | 'Login social'
  | 'Mídia e CDN'
  | 'Impostos'
  | 'Outros sistemas'

/** How the store usually reaches a system of this category */
export type Trigger = 'checkout' | 'navegacao' | 'agendado' | 'entrada'

export const CATEGORY_TRIGGER: Record<IntegrationCategory, Trigger> = {
  Pagamento: 'checkout',
  Frete: 'checkout',
  ERP: 'agendado',
  OMS: 'agendado',
  PIM: 'agendado',
  Antifraude: 'checkout',
  Busca: 'navegacao',
  'Marketing e CRM': 'agendado',
  Recomendação: 'navegacao',
  Avaliações: 'navegacao',
  'Analytics e tags': 'navegacao',
  'Nota fiscal': 'agendado',
  Marketplaces: 'agendado',
  Atendimento: 'navegacao',
  'Login social': 'navegacao',
  'Mídia e CDN': 'navegacao',
  Impostos: 'checkout',
  'Outros sistemas': 'navegacao',
}

interface KnownSystem {
  /** Matched against the name with separators removed ("Adyen_Payment" → "adyenpayment") */
  match?: RegExp
  /** Matched only as a whole word of the name ("Loja_SapPedidos" has "sap"; "Sapataria" does not) */
  words?: string[]
  name: string
  category: IntegrationCategory
}

/** Named systems first, then the generic words a project uses for its own integrations */
const KNOWN: KnownSystem[] = [
  // pagamento
  { match: /adyen/, name: 'Adyen', category: 'Pagamento' },
  { match: /braintree/, name: 'Braintree', category: 'Pagamento' },
  { match: /paypal/, name: 'PayPal', category: 'Pagamento' },
  { match: /stripe/, name: 'Stripe', category: 'Pagamento' },
  { match: /mercadopago/, name: 'Mercado Pago', category: 'Pagamento' },
  { match: /pagarme/, name: 'Pagar.me', category: 'Pagamento' },
  { match: /pagseguro|pagbank/, name: 'PagSeguro / PagBank', category: 'Pagamento' },
  { match: /cielo/, name: 'Cielo', category: 'Pagamento' },
  { match: /getnet/, name: 'Getnet', category: 'Pagamento' },
  { match: /braspag/, name: 'Braspag', category: 'Pagamento' },
  { match: /erede|userede/, words: ['rede'], name: 'Rede', category: 'Pagamento' },
  { match: /ebanx/, name: 'EBANX', category: 'Pagamento' },
  { match: /vindi/, name: 'Vindi', category: 'Pagamento' },
  { match: /iugu/, name: 'Iugu', category: 'Pagamento' },
  { match: /cybersource/, name: 'CyberSource', category: 'Pagamento' },
  { match: /worldpay/, name: 'Worldpay', category: 'Pagamento' },
  { match: /klarna/, name: 'Klarna', category: 'Pagamento' },
  { words: ['stone'], name: 'Stone', category: 'Pagamento' },
  // frete
  { match: /correios/, name: 'Correios', category: 'Frete' },
  { match: /frenet/, name: 'Frenet', category: 'Frete' },
  { match: /intelipost/, name: 'Intelipost', category: 'Frete' },
  { match: /melhorenvio/, name: 'Melhor Envio', category: 'Frete' },
  { match: /jadlog/, name: 'Jadlog', category: 'Frete' },
  { match: /mandae/, name: 'Mandaê', category: 'Frete' },
  { match: /loggi/, name: 'Loggi', category: 'Frete' },
  { match: /kangu/, name: 'Kangu', category: 'Frete' },
  { match: /shipstation|shipperhq/, name: 'ShipperHQ / ShipStation', category: 'Frete' },
  // ERP, OMS, PIM
  { words: ['sap', 'hana', 's4hana'], name: 'SAP', category: 'ERP' },
  { match: /totvs|protheus/, name: 'TOTVS', category: 'ERP' },
  { match: /bling/, name: 'Bling', category: 'ERP' },
  { match: /tinyerp/, words: ['tiny'], name: 'Tiny', category: 'ERP' },
  { match: /omie/, name: 'Omie', category: 'ERP' },
  { match: /microvix|linxerp/, name: 'Linx', category: 'ERP' },
  { match: /netsuite/, name: 'NetSuite', category: 'ERP' },
  { match: /sankhya/, name: 'Sankhya', category: 'ERP' },
  { match: /akeneo/, name: 'Akeneo', category: 'PIM' },
  { match: /pimcore/, name: 'Pimcore', category: 'PIM' },
  { match: /salsify/, name: 'Salsify', category: 'PIM' },
  // antifraude
  { match: /clearsale/, name: 'ClearSale', category: 'Antifraude' },
  { match: /konduto/, name: 'Konduto', category: 'Antifraude' },
  { match: /signifyd/, name: 'Signifyd', category: 'Antifraude' },
  { match: /riskified/, name: 'Riskified', category: 'Antifraude' },
  // busca e recomendação
  { match: /algolia/, name: 'Algolia', category: 'Busca' },
  { match: /elasticsuite|smilecore/, name: 'ElasticSuite', category: 'Busca' },
  { match: /klevu/, name: 'Klevu', category: 'Busca' },
  { match: /doofinder/, name: 'Doofinder', category: 'Busca' },
  { match: /searchspring/, name: 'Searchspring', category: 'Busca' },
  { match: /bloomreach/, name: 'Bloomreach', category: 'Busca' },
  { match: /smarthint/, name: 'SmartHint', category: 'Recomendação' },
  { match: /chaordic|linximpulse/, name: 'Linx Impulse', category: 'Recomendação' },
  { match: /nosto/, name: 'Nosto', category: 'Recomendação' },
  { match: /einstein/, name: 'Einstein', category: 'Recomendação' },
  // marketing e CRM
  { match: /rdstation/, name: 'RD Station', category: 'Marketing e CRM' },
  { match: /klaviyo/, name: 'Klaviyo', category: 'Marketing e CRM' },
  { match: /mailchimp/, name: 'Mailchimp', category: 'Marketing e CRM' },
  { match: /dotdigital|dotmailer/, name: 'Dotdigital', category: 'Marketing e CRM' },
  { match: /hubspot/, name: 'HubSpot', category: 'Marketing e CRM' },
  { match: /emarsys/, name: 'Emarsys', category: 'Marketing e CRM' },
  { match: /braze/, name: 'Braze', category: 'Marketing e CRM' },
  { match: /insider/, name: 'Insider', category: 'Marketing e CRM' },
  { match: /edrone/, name: 'edrone', category: 'Marketing e CRM' },
  { words: ['dito'], name: 'Dito', category: 'Marketing e CRM' },
  { match: /marketingcloud|exacttarget|sfmc/, name: 'Salesforce Marketing Cloud', category: 'Marketing e CRM' },
  // avaliações, analytics, atendimento
  { match: /yotpo/, name: 'Yotpo', category: 'Avaliações' },
  { match: /trustvox/, name: 'Trustvox', category: 'Avaliações' },
  { match: /bazaarvoice/, name: 'Bazaarvoice', category: 'Avaliações' },
  { match: /trustpilot/, name: 'Trustpilot', category: 'Avaliações' },
  { match: /googletagmanager|tagmanager/, words: ['gtm'], name: 'Google Tag Manager', category: 'Analytics e tags' },
  { match: /googleanalytics/, words: ['ga4'], name: 'Google Analytics', category: 'Analytics e tags' },
  { match: /hotjar/, name: 'Hotjar', category: 'Analytics e tags' },
  { match: /zendesk/, name: 'Zendesk', category: 'Atendimento' },
  { match: /zenvia/, name: 'Zenvia', category: 'Atendimento' },
  { match: /octadesk/, name: 'Octadesk', category: 'Atendimento' },
  { match: /whatsapp/, name: 'WhatsApp', category: 'Atendimento' },
  // fiscal, marketplaces, mídia, impostos, login
  { match: /enotas|focusnfe|notafiscal/, words: ['nfe', 'nfse'], name: 'Emissor de nota fiscal', category: 'Nota fiscal' },
  { match: /anymarket/, name: 'ANYMARKET', category: 'Marketplaces' },
  { match: /skyhub/, name: 'SkyHub', category: 'Marketplaces' },
  { match: /mercadolivre|mercadolibre/, name: 'Mercado Livre', category: 'Marketplaces' },
  { match: /pluggto/, name: 'Plugg.to', category: 'Marketplaces' },
  { match: /cloudinary/, name: 'Cloudinary', category: 'Mídia e CDN' },
  { match: /imgix/, name: 'imgix', category: 'Mídia e CDN' },
  { match: /avalara/, name: 'Avalara', category: 'Impostos' },
  { words: ['vertex'], name: 'Vertex', category: 'Impostos' },
  { match: /sociallogin|facebooklogin|googlelogin/, name: 'Login social', category: 'Login social' },
  // generic words of the project's own integrations
  { words: ['erp'], match: /erpintegra|integracaoerp/, name: 'ERP', category: 'ERP' },
  { match: /ordermanagement/, words: ['oms'], name: 'OMS', category: 'OMS' },
  { words: ['pim'], name: 'PIM', category: 'PIM' },
  { match: /antifraud|fraud/, name: 'Antifraude', category: 'Antifraude' },
  { match: /gateway|pagamento|payment|checkoutpay/, name: 'Gateway de pagamento', category: 'Pagamento' },
  { match: /frete|transportadora/, name: 'Frete', category: 'Frete' },
  { words: ['crm'], name: 'CRM', category: 'Marketing e CRM' },
]

/**
 * Extensions that ship with Magento 2.4 (composer packages of the bundled extensions). Installed is
 * not the same as used: they only count when the project's own code touches them.
 */
export const isBundledExtension = (pkg: string) => /^(klarna|paypal|braintree|vertex|vertexinc|yotpo|dotmailer|dotdigital|amzn|amazon-pay|temando|signifyd)\//i.test(pkg)

const SUBJECTS: [RegExp, string][] = [
  [/stock|estoque|inventory|inventario/, 'estoque'],
  [/price|preco|pricing/, 'preços'],
  [/order|pedido/, 'pedidos'],
  [/customer|cliente/, 'clientes'],
  [/product|produto|catalog|catalogo|sku/, 'catálogo'],
  [/invoice|fatura|nota/, 'faturamento'],
  [/shipment|entrega|tracking|rastreio/, 'entregas'],
  [/budget|orcamento|quote|cotacao/, 'orçamentos'],
]
const GENERIC = /^(integration|integracao|integra|connector|conector|sync|api|config|webhook|export|import|module|core|base)$/

/**
 * A name for an integration of the project whose system the name does not tell: by its subject
 * ("Loja_StockIntegrationApi" → "Integração de estoque"), else by what is left of the name.
 */
export function integrationName(module: string): string {
  const flat = wordsOf(module).slice(1).join('')
  for (const [re, subject] of SUBJECTS) if (re.test(flat)) return `Integração de ${subject}`
  const left = module
    .split('_')
    .slice(1)
    .join(' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter((w) => w && !GENERIC.test(w.toLowerCase()))
  return left.length ? left.join(' ') : `Integração (${module})`
}

/** Names that are part of the platform, never an external system */
const PLATFORM = /^(magento|app_storefront_base|modules|bm_app_storefront_base|plugin_wishlists|plugin_giftregistry|plugin_productcompare|plugin_instorepickup|plugin_datadownload|plugin_cartridge_merge)/

export interface KnownMatch {
  name: string
  category: IntegrationCategory
  /** A named product (Adyen) rather than a generic word (ERP) */
  named: boolean
}

/** The words of a name: "Loja_SapPedidos" → loja, sap, pedidos; "erp.sap.pedidos" → erp, sap, pedidos */
const wordsOf = (raw: string) =>
  raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

/** The external system a module, cartridge or service name points to, if any */
export function recognise(raw: string): KnownMatch | null {
  if (PLATFORM.test(raw.toLowerCase())) return null
  const words = wordsOf(raw.replace(/^(int|link|bm|plugin)_/i, ''))
  const flat = words.join('')
  const generic = KNOWN.findIndex((k) => k.name === 'ERP')
  for (const [i, k] of KNOWN.entries()) {
    if ((k.match && k.match.test(flat)) || k.words?.some((w) => words.includes(w))) return { name: k.name, category: k.category, named: i < generic }
  }
  return null
}
