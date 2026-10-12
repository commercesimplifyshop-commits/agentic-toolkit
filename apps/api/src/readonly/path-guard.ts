import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../config/paths'

export class ReadOnlyViolation extends Error {
  constructor(
    message: string,
    readonly rule: string,
  ) {
    super(message)
  }
}

/**
 * Files that may hold credentials. They are listed (so engineers know they exist)
 * but their content is never returned.
 */
const SENSITIVE = [
  /(^|\/)app\/etc\/env\.php$/i,
  /(^|\/)auth\.json$/i,
  /(^|\/)\.env(\..*)?$/i,
  /(^|\/)\.git\/config$/i,
  /(^|\/)\.git-credentials$/i,
  /(^|\/)id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.htpasswd$/i,
  /(^|\/)\.magento\.env\.yaml$/i,
]

export const isSensitive = (relPath: string) => SENSITIVE.some((re) => re.test(relPath.split(path.sep).join('/')))

const isInside = (parent: string, child: string) => {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Resolves `relPath` inside `root`, following symlinks, and refuses anything
 * that escapes the root (../, absolute paths, symlinks pointing outside).
 */
export function resolveInside(root: string, relPath = ''): string {
  if (relPath.includes('\0')) throw new ReadOnlyViolation('Caminho inválido', 'path.null-byte')
  const realRoot = fs.realpathSync.native(root)
  const candidate = path.resolve(realRoot, relPath)
  if (!isInside(realRoot, candidate)) throw new ReadOnlyViolation(`Fora da instalação: ${relPath}`, 'path.traversal')
  let real = candidate
  try {
    real = fs.realpathSync.native(candidate)
  } catch {
    // Not existing yet is fine for a check; reads will fail later with ENOENT
  }
  if (!isInside(realRoot, real)) throw new ReadOnlyViolation(`Link simbólico aponta para fora da instalação: ${relPath}`, 'path.symlink-escape')
  return real
}

/** Destinations StoreFlow may write to: only inside its own data directory. */
export function assertWritableTarget(target: string, protectedRoots: string[] = []) {
  const resolved = path.resolve(target)
  if (!isInside(DATA_DIR, resolved)) {
    throw new ReadOnlyViolation(`Escrita fora do diretório de dados do StoreFlow bloqueada: ${resolved}`, 'write.outside-data-dir')
  }
  for (const root of protectedRoots) {
    if (isInside(path.resolve(root), resolved)) {
      throw new ReadOnlyViolation(`Escrita dentro da instalação Magento bloqueada: ${resolved}`, 'write.inside-magento')
    }
  }
}

/** A Magento root must not contain the data dir, otherwise our outputs would land in the project. */
export function assertDataDirOutside(magentoRoot: string) {
  if (isInside(path.resolve(magentoRoot), DATA_DIR)) {
    throw new ReadOnlyViolation('O diretório de dados do StoreFlow não pode ficar dentro da instalação Magento', 'write.data-dir-inside-magento')
  }
}

export { isInside }
