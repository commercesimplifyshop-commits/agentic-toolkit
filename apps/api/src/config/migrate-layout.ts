import fs from 'node:fs'
import path from 'node:path'
import { CORE_DIR, DATA_DIR, techDirs } from './paths'

/**
 * Moves the first version's flat layout into core/ and techs/adobe-commerce/.
 * It only COPIES: the old folders stay where they were as a backup. It runs once, and only when
 * the new core/workspaces.json does not exist yet. The store is written last, so a migration that
 * was interrupted runs again on the next start.
 */
export function migrateLayout(log: (message: string) => void) {
  const legacyStore = path.join(DATA_DIR, 'workspaces.json')
  const coreStore = path.join(CORE_DIR, 'workspaces.json')
  if (!fs.existsSync(legacyStore) || fs.existsSync(coreStore)) return

  const adobe = techDirs('adobe-commerce')
  const legacyRepos = path.join(DATA_DIR, 'repos')
  const legacyUploads = path.join(DATA_DIR, 'uploads')

  const copyDir = (from: string, to: string) => {
    if (!fs.existsSync(from) || fs.existsSync(to)) return
    fs.cpSync(from, to, { recursive: true })
  }
  const copyFile = (from: string, to: string) => {
    if (!fs.existsSync(from) || fs.existsSync(to)) return
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
  }

  copyDir(path.join(DATA_DIR, 'workspaces'), adobe.workspaces)
  copyDir(path.join(DATA_DIR, 'reference'), adobe.reference)
  copyDir(path.join(DATA_DIR, 'cache'), adobe.cache)
  copyDir(legacyRepos, adobe.repos)
  copyDir(legacyUploads, adobe.uploads)
  copyFile(path.join(DATA_DIR, 'audit.log'), path.join(CORE_DIR, 'audit.log'))
  copyFile(path.join(DATA_DIR, 'settings.json'), path.join(CORE_DIR, 'settings.json'))

  // a clone or extraction lives in the old folder: point it at the copy
  const relocate = (p?: string) => {
    if (!p) return p
    if (p.startsWith(legacyRepos)) return path.join(adobe.repos, path.relative(legacyRepos, p))
    if (p.startsWith(legacyUploads)) return path.join(adobe.uploads, path.relative(legacyUploads, p))
    return p
  }

  const legacy = JSON.parse(fs.readFileSync(legacyStore, 'utf8')) as Array<Record<string, unknown>>
  const migrated = legacy.map((ws) => {
    const { magentoRoot, ...rest } = ws
    return {
      ...rest,
      tech: 'adobe-commerce',
      root: (rest.root as string | undefined) ?? (magentoRoot as string | undefined),
      checkoutDir: relocate(rest.checkoutDir as string | undefined),
    }
  })
  fs.mkdirSync(CORE_DIR, { recursive: true })
  fs.writeFileSync(coreStore, JSON.stringify(migrated, null, 2))
  log(`Dados da primeira versão copiados para techs/adobe-commerce (${migrated.length} instalação(ões)). Os originais foram mantidos.`)
}
