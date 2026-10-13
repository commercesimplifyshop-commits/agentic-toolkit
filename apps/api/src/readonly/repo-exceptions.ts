import path from 'node:path'
import { isSensitive } from './path-guard'

/**
 * Exceptions to the read-only rule. The rule still holds for everything else:
 * a path is writable only when an exception below lists it, the exception's
 * extensions match, and it is not a credential file. Each write is confirmed in
 * the UI and recorded in the audit log by the RepoWriter, the only class allowed
 * to write into a Magento repository.
 *
 * Adding an exception is a decision for the team: change this list and the tests.
 */
export interface RepoWriteException {
  id: string
  owner: string
  description: string
  /** Paths are relative to the Magento root. {openspec} is the mapped OpenSpec folder. */
  rules: { pattern: RegExp; extensions: string[]; note: string }[]
  /** Paths that may be removed (a subset of rules). Empty = removal never allowed. */
  deleteRules: RegExp[]
  maxBytes: number
}

const kebab = '[a-z0-9][a-z0-9-]*'

export const REPO_WRITE_EXCEPTIONS: RepoWriteException[] = [
  {
    id: 'openspec',
    owner: 'Dashboard OpenSpec',
    description: 'Instalar, criar e editar specs, mudanças e tarefas do OpenSpec',
    rules: [
      // The OpenSpec tree itself (specs, changes, archive, config). {openspec} is replaced at check time.
      { pattern: /^\{openspec\}\/.+$/, extensions: ['.md', '.yaml', '.yml', '.gitkeep'], note: 'pasta do OpenSpec' },
      // Commands and skills that `openspec init --tools claude` installs for Claude Code
      { pattern: new RegExp(`^\\.claude/commands/opsx/${kebab}\\.md$`), extensions: ['.md'], note: 'comandos /opsx do Claude' },
      { pattern: new RegExp(`^\\.claude/skills/openspec-${kebab}/SKILL\\.md$`), extensions: ['.md'], note: 'skills do OpenSpec para o Claude' },
    ],
    // Removal only inside an active change folder: changes/archive is never removed
    deleteRules: [/^\{openspec\}\/changes\/(?!archive\/)[a-z0-9][a-z0-9-]*\/.+$/],
    maxBytes: 512 * 1024,
  },
]

/** Removal is stricter than writing: the path must match a deleteRule and also be writable under the exception. */
export function checkRepoDelete(exceptionId: string, rel: string, openspecDir: string): ExceptionCheck {
  const exception = REPO_WRITE_EXCEPTIONS.find((e) => e.id === exceptionId)
  if (!exception) return { ok: false, reason: `Exceção "${exceptionId}" não existe` }
  const writable = checkRepoWrite(exceptionId, rel, openspecDir)
  if (!writable.ok) return writable
  const clean = rel.replace(/\\/g, '/')
  const allowed = exception.deleteRules.some((re) => new RegExp(re.source.replace('\\{openspec\\}', escapeRe(openspecDir))).test(clean))
  return allowed ? { ok: true, exception } : { ok: false, reason: 'Só é possível excluir arquivos de uma mudança ativa (não do archive nem das specs)' }
}

export interface ExceptionCheck {
  ok: boolean
  exception?: RepoWriteException
  reason?: string
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Decides whether a repository-relative path may be written under an exception. */
export function checkRepoWrite(exceptionId: string, rel: string, openspecDir: string): ExceptionCheck {
  const exception = REPO_WRITE_EXCEPTIONS.find((e) => e.id === exceptionId)
  if (!exception) return { ok: false, reason: `Exceção "${exceptionId}" não existe` }
  const clean = rel.replace(/\\/g, '/')
  if (!clean || clean.startsWith('/') || /^[A-Za-z]:/.test(clean) || clean.split('/').some((seg) => seg === '..' || seg === '')) {
    return { ok: false, reason: 'Caminho fora da instalação' }
  }
  if (path.posix.normalize(clean) !== clean) return { ok: false, reason: 'Caminho não normalizado' }
  if (isSensitive(clean)) return { ok: false, reason: 'Arquivo sensível (credenciais) nunca é gravado' }
  for (const r of exception.rules) {
    const pattern = new RegExp(r.pattern.source.replace('\\{openspec\\}', escapeRe(openspecDir)))
    if (!pattern.test(clean)) continue
    const ext = path.posix.extname(clean) || (clean.endsWith('.gitkeep') ? '.gitkeep' : '')
    if (!r.extensions.includes(ext)) return { ok: false, reason: `Extensão ${ext || '(sem extensão)'} não é permitida para ${r.note}` }
    return { ok: true, exception }
  }
  return { ok: false, reason: `"${clean}" não está na lista de exceções de escrita (${exception.owner})` }
}
