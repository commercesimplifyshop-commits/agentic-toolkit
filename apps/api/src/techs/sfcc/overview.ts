import type { ReadOnlyFs } from '../../readonly/readonly-fs.service'
import { storefrontOf, type Storefront } from './detector'

const READ_LIMIT = 512 * 1024
/** Total text read for services (scripts): keeps a huge project from making the overview slow */
const SCRIPT_BUDGET = 4 * 1024 * 1024
const MAX_JOB_FILES = 300
const CARTRIDGE = /^cartridges\/([^/]+)\/(.*)$/
/** Keys that hold secrets in dw.json: their presence means credentials are stored in the repository */
const SECRET_KEYS = ['password', 'client-secret', 'client_secret', 'secret', 'api-key', 'apikey', 'token']

export interface SfccRoute {
  method: string
  name: string
}

export interface SfccController {
  cartridge: string
  file: string
  kind: 'sfra' | 'pipeline'
  routes: SfccRoute[]
}

export interface SfccCartridge {
  name: string
  controllers: number
  templates: number
  scripts: number
  hooks: number
}

export interface SfccOverview {
  tech: 'salesforce-b2c'
  name: string
  storefront: Storefront
  instance: { hostname?: string; codeVersion?: string; credentialsInRepo: boolean }
  cartridges: SfccCartridge[]
  controllers: SfccController[]
  hooks: { cartridge: string; name: string; script?: string }[]
  jobs: { id: string; file: string }[]
  services: string[]
  /** Which cartridge creates each service (a cartridge may call several) */
  serviceUses: { service: string; cartridge: string }[]
  sites: string[]
  /** Cartridge path per site, from the site import (sites/<site>/site.xml), when the project versions it */
  cartridgePaths: { site: string; path: string[] }[]
  /** Custom attribute definitions per object type (meta/*.xml) */
  attributes: { type: string; count: number }[]
  counts: { cartridges: number; controllers: number; routes: number; pipelines: number; templates: number; scripts: number; jobs: number; services: number; sites: number; hooks: number }
  highlights: { level: 'critical' | 'warning' | 'info'; title: string; detail: string }[]
}

/**
 * Reads a Salesforce B2C project and describes its architecture: cartridges, controllers and
 * routes, templates, jobs, integrations, sites and custom attributes. Read-only. Secrets in
 * dw.json are detected but never returned.
 */
export function sfccOverview(rofs: ReadOnlyFs, root: string, name: string): SfccOverview {
  const files = rofs.walk(root, '', { maxFiles: 80000, skip: ['node_modules', '.git', 'build', 'coverage', '.idea', '.vscode'] })
  const carts = new Map<string, SfccCartridge>()
  const cart = (n: string) => {
    if (!carts.has(n)) carts.set(n, { name: n, controllers: 0, templates: 0, scripts: 0, hooks: 0 })
    return carts.get(n)!
  }

  const controllerFiles: { cartridge: string; file: string; kind: 'sfra' | 'pipeline' }[] = []
  const hookFiles: { cartridge: string; file: string }[] = []
  const scriptFiles: string[] = []
  const jobFiles: string[] = []
  const siteFiles: string[] = []
  const metaFiles: string[] = []

  for (const f of files) {
    const m = f.match(CARTRIDGE)
    if (m) {
      const [, cartridge, rest] = m
      const c = cart(cartridge)
      if (/^cartridge\/controllers\/.+\.js$/.test(rest)) {
        c.controllers++
        controllerFiles.push({ cartridge, file: f, kind: 'sfra' })
      } else if (/^cartridge\/controllers\/.+\.ds$/.test(rest)) {
        c.controllers++
        controllerFiles.push({ cartridge, file: f, kind: 'pipeline' })
      } else if (/^cartridge\/templates\/.+\.isml$/.test(rest)) {
        c.templates++
      } else if (/^cartridge\/scripts\/.+\.js$/.test(rest)) {
        c.scripts++
        scriptFiles.push(f)
      } else if (rest === 'hooks.json' || /^cartridge\/scripts\/hooks\.json$/.test(rest)) {
        hookFiles.push({ cartridge, file: f })
      }
    }
    if (/(^|\/)jobs?\/[^/]+\.xml$/.test(f) || /(^|\/)jobs?\.xml$/.test(f)) jobFiles.push(f)
    if (/^sites\/.+\.xml$/.test(f)) siteFiles.push(f)
    if (/^meta\/.+\.xml$/.test(f)) metaFiles.push(f)
  }

  const read = (file: string) => {
    try {
      return rofs.read(root, file, READ_LIMIT).content
    } catch {
      return ''
    }
  }

  const controllers: SfccController[] = controllerFiles.map((c) => {
    const src = read(c.file)
    const routes: SfccRoute[] =
      c.kind === 'sfra'
        ? Array.from(src.matchAll(/server\.(get|post|put|patch|delete|append|prepend|replace)\(\s*['"]([^'"]+)['"]/g), (x) => ({ method: x[1], name: x[2] }))
        : Array.from(src.matchAll(/function\s+([A-Za-z][A-Za-z0-9_]*)\s*\(/g), (x) => ({ method: 'pipeline', name: x[1] }))
    return { cartridge: c.cartridge, file: c.file, kind: c.kind, routes }
  })

  const hooks = hookFiles.flatMap((h) => {
    const json = rofs.readJson<{ hooks?: { name?: string; script?: string }[] }>(root, h.file)
    const list = Array.isArray(json?.hooks) ? json!.hooks! : []
    cart(h.cartridge).hooks = list.length
    return list.filter((x) => x.name).map((x) => ({ cartridge: h.cartridge, name: String(x.name), script: x.script ? String(x.script) : undefined }))
  })

  const jobs: { id: string; file: string }[] = []
  for (const f of jobFiles.slice(0, MAX_JOB_FILES)) {
    for (const x of read(f).matchAll(/<job\s[^>]*job-id="([^"]+)"/g)) jobs.push({ id: x[1], file: f })
  }

  const services = new Set<string>()
  const serviceUses = new Map<string, { service: string; cartridge: string }>()
  let budget = SCRIPT_BUDGET
  for (const f of scriptFiles) {
    if (budget <= 0) break
    const src = read(f)
    budget -= src.length
    const cartridge = f.match(CARTRIDGE)?.[1] ?? ''
    for (const x of src.matchAll(/LocalServiceRegistry\.createService\(\s*['"]([^'"]+)['"]/g)) {
      services.add(x[1])
      if (cartridge) serviceUses.set(`${x[1]}|${cartridge}`, { service: x[1], cartridge })
    }
  }

  const sites = new Set<string>()
  const cartridgePaths: SfccOverview['cartridgePaths'] = []
  for (const f of siteFiles) {
    const src = read(f)
    for (const x of src.matchAll(/site-id="([^"]+)"/g)) sites.add(x[1])
    const cp = src.match(/<custom-cartridges>([^<]+)<\/custom-cartridges>/)
    if (cp) cartridgePaths.push({ site: src.match(/site-id="([^"]+)"/)?.[1] ?? f.split('/')[1], path: cp[1].split(':').map((c) => c.trim()).filter(Boolean) })
  }
  try {
    for (const e of rofs.list(root, 'sites')) if (e.type === 'dir') sites.add(e.name)
  } catch {
    // no sites/ folder
  }

  const attrs = new Map<string, number>()
  for (const f of metaFiles) {
    for (const x of read(f).matchAll(/<type-extension\s[^>]*type-id="([^"]+)"[\s\S]*?<\/type-extension>/g)) {
      const n = (x[0].match(/<attribute-definition\s/g) ?? []).length
      attrs.set(x[1], (attrs.get(x[1]) ?? 0) + n)
    }
  }

  const dw = rofs.readJson<Record<string, unknown>>(root, 'dw.json')
  const credentialsInRepo = !!dw && Object.keys(dw).some((k) => SECRET_KEYS.includes(k.toLowerCase()) && String(dw[k] ?? '').trim() !== '')
  const instance = {
    hostname: typeof dw?.hostname === 'string' ? dw.hostname : undefined,
    codeVersion: typeof dw?.['code-version'] === 'string' ? (dw['code-version'] as string) : undefined,
    credentialsInRepo,
  }

  const cartridges = Array.from(carts.values()).sort((a, b) => a.name.localeCompare(b.name))
  const pipelines = controllers.filter((c) => c.kind === 'pipeline').length
  const routes = controllers.reduce((n, c) => n + c.routes.length, 0)
  const templates = cartridges.reduce((n, c) => n + c.templates, 0)
  const scripts = cartridges.reduce((n, c) => n + c.scripts, 0)

  const highlights: SfccOverview['highlights'] = []
  if (credentialsInRepo) {
    highlights.push({
      level: 'critical',
      title: 'Credenciais guardadas em dw.json dentro do projeto',
      detail: 'Os valores não são mostrados aqui. Tire as credenciais do repositório e use variáveis de ambiente ou o cofre do time.',
    })
  }
  if (!instance.hostname) {
    highlights.push({ level: 'warning', title: 'dw.json sem hostname', detail: 'Sem o endereço da instância não é possível conferir a ligação com o ambiente.' })
  }
  if (pipelines) {
    highlights.push({ level: 'info', title: `${pipelines} controller(s) em pipeline legado (.ds)`, detail: 'Ao desenhar mudanças nesses fluxos, considere a migração para SFRA.' })
  }

  return {
    tech: 'salesforce-b2c',
    name,
    storefront: storefrontOf(rofs, root),
    instance,
    cartridges,
    controllers,
    hooks,
    jobs,
    services: Array.from(services).sort(),
    serviceUses: [...serviceUses.values()],
    sites: Array.from(sites).sort(),
    cartridgePaths,
    attributes: Array.from(attrs, ([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    counts: {
      cartridges: cartridges.length,
      controllers: controllers.length,
      routes,
      pipelines,
      templates,
      scripts,
      jobs: jobs.length,
      services: services.size,
      sites: sites.size,
      hooks: hooks.length,
    },
    highlights,
  }
}
