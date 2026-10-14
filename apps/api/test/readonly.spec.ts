import { ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ANALYZER_DIR, DATA_DIR } from '../src/config/paths'
import { CodeIndexService } from '../src/files/code-index.service'
import { dataGetters, fieldName, findMethod } from '../src/apiclient/php-signature'
import { parseGraph } from '../src/diagrams/graph'
import { parseDelta, parseSpec, parseTasks } from '../src/openspec/openspec-parse'
import { checkRepoDelete, checkRepoWrite } from '../src/readonly/repo-exceptions'
import { RepoWriter, sha256 } from '../src/readonly/repo-writer.service'
import { ConflictException } from '@nestjs/common'
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

  it('allows git to write: branches, worktrees, commits and push', () => {
    const root = fakeMagento()
    expect(() => runner.validate('git', ['clone', '--depth', '1', 'https://github.com/acme/shop.git', clone])).not.toThrow()
    for (const sub of [['push', '-u', 'origin', 'feature/x'], ['commit', '-m', 'x'], ['worktree', 'add', '-b', 'feature/x', '../wt', 'main'], ['branch', '-D', 'old'], ['checkout', 'main'], ['fetch', 'origin'], ['pull', '--ff-only']]) {
      expect(() => runner.validate('git', ['-C', root, ...sub])).not.toThrow()
    }
  })

  it('still blocks the git options that run an arbitrary program, and file:// clones', () => {
    blocked(() => runner.validate('git', ['clone', 'file:///etc', clone]), 'cmd.git-url')
    blocked(() => runner.validate('git', ['clone', '--upload-pack=touch /tmp/pwn', 'https://x/y.git', clone]), 'cmd.git-flag')
    blocked(() => runner.validate('git', ['clone', '-u', 'touch /tmp/pwn', 'https://x/y.git', clone]), 'cmd.git-flag')
    blocked(() => runner.validate('git', ['-c', 'core.hooksPath=/tmp/h', 'clone', 'https://x/y.git', clone]), 'cmd.git-config')
    blocked(() => runner.validate('git', ['-c', 'core.sshCommand=touch /tmp/pwn', 'fetch']), 'cmd.git-config')
    blocked(() => runner.validate('git', ['fetch', '--upload-pack=touch /tmp/pwn']), 'cmd.git-flag')
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

  it('runs Claude Code headless, read-only or able to write (development sessions)', () => {
    expect(() => runner.validate('claude', claudeOk)).not.toThrow()
    expect(() => runner.validate('claude', ['-p', '--tools', 'Read,Grep,Glob,Edit,Write,Bash', '--allowedTools', 'Read,Grep,Glob,Edit,Write,Bash', '--permission-mode', 'acceptEdits'])).not.toThrow()
    blocked(() => runner.validate('claude', ['--tools', 'Read']), 'cmd.claude-headless')
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

  it('validates diagram requests', () => {
    const save = (diagramId: string, body: Record<string, unknown>) => () => guard.canActivate(ctx('diagrams.save', 'PUT', { params: { id: 'abc-123', diagramId }, body }))
    expect(save('c4-contexto-1a2b3c', { source: 'C4Context\n  Person(u, "Cliente")' })()).toBe(true)
    expect(save('c4-contexto-1a2b3c', { kind: 'uml', name: 'Classes' })()).toBe(true)
    expect(save('../../app', { source: 'x' })).toThrow(ForbiddenException)
    expect(save('c4-contexto-1a2b3c', { kind: 'script' })).toThrow(ForbiddenException)
    expect(save('c4-contexto-1a2b3c', { source: 'x'.repeat(200_001) })).toThrow(ForbiddenException)
    expect(save('c4-contexto-1a2b3c', { source: 42 })).toThrow(ForbiddenException)
  })

  it('validates model generation requests', () => {
    const gen = (body: Record<string, unknown>) => () => guard.canActivate(ctx('diagrams.generate', 'POST', { params: { id: 'abc-123' }, body }))
    expect(gen({ request: 'loja B2B com cotação', scenario: 'b2b', type: 'c4-container' })()).toBe(true)
    expect(gen({ request: 'ok', scenario: 'retail', type: 'c4-container' })).toThrow(ForbiddenException)
    expect(gen({ request: 'ok', scenario: 'b2c', type: 'bpmn' })).toThrow(ForbiddenException)
    expect(gen({ request: 'a', scenario: 'b2c', type: 'flow' })).toThrow(ForbiddenException)
    expect(gen({ request: 'x'.repeat(4001), scenario: 'b2c', type: 'flow' })).toThrow(ForbiddenException)
    expect(() => guard.canActivate(ctx('diagrams.cancel', 'POST', { params: { id: 'abc-123', jobId: '../../etc' } }))).toThrow(ForbiddenException)
    expect(guard.canActivate(ctx('diagrams.cancel', 'POST', { params: { id: 'abc-123', jobId: 'fdca85e6-6621-4a48-8d75-2b15a7b16808' } }))).toBe(true)
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

  it('rejects other protocols, credentials in the URL, bad methods/headers and Agentic Toolkit itself', () => {
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

describe('Canvas diagram graph (what the editor saves and Claude returns)', () => {
  const valid = {
    family: 'c4',
    nodes: [
      { id: 'loja', type: 'boundary', title: 'Loja' },
      { id: 'vitrine', type: 'container', title: 'Vitrine', tech: 'PHP', parent: 'loja', x: 32, y: 64 },
      { id: 'cliente', type: 'person', title: 'Cliente' },
    ],
    edges: [{ id: 'e1', source: 'cliente', target: 'vitrine', label: 'Compra', tech: 'HTTPS', dashed: true }],
  }

  it('accepts and normalizes a well formed graph', () => {
    const g = parseGraph(valid)
    expect(g.version).toBe(1)
    expect(g.nodes.find((n) => n.id === 'vitrine')).toMatchObject({ parent: 'loja', x: 32, y: 64, tech: 'PHP' })
    expect(parseGraph(JSON.stringify(valid)).edges[0]).toMatchObject({ label: 'Compra', dashed: true })
  })

  it('rejects unknown families and element types from the wrong family', () => {
    expect(() => parseGraph({ ...valid, family: 'uml' })).toThrow()
    expect(() => parseGraph({ ...valid, nodes: [{ id: 'a', type: 'decision', title: 'x' }], edges: [] })).toThrow()
  })

  it('rejects connections to missing elements and duplicated ids', () => {
    expect(() => parseGraph({ ...valid, edges: [{ id: 'e2', source: 'cliente', target: 'nada' }] })).toThrow()
    expect(() => parseGraph({ ...valid, nodes: [valid.nodes[0], valid.nodes[0]], edges: [] })).toThrow()
  })

  it('rejects ids and texts outside the limits, and malformed JSON', () => {
    expect(() => parseGraph({ ...valid, nodes: [{ id: '../x', type: 'person', title: 'x' }], edges: [] })).toThrow()
    expect(() => parseGraph({ ...valid, nodes: [{ id: 'a', type: 'person', title: 'x'.repeat(121) }], edges: [] })).toThrow()
    expect(() => parseGraph('{ nao é json')).toThrow()
    expect(() => parseGraph({ ...valid, nodes: [{ id: 'a', type: 'person', title: 'x', x: 1e9 }], edges: [] })).toThrow()
  })
})

describe('OpenSpec reading', () => {
  it('reads a spec: purpose, requirements and scenarios', () => {
    const md = `# Checkout Specification

## Purpose
Fluxo de finalização de compra do cliente na loja.

## Requirements

### Requirement: Pedido exige endereço
O sistema MUST exigir endereço.

#### Scenario: Endereço ausente
- **WHEN** sem endereço
- **THEN** erro

### Requirement: Sem cenário ainda
Texto.
`
    const parsed = parseSpec(md)
    expect(parsed.purpose).toBe('Fluxo de finalização de compra do cliente na loja.')
    expect(parsed.requirements.map((r) => [r.name, r.scenarios.length])).toEqual([
      ['Pedido exige endereço', 1],
      ['Sem cenário ainda', 0],
    ])
  })

  it('reads a delta: which requirements are added, modified or removed', () => {
    const md = `# Spec Delta

## ADDED Requirements

### Requirement: Pix como pagamento
Texto.

## MODIFIED Requirements

### Requirement: Pedido exige endereço
Texto.

## REMOVED Requirements

### Requirement: Cupom antigo
`
    expect(parseDelta(md)).toEqual({ added: ['Pix como pagamento'], modified: ['Pedido exige endereço'], removed: ['Cupom antigo'] })
  })

  it('counts tasks and keeps their groups', () => {
    const md = `# Tasks

## 1. Backend <!-- grupo -->

- [x] 1.1 Criar método Pix
- [ ] 1.2 Validar expiração

## 2. Front

- [X] 2.1 Exibir QR
`
    const t = parseTasks(md)
    expect(t.total).toBe(3)
    expect(t.done).toBe(2)
    expect(t.groups.map((g) => [g.title, g.tasks.length])).toEqual([
      ['1. Backend', 2],
      ['2. Front', 1],
    ])
  })
})

describe('OpenSpec CLI allowlist', () => {
  const runner = new CommandRunner()
  const entry = path.join('C:', 'Users', 'x', 'npm', 'node_modules', '@fission-ai', 'openspec', 'bin', 'openspec.js')
  const opts = { executable: entry, cwd: os.tmpdir() }

  it('allows read-only verbs', () => {
    for (const args of [['list', '--json'], ['status', '--change', 'add-pix', '--json'], ['show', 'checkout', '--type', 'spec', '--json'], ['validate', '--all', '--json', '--no-interactive'], ['--version']]) {
      expect(() => runner.validate('openspec', args, opts)).not.toThrow()
    }
  })

  it('refuses every verb that writes to the project', () => {
    for (const verb of ['update', 'archive', 'change', 'config', 'schema', 'store', 'workset', 'feedback', 'completion', 'spec']) {
      blocked(() => runner.validate('openspec', [verb], opts), 'cmd.openspec-verb')
    }
  })

  it('refuses --store (another repository) and unknown validate flags', () => {
    blocked(() => runner.validate('openspec', ['list', '--store', 'outro'], opts), 'cmd.openspec-store')
    blocked(() => runner.validate('openspec', ['validate', '--all', '--fix'], opts), 'cmd.openspec-flag')
  })

  it('only runs the OpenSpec package entry, never another script', () => {
    blocked(() => runner.validate('openspec', ['list'], { executable: path.join(os.tmpdir(), 'evil.js'), cwd: os.tmpdir() }), 'cmd.openspec-entry')
  })
})

describe('Repository write exceptions (OpenSpec)', () => {
  const allowed = (rel: string, dir = 'openspec') => checkRepoWrite('openspec', rel, dir).ok
  const reason = (rel: string, dir = 'openspec') => checkRepoWrite('openspec', rel, dir).reason ?? ''

  it('allows the OpenSpec tree and the Claude commands/skills it installs', () => {
    expect(allowed('openspec/config.yaml')).toBe(true)
    expect(allowed('openspec/specs/checkout/spec.md')).toBe(true)
    expect(allowed('openspec/changes/adicionar-pix/tasks.md')).toBe(true)
    expect(allowed('openspec/changes/archive/.gitkeep')).toBe(true)
    expect(allowed('docs/openspec/specs/pedido/spec.md', 'docs/openspec')).toBe(true)
    expect(allowed('.claude/commands/opsx/apply.md')).toBe(true)
    expect(allowed('.claude/skills/openspec-apply-change/SKILL.md')).toBe(true)
  })

  it('blocks everything else, including the application code and credentials', () => {
    for (const rel of ['app/etc/env.php', 'auth.json', 'composer.json', '.env', 'app/code/Vendor/Mod/etc/module.xml', 'CLAUDE.md', 'AGENTS.md', '.claude/settings.json', '.claude/commands/outro/x.md', '.claude/skills/outra/SKILL.md']) {
      expect(allowed(rel)).toBe(false)
    }
  })

  it('blocks path tricks and wrong extensions', () => {
    expect(allowed('openspec/../app/etc/env.php')).toBe(false)
    expect(allowed('/etc/passwd')).toBe(false)
    expect(allowed('C:/Windows/x.md')).toBe(false)
    expect(allowed('openspec/specs/x.php')).toBe(false)
    expect(reason('openspec/specs/x.php')).toMatch(/Extensão/)
    expect(allowed('openspec/../../x.md')).toBe(false)
  })

  it('writes through RepoWriter only inside the exception, with a version check', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-writer-'))
    const workspaces = { rootOf: () => root } as never
    const writer = new RepoWriter(workspaces, new AuditService())
    const base = { exception: 'openspec', openspecDir: 'openspec', action: 'test' }

    const created = writer.write('ws', { ...base, rel: 'openspec/specs/x/spec.md', content: 'v1', create: true })
    expect(created.created).toBe(true)
    expect(fs.readFileSync(path.join(root, 'openspec/specs/x/spec.md'), 'utf8')).toBe('v1')

    // A stale editor (old sha) must not overwrite
    expect(() => writer.write('ws', { ...base, rel: 'openspec/specs/x/spec.md', content: 'v2', create: false, expectedSha: sha256('antiga') })).toThrow(ConflictException)
    const ok = writer.write('ws', { ...base, rel: 'openspec/specs/x/spec.md', content: 'v2', create: false, expectedSha: created.sha })
    expect(ok.created).toBe(false)
    expect(fs.readFileSync(path.join(root, 'openspec/specs/x/spec.md'), 'utf8')).toBe('v2')

    // Outside the list: refused, nothing written
    expect(() => writer.write('ws', { ...base, rel: 'app/etc/env.php', content: 'x', create: true })).toThrow(ReadOnlyViolation)
    expect(fs.existsSync(path.join(root, 'app/etc/env.php'))).toBe(false)
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('runs OpenSpec init only in a staging folder inside the data dir', () => {
    const runner = new CommandRunner()
    const entry = path.join('C:', 'x', 'node_modules', '@fission-ai', 'openspec', 'bin', 'openspec.js')
    const staging = path.join(DATA_DIR, 'workspaces', 'ws', 'staging', 'install-1')
    expect(() => runner.validate('openspec', ['init', '--tools', 'claude', '.'], { executable: entry, cwd: staging })).not.toThrow()
    blocked(() => runner.validate('openspec', ['init', '--tools', 'claude', '.'], { executable: entry, cwd: os.tmpdir() }), 'cmd.openspec-init-cwd')
    blocked(() => runner.validate('openspec', ['init', '--tools', 'claude', '--force', '.'], { executable: entry, cwd: staging }), 'cmd.openspec-init-args')
  })
})

describe('OpenSpec removal (exception)', () => {
  const del = (rel: string, dir = 'openspec') => checkRepoDelete('openspec', rel, dir).ok

  it('allows removing files of an active change', () => {
    expect(del('openspec/changes/adicionar-pix/proposal.md')).toBe(true)
    expect(del('openspec/changes/adicionar-pix/specs/checkout/spec.md')).toBe(true)
    expect(del('docs/openspec/changes/x/tasks.md', 'docs/openspec')).toBe(true)
  })

  it('never removes archived changes, main specs, config or code', () => {
    expect(del('openspec/changes/archive/2026-10-01-inicial/proposal.md')).toBe(false)
    expect(del('openspec/specs/checkout/spec.md')).toBe(false)
    expect(del('openspec/config.yaml')).toBe(false)
    expect(del('app/code/Vendor/Mod/Model/X.php')).toBe(false)
    expect(del('openspec/changes/../specs/x.md')).toBe(false)
  })
})

