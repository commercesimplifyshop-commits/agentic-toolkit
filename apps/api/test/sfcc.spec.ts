import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ReadOnlyFs } from '../src/readonly/readonly-fs.service'
import { detectSfcc } from '../src/techs/sfcc/detector'
import { sfccOverview } from '../src/techs/sfcc/overview'
import { detectTech } from '../src/techs/detect'
import { TECHS } from '../src/techs/registry'
import { TECH_IDS } from '../src/config/paths'

const SECRET = 'S3cr3t-do-not-show'

/** A small Salesforce B2C project: an SFRA cartridge, a legacy pipeline cartridge, a job, a site and attributes */
function sfccProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfcc-'))
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), content)
  }
  write('package.json', JSON.stringify({ name: 'storefront', devDependencies: { 'sgmf-scripts': '2.4.0' } }))
  write('dw.json', JSON.stringify({ hostname: 'shop-dev.example.com', 'code-version': 'version_1', username: 'deployer', password: SECRET }))
  write(
    'cartridges/app_custom/cartridge/controllers/Product.js',
    "server.get('Show', function (req, res, next) { next() })\nserver.post('AddToCart', function (req, res, next) { next() })\nserver.append('Show', function () {})\n",
  )
  write('cartridges/app_custom/cartridge/templates/default/product/pdp.isml', '<div/>')
  write('cartridges/app_custom/cartridge/templates/default/cart/mini.isml', '<div/>')
  write('cartridges/app_custom/cartridge/scripts/services.js', "var svc = LocalServiceRegistry.createService('ocapi.shop', {})\n")
  write('cartridges/app_custom/hooks.json', JSON.stringify({ hooks: [{ name: 'dw.ocapi.shop.product.afterGET', script: './scripts/hooks.js' }] }))
  write('cartridges/app_custom/.project', '<projectDescription/>')
  write('cartridges/app_legacy/cartridge/controllers/Old.ds', 'function Show() {}\nfunction _private() {}\n')
  write('jobs/import.xml', '<jobs><job job-id="ImportCatalog"><step step-id="s1"/></job></jobs>')
  write('sites/RefArch/site.xml', '<site site-id="RefArch"/>')
  write(
    'meta/system-objecttype-extensions.xml',
    '<metadata><type-extension type-id="Product"><custom-attributes><attribute-definition attribute-id="brandNote"/><attribute-definition attribute-id="ean2"/></custom-attributes></type-extension></metadata>',
  )
  return root
}

describe('Salesforce B2C detection', () => {
  it('recognises a project with cartridges and dw.json, and reports the storefront', () => {
    const root = sfccProject()
    try {
      const d = detectSfcc(new ReadOnlyFs(), root)
      expect(d.tech).toBe('salesforce-b2c')
      expect(d.match).toBe(true)
      expect(d.checks.find((c) => c.id === 'storefront')?.detail).toBe('SFRA')
      expect(d.confidence).toBeGreaterThanOrEqual(90)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not match an ordinary folder, and finds the project one level down', () => {
    const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'outer-'))
    try {
      expect(detectSfcc(new ReadOnlyFs(), outer).match).toBe(false)
      fs.cpSync(sfccProject(), path.join(outer, 'storefront'), { recursive: true })
      const d = detectTech('salesforce-b2c', new ReadOnlyFs(), outer)
      expect(d.match).toBe(false)
      expect(d.candidates.map((c) => c.relative)).toEqual(['storefront'])
    } finally {
      fs.rmSync(outer, { recursive: true, force: true })
    }
  })
})

describe('Salesforce B2C overview', () => {
  it('describes cartridges, routes, templates, hooks, jobs, integrations, sites and attributes', () => {
    const root = sfccProject()
    try {
      const o = sfccOverview(new ReadOnlyFs(), root, 'storefront')
      expect(o.counts.cartridges).toBe(2)
      expect(o.counts.templates).toBe(2)
      expect(o.counts.routes).toBe(4) // Show, AddToCart, Show (append), and the legacy Show pipeline
      expect(o.controllers.find((c) => c.kind === 'sfra')?.routes.map((r) => r.name)).toEqual(['Show', 'AddToCart', 'Show'])
      expect(o.controllers.find((c) => c.kind === 'pipeline')?.routes.map((r) => r.name)).toEqual(['Show'])
      expect(o.counts.pipelines).toBe(1)
      expect(o.hooks).toEqual([{ cartridge: 'app_custom', name: 'dw.ocapi.shop.product.afterGET', script: './scripts/hooks.js' }])
      expect(o.services).toEqual(['ocapi.shop'])
      expect(o.jobs).toEqual([{ id: 'ImportCatalog', file: 'jobs/import.xml' }])
      expect(o.sites).toEqual(['RefArch'])
      expect(o.attributes).toEqual([{ type: 'Product', count: 2 }])
      expect(o.storefront.type).toBe('SFRA')
      expect(o.instance.hostname).toBe('shop-dev.example.com')
      expect(o.instance.codeVersion).toBe('version_1')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('flags stored credentials as critical and never returns their values', () => {
    const root = sfccProject()
    try {
      const o = sfccOverview(new ReadOnlyFs(), root, 'storefront')
      expect(o.instance.credentialsInRepo).toBe(true)
      expect(o.highlights.some((h) => h.level === 'critical')).toBe(true)
      expect(JSON.stringify(o)).not.toContain(SECRET)
      expect(JSON.stringify(o)).not.toContain('deployer')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Technology registry', () => {
  it('lists every supported technology with a detector and a name', () => {
    expect(TECHS.map((t) => t.id).sort()).toEqual([...TECH_IDS].sort())
    for (const t of TECHS) expect(t.name.length).toBeGreaterThan(3)
  })
})
