import { Injectable } from '@nestjs/common'
import fs from 'node:fs'
import path from 'node:path'
import { DIRS } from '../config/paths'

const TTL_MS = 24 * 60 * 60 * 1000

/**
 * End of regular support per release line (Adobe Commerce lifecycle policy).
 * Kept here so the dashboard works offline; check Adobe's lifecycle page for changes.
 */
const END_OF_SUPPORT: Record<string, string> = {
  '2.3': '2022-09-08',
  '2.4.0': '2022-11-28',
  '2.4.1': '2022-11-28',
  '2.4.2': '2022-11-28',
  '2.4.3': '2022-11-28',
  '2.4.4': '2025-04-14',
  '2.4.5': '2025-08-09',
  '2.4.6': '2026-03-14',
  '2.4.7': '2027-04-09',
  '2.4.8': '2028-04-11',
}

export interface SupportInfo {
  line: string
  current: string
  latestInLine?: string
  latestOverall?: string
  patchesBehind?: number
  endOfSupport?: string
  supported?: boolean
  source: 'github' | 'cache' | 'offline'
}

/** Release facts from public magento/magento2 tags (cached for a day). */
@Injectable()
export class ReleasesService {
  private readonly cacheFile = path.join(DIRS.cache, 'magento2-tags.json')

  private async tags(): Promise<{ tags: string[]; source: SupportInfo['source'] }> {
    try {
      const cached = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'))
      if (Date.now() - cached.at < TTL_MS) return { tags: cached.tags, source: 'cache' }
    } catch {
      // no cache yet
    }
    try {
      const tags: string[] = []
      for (let page = 1; page <= 4; page++) {
        const res = await fetch(`https://api.github.com/repos/magento/magento2/tags?per_page=100&page=${page}`, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'agentic-toolkit' },
          signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) break
        const batch = (await res.json()) as { name: string }[]
        tags.push(...batch.map((t) => t.name))
        if (batch.length < 100) break
      }
      if (tags.length) {
        fs.writeFileSync(this.cacheFile, JSON.stringify({ at: Date.now(), tags }))
        return { tags, source: 'github' }
      }
    } catch {
      // offline: fall through
    }
    return { tags: [], source: 'offline' }
  }

  async support(version?: string): Promise<SupportInfo | null> {
    const m = version?.match(/^(\d+\.\d+\.\d+)(?:-p(\d+))?/)
    if (!m) return null
    const line = m[1]
    const { tags, source } = await this.tags()
    const parse = (t: string) => t.match(/^(\d+\.\d+\.\d+)(?:-p(\d+))?$/)
    const inLine = tags
      .map(parse)
      .filter((x): x is RegExpMatchArray => Boolean(x) && x![1] === line)
      .sort((a, b) => Number(b[2] ?? 0) - Number(a[2] ?? 0))
    const stable = tags.filter((t) => /^2\.4\.\d+(-p\d+)?$/.test(t)).sort((a, b) => cmp(b, a))
    const eos = END_OF_SUPPORT[line] ?? END_OF_SUPPORT[line.split('.').slice(0, 2).join('.')]
    return {
      line,
      current: version!,
      latestInLine: inLine[0]?.[0],
      latestOverall: stable[0],
      patchesBehind: inLine.length ? Number(inLine[0][2] ?? 0) - Number(m[2] ?? 0) : undefined,
      endOfSupport: eos,
      supported: eos ? new Date(eos) > new Date() : undefined,
      source,
    }
  }
}

function cmp(a: string, b: string) {
  // "2.4.7-p3" → [2, 4, 7, 3]
  const pa = a.split(/\.|-p/).map(Number)
  const pb = b.split(/\.|-p/).map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}
