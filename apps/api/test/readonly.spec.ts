import { ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ANALYZER_DIR, DATA_DIR } from '../src/config/paths'
import { CodeIndexService } from '../src/files/code-index.service'
import { dataGetters, fieldName, findMethod } from '../src/apiclient/php-signature'
import { ACTION_KEY } from '../src/readonly/actions'
import { AuditService } from '../src/readonly/audit.service'
import { CLAUDE_DOCS_BUILTINS, CLAUDE_DOCS_DENIED, CLAUDE_DOCS_TOOLS, CommandRunner } from '../src/readonly/command-runner.service'
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

  const docsOk = ['-p', '--tools', CLAUDE_DOCS_BUILTINS.join(','), '--allowedTools', CLAUDE_DOCS_TOOLS.join(','), '--disallowedTools', CLAUDE_DOCS_DENIED.join(','), '--setting-sources', 'user']
  const docsCwd = path.join(DATA_DIR, 'workspaces', 'x', 'docs', 'publish')

  it('publishes to Claude Docs only with the connector, no code tools, from the data dir', () => {
    const root = fakeMagento()
    expect(() => runner.validate('claude-docs', docsOk, { cwd: docsCwd, protectedRoots: [root] })).not.toThrow()
    blocked(() => runner.validate('claude-docs', docsOk.map((a) => (a === CLAUDE_DOCS_BUILTINS.join(',') ? 'Artifact,Read' : a)), { cwd: docsCwd }), 'cmd.claude-docs-tools')
    blocked(() => runner.validate('claude-docs', docsOk.map((a) => (a === CLAUDE_DOCS_TOOLS.join(',') ? `${a},mcp__claude_ai_Claude_Docs__delete` : a)), { cwd: docsCwd }), 'cmd.claude-docs-tools')
    blocked(() => runner.validate('claude-docs', docsOk.map((a) => (a === CLAUDE_DOCS_TOOLS.join(',') ? `${a},mcp__claude_ai_Vercel__create_deployment` : a)), { cwd: docsCwd }), 'cmd.claude-docs-tools')
    blocked(() => runner.validate('claude-docs', [...docsOk, '--add-dir', root], { cwd: docsCwd }), 'cmd.claude-bypass')
    blocked(() => runner.validate('claude-docs', docsOk, { cwd: root, protectedRoots: [root] }))
    blocked(() => runner.validate('claude-docs', docsOk), 'cmd.claude-docs-cwd')
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

  it('validates documentation requests', () => {
    const gen = (body: Record<string, unknown>) => () => guard.canActivate(ctx('docs.generate', 'POST', { params: { id: 'abc-123' }, body }))
    expect(gen({ kind: 'modulo', subject: 'Acme_Refund' })()).toBe(true)
    expect(gen({ kind: 'script', subject: 'x y' })).toThrow(ForbiddenException)
    expect(gen({ kind: 'fluxo', subject: '' })).toThrow(ForbiddenException)
    expect(gen({ kind: 'tema', subject: 'ERP', regenerate: '../../etc' })).toThrow(ForbiddenException)
    expect(() => guard.canActivate(ctx('docs.export', 'GET', { params: { id: 'abc-123', docId: 'acme-1a2b3c' }, query: { format: 'exe' } }))).toThrow(ForbiddenException)
    expect(() => guard.canActivate(ctx('docs.get', 'GET', { params: { id: 'abc-123', docId: '..' } }))).toThrow(ForbiddenException)
  })

  it('validates whiteboard requests', () => {
    const save = (boardId: string, body: Record<string, unknown>) => () => guard.canActivate(ctx('boards.save', 'PUT', { params: { id: 'abc-123', boardId }, body }))
    expect(save('quadro-1a2b3c', { scene: { elements: [], files: {} } })()).toBe(true)
    expect(save('quadro-1a2b3c', { name: 'Arquitetura do checkout' })()).toBe(true)
    expect(save('../../app', { scene: { elements: [] } })).toThrow(ForbiddenException)
    expect(save('quadro-1a2b3c', { scene: { elements: 'x' } })).toThrow(ForbiddenException)
    expect(save('quadro-1a2b3c', { name: 'x'.repeat(200) })).toThrow(ForbiddenException)
    expect(() => guard.canActivate(ctx('boards.save', 'POST', { params: { id: 'abc-123', boardId: 'quadro-1a2b3c' }, body: {} }))).toThrow(ForbiddenException)
  })

  it('runs the action validator', () => {
    expect(() => guard.canActivate(ctx('files.read', 'GET', { params: { id: 'abc-123' }, query: { path: 'app/etc/env.php' } }))).toThrow(ForbiddenException)
    expect(() => guard.canActivate(ctx('files.read', 'GET', { params: { id: 'abc-123' }, query: { path: '../secret' } }))).toThrow(ForbiddenException)
    expect(guard.canActivate(ctx('files.read', 'GET', { params: { id: 'abc-123' }, query: { path: 'composer.json' } }))).toBe(true)
  })
})

describe('API simulator', () => {
  const audit = new AuditService()
  const guard = new ReadOnlyGuard(new Reflector(), audit, { get: () => ({ rootOf: () => '/x' }) } as never)
  const send = (body: Record<string, unknown>) => {
    const handler = () => undefined
    Reflect.defineMetadata(ACTION_KEY, 'apiclient.send', handler)
    const req = { method: 'POST', originalUrl: '/api/x', params: { id: 'abc-123' }, query: {}, body: { method: 'GET', ...body } }
    return () => guard.canActivate({ getHandler: () => handler, switchToHttp: () => ({ getRequest: () => req }) } as never)
  }

  it('accepts http(s) requests to the chosen environment', () => {
    expect(send({ url: 'https://loja.test/rest/default/V1/orders', method: 'POST', body: '{}', headers: { Authorization: 'Bearer x' } })()).toBe(true)
  })

  it('rejects other protocols, credentials in the URL, bad methods/headers and StoreFlow itself', () => {
    expect(send({ url: 'file:///etc/passwd' })).toThrow(ForbiddenException)
    expect(send({ url: 'https://admin:pw@loja.test/' })).toThrow(ForbiddenException)
    expect(send({ url: 'https://loja.test/', method: 'TRACE' })).toThrow(ForbiddenException)
    expect(send({ url: 'https://loja.test/', headers: { 'Bad Header\n': 'x' } })).toThrow(ForbiddenException)
    expect(send({ url: 'http://127.0.0.1:4310/api/workspaces' })).toThrow(ForbiddenException)
    expect(send({ url: 'https://loja.test/', body: { not: 'a string' } })).toThrow(ForbiddenException)
  })

  it('reads method signatures and Data interface getters', () => {
    const src = `<?php
namespace Vendor\\Mod\\Api;
use Magento\\Quote\\Api\\Data\\AddressInterface as Address;
interface PayInterface {
    /**
     * Pays the cart
     * @param int $cartId
     * @param \\Magento\\Quote\\Api\\Data\\PaymentInterface $paymentMethod
     * @param Address|null $billingAddress
     * @return int
     */
    public function savePaymentInformation($cartId, $paymentMethod, Address $billingAddress = null);
    /** @return string|null */
    public function getCustomerEmail();
    /** @return bool */
    public function isDefaultShipping();
    /** @return \\Magento\\Quote\\Api\\Data\\AddressExtensionInterface|null */
    public function getExtensionAttributes();
}`
    const m = findMethod(src, 'savePaymentInformation')
    expect(m?.summary).toBe('Pays the cart')
    expect(m?.params.map((p) => [p.name, p.type])).toEqual([
      ['cartId', 'int'],
      ['paymentMethod', 'Magento\\Quote\\Api\\Data\\PaymentInterface'],
      ['billingAddress', 'Magento\\Quote\\Api\\Data\\AddressInterface'],
    ])
    expect(dataGetters(src).map((g) => g.field)).toEqual(['customer_email', 'default_shipping'])
    expect(fieldName('getRegionId')).toBe('region_id')
    expect(fieldName('getIsActive')).toBe('is_active')
    expect(fieldName('hasGiftMessage')).toBe('gift_message')
  })
})

describe('Code index (Go to File / Find in Files)', () => {
  const root = fakeMagento()
  const plugin = path.join(root, 'app', 'code', 'Acme', 'Checkout', 'Plugin')
  fs.mkdirSync(plugin, { recursive: true })
  fs.writeFileSync(
    path.join(plugin, 'QuotePlugin.php'),
    '<?php\nnamespace Acme\\Checkout\\Plugin;\n\nfinal class QuotePlugin\n{\n    public function aroundPlace($subject, callable $proceed) { return $proceed(); }\n    // placeOrder replaced\n}\n',
  )
  fs.mkdirSync(path.join(root, 'vendor', 'magento'), { recursive: true })
  fs.writeFileSync(path.join(root, 'vendor', 'magento', 'Big.php'), '<?php // aroundPlace in vendor')
  const index = new CodeIndexService(new ReadOnlyFs())

  it('lists project files without vendor/', () => {
    const files = index.files(root)
    expect(files).toContain('app/code/Acme/Checkout/Plugin/QuotePlugin.php')
    expect(files.some((f) => f.startsWith('vendor/'))).toBe(false)
  })

  it('indexes PHP classes by FQCN', async () => {
    expect(await index.classes(root)).toContainEqual({ fqcn: 'Acme\\Checkout\\Plugin\\QuotePlugin', path: 'app/code/Acme/Checkout/Plugin/QuotePlugin.php', kind: 'class' })
  })

  it('finds text with case, whole word, regex, scope and mask options', async () => {
    expect((await index.find(root, { query: 'aroundplace' })).matches).toHaveLength(1)
    expect((await index.find(root, { query: 'aroundplace', caseSensitive: true })).matches).toHaveLength(0)
    expect((await index.find(root, { query: 'place', wholeWord: true })).matches).toHaveLength(0)
    expect((await index.find(root, { query: 'around\\w+\\(', regex: true })).matches[0]).toMatchObject({ line: 6, col: 20 })
    expect((await index.find(root, { query: 'aroundPlace', mask: '*.xml' })).matches).toHaveLength(0)
    expect((await index.find(root, { query: 'aroundPlace', scope: 'vendor' })).matches.map((m) => m.file)).toEqual(['vendor/magento/Big.php'])
  })

  it('never searches credential files', async () => {
    expect((await index.find(root, { query: 'secret' })).matches).toHaveLength(0)
  })

  it('rejects invalid regex as a rule violation', async () => {
    await expect(index.find(root, { query: '(unclosed', regex: true })).rejects.toMatchObject({ rule: 'input.regex' })
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
