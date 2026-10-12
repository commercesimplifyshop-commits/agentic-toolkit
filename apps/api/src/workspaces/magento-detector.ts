import fs from 'node:fs'
import path from 'node:path'
import { ReadOnlyFs } from '../readonly/readonly-fs.service'

export interface DetectionCheck {
  id: string
  label: string
  ok: boolean
  weight: 'required' | 'strong' | 'hint'
  detail?: string
}

export interface Detection {
  path: string
  isMagento: boolean
  confidence: number
  edition?: string
  version?: string
  checks: DetectionCheck[]
  /** Subfolders that look like a Magento root (e.g. repo/magento2) */
  candidates: { path: string; relative: string; version?: string; edition?: string }[]
  vendors: { name: string; modules: number }[]
}

interface Composer {
  name?: string
  require?: Record<string, string>
  version?: string
}
interface ComposerLock {
  packages?: { name: string; version: string }[]
}

const PRODUCT = /^magento\/(product-(community|enterprise)-edition|magento2-base|magento-cloud-metapackage)$/

/** Edition + installed version, preferring composer.lock over composer.json constraints. */
export function readVersion(rofs: ReadOnlyFs, root: string): { edition?: string; version?: string } {
  const lock = rofs.readJson<ComposerLock>(root, 'composer.lock')
  const pkgs = lock?.packages ?? []
  const pick = (name: string) => pkgs.find((p) => p.name === name)?.version
  const enterprise = pick('magento/product-enterprise-edition')
  const community = pick('magento/product-community-edition') ?? pick('magento/magento2-base')
  if (enterprise) return { edition: 'Adobe Commerce', version: enterprise }
  if (community) return { edition: pkgs.some((p) => p.name.startsWith('magento/magento-cloud')) ? 'Adobe Commerce Cloud' : 'Magento Open Source', version: community }

  const composer = rofs.readJson<Composer>(root, 'composer.json')
  const req = composer?.require ?? {}
  const key = Object.keys(req).find((k) => PRODUCT.test(k))
  if (key) return { edition: key.includes('enterprise') ? 'Adobe Commerce' : 'Magento Open Source', version: req[key].replace(/^[\^~=v]/, '') }
  if (composer?.name === 'magento/magento2ce') return { edition: 'Magento Open Source (repositório do core)', version: composer.version }
  return {}
}

function checksFor(rofs: ReadOnlyFs, root: string): DetectionCheck[] {
  const composer = rofs.readJson<Composer>(root, 'composer.json')
  const req = composer?.require ?? {}
  const magentoDep = Object.keys(req).find((k) => PRODUCT.test(k) || k === 'magento/framework')
  const has = (rel: string) => rofs.exists(root, rel)
  return [
    { id: 'composer', label: 'composer.json presente', ok: has('composer.json'), weight: 'required' },
    {
      id: 'magento-dependency',
      label: 'composer.json depende do Magento',
      ok: Boolean(magentoDep) || composer?.name === 'magento/magento2ce',
      weight: 'strong',
      detail: magentoDep ? `${magentoDep} ${req[magentoDep]}` : composer?.name,
    },
    { id: 'bin-magento', label: 'bin/magento', ok: has('bin/magento'), weight: 'strong' },
    { id: 'config-php', label: 'app/etc/config.php (lista de módulos)', ok: has('app/etc/config.php'), weight: 'strong' },
    { id: 'app-etc-di', label: 'app/etc/di.xml', ok: has('app/etc/di.xml'), weight: 'hint' },
    { id: 'app-code', label: 'app/code (módulos do projeto)', ok: has('app/code'), weight: 'hint' },
    { id: 'composer-lock', label: 'composer.lock (versões exatas)', ok: has('composer.lock'), weight: 'hint' },
    { id: 'vendor', label: 'vendor/ instalado', ok: has('vendor/magento'), weight: 'hint', detail: has('vendor/magento') ? undefined : 'opcional: a análise usa a referência pública do core' },
  ]
}

const SKIP = new Set(['node_modules', 'vendor', '.git', 'generated', 'pub', 'var', 'dev', '.idea', 'setup', 'lib'])

/** Breadth-first search for folders that look like a Magento root. */
function findCandidates(rofs: ReadOnlyFs, root: string, maxDepth = 3) {
  const out: string[] = []
  const queue: [string, number][] = [['', 0]]
  while (queue.length && out.length < 10) {
    const [rel, depth] = queue.shift()!
    if (rel && rofs.exists(root, `${rel}/composer.json`) && (rofs.exists(root, `${rel}/bin/magento`) || rofs.exists(root, `${rel}/app/etc/config.php`))) {
      out.push(rel)
      continue
    }
    if (depth >= maxDepth) continue
    let entries: string[] = []
    try {
      entries = rofs.list(root, rel).filter((e) => e.type === 'dir' && !SKIP.has(e.name) && !e.name.startsWith('.')).map((e) => e.path)
    } catch {
      continue
    }
    for (const e of entries.slice(0, 200)) queue.push([e, depth + 1])
  }
  return out
}

export function vendorsOf(rofs: ReadOnlyFs, root: string) {
  if (!rofs.isDir(root, 'app/code')) return []
  return rofs
    .list(root, 'app/code')
    .filter((e) => e.type === 'dir')
    .map((v) => ({ name: v.name, modules: rofs.list(root, v.path).filter((m) => m.type === 'dir' && rofs.exists(root, `${m.path}/etc/module.xml`)).length }))
    .filter((v) => v.modules > 0)
}

export function detectMagento(rofs: ReadOnlyFs, dir: string): Detection {
  const root = path.resolve(dir)
  if (!fs.existsSync(root)) throw new Error(`Pasta não encontrada: ${root}`)
  const checks = checksFor(rofs, root)
  const score = checks.reduce((s, c) => s + (c.ok ? (c.weight === 'required' ? 2 : c.weight === 'strong' ? 3 : 1) : 0), 0)
  const max = checks.reduce((s, c) => s + (c.weight === 'required' ? 2 : c.weight === 'strong' ? 3 : 1), 0)
  const required = checks.filter((c) => c.weight === 'required').every((c) => c.ok)
  const strong = checks.filter((c) => c.weight === 'strong' && c.ok).length
  const isMagento = required && strong >= 2

  const candidates = isMagento
    ? []
    : findCandidates(rofs, root).map((rel) => ({ path: path.join(root, rel), relative: rel, ...readVersion(rofs, path.join(root, rel)) }))

  return {
    path: root,
    isMagento,
    confidence: Math.round((score / max) * 100),
    ...(isMagento ? readVersion(rofs, root) : {}),
    checks,
    candidates,
    vendors: isMagento ? vendorsOf(rofs, root) : [],
  }
}
