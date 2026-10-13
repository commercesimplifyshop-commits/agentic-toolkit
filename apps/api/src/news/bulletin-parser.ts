/**
 * Reads Adobe security bulletins from helpx.adobe.com. The pages are HTML with stable tables
 * (Affected Versions, Solution, Vulnerability Details), so the parser reads those tables by
 * their headers, not by position in the page.
 */

export interface AffectedRow {
  product: string
  /** As written by Adobe, e.g. "2.4.9-2026-jul and earlier" */
  versions: string[]
}

export interface FixedRow {
  product: string
  /** Updated versions, e.g. "2.4.9-2026-aug" */
  versions: string[]
  /** Adobe's installation / release-notes page for this update, as linked in the bulletin */
  url?: string
}

export interface Bulletin {
  id: string
  title: string
  url: string
  /** yyyy-mm-dd */
  published?: string
  /** Adobe priority rating, 1 (most urgent) to 5 */
  priority?: number
  affected: AffectedRow[]
  fixed: FixedRow[]
  /** Count of vulnerabilities per severity, e.g. { Critical: 1, Important: 3 } */
  severity: Record<string, number>
  cves: string[]
}

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' }

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")

/** Text of a cell as lines: each <p>, <br> or block boundary starts a new line */
export function cellLines(cell: string): string[] {
  const withBreaks = cell.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n')
  return decode(withBreaks.replace(/<[^>]+>/g, ' '))
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/** Rows of a table: each row is the list of its cells' lines */
export function tableRows(table: string): string[][][] {
  const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []
  return rows.map((tr) => (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? []).map(cellLines))
}

/** Plain text of a whole page, for the title and dates */
export function plainText(html: string): string {
  const noScript = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
  return decode(noScript.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ')
}

/** The Commerce bulletins listed on the security bulletin index (absolute URLs, no duplicates) */
export function parseIndex(html: string, base: string): string[] {
  const hrefs = html.match(/href="(\/[^"]*\/security\/products\/magento\/apsb[^"#?]+\.html)"/gi) ?? []
  const urls = hrefs.map((h) => new URL(h.slice(6, -1), base).toString())
  return [...new Set(urls)]
}

const findTable = (tables: string[], header: (cells: string[]) => boolean) =>
  tables.find((t) => {
    const rows = tableRows(t)
    return rows.length > 1 && header(rows[0].map((c) => c.join(' ')))
  })

const isoDate = (text: string): string | undefined => {
  const m = text.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s+(\d{4})/)
  if (!m) return undefined
  const month = MONTHS[m[1].toLowerCase()]
  return month ? `${m[3]}-${month}-${m[2].padStart(2, '0')}` : undefined
}

/** One bulletin page: title, date, priority, affected and fixed versions, severities, CVEs */
export function parseBulletin(html: string, url: string): Bulletin {
  const text = plainText(html)
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? []

  const titleMatch = text.match(/Security update available for ([^|]+?)\s*\|\s*(APSB\d{2}-\d+)/i) ?? text.match(/(APSB\d{2}-\d+)/i)
  const id = (titleMatch && (titleMatch[2] ?? titleMatch[1])) || url.match(/apsb\d{2}-\d+/i)?.[0].toUpperCase() || 'APSB'
  const title = titleMatch && titleMatch[2] ? `Security update available for ${titleMatch[1].trim()} | ${id}` : id

  const publishedText = text.match(/Date Published[\s\S]{0,200}?([A-Za-z]{3}[a-z]*\.?\s+\d{1,2},\s+\d{4})/)?.[1]
  const published = publishedText ? isoDate(publishedText) : undefined

  const affectedTable = findTable(tables, (h) => h[0] === 'Product' && h[1] === 'Version' && !h.some((c) => /updated/i.test(c)))
  const affected: AffectedRow[] = affectedTable
    ? tableRows(affectedTable)
        .slice(1)
        .map((cells) => ({ product: cells[0]?.[0] ?? '', versions: (cells[1] ?? []).filter((v) => /\d/.test(v)) }))
        .filter((r) => r.product && r.versions.length)
    : []

  const solutionTable = findTable(tables, (h) => h.some((c) => /updated version/i.test(c)))
  let priority: number | undefined
  const fixed: FixedRow[] = []
  if (solutionTable) {
    const rows = tableRows(solutionTable)
    const header = rows[0].map((c) => c.join(' ').toLowerCase())
    const priorityCol = header.findIndex((h) => h.includes('priority'))
    const rawRows = solutionTable.match(/<tr[\s\S]*?<\/tr>/gi) ?? []
    for (const [i, cells] of rows.slice(1).entries()) {
      const versions = (cells[1] ?? []).filter((v) => /\d/.test(v))
      const url = rawRows[i + 1]?.match(/href="(https:\/\/[^"]+)"/i)?.[1]
      if (cells[0]?.[0] && versions.length) fixed.push({ product: cells[0][0], versions, url })
      const p = priorityCol >= 0 ? Number((cells[priorityCol] ?? [])[0]) : NaN
      if (priority === undefined && Number.isInteger(p)) priority = p
    }
  }

  const vulnTable = findTable(tables, (h) => h.some((c) => /severity/i.test(c)))
  const severity: Record<string, number> = {}
  if (vulnTable) {
    const rows = tableRows(vulnTable)
    const col = rows[0].findIndex((c) => /^severity$/i.test(c.join(' ').trim()))
    for (const cells of rows.slice(1)) {
      const level = col >= 0 ? (cells[col]?.[0] ?? '') : ''
      if (/^(critical|important|moderate|low)$/i.test(level)) {
        const key = level[0].toUpperCase() + level.slice(1).toLowerCase()
        severity[key] = (severity[key] ?? 0) + 1
      }
    }
  }
  const cves = [...new Set(tables.join(' ').match(/CVE-\d{4}-\d{4,}/g) ?? [])].sort()

  return { id, title, url, published, priority, affected, fixed, severity, cves }
}
