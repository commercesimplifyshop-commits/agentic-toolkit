import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Everything Agentic Toolkit writes lives under DATA_DIR, and nowhere else. The client code it
 * reads is never written to. Layout:
 *
 *   core/                       workspaces.json, audit.log, settings.json (shared by every technology)
 *   staging/                    uploads received before their technology is known
 *   techs/<technology>/         repos/, uploads/, workspaces/<id>/, reference/, cache/
 *
 * Each technology keeps its own copies, so Adobe Commerce and Salesforce B2C data never mix.
 */
export const DATA_DIR = path.resolve(process.env.AGENTIC_TOOLKIT_DATA ?? path.join(os.homedir(), '.agentic-toolkit'))
export const CORE_DIR = path.join(DATA_DIR, 'core')
export const STAGING_DIR = path.join(DATA_DIR, 'staging')

export const TECH_IDS = ['adobe-commerce', 'salesforce-b2c'] as const
export type TechId = (typeof TECH_IDS)[number]
export const DEFAULT_TECH: TechId = 'adobe-commerce'

export const isTechId = (v: unknown): v is TechId => typeof v === 'string' && (TECH_IDS as readonly string[]).includes(v)

/** Folders owned by one technology */
export function techDirs(tech: TechId) {
  const base = path.join(DATA_DIR, 'techs', tech)
  return {
    base,
    repos: path.join(base, 'repos'),
    uploads: path.join(base, 'uploads'),
    workspaces: path.join(base, 'workspaces'),
    reference: path.join(base, 'reference'),
    cache: path.join(base, 'cache'),
  }
}

export function ensureDataDirs() {
  fs.mkdirSync(CORE_DIR, { recursive: true })
  fs.mkdirSync(STAGING_DIR, { recursive: true })
  for (const tech of TECH_IDS) {
    for (const dir of Object.values(techDirs(tech))) fs.mkdirSync(dir, { recursive: true })
  }
}

/** packages/analyzer, resolved from node_modules (workspace link) */
export const ANALYZER_DIR = path.dirname(require.resolve('@agentic-toolkit/analyzer/package.json'))

export const HOST = process.env.AGENTIC_TOOLKIT_HOST ?? '127.0.0.1'
export const PORT = Number(process.env.AGENTIC_TOOLKIT_PORT ?? 4310)
