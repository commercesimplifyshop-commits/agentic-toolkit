import { Controller, Get } from '@nestjs/common'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../config/paths'
import { Action, ACTIONS } from '../readonly/actions'
import { AuditService } from '../readonly/audit.service'
import { CLAUDE_DENIED_TOOLS, CLAUDE_READONLY_TOOLS, CommandRunner } from '../readonly/command-runner.service'
import { assertWritableTarget, isSensitive, ReadOnlyViolation, resolveInside } from '../readonly/path-guard'
import { ReadOnlyFs } from '../readonly/readonly-fs.service'

interface Check {
  id: string
  label: string
  ok: boolean
  detail?: string
}

@Controller('system')
export class SystemController {
  constructor(
    private readonly audit: AuditService,
    private readonly runner: CommandRunner,
    private readonly rofs: ReadOnlyFs,
  ) {}

  @Get('health')
  @Action('system.health')
  health() {
    return { ok: true, dataDir: DATA_DIR, version: '0.2.0' }
  }

  @Get('rules')
  @Action('system.health')
  rules() {
    return {
      principle: 'StoreFlow nunca escreve no código Magento. Ele só lê; tudo o que grava fica no seu diretório de dados.',
      dataDir: DATA_DIR,
      actions: Object.entries(ACTIONS).map(([id, a]) => ({ id, kind: a.kind, methods: a.methods, description: a.description, validated: 'validate' in a })),
      claude: { allowedTools: CLAUDE_READONLY_TOOLS, deniedTools: CLAUDE_DENIED_TOOLS },
    }
  }

  @Get('audit')
  @Action('audit.list')
  auditLog() {
    return this.audit.list()
  }

  /** Each protection must reject what it is supposed to reject. */
  @Get('selftest')
  @Action('system.selftest')
  selftest() {
    const sandbox = path.join(DATA_DIR, 'cache', 'selftest')
    fs.mkdirSync(path.join(sandbox, 'app', 'etc'), { recursive: true })
    fs.writeFileSync(path.join(sandbox, 'app', 'etc', 'env.php'), "<?php return ['db' => 'secret'];")

    const expectBlocked = (id: string, label: string, fn: () => unknown): Check => {
      try {
        fn()
        return { id, label, ok: false, detail: 'não foi bloqueado' }
      } catch (err) {
        return { id, label, ok: err instanceof ReadOnlyViolation, detail: (err as Error).message }
      }
    }

    const checks: Check[] = [
      expectBlocked('path-traversal', 'Leitura fora da instalação (../) é bloqueada', () => resolveInside(sandbox, '../../etc/passwd')),
      expectBlocked('sensitive-read', 'Leitura de app/etc/env.php é bloqueada', () => this.rofs.read(sandbox, 'app/etc/env.php')),
      expectBlocked('write-outside', 'Escrita fora do diretório de dados é bloqueada', () => assertWritableTarget(path.resolve(DATA_DIR, '..', 'storeflow-escape'))),
      expectBlocked('write-magento', 'Escrita dentro de uma instalação Magento é bloqueada', () => assertWritableTarget(path.join(sandbox, 'app'), [sandbox])),
      expectBlocked('git-push', 'git push é bloqueado', () => this.runner.validate('git', ['push', 'origin', 'main'])),
      expectBlocked('git-commit', 'git commit é bloqueado', () => this.runner.validate('git', ['commit', '-m', 'x'])),
      expectBlocked('git-reset', 'git reset é bloqueado', () => this.runner.validate('git', ['reset', '--hard'])),
      expectBlocked('git-clone-local', 'Clone para fora do diretório de dados é bloqueado', () => this.runner.validate('git', ['clone', 'https://github.com/x/y.git', path.resolve(DATA_DIR, '..', 'x')])),
      expectBlocked('git-file-url', 'Clone de URL file:// é bloqueado', () => this.runner.validate('git', ['clone', 'file:///etc', path.join(DATA_DIR, 'repos', 'x')])),
      expectBlocked('shell', 'Comandos arbitrários (sh, rm, php) são bloqueados', () => this.runner.validate('rm', ['-rf', '/'])),
      expectBlocked('claude-write', 'Claude Code com Edit/Write/Bash é bloqueado', () => this.runner.validate('claude', ['-p', 'x', '--allowedTools', 'Read,Edit', '--disallowedTools', 'Write'])),
      expectBlocked('claude-bypass', 'Claude Code com --dangerously-skip-permissions é bloqueado', () =>
        this.runner.validate('claude', ['-p', 'x', '--allowedTools', 'Read', '--disallowedTools', 'Edit', '--dangerously-skip-permissions']),
      ),
      { id: 'sensitive-patterns', label: 'auth.json, .env e chaves são reconhecidos como sensíveis', ok: ['auth.json', '.env', 'id_rsa', 'app/etc/env.php'].every(isSensitive) },
      { id: 'no-write-api', label: 'A camada de leitura não expõe métodos de escrita', ok: !['write', 'writeFile', 'remove', 'rename', 'mkdir', 'unlink'].some((m) => m in this.rofs) },
      { id: 'all-routes-declared', label: 'Toda ação declarada tem método HTTP definido', ok: Object.values(ACTIONS).every((a) => a.methods.length > 0) },
    ]
    return { ok: checks.every((c) => c.ok), checks }
  }
}
