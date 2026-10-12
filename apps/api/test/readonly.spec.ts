import { ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ANALYZER_DIR, DATA_DIR } from '../src/config/paths'
import { ACTION_KEY } from '../src/readonly/actions'
import { AuditService } from '../src/readonly/audit.service'
import { CommandRunner } from '../src/readonly/command-runner.service'
import { assertWritableTarget, isSensitive, ReadOnlyViolation, resolveInside } from '../src/readonly/path-guard'
import { ReadOnlyGuard } from '../src/readonly/readonly.guard'
import { ReadOnlyFs } from '../src/readonly/readonly-fs.service'
import { detectMagento } from '../src/workspaces/magento-detector'

const tmp = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`))

/** A minimal fake Magento install outside the data dir */
function fakeMagento() {
  const root = tmp('magento')
  fs.mkdirSync(path.join(root, 'app', 'etc'), { recursive: true })
  fs.mkdirSync(path.join(root, 'bin'))
  fs.mkdirSync(path.join(root, 'app', 'code', 'Acme', 'Checkout', 'etc'), { recursive: true })
  fs.writeFileSync(path.join(root, 'composer.json'), JSON.stringify({ require: { 'magento/product-community-edition': '2.4.7-p3' } }))
  fs.writeFileSync(path.join(root, 'bin', 'magento'), '#!/usr/bin/env php')
  fs.writeFileSync(path.join(root, 'app', 'etc', 'config.php'), "<?php return ['modules' => ['Magento_Store' => 1, 'Acme_Checkout' => 1]];")
  fs.writeFileSync(path.join(root, 'app', 'etc', 'env.php'), "<?php return ['db' => ['password' => 'secret']];")
  fs.writeFileSync(path.join(root, 'app', 'code', 'Acme', 'Checkout', 'etc', 'module.xml'), '<config><module name="Acme_Checkout"/></config>')
  return root
}

const blocked = (fn: () => unknown, rule?: string) => {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(ReadOnlyViolation)
    if (rule) expect((err as ReadOnlyViolation).rule).toBe(rule)
    return
  }
  throw new Error('esperava bloqueio, mas passou')
}

describe('path guard', () => {
  const root = fakeMagento()

  it('resolves paths inside the installation', () => {
    expect(resolveInside(root, 'app/etc/config.php')).toBe(fs.realpathSync.native(path.join(root, 'app/etc/config.php')))
  })

  it('blocks traversal and absolute escapes', () => {
    blocked(() => resolveInside(root, '../../etc/passwd'), 'path.traversal')
    blocked(() => resolveInside(root, path.resolve(os.tmpdir())), 'path.traversal')
  })

  it('blocks symlinks pointing outside the installation', () => {
    const outside = tmp('outside')
    try {
      fs.symlinkSync(outside, path.join(root, 'escape'), 'junction')
    } catch {
      return // symlinks not permitted on this machine: nothing to test
    }
    blocked(() => resolveInside(root, 'escape'), 'path.symlink-escape')
  })

  it('recognizes credential files as sensitive', () => {
    for (const f of ['app/etc/env.php', 'auth.json', '.env', '.env.local', 'id_rsa', 'certs/key.pem', '.git/config']) expect(isSensitive(f)).toBe(true)
    for (const f of ['app/etc/config.php', 'composer.json', 'app/code/Acme/Checkout/etc/di.xml']) expect(isSensitive(f)).toBe(false)
  })

  it('only allows writes inside the data dir and never inside Magento', () => {
    expect(() => assertWritableTarget(path.join(DATA_DIR, 'maps', 'x.json'))).not.toThrow()
    blocked(() => assertWritableTarget(path.join(root, 'app', 'etc', 'config.php')), 'write.outside-data-dir')
    blocked(() => assertWritableTarget(path.join(DATA_DIR, 'repos', 'x', 'app'), [path.join(DATA_DIR, 'repos', 'x')]), 'write.inside-magento')
  })
})

describe('ReadOnlyFs', () => {
  const root = fakeMagento()
  const rofs = new ReadOnlyFs()

  it('reads regular files and refuses sensitive ones', () => {
    expect(rofs.read(root, 'composer.json').content).toContain('magento')
    blocked(() => rofs.read(root, 'app/etc/env.php'), 'read.sensitive-file')
  })

  it('lists sensitive files without exposing them', () => {
    const env = rofs.list(root, 'app/etc').find((e) => e.name === 'env.php')
    expect(env?.sensitive).toBe(true)
  })

  it('exposes no write operations', () => {
    for (const m of ['write', 'writeFile', 'remove', 'rm', 'rename', 'mkdir', 'unlink', 'chmod']) expect((rofs as unknown as Record<string, unknown>)[m]).toBeUndefined()
  })

  it('never returns env.php content through grep', () => {
    expect(rofs.grep(root, 'secret').some((m) => m.file.includes('env.php'))).toBe(false)
  })
})

describe('CommandRunner allowlist', () => {
  const runner = new CommandRunner()
  const clone = path.join(DATA_DIR, 'repos', 'abc')

  it('allows read-only git and clones into the data dir', () => {
    expect(() => runner.validate('git', ['clone', '--depth', '1', 'https://github.com/acme/shop.git', clone])).not.toThrow()
    expect(() => runner.validate('git', ['-C', clone, 'log', '-1'])).not.toThrow()
    expect(() => runner.validate('git', ['-C', clone, 'remote', 'set-url', '--push', 'origin', 'DISABLED'])).not.toThrow()
  })

  it('blocks git commands that write to a repository', () => {
    for (const sub of [['push', 'origin', 'main'], ['commit', '-m', 'x'], ['reset', '--hard'], ['merge', 'x'], ['rebase', 'x'], ['tag', 'v1'], ['rm', 'a'], ['clean', '-fd'], ['apply', 'x.patch'], ['config', 'user.name', 'x']]) {
      blocked(() => runner.validate('git', sub), 'cmd.git-subcommand')
    }
    blocked(() => runner.validate('git', ['remote', 'add', 'evil', 'https://x']), 'cmd.git-remote')
    blocked(() => runner.validate('git', ['branch', '-D', 'main']), 'cmd.git-branch')
  })

  it('blocks clones outside the data dir and dangerous URLs', () => {
    blocked(() => runner.validate('git', ['clone', 'https://github.com/acme/shop.git', path.join(os.tmpdir(), 'x')]), 'write.outside-data-dir')
    blocked(() => runner.validate('git', ['clone', 'file:///etc', clone]), 'cmd.git-url')
    blocked(() => runner.validate('git', ['clone', '--upload-pack=touch /tmp/pwn', 'https://x/y.git', clone]), 'cmd.git-flag')
    blocked(() => runner.validate('git', ['-c', 'core.hooksPath=/tmp/h', 'clone', 'https://x/y.git', clone]), 'cmd.git-config')
  })

  it('blocks fetch/checkout in a local Magento folder', () => {
    const root = fakeMagento()
    blocked(() => runner.validate('git', ['-C', root, 'fetch']), 'write.outside-data-dir')
    blocked(() => runner.validate('git', ['-C', root, 'checkout', 'main']), 'write.outside-data-dir')
  })

  it('only runs the analyzer scripts, writing to the data dir', () => {
    const root = fakeMagento()
    expect(() => runner.validate('node', [path.join(ANALYZER_DIR, 'extract.mjs'), root, '--out', path.join(DATA_DIR, 'w', 'maps')], { protectedRoots: [root] })).not.toThrow()
    blocked(() => runner.validate('node', [path.join(ANALYZER_DIR, 'extract.mjs'), root, '--out', path.join(root, 'maps')], { protectedRoots: [root] }))
    blocked(() => runner.validate('node', ['-e', 'require("fs").rmSync("/")']), 'cmd.node-script')
  })

  it('rejects any other program', () => {
    for (const cmd of ['sh', 'bash', 'cmd', 'powershell', 'php', 'rm', 'composer']) blocked(() => runner.validate(cmd, []), 'cmd.not-allowed')
  })

  const claudeOk = ['-p', '--tools', 'Read,Grep,Glob', '--allowedTools', 'Read,Grep,Glob', '--disallowedTools', 'Edit,MultiEdit,Write,NotebookEdit,Bash,WebFetch,WebSearch', '--setting-sources', 'user', '--strict-mcp-config']

  it('runs Claude Code only with read-only tools and without repo settings', () => {
    expect(() => runner.validate('claude', claudeOk)).not.toThrow()
    blocked(() => runner.validate('claude', claudeOk.map((a) => (a === 'Read,Grep,Glob' ? 'Read,Edit' : a))), 'cmd.claude-tools')
    blocked(() => runner.validate('claude', claudeOk.filter((a) => a !== '--strict-mcp-config')), 'cmd.claude-mcp')
    blocked(() => runner.validate('claude', claudeOk.map((a) => (a === 'user' ? 'user,project' : a))), 'cmd.claude-settings')
    blocked(() => runner.validate('claude', [...claudeOk, '--dangerously-skip-permissions']), 'cmd.claude-bypass')
    blocked(() => runner.validate('claude', [...claudeOk, '--permission-mode', 'bypassPermissions']), 'cmd.claude-bypass')
  })

  it('only lets Claude Code read extra folders inside the data dir', () => {
    expect(() => runner.validate('claude', [...claudeOk, '--add-dir', path.join(DATA_DIR, 'workspaces', 'x', 'maps')])).not.toThrow()
    blocked(() => runner.validate('claude', [...claudeOk, '--add-dir', os.homedir()]), 'write.outside-data-dir')
  })
})

describe('ReadOnlyGuard', () => {
  const audit = new AuditService()
  const guard = new ReadOnlyGuard(new Reflector(), audit, { get: () => ({ rootOf: () => '/x' }) } as never)
  const ctx = (action: string | undefined, method = 'GET', extra: Record<string, unknown> = {}) => {
    const handler = () => undefined
    if (action) Reflect.defineMetadata(ACTION_KEY, action, handler)
    const req = { method, originalUrl: '/api/x', params: {}, query: {}, body: {}, ...extra }
    return { getHandler: () => handler, switchToHttp: () => ({ getRequest: () => req }) } as never
  }

  it('fails closed on routes without a declared action', () => {
    expect(() => guard.canActivate(ctx(undefined))).toThrow(ForbiddenException)
    expect(audit.list()[0]).toMatchObject({ verdict: 'blocked', rule: 'route.undeclared' })
  })

  it('rejects HTTP methods an action does not declare', () => {
    expect(() => guard.canActivate(ctx('overview.get', 'DELETE', { params: { id: 'abc-123' } }))).toThrow(ForbiddenException)
  })

  it('runs the action validator', () => {
    expect(() => guard.canActivate(ctx('files.read', 'GET', { params: { id: 'abc-123' }, query: { path: 'app/etc/env.php' } }))).toThrow(ForbiddenException)
    expect(() => guard.canActivate(ctx('files.read', 'GET', { params: { id: 'abc-123' }, query: { path: '../secret' } }))).toThrow(ForbiddenException)
    expect(guard.canActivate(ctx('files.read', 'GET', { params: { id: 'abc-123' }, query: { path: 'composer.json' } }))).toBe(true)
  })
})

describe('Magento detector', () => {
  const rofs = new ReadOnlyFs()

  it('recognizes an installation and its version', () => {
    const d = detectMagento(rofs, fakeMagento())
    expect(d.isMagento).toBe(true)
    expect(d.version).toBe('2.4.7-p3')
    expect(d.vendors).toEqual([{ name: 'Acme', modules: 1 }])
  })

  it('finds Magento in a subfolder of a repository', () => {
    const repo = tmp('repo')
    fs.renameSync(fakeMagento(), path.join(repo, 'magento2'))
    const d = detectMagento(rofs, repo)
    expect(d.isMagento).toBe(false)
    expect(d.candidates.map((c) => c.relative)).toEqual(['magento2'])
  })

  it('rejects a non-Magento project', () => {
    const other = tmp('node-app')
    fs.writeFileSync(path.join(other, 'composer.json'), JSON.stringify({ require: { 'laravel/framework': '^11' } }))
    expect(detectMagento(rofs, other).isMagento).toBe(false)
  })
})
