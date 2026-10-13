import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { AuditService } from './audit.service'
import { checkRepoDelete, checkRepoWrite } from './repo-exceptions'
import { ReadOnlyViolation, resolveInside } from './path-guard'
import { WorkspacesService } from '../workspaces/workspaces.service'

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/**
 * The ONLY class that writes into a Magento repository, and only for paths listed in
 * repo-exceptions.ts. Every call is checked, optimistic-locked (expectedSha), written
 * atomically and recorded in the audit log with the path and size, never the content.
 */
@Injectable()
export class RepoWriter {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly audit: AuditService,
  ) {}

  private blocked(action: string, rel: string, reason: string, rule: string): never {
    this.audit.record({ action, kind: 'repo-exception', method: 'WRITE', url: rel, verdict: 'blocked', rule, detail: reason })
    throw new ReadOnlyViolation(reason, rule)
  }

  /** Removes one file of an active change, then its now-empty folders. Audited per file. */
  remove(workspaceId: string, input: { exception: string; rel: string; openspecDir: string; action: string }) {
    const root = this.workspaces.rootOf(workspaceId)
    const check = checkRepoDelete(input.exception, input.rel, input.openspecDir)
    if (!check.ok) this.blocked(input.action, input.rel, check.reason ?? 'Bloqueado', 'exception.delete-not-listed')
    const file = resolveInside(root, input.rel)
    if (!fs.existsSync(file)) return
    if (fs.lstatSync(file).isSymbolicLink()) this.blocked(input.action, input.rel, 'Links simbólicos não são removidos', 'exception.symlink')
    fs.unlinkSync(file)
    // Empty folders left behind, never climbing above the change folder itself
    let dir = path.dirname(file)
    const changeRoot = path.join(root, input.openspecDir, 'changes')
    while (dir.startsWith(changeRoot + path.sep) && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir)
      dir = path.dirname(dir)
    }
    this.audit.record({ action: input.action, kind: 'repo-exception', method: 'DELETE', url: input.rel, verdict: 'allowed', detail: `removido · exceção ${input.exception}` })
  }

  /**
   * Creates (create=true) or replaces a file. For replacements, expectedSha must be the
   * sha the editor loaded; a different sha means someone else changed the file meanwhile.
   */
  write(
    workspaceId: string,
    input: { exception: string; rel: string; content: string; openspecDir: string; create: boolean; expectedSha?: string; action: string },
  ): { sha: string; bytes: number; created: boolean } {
    const root = this.workspaces.rootOf(workspaceId)
    const check = checkRepoWrite(input.exception, input.rel, input.openspecDir)
    if (!check.ok || !check.exception) this.blocked(input.action, input.rel, check.reason ?? 'Bloqueado', 'exception.not-listed')

    const bytes = Buffer.byteLength(input.content, 'utf8')
    if (bytes > check.exception.maxBytes) this.blocked(input.action, input.rel, `Arquivo maior que ${check.exception.maxBytes / 1024} KB`, 'exception.size')

    const file = resolveInside(root, input.rel) // realpath check: no link or ".." can leave the root
    const exists = fs.existsSync(file)
    if (exists && fs.lstatSync(file).isSymbolicLink()) this.blocked(input.action, input.rel, 'Links simbólicos não são gravados', 'exception.symlink')

    if (exists) {
      if (input.create) throw new ConflictException(`Já existe: ${input.rel}`)
      const current = fs.readFileSync(file, 'utf8')
      if (input.expectedSha !== undefined && sha256(current) !== input.expectedSha) {
        throw new ConflictException('O arquivo mudou desde que você abriu. Recarregue antes de salvar, para não sobrescrever a outra alteração.')
      }
    } else if (!input.create) {
      throw new NotFoundException(`Não existe: ${input.rel}`)
    }

    fs.mkdirSync(path.dirname(file), { recursive: true })
    // Atomic replace: an interrupted save never leaves a half-written spec
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
    fs.writeFileSync(tmp, input.content, 'utf8')
    fs.renameSync(tmp, file)

    this.audit.record({ action: input.action, kind: 'repo-exception', method: 'WRITE', url: input.rel, verdict: 'allowed', detail: `${exists ? 'alterado' : 'criado'} · ${bytes} bytes · exceção ${input.exception}` })
    return { sha: sha256(input.content), bytes, created: !exists }
  }
}
