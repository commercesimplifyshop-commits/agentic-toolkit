import { Injectable, Logger } from '@nestjs/common'
import fs from 'node:fs'
import path from 'node:path'
import { CORE_DIR } from '../config/paths'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { Bulletin, PARSER_VERSION, parseBulletin, parseCaasIndex } from './bulletin-parser'
import { TopicItem, TopicProvider, Tone } from './topic'
import { impactOf, type Verdict } from './version-match'

/** The Adobe Trust Center page that lists the bulletins (https://www.adobe.com/trust/security/bulletins-and-advisories.html) */
export const BULLETINS_PAGE = 'https://www.adobe.com/trust/security/bulletins-and-advisories.html'
/**
 * The content API that page reads its list from: the collection of security bulletins.
 * Bulletins published before 2026 stay on HelpX; the ones already read are kept in the cache.
 */
export const INDEX_URL =
  'https://www.adobe.com/chimera-api/collection?originSelection=hawks&contentTypeTags=caas%3Acontent-type%2Fdocumentation&collectionTags=&excludeContentWithTags=&language=en&country=us&complexQuery=((%22caas%3Atrust-center%2Fsecurity-bulletin%22))&currentEntityId=&featuredCards=&environment=&draft=false&size=250&flatFile=false'
/** The only host this topic reads: nothing else is ever requested */
const ALLOWED_HOST = 'www.adobe.com'
const MAX_PAGES_PER_RUN = 40
const DIR = path.join(CORE_DIR, 'news')
const CACHE_FILE = path.join(DIR, 'security-bulletin.json')

interface Cache {
  fetchedAt?: string
  bulletins: Bulletin[]
}

const LABEL: Record<Verdict, string> = { affected: 'afetada', 'not-affected': 'não afetada', verify: 'verificar' }

/** The product a workspace is compared with: Open Source installs use the Magento Open Source rows */
export const productOf = (edition?: string) => (/open source/i.test(edition ?? '') ? 'Magento Open Source' : 'Adobe Commerce')

/**
 * Whether a table row is about the product. Adobe writes some rows for several products at once
 * ("Adobe Commerce and Magento Open Source"), so the row is split before comparing; "Adobe Commerce B2B" is a different product.
 */
export const rowIsProduct = (row: string, product: string) =>
  row.split(/\s+and\s+|,\s*/i).some((p) => p.trim().toLowerCase() === product.toLowerCase())

/** Adobe security bulletins for Adobe Commerce, compared with each installation */
@Injectable()
export class SecurityBulletinTopic implements TopicProvider {
  readonly id = 'seguranca-adobe-commerce'
  readonly title = 'Segurança · Adobe Commerce'
  readonly description = 'Boletins de segurança da Adobe para o Adobe Commerce e o Magento Open Source, com o impacto em cada instalação.'
  private readonly log = new Logger('Boletins de segurança')

  constructor(private readonly workspaces: WorkspacesService) {}

  private readCache(): Cache {
    try {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as Cache
    } catch {
      return { bulletins: [] }
    }
  }

  private writeCache(cache: Cache) {
    fs.mkdirSync(DIR, { recursive: true })
    fs.writeFileSync(`${CACHE_FILE}.tmp`, JSON.stringify(cache, null, 2))
    fs.renameSync(`${CACHE_FILE}.tmp`, CACHE_FILE)
  }

  fetchedAt() {
    return this.readCache().fetchedAt
  }

  latestPublished() {
    return this.readCache()
      .bulletins.map((b) => b.published ?? '')
      .sort()
      .pop() || undefined
  }

  private async get(url: string, accept = 'text/html'): Promise<string> {
    const u = new URL(url)
    if (u.protocol !== 'https:' || u.hostname !== ALLOWED_HOST) throw new Error(`Endereço não permitido: ${u.hostname}`)
    const ctl = new AbortController()
    const timeout = setTimeout(() => ctl.abort(), 20_000)
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'AgenticToolkit/security-bulletin-reader', accept }, signal: ctl.signal })
      if (new URL(res.url || url).hostname !== ALLOWED_HOST) throw new Error('Redirecionamento para fora do Adobe')
      if (!res.ok) throw new Error(`HTTP ${res.status} em ${u.pathname}`)
      return await res.text()
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * The Trust Center list first; then only the bulletins not cached yet. Bulletins already read are
   * kept, including the ones from HelpX (before 2026) that the Trust Center no longer lists.
   */
  async refresh(): Promise<void> {
    let json: unknown
    try {
      json = JSON.parse(await this.get(INDEX_URL, 'application/json'))
    } catch (err) {
      throw new Error(`Lista de boletins da Adobe ilegível (${BULLETINS_PAGE}): ${(err as Error).message}`)
    }
    const entries = parseCaasIndex(json)
    if (!entries.length) throw new Error(`Nenhum boletim do Commerce encontrado em ${BULLETINS_PAGE}`)
    const known = new Map(this.readCache().bulletins.map((b) => [b.url, b]))
    // new bulletins, and ones read by an older version of the parser
    for (const e of entries.filter((x) => known.get(x.url)?.parser !== PARSER_VERSION).slice(0, MAX_PAGES_PER_RUN)) {
      try {
        const b = parseBulletin(await this.get(e.url), e.url)
        // the list knows the date and priority even when the page layout changes
        known.set(e.url, { ...b, id: b.id === 'APSB' ? e.id : b.id, published: b.published ?? e.published, priority: b.priority ?? e.priority })
      } catch (err) {
        this.log.warn(`Boletim ${e.url} não foi lido: ${(err as Error).message}`)
      }
    }
    // older bulletins (HelpX) stay, unless the Trust Center lists the same one
    const listed = new Set(entries.flatMap((e) => (known.has(e.url) ? [e.url, e.id] : [e.url])))
    const bulletins = [...entries.map((e) => known.get(e.url)), ...[...known.values()].filter((b) => !listed.has(b.url) && !listed.has(b.id))].filter((b): b is Bulletin => !!b)
    this.writeCache({ fetchedAt: new Date().toISOString(), bulletins })
  }

  itemsFor(days: string[]): TopicItem[] {
    const installs = this.workspaces.list().filter((w) => w.tech === 'adobe-commerce' && w.version)
    const published = this.readCache().bulletins.filter((b) => b.published && days.includes(b.published))
    return published
      .map((b): TopicItem => {
        const impacts = installs.map((w) => {
          const product = productOf(w.edition)
          const scoped: Bulletin = { ...b, affected: b.affected.filter((r) => rowIsProduct(r.product, product)) }
          const impact = scoped.affected.length
            ? impactOf(w.version!, scoped)
            : { status: 'verify' as Verdict, note: `o boletim não lista ${product}`, fixedIn: undefined }
          return { name: w.name, version: w.version!, ...impact }
        })
        const tone: Tone = impacts.some((i) => i.status === 'affected') ? 'red' : impacts.some((i) => i.status === 'verify') ? 'yellow' : 'green'
        return {
          id: b.id,
          title: b.title.replace(/^Security update available for /, '').replace(/ \| APSB.*$/, ''),
          url: b.url,
          date: b.published,
          priority: b.priority,
          tone,
          tags: [...Object.entries(b.severity).map(([k, n]) => `${n} ${k.toLowerCase()}`), ...(b.cves.length ? [`${b.cves.length} CVE`] : [])],
          actions: installActions(b, installs.map((w) => productOf(w.edition))),
          lines: impacts.map(
            (i) => `${i.name} ${i.version}: ${LABEL[i.status]} — ${i.note}${i.status === 'affected' && i.fixedIn ? `, atualizar para ${i.fixedIn}` : ''}`,
          ),
        }
      })
      .sort((a, b) => toneRank(a.tone) - toneRank(b.tone) || (b.date ?? '').localeCompare(a.date ?? ''))
  }
}

/** Adobe's installation / release-notes pages for the products the installations run, without repeats */
const installActions = (b: Bulletin, products: string[]) => {
  const seen = new Set<string>()
  const actions: { label: string; url: string }[] = []
  for (const row of b.fixed) {
    if (!row.url || !products.some((p) => rowIsProduct(row.product, p)) || seen.has(row.url)) continue
    seen.add(row.url)
    actions.push({ label: `Instruções de instalação · ${row.product}`, url: row.url })
  }
  return actions
}

const toneRank = (t: Tone) => ({ red: 0, yellow: 1, neutral: 2, green: 3 })[t]
