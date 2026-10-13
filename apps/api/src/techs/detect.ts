import type { TechId } from '../config/paths'
import type { ReadOnlyFs } from '../readonly/readonly-fs.service'
import { detectMagento } from '../workspaces/magento-detector'
import { detectSfcc } from './sfcc/detector'
import type { Detection } from './types'

/** Runs the detector of one technology. Read-only. */
export function detectTech(tech: TechId, rofs: ReadOnlyFs, dir: string): Detection {
  if (tech === 'salesforce-b2c') return detectSfcc(rofs, dir)
  const d = detectMagento(rofs, dir)
  return {
    tech: 'adobe-commerce',
    path: d.path,
    match: d.isMagento,
    confidence: d.confidence,
    edition: d.edition,
    version: d.version,
    checks: d.checks,
    candidates: d.candidates,
    vendors: d.vendors,
  }
}
