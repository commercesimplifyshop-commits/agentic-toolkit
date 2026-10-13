import fs from 'node:fs'
import path from 'node:path'
import { parseBulletin, parseIndex } from '../src/news/bulletin-parser'
import { impactOf, parseVersion } from '../src/news/version-match'
import { defaultDays } from '../src/news/news.service'
import { rowIsProduct } from '../src/news/security-bulletin.topic'

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'apsb26-92.html'), 'utf8')
const url = 'https://helpx.adobe.com/ca/security/products/magento/apsb26-92.html'
const bulletin = parseBulletin(fixture, url)

describe('Adobe bulletin parser', () => {
  it('reads the id, title, publication date and priority', () => {
    expect(bulletin.id).toBe('APSB26-92')
    expect(bulletin.title).toBe('Security update available for Adobe Commerce | APSB26-92')
    expect(bulletin.published).toBe('2026-08-11')
    expect(bulletin.priority).toBe(2)
  })

  it('reads every affected product and its versions, as Adobe writes them', () => {
    const commerce = bulletin.affected.find((r) => r.product === 'Adobe Commerce')
    expect(commerce?.versions[0]).toBe('2.4.9-2026-jul and earlier')
    expect(commerce?.versions).toHaveLength(6)
    expect(bulletin.affected.map((r) => r.product)).toEqual(expect.arrayContaining(['Adobe Commerce', 'Adobe Commerce B2B', 'Magento Open Source']))
  })

  it('keeps the installation page Adobe links for each product', () => {
    const commerce = bulletin.fixed.find((r) => r.product === 'Adobe Commerce')
    expect(commerce?.url).toMatch(/^https:\/\/experienceleague\.adobe\.com\//)
  })

  it('reads the updated versions that fix each line', () => {
    const commerce = bulletin.fixed.find((r) => r.product === 'Adobe Commerce')
    expect(commerce?.versions).toContain('2.4.9-2026-aug')
  })

  it('counts the severities and collects the CVEs', () => {
    expect(bulletin.severity.Critical ?? 0).toBeGreaterThanOrEqual(1)
    expect(bulletin.cves.length).toBeGreaterThan(0)
    expect(bulletin.cves[0]).toMatch(/^CVE-\d{4}-\d+$/)
  })

  it('finds the Commerce bulletins in the index, as absolute links without duplicates', () => {
    const index = `<a href="/ca/security/products/magento/apsb26-92.html">a</a><a href="/ca/security/products/magento/apsb26-92.html">b</a><a href="/ca/security/products/indesign/apsb26-145.html">c</a>`
    expect(parseIndex(index, 'https://helpx.adobe.com/ca/security/security-bulletin.html')).toEqual([url])
  })
})

describe('Version matching', () => {
  it('reads dated and patch versions and rejects anything else', () => {
    expect(parseVersion('2.4.9-2026-jul and earlier')).toEqual({ base: '2.4.9', suffix: '2026-jul' })
    expect(parseVersion('2.4.1-p1')).toEqual({ base: '2.4.1', suffix: 'p1' })
    expect(parseVersion('loja-ajustada')).toBeNull()
  })

  it('marks a dated release before the fix as affected, with the version to update to', () => {
    const r = impactOf('2.4.9-2026-jun', bulletin)
    expect(r.status).toBe('affected')
    expect(r.fixedIn).toBe('2.4.9-2026-aug')
  })

  it('marks a release already at or after the fix as not affected', () => {
    expect(impactOf('2.4.9-2026-aug', bulletin).status).toBe('not-affected')
    expect(impactOf('2.4.10', bulletin).status).toBe('not-affected')
  })

  it('treats a plain release as affected, since it predates every dated patch', () => {
    expect(impactOf('2.4.7', bulletin).status).toBe('affected')
  })

  it('asks for a manual check when it cannot be sure', () => {
    // 2.4.1 is below every line the bulletin lists: support must be checked, not assumed
    expect(impactOf('2.4.1-p1', bulletin).status).toBe('verify')
    // a patch number cannot be ordered against dated releases
    expect(impactOf('2.4.6-p3', bulletin).status).toBe('verify')
    expect(impactOf('versao-estranha', bulletin).status).toBe('verify')
  })
})

describe('Days shown by default', () => {
  // a fixed calendar: 2026-10-12 is a Monday, 2026-10-13 a Tuesday
  it('shows only today on a normal day', () => {
    expect(defaultDays(new Date(2026, 9, 13, 10))).toEqual(['2026-10-13'])
  })

  it('on Monday shows the weekend: Saturday and Sunday', () => {
    expect(defaultDays(new Date(2026, 9, 12, 8))).toEqual(['2026-10-10', '2026-10-11'])
  })
})

describe('Product rows', () => {
  it('reads a row that names several products, and keeps B2B apart from Commerce', () => {
    expect(rowIsProduct('Adobe Commerce and Magento Open Source', 'Adobe Commerce')).toBe(true)
    expect(rowIsProduct('Adobe Commerce and Magento Open Source', 'Magento Open Source')).toBe(true)
    expect(rowIsProduct('Adobe Commerce B2B', 'Adobe Commerce')).toBe(false)
  })
})
