import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Everything StoreFlow writes (clones, uploads, maps, annotations, audit log)
 * lives here, and only here. Magento code is never written to.
 */
export const DATA_DIR = path.resolve(process.env.STOREFLOW_DATA ?? path.join(os.homedir(), '.storeflow'))

export const DIRS = {
  repos: path.join(DATA_DIR, 'repos'),
  uploads: path.join(DATA_DIR, 'uploads'),
  workspaces: path.join(DATA_DIR, 'workspaces'),
  reference: path.join(DATA_DIR, 'reference'),
  cache: path.join(DATA_DIR, 'cache'),
}

export function ensureDataDirs() {
  for (const dir of [DATA_DIR, ...Object.values(DIRS)]) fs.mkdirSync(dir, { recursive: true })
}

/** packages/analyzer, resolved from node_modules (workspace link) */
export const ANALYZER_DIR = path.dirname(require.resolve('@storeflow/analyzer/package.json'))

export const HOST = process.env.STOREFLOW_HOST ?? '127.0.0.1'
export const PORT = Number(process.env.STOREFLOW_PORT ?? 4310)
