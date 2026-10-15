import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { refineProfile } from '../src/refine/profiles'
import { RefineService } from '../src/refine/refine.service'
import type { AuditService } from '../src/readonly/audit.service'
import { CLAUDE_DENIED_TOOLS, CommandRunner } from '../src/readonly/command-runner.service'
import { ReadOnlyFs } from '../src/readonly/readonly-fs.service'
import { sfccOverview } from '../src/techs/sfcc/overview'
import { summarize } from '../src/techs/sfcc/sfcc.service'
import { SfccUploadService } from '../src/techs/sfcc/upload.service'
import type { WorkspacesService } from '../src/workspaces/workspaces.service'

const SECRET = 'S3nha-da-sandbox-nao-mostrar'
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/** A fake dwupload: prints what it got, whether dw.json is next to it and (to test the redaction) the password */
const FAKE_DWUPLOAD = `
const fs = require('fs')
const args = process.argv.slice(2)
const dw = fs.existsSync('dw.json') ? JSON.parse(fs.readFileSync('dw.json', 'utf8')) : null
console.log('args: ' + args.join(' '))
console.log('dw.json no cwd: ' + (dw ? 'sim' : 'nao'))
if (dw) console.log('conectando como ' + dw.username + ':' + dw.password)
if (args[0] === 'watch') { console.log('Watching'); setInterval(() => {}, 1000) } else { console.log('Successfully uploaded cartridge'); process.exit(dw ? 0 : 1) }
`

/** An SFRA project in git: dw.json ignored, two cartridges, one of them changed, and the project's dwupload */
function project({ ignoreDw = true } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sfra-')))
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), content)
  }
  write('package.json', JSON.stringify({ name: 'sfra', scripts: { lint: 'sgmf-scripts --lint js', test: 'sgmf-scripts --test test/unit/**/*.js', watch: 'sgmf-scripts --watch', uploadCartridge: 'sgmf-scripts --uploadCartridge app_custom' }, devDependencies: { 'sgmf-scripts': '^3.0.0' } }))
  write('.gitignore', ignoreDw ? 'node_modules\ndw.json\n' : 'node_modules\n')
  write('dw.json', JSON.stringify({ hostname: 'zzzz-001.dx.commercecloud.salesforce.com', username: 'dev@example.com', password: SECRET, 'code-version': 'version_dev' }))
  write('cartridges/app_custom/cartridge/controllers/Cart.js', "var server = require('server');\nserver.extend(module.superModule);\nmodule.exports = server.exports();\n")
  write('cartridges/app_storefront_base/cartridge/controllers/Cart.js', "var server = require('server');\n")
  write('sites/RefArch/site.xml', '<site site-id="RefArch"><custom-cartridges>app_custom:app_storefront_base</custom-cartridges></site>')
  write('node_modules/dwupload/index.js', FAKE_DWUPLOAD)
  sh(root, 'init', '-q', '-b', 'main')
  sh(root, 'config', 'user.email', 'test@example.com')
  sh(root, 'config', 'user.name', 'Test')
  sh(root, 'add', '.')
  sh(root, 'commit', '-q', '-m', 'inicial')
  write('cartridges/app_custom/cartridge/scripts/frete.js', 'module.exports = {}\n')
  return root
}

function uploadService(root: string) {
  const ws = { id: 'w', tech: 'salesforce-b2c', root, name: 'sfra' }
  const workspaces = { get: () => ws } as unknown as WorkspacesService
  const refine = { get: () => { throw new Error('sem card') } } as unknown as RefineService
  const audit = { record: jest.fn() } as unknown as AuditService
  return { svc: new SfccUploadService(workspaces, refine, new CommandRunner(), audit), audit }
}

async function finished(svc: SfccUploadService) {
  for (let i = 0; i < 100; i++) {
    const s = await svc.status('w')
    if (s.run && s.run.status !== 'executando') return s.run
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('o upload não terminou')
}

describe('Refinamento para Salesforce B2C (perfil)', () => {
  it('keeps the Adobe Commerce prompts and gives SFCC its own, with the guide always on', () => {
    const adobe = refineProfile('adobe-commerce')
    const sfcc = refineProfile('salesforce-b2c')
    expect(adobe.learning).toBe(false)
    expect(adobe.stance).toContain('app/etc/env.php')
    expect(adobe.devRules({ scripts: {}, hasNodeModules: false }).join(' ')).toContain('php -l')
    expect(sfcc.learning).toBe(true)
    expect(sfcc.stance).toContain('Para quem vem do Adobe')
    expect(sfcc.stance).toContain('server.extend(module.superModule)')
    expect(sfcc.rules).toContain('"platformSteps"')
    expect(sfcc.rules).toContain('"learning"')
    expect(sfcc.stance).not.toContain('app/etc/env.php')
  })

  it('tells the development session which checks the project really has', () => {
    const rules = refineProfile('salesforce-b2c').devRules({ scripts: { lint: 'x', test: 'y' }, hasNodeModules: false }).join('\n')
    expect(rules).toContain('`npm run lint`')
    expect(rules).toContain('não rode npm install')
    expect(rules).not.toContain('php -l')
    expect(rules).toContain('Não faça upload')
  })

  it('keeps the Business Manager steps and only documentation links in the guide', () => {
    const svc = new RefineService(...([null, null, null, null, null, null, null, null] as unknown as ConstructorParameters<typeof RefineService>))
    const sanitize = (svc as unknown as { sanitize: (r: Record<string, unknown>, l: boolean) => { platformSteps?: string[]; learning?: { docs: { url: string }[] }[] } }).sanitize.bind(svc)
    const raw = {
      technical: 't',
      plan: ['a'],
      platformSteps: ['Criar a site preference freteGratisMinimo em Merchant Tools → Site Preferences'],
      learning: [
        { topic: 'Hooks', adobe: 'observer', sfcc: 'hooks.json', why: 'todos rodam', docs: [{ title: 'Hooks', url: 'https://developer.salesforce.com/docs/commerce/b2c-commerce/guide/b2c-hooks.html' }, { title: 'x', url: 'https://evil.example.com/a' }, { title: 'y', url: 'javascript:alert(1)' }] },
        { topic: '', sfcc: 'sem tópico' },
      ],
    }
    const card = sanitize(raw, true)
    expect(card.platformSteps).toHaveLength(1)
    expect(card.learning).toHaveLength(1)
    expect(card.learning![0].docs.map((d) => d.url)).toEqual(['https://developer.salesforce.com/docs/commerce/b2c-commerce/guide/b2c-hooks.html'])
    const adobe = sanitize(raw, false)
    expect(adobe.platformSteps).toBeUndefined()
    expect(adobe.learning).toBeUndefined()
  })

  it('gives Claude the structure of the project, cartridge path included', () => {
    const root = project()
    try {
      const text = summarize(sfccOverview(new ReadOnlyFs(), root, 'sfra'))
      expect(text).toContain('Cartridge path do site RefArch: app_custom:app_storefront_base')
      expect(text).toContain('app_custom')
      expect(text).not.toContain(SECRET)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('denies Claude the credential files', () => {
    expect(CLAUDE_DENIED_TOOLS).toContain('Read(**/dw.json)')
  })
})

describe('Upload para a instância (dwupload)', () => {
  it('only runs the project dwupload, from cartridges/, with --cartridge names', () => {
    const r = new CommandRunner()
    const exe = path.join('C:', 'p', 'node_modules', 'dwupload', 'index.js')
    const cwd = path.join('C:', 'p', 'cartridges')
    expect(() => r.validate('dwupload', ['--cartridge', 'app_custom'], { executable: exe, cwd })).not.toThrow()
    expect(() => r.validate('dwupload', ['watch', '--cartridge', 'a', '--cartridge', 'b'], { executable: exe, cwd })).not.toThrow()
    expect(() => r.validate('dwupload', ['--cartridge', 'app_custom', '--password', 'x'], { executable: exe, cwd })).toThrow()
    expect(() => r.validate('dwupload', ['--cartridge', '../x'], { executable: exe, cwd })).toThrow()
    expect(() => r.validate('dwupload', ['--cartridge', 'a'], { executable: path.join('C:', 'evil.js'), cwd })).toThrow()
    expect(() => r.validate('dwupload', ['--cartridge', 'a'], { executable: exe, cwd: path.join('C:', 'p') })).toThrow()
  })

  it('explains the tools, shows dw.json without credentials and checks the changed cartridges', async () => {
    const root = project()
    const { svc } = uploadService(root)
    try {
      const s = await svc.status('w')
      expect(JSON.stringify(s)).not.toContain(SECRET)
      expect(JSON.stringify(s)).not.toContain('dev@example.com')
      expect(s.dw).toMatchObject({ found: true, hostname: 'zzzz-001.dx.commercecloud.salesforce.com', codeVersion: 'version_dev', hasUsername: true, hasPassword: true })
      expect(s.dwupload).toBe(true)
      expect(s.tools.map((t) => t.id)).toEqual(expect.arrayContaining(['sgmf-watch', 'sgmf-upload', 'dwupload']))
      expect(s.cartridges[0]).toMatchObject({ name: 'app_custom', changed: 1 })
      expect(s.cartridges.find((c) => c.name === 'app_storefront_base')?.changed).toBe(0)
      expect(svc.prerequisites('w').every((p) => p.ok)).toBe(true)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('uploads with dw.json next to the cartridges only while it runs, and never shows the password', async () => {
    const root = project()
    const { svc, audit } = uploadService(root)
    try {
      await svc.start('w', { cartridges: ['app_custom'] })
      const run = await finished(svc)
      const log = run.log.map((l) => l.text).join('\n')
      expect(run.status).toBe('concluido')
      expect(log).toContain('args: --cartridge app_custom')
      expect(log).toContain('dw.json no cwd: sim')
      expect(log).not.toContain(SECRET)
      expect(log).not.toContain('dev@example.com')
      expect(fs.existsSync(path.join(root, 'cartridges', 'dw.json'))).toBe(false)
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'external', action: 'sfcc.upload.run' }))
      await expect(svc.start('w', { cartridges: ['nao_existe'] })).rejects.toThrow()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('runs the automatic upload until it is stopped, one at a time', async () => {
    const root = project()
    const { svc } = uploadService(root)
    try {
      await svc.start('w', { cartridges: ['app_custom'], mode: 'watch' })
      await expect(svc.start('w', { cartridges: ['app_custom'] })).rejects.toThrow('Já há um upload')
      for (let i = 0; i < 50 && !(await svc.status('w')).run!.log.some((l) => l.text.includes('Watching')); i++) await new Promise((r) => setTimeout(r, 100))
      expect(fs.existsSync(path.join(root, 'cartridges', 'dw.json'))).toBe(true)
      expect(svc.stop('w')).toEqual({ stopped: true })
      const run = await finished(svc)
      expect(run.status).toBe('parado')
      expect(fs.existsSync(path.join(root, 'cartridges', 'dw.json'))).toBe(false)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses when .gitignore does not ignore dw.json, so the copy never reaches a commit', async () => {
    const root = project({ ignoreDw: false })
    const { svc } = uploadService(root)
    try {
      await expect(svc.start('w', { cartridges: ['app_custom'] })).rejects.toThrow('.gitignore')
      expect(fs.existsSync(path.join(root, 'cartridges', 'dw.json'))).toBe(false)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
