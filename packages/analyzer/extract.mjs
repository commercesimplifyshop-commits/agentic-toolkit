#!/usr/bin/env node
// Scans a Magento 2 installation and writes a StoreFlow map:
// every REST route, GraphQL operation, observer, plugin, preference, route,
// cron job and queue topic, classified into a zone of the purchase flow.
//
//   node tools/extract.mjs <magento-root> --name minha-loja [--native reference/magento2-2.4.6] [--own MinhaAgencia,MinhaLoja]

import fs from 'node:fs'
import path from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import { classify } from './classify.mjs'

// ---- args ----------------------------------------------------------------

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const root = args[0] && !args[0].startsWith('--') ? path.resolve(args[0]) : null
if (!root) {
  console.error('uso: node tools/extract.mjs <magento-root> --name <slug> [--native <magento2-checkout>] [--own Vendor1,Vendor2]')
  process.exit(1)
}
const slug = flag('name') ?? path.basename(root)
const nativeRoot = flag('native') ? path.resolve(flag('native')) : null
const ownVendors = new Set((flag('own') ?? '').split(',').filter(Boolean))
const outDir = path.resolve(flag('out') ?? 'public/maps')

// ---- helpers -------------------------------------------------------------

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  isArray: (name, _jpath, _leaf, isAttribute) => !isAttribute && ['route', 'resource', 'event', 'observer', 'type', 'plugin', 'preference', 'router', 'module', 'group', 'job', 'topic', 'handler', 'consumer', 'parameter'].includes(name),
})

const arr = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v])

function walk(dir, out = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'Test' || e.name === 'view' || e.name === 'i18n') continue
      walk(p, out)
    } else out.push(p)
  }
  return out
}

function lineOf(text, needle) {
  const i = needle ? text.indexOf(needle) : -1
  return i < 0 ? 1 : text.slice(0, i).split('\n').length
}

/** etc/frontend/events.xml → frontend, etc/events.xml → global */
function areaOf(file) {
  const parts = file.split(path.sep)
  const etc = parts.lastIndexOf('etc')
  return etc >= 0 && etc < parts.length - 2 ? parts[etc + 1] : 'global'
}

const shortClass = (cls = '') => cls.replace(/^\\/, '').split('\\').slice(-2).join('\\')

// ---- module discovery ----------------------------------------------------

/** @returns {{ name: string, vendor: string, dir: string, origin: string }[]} */
function discoverModules(codeDir, originFor) {
  const modules = []
  for (const vendor of fs.existsSync(codeDir) ? fs.readdirSync(codeDir) : []) {
    const vdir = path.join(codeDir, vendor)
    if (!fs.statSync(vdir).isDirectory()) continue
    for (const mod of fs.readdirSync(vdir)) {
      const dir = path.join(vdir, mod)
      const xml = path.join(dir, 'etc', 'module.xml')
      if (!fs.existsSync(xml)) continue
      const parsed = parser.parse(fs.readFileSync(xml, 'utf8'))
      const name = arr(parsed?.config?.module)[0]?.name ?? `${vendor}_${mod}`
      modules.push({ name, vendor, dir, origin: originFor(vendor) })
    }
  }
  return modules
}

// ---- parsers per file type ------------------------------------------------

const items = []
const byId = new Map()

function add(item) {
  const existing = byId.get(item.id)
  if (existing) {
    // app/code is scanned first: a custom REST route with a native URL replaces the core one
    if (item.kind === 'rest') {
      existing.details.overridesNative = `${item.details.serviceClass}::${item.details.serviceMethod}`
      return
    }
    // Same observer/plugin name declared again (e.g. a module disabling a core observer): keep both
    if (item.kind !== 'observer' && item.kind !== 'plugin') return
    item.id = `${item.id}@${item.module}`
    if (byId.has(item.id)) return
  }
  byId.set(item.id, item)
  items.push(item)
}

function rel(file) {
  return path.relative(item_root(file), file).split(path.sep).join('/')
}
function item_root(file) {
  return nativeRoot && file.startsWith(nativeRoot) ? nativeRoot : root
}

function parseWebapi(file, mod, text) {
  for (const r of arr(parser.parse(text)?.routes?.route)) {
    const svc = r.service ?? {}
    const acl = arr(r.resources?.resource).map((x) => x.ref)
    const title = `${r.method} ${r.url}`
    add({
      id: `rest:${r.method} ${r.url}`,
      kind: 'rest',
      title,
      subtitle: `${shortClass(svc.class)}::${svc.method}`,
      // <data><parameter force="true">%cart_id%</parameter></data>: injected by Magento from the token, not sent by the client
      details: { method: r.method, url: r.url, serviceClass: svc.class, serviceMethod: svc.method, acl, forcedParams: arr(r.data?.parameter).map((p) => p.name) },
      ...classify(`${r.url} ${svc.class} ${svc.method}`, mod.name),
      module: mod.name,
      origin: mod.origin,
      file: rel(file),
      line: lineOf(text, `url="${r.url}"`),
    })
  }
}

/** Splits the body of `type Query { ... }` into top-level field statements. */
function graphqlFields(body) {
  const stmts = []
  let cur = ''
  let depth = 0
  let inStr = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '"' && body[i - 1] !== '\\') inStr = !inStr
    if (!inStr) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (ch === '#' && depth === 0) {
        while (i < body.length && body[i] !== '\n') i++
        continue
      }
    }
    if (ch === '\n' && depth === 0 && !inStr) {
      if (cur.trim()) stmts.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) stmts.push(cur.trim())
  // Directives continued on the next line belong to the previous field
  return stmts.reduce((acc, s) => {
    if (s.startsWith('@') && acc.length) acc[acc.length - 1] += ' ' + s
    else acc.push(s)
    return acc
  }, [])
}

function parseGraphql(file, mod, text) {
  const re = /(?:extend\s+)?type\s+(Query|Mutation)\s*(?:@[^{]*)?\{/g
  let m
  while ((m = re.exec(text))) {
    let depth = 1
    let i = re.lastIndex
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth++
      if (text[i] === '}') depth--
      i++
    }
    const body = text.slice(re.lastIndex, i - 1)
    for (const stmt of graphqlFields(body)) {
      const name = stmt.match(/^(\w+)/)?.[1]
      if (!name) continue
      const resolver = stmt.match(/@resolver\s*\(\s*class\s*:\s*"([^"]+)"/)?.[1]
      const doc = stmt.match(/@doc\s*\(\s*description\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]
      const op = m[1] === 'Query' ? 'query' : 'mutation'
      add({
        id: `graphql:${op} ${name}`,
        kind: 'graphql',
        title: `${op} ${name}`,
        subtitle: resolver ? shortClass(resolver) : 'sem resolver',
        details: { operation: op, name, resolver, description: doc },
        ...classify(`${name} ${resolver ?? ''}`, mod.name),
        module: mod.name,
        origin: mod.origin,
        file: rel(file),
        line: lineOf(text, `${name}(`) || lineOf(text, `${name}:`),
      })
    }
  }
}

function parseEvents(file, mod, text) {
  const area = areaOf(file)
  for (const ev of arr(parser.parse(text)?.config?.event)) {
    for (const o of arr(ev.observer)) {
      add({
        id: `observer:${area}:${ev.name}:${o.name}`,
        kind: 'observer',
        title: ev.name,
        subtitle: o.instance ? `${o.name} → ${shortClass(o.instance)}` : `${o.name} (override)`,
        details: { event: ev.name, name: o.name, instance: o.instance, area, disabled: o.disabled === 'true' },
        ...classify(`${ev.name} ${o.instance ?? ''}`, mod.name),
        module: mod.name,
        origin: mod.origin,
        file: rel(file),
        line: lineOf(text, `name="${o.name}"`),
        classFile: classFile(o.instance),
      })
    }
  }
}

/** Finds the PHP file for a class in app/code of the installation or of the native reference. */
function classFile(cls) {
  if (!cls) return undefined
  const parts = cls.replace(/^\\/, '').split('\\')
  for (const base of [root, nativeRoot].filter(Boolean)) {
    const file = path.join(base, 'app', 'code', ...parts) + '.php'
    if (fs.existsSync(file)) return path.relative(base, file).split(path.sep).join('/')
  }
  return undefined
}

function readClass(rel) {
  for (const base of [root, nativeRoot].filter(Boolean)) {
    const file = path.join(base, rel)
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8')
  }
  return ''
}

function pluginMethods(cls) {
  const f = classFile(cls)
  if (!f) return []
  const text = readClass(f)
  return [...text.matchAll(/public\s+function\s+(before|around|after)(\w+)/gi)].map(
    ([, type, method]) => `${type.toLowerCase()}:${method[0].toLowerCase()}${method.slice(1)}`,
  )
}

/** around methods whose body never invokes $proceed: they cut the chain and the original never runs. */
function aroundWithoutProceed(cls) {
  const f = classFile(cls)
  if (!f) return []
  const text = readClass(f)
  const out = []
  for (const m of text.matchAll(/public\s+function\s+around(\w+)\s*\(([^)]*)\)/gi)) {
    // The proceed argument is the one typed callable/Closure, or else the 2nd parameter
    const params = m[2].split(',')
    const typed = params.find((p) => /callable|Closure/.test(p))
    const proceedVar = (typed ?? params[1] ?? '').match(/\$\w+/)?.[0] ?? '$proceed'
    let i = text.indexOf('{', m.index + m[0].length)
    let depth = 0
    const start = i
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++
      if (text[i] === '}' && --depth === 0) break
    }
    const body = text.slice(start, i)
    const v = proceedVar.replace('$', '\\$')
    // The chain continues if $proceed is invoked or passed along as an argument
    // (e.g. to a commit callback); returning or overwriting it does not count
    const continues = new RegExp(`${v}\\s*\\(|[(,]\\s*${v}\\s*[,)]|call_user_func(_array)?\\(\\s*${v}`).test(body)
    if (!continues) out.push(`${m[1][0].toLowerCase()}${m[1].slice(1)}`)
  }
  return out
}

function parseDi(file, mod, text) {
  const area = areaOf(file)
  const cfg = parser.parse(text)?.config ?? {}
  for (const t of arr(cfg.type)) {
    for (const p of arr(t.plugin)) {
      if (!p.type && p.disabled !== 'true') continue
      const methods = pluginMethods(p.type)
      add({
        id: `plugin:${area}:${t.name}:${p.name}`,
        kind: 'plugin',
        title: shortClass(t.name),
        subtitle: `${p.name}${methods.length ? ' · ' + methods.join(', ') : ''}`,
        details: {
          target: t.name.replace(/^\\/, ''),
          name: p.name,
          type: p.type,
          area,
          methods,
          aroundWithoutProceed: aroundWithoutProceed(p.type),
          disabled: p.disabled === 'true',
          sortOrder: p.sortOrder === undefined ? undefined : Number(p.sortOrder),
        },
        ...classify(`${t.name} ${methods.join(' ')}`, `${p.type ?? ''} ${mod.name}`),
        module: mod.name,
        origin: mod.origin,
        file: rel(file),
        line: lineOf(text, `name="${p.name}"`),
        classFile: classFile(p.type),
      })
    }
  }
  for (const p of arr(cfg.preference)) {
    // Only class rewrites matter for the flow; interface → implementation bindings are wiring
    if (!p.for || /Interface$/.test(p.for) || mod.origin === 'native') continue
    add({
      id: `preference:${area}:${p.for}`,
      kind: 'preference',
      title: shortClass(p.for),
      subtitle: `reescrito por ${shortClass(p.type)}`,
      details: { for: p.for, type: p.type, area },
      ...classify(p.for, `${p.type} ${mod.name}`),
      module: mod.name,
      origin: mod.origin,
      file: rel(file),
      line: lineOf(text, `for="${p.for}"`),
      classFile: classFile(p.type),
    })
  }
}

function parseRoutes(file, mod, text) {
  const area = areaOf(file)
  for (const router of arr(parser.parse(text)?.config?.router)) {
    for (const r of arr(router.route)) {
      add({
        id: `route:${area}:${r.frontName}:${mod.name}`,
        kind: 'route',
        title: `/${r.frontName}`,
        subtitle: `${area} · ${arr(r.module).map((m) => m.name).join(', ')}`,
        details: { area, router: router.id, id: r.id, frontName: r.frontName },
        ...classify(`${r.frontName} ${r.id}`, mod.name),
        module: mod.name,
        origin: mod.origin,
        file: rel(file),
        line: lineOf(text, `frontName="${r.frontName}"`),
      })
    }
  }
}

function parseCrontab(file, mod, text) {
  for (const g of arr(parser.parse(text)?.config?.group)) {
    for (const j of arr(g.job)) {
      const schedule = j.schedule ?? (j.config_path ? `config: ${j.config_path}` : '—')
      add({
        id: `cron:${j.name}`,
        kind: 'cron',
        title: j.name,
        subtitle: `${schedule} · ${shortClass(j.instance)}::${j.method}`,
        details: { group: g.id, name: j.name, instance: j.instance, method: j.method, schedule },
        ...classify(`${j.name} ${j.instance}`, mod.name),
        module: mod.name,
        origin: mod.origin,
        file: rel(file),
        line: lineOf(text, `name="${j.name}"`),
        classFile: classFile(j.instance),
      })
    }
  }
}

function parseCommunication(file, mod, text) {
  for (const t of arr(parser.parse(text)?.config?.topic)) {
    const handlers = arr(t.handler).map((h) => `${shortClass(h.type)}::${h.method}`)
    add({
      id: `queue:${t.name}`,
      kind: 'queue',
      title: t.name,
      subtitle: handlers.join(', ') || `request: ${t.request ?? '—'}`,
      details: { topic: t.name, request: t.request, handlers: arr(t.handler) },
      ...classify(t.name, `${handlers.join(' ')} ${mod.name}`),
      module: mod.name,
      origin: mod.origin,
      file: rel(file),
      line: lineOf(text, `name="${t.name}"`),
    })
  }
}

const PARSERS = {
  'webapi.xml': parseWebapi,
  'schema.graphqls': parseGraphql,
  'events.xml': parseEvents,
  'di.xml': parseDi,
  'routes.xml': parseRoutes,
  'crontab.xml': parseCrontab,
  'communication.xml': parseCommunication,
}

function scan(modules, only) {
  for (const mod of modules) {
    for (const file of walk(path.join(mod.dir, 'etc'))) {
      const fn = PARSERS[path.basename(file)]
      if (!fn || (only && !only.includes(path.basename(file)))) continue
      try {
        fn(file, mod, fs.readFileSync(file, 'utf8'))
      } catch (err) {
        console.warn(`! ${path.relative(root, file)}: ${err.message}`)
      }
    }
  }
}

// ---- run -----------------------------------------------------------------

const customModules = discoverModules(path.join(root, 'app', 'code'), (vendor) =>
  ownVendors.size === 0 || ownVendors.has(vendor) ? 'custom' : 'thirdparty',
)
scan(customModules)

let nativeModules = []
if (nativeRoot) {
  nativeModules = discoverModules(path.join(nativeRoot, 'app', 'code'), () => 'native')
  // Native installs ship hundreds of observers/plugins; the APIs are what matter here
  scan(nativeModules, ['webapi.xml', 'schema.graphqls', 'events.xml', 'di.xml'])
}

const composer = JSON.parse(fs.readFileSync(path.join(root, 'composer.json'), 'utf8'))
const req = composer.require ?? {}
const productKey = Object.keys(req).find((k) => /^magento\/product-(enterprise|community)-edition$/.test(k))

// Module load order: decides observer order and plugin sortOrder ties
const configPhp = path.join(root, 'app', 'etc', 'config.php')
const moduleOrder = []
const disabledModules = []
if (fs.existsSync(configPhp)) {
  for (const [, name, enabled] of fs.readFileSync(configPhp, 'utf8').matchAll(/'(\w+_\w+)'\s*=>\s*([01])/g)) {
    ;(enabled === '1' ? moduleOrder : disabledModules).push(name)
  }
}

const map = {
  version: 1,
  project: {
    name: slug,
    root,
    edition: productKey?.includes('enterprise') ? 'Adobe Commerce' : 'Magento Open Source',
    magentoVersion: productKey ? req[productKey] : 'desconhecida',
    scannedAt: new Date().toISOString(),
    nativeReference: nativeRoot ? path.basename(nativeRoot) : null,
    moduleOrder,
    disabledModules,
  },
  modules: [...customModules, ...nativeModules].map(({ name, vendor, origin }) => ({ name, vendor, origin })),
  items: items.sort((a, b) => a.zone.localeCompare(b.zone) || a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title)),
}

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, `${slug}.json`), JSON.stringify(map, null, 1))

const indexFile = path.join(outDir, 'index.json')
const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : { maps: [] }
index.maps = [...index.maps.filter((m) => m.slug !== slug), { slug, name: slug, edition: map.project.edition, magentoVersion: map.project.magentoVersion }]
fs.writeFileSync(indexFile, JSON.stringify(index, null, 1))

// ---- summary ---------------------------------------------------------------

const tally = {}
for (const it of items) {
  const k = `${it.zone}`
  tally[k] ??= { custom: 0, thirdparty: 0, native: 0 }
  tally[k][it.origin]++
}
console.log(`${map.project.edition} ${map.project.magentoVersion} · ${customModules.length} módulos em app/code · ${nativeModules.length} nativos de referência`)
console.log(`${items.length} pontos de integração → ${path.relative(process.cwd(), path.join(outDir, slug + '.json'))}`)
console.table(tally)
const byKind = {}
for (const it of items) byKind[it.kind] = (byKind[it.kind] ?? 0) + 1
console.table(byKind)
