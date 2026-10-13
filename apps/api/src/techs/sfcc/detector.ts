import path from 'node:path'
import type { ReadOnlyFs } from '../../readonly/readonly-fs.service'
import type { Detection, DetectionCheck } from '../types'

export interface Storefront {
  type: 'SFRA' | 'PWA Kit' | 'Personalizado'
  detail?: string
}

/** Storefront flavour from package.json: SFRA projects depend on sgmf-scripts, PWA Kit on its runtime. */
export function storefrontOf(rofs: ReadOnlyFs, root: string): Storefront {
  const pkg = rofs.readJson<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(root, 'package.json')
  const deps: Record<string, string> = { ...(pkg?.devDependencies ?? {}), ...(pkg?.dependencies ?? {}) }
  if (deps['sgmf-scripts']) return { type: 'SFRA', detail: `sgmf-scripts ${deps['sgmf-scripts']}` }
  const pwa = Object.keys(deps).find((k) => k.startsWith('@salesforce/pwa-kit'))
  if (pwa) return { type: 'PWA Kit', detail: `${pwa} ${deps[pwa]}` }
  return { type: 'Personalizado' }
}

/** Cartridge folders under cartridges/ that really are cartridges (they have a cartridge/ folder). */
export function cartridgesOf(rofs: ReadOnlyFs, root: string): string[] {
  if (!rofs.isDir(root, 'cartridges')) return []
  return rofs
    .list(root, 'cartridges')
    .filter((e) => e.type === 'dir' && rofs.isDir(root, `cartridges/${e.name}/cartridge`))
    .map((e) => e.name)
}

/**
 * Salesforce B2C Commerce detection. Reads only; a folder matches when it has cartridges and at
 * least one sign of a live project (dw.json or ISML templates).
 */
export function detectSfcc(rofs: ReadOnlyFs, dir: string): Detection {
  const cartridges = cartridgesOf(rofs, dir)
  const hasDw = rofs.exists(dir, 'dw.json')
  const hasIsml = cartridges.some((c) => rofs.walk(dir, `cartridges/${c}/cartridge/templates`, { maxFiles: 300 }).some((f) => f.endsWith('.isml')))
  const storefront = storefrontOf(rofs, dir)

  const checks: DetectionCheck[] = [
    { id: 'cartridges', label: 'pasta cartridges/ com cartuchos (cada um com cartridge/)', ok: cartridges.length > 0, weight: 'required', detail: cartridges.length ? `${cartridges.length} cartucho(s)` : undefined },
    { id: 'dw', label: 'dw.json (ligação com a instância)', ok: hasDw, weight: 'strong' },
    { id: 'isml', label: 'templates ISML', ok: hasIsml, weight: 'strong' },
    { id: 'storefront', label: 'storefront SFRA ou PWA Kit', ok: storefront.type !== 'Personalizado', weight: 'hint', detail: storefront.type },
  ]
  const confidence = (cartridges.length ? 50 : 0) + (hasDw ? 20 : 0) + (hasIsml ? 20 : 0) + (storefront.type !== 'Personalizado' ? 10 : 0)

  // one level down: a repo that keeps the storefront in a subfolder
  const candidates = rofs
    .list(dir)
    .filter((e) => e.type === 'dir' && !e.name.startsWith('.') && e.name !== 'node_modules')
    .map((e) => ({ root: path.join(dir, e.name), name: e.name }))
    .filter((c) => cartridgesOf(rofs, c.root).length > 0)
    .map((c) => ({ path: c.root, relative: c.name, edition: 'Salesforce B2C Commerce' }))

  return {
    tech: 'salesforce-b2c',
    path: dir,
    match: cartridges.length > 0 && (hasDw || hasIsml),
    confidence,
    edition: 'Salesforce B2C Commerce',
    checks,
    candidates,
    vendors: [],
  }
}
