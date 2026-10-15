import fs from 'node:fs'
import path from 'node:path'
import { divTables, parseBulletin, parseCaasIndex, parseIndex } from '../src/news/bulletin-parser'
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

describe('Adobe Trust Center (bulletins since 2026)', () => {
  const trustUrl = 'https://www.adobe.com/trust/security/products/commerce/apsb26-92'
  const page = parseBulletin(fs.readFileSync(path.join(__dirname, 'fixtures', 'apsb26-92-trust.html'), 'utf8'), trustUrl)

  it('lists only the Commerce bulletins of the Trust Center collection, with date and priority', () => {
    const json = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'caas-security-bulletins.json'), 'utf8'))
    const entries = parseCaasIndex(json)
    expect(entries.map((e) => e.id).sort()).toEqual(['APSB26-153', 'APSB26-92'])
    expect(entries.find((e) => e.id === 'APSB26-92')).toEqual({ url: trustUrl, id: 'APSB26-92', published: '2026-08-11', priority: 2 })
    expect(parseCaasIndex({})).toEqual([])
  })

  it('reads a Trust Center page (tables made of divs) like a HelpX one', () => {
    expect(page.id).toBe('APSB26-92')
    expect(page.title).toBe('Security update available for Adobe Commerce | APSB26-92')
    expect(page.published).toBe('2026-08-11')
    expect(page.priority).toBe(2)
    expect(page.affected.find((r) => r.product === 'Adobe Commerce')?.versions).toHaveLength(6)
    expect(page.affected.map((r) => r.product)).toEqual(expect.arrayContaining(['Adobe Commerce', 'Adobe Commerce B2B', 'Magento Open Source']))
    const fixed = page.fixed.find((r) => r.product === 'Adobe Commerce')
    expect(fixed?.versions).toContain('2.4.9-2026-aug')
    expect(fixed?.url).toMatch(/^https:\/\/experienceleague\.adobe\.com\//)
    expect(page.severity.Critical).toBeGreaterThanOrEqual(1)
    expect(page.cves).toContain('CVE-2026-71362')
  })

  it('reads the same versions, fixes, severities and CVEs as the HelpX copy of the bulletin', () => {
    expect(page.affected).toEqual(bulletin.affected)
    expect(page.fixed.map((r) => [r.product, r.versions])).toEqual(bulletin.fixed.map((r) => [r.product, r.versions]))
    expect(page.severity).toEqual(bulletin.severity)
    expect(page.cves).toEqual(bulletin.cves)
  })

  it('reads the variant whose vulnerability details are a table, the same way', () => {
    const table = parseBulletin(fs.readFileSync(path.join(__dirname, 'fixtures', 'apsb26-92-trust-table.html'), 'utf8'), trustUrl)
    expect(table.severity).toEqual(bulletin.severity)
    expect(table.cves).toEqual(bulletin.cves)
    expect(table.fixed.map((r) => r.versions)).toEqual(page.fixed.map((r) => r.versions))
  })

  it('refreshes from the Trust Center, keeping older HelpX bulletins and dropping the ones it now lists', async () => {
    const { CORE_DIR } = await import('../src/config/paths')
    const { SecurityBulletinTopic, INDEX_URL } = await import('../src/news/security-bulletin.topic')
    const cacheFile = path.join(CORE_DIR, 'news', 'security-bulletin.json')
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
    const old = { ...bulletin, id: 'APSB25-50', url: 'https://helpx.adobe.com/ca/security/products/magento/apsb25-50.html', published: '2025-06-10' }
    fs.writeFileSync(cacheFile, JSON.stringify({ bulletins: [bulletin, old] }))

    const caas = fs.readFileSync(path.join(__dirname, 'fixtures', 'caas-security-bulletins.json'), 'utf8')
    const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'apsb26-92-trust.html'), 'utf8')
    const requested: string[] = []
    const realFetch = global.fetch
    global.fetch = (async (input: string) => {
      requested.push(input)
      const body = input === INDEX_URL ? caas : input.includes('apsb26-92') ? html : '<main></main>'
      return { ok: true, status: 200, url: input, text: async () => body } as Response
    }) as typeof fetch
    try {
      await new SecurityBulletinTopic({ list: () => [] } as never).refresh()
    } finally {
      global.fetch = realFetch
    }
    expect(requested.every((u) => new URL(u).hostname === 'www.adobe.com')).toBe(true)
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')).bulletins as { id: string; url: string; cves: string[] }[]
    expect(cached.filter((b) => b.id === 'APSB26-92').map((b) => b.url)).toEqual([trustUrl])
    expect(cached.find((b) => b.id === 'APSB26-92')!.cves.length).toBeGreaterThan(0)
    expect(cached.some((b) => b.id === 'APSB25-50')).toBe(true)
    // a page it could not read fully keeps the date and priority of the list
    expect(cached.find((b) => b.id === 'APSB26-153')).toMatchObject({ published: '2026-10-13', priority: 2 })
  })

  it('turns a div table into rows and cells', () => {
    const html = '<div class="table left"><div><div><strong>Product</strong></div><div><strong>Version</strong></div></div><div><div>Adobe Commerce</div><div><p>2.4.9</p><p>2.4.8</p></div></div></div>'
    expect(divTables(html)).toEqual(['<table><tr><td><strong>Product</strong></td><td><strong>Version</strong></td></tr><tr><td>Adobe Commerce</td><td><p>2.4.9</p><p>2.4.8</p></td></tr></table>'])
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
