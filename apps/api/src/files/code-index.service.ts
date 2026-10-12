import { Injectable } from '@nestjs/common'
import { isSensitive, ReadOnlyViolation } from '../readonly/path-guard'
import { ReadOnlyFs } from '../readonly/readonly-fs.service'

/** Folders that are generated, huge or irrelevant for reading a project */
const SKIP = ['node_modules', '.git', 'generated', 'var', 'pub', 'dev', 'setup', 'update', '.idea', '.npm', 'vendor']
const TEXT_EXT = /\.(php|phtml|xml|xsd|js|ts|json|graphqls|less|css|scss|html|yaml|yml|md|csv|txt|neon|dist|sql|sh|conf|ini|lock|patch|diff)$/i
const MAX_FILE = 1.5 * 1024 * 1024
const TTL_MS = 10 * 60_000
const CACHE_BYTES = 400 * 1024 * 1024
/** Files processed between event-loop yields, so a cold index never freezes the API */
const BATCH = 200
const yieldLoop = () => new Promise<void>((resolve) => setImmediate(resolve))

export interface FindOptions {
  query: string
  regex?: boolean
  caseSensitive?: boolean
  wholeWord?: boolean
  /** Relative folder to search in ('' = project without vendor; 'vendor/...' must be explicit) */
  scope?: string
  /** Comma-separated globs, e.g. "*.php,*.xml" */
  mask?: string
  maxResults?: number
}

export interface FindMatch {
  file: string
  line: number
  col: number
  length: number
  text: string
}

interface Index {
  at: number
  files: string[]
  classes?: { fqcn: string; path: string; kind: string }[]
}

/** Builds a glob matcher for file masks (only * and ? are special). */
function maskMatcher(mask?: string) {
  const parts = (mask ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
  if (!parts.length) return () => true
  const res = parts.map((p) => new RegExp(`(^|/)${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}$`, 'i'))
  return (file: string) => res.some((re) => re.test(file))
}

/**
 * In-memory, read-only index of a workspace: file list, PHP class index and
 * a content cache for fast "Find in Files". Nothing is ever written.
 */
@Injectable()
export class CodeIndexService {
  private readonly indexes = new Map<string, Index>()
  private readonly content = new Map<string, string>()
  private readonly building = new Map<string, Promise<NonNullable<Index['classes']>>>()
  private contentBytes = 0

  constructor(private readonly rofs: ReadOnlyFs) {}

  private index(root: string, refresh = false): Index {
    const cached = this.indexes.get(root)
    if (cached && !refresh && Date.now() - cached.at < TTL_MS) return cached
    const files = this.rofs.walk(root, '', { skip: SKIP, maxFiles: 200_000 }).sort()
    const idx: Index = { at: Date.now(), files }
    this.indexes.set(root, idx)
    return idx
  }

  files(root: string, refresh = false) {
    return this.index(root, refresh).files
  }

  private text(root: string, file: string): string | null {
    const key = `${root}\0${file}`
    const hit = this.content.get(key)
    if (hit !== undefined) return hit
    try {
      const r = this.rofs.read(root, file, MAX_FILE)
      if (r.truncated || r.content.includes('\0')) return null
      if (this.contentBytes + r.content.length < CACHE_BYTES) {
        this.content.set(key, r.content)
        this.contentBytes += r.content.length
      }
      return r.content
    } catch {
      return null
    }
  }

  /** FQCN → file for every class/interface/trait/enum declared in the project's PHP. */
  async classes(root: string): Promise<NonNullable<Index['classes']>> {
    const idx = this.index(root)
    if (idx.classes) return idx.classes
    // Concurrent callers share one build
    const pending = this.building.get(root)
    if (pending) return pending
    const build = this.buildClasses(root, idx).finally(() => this.building.delete(root))
    this.building.set(root, build)
    return build
  }

  private async buildClasses(root: string, idx: Index) {
    const out: NonNullable<Index['classes']> = []
    let n = 0
    for (const file of idx.files) {
      if (!file.endsWith('.php')) continue
      if (++n % BATCH === 0) await yieldLoop()
      const src = this.text(root, file)
      if (!src) continue
      const ns = src.match(/^\s*namespace\s+([\w\\]+)\s*;/m)?.[1]
      for (const m of src.matchAll(/^\s*(?:final\s+|abstract\s+|readonly\s+)*(class|interface|trait|enum)\s+(\w+)/gm)) {
        out.push({ fqcn: ns ? `${ns}\\${m[2]}` : m[2], path: file, kind: m[1] })
      }
    }
    idx.classes = out
    return out
  }

  /** PhpStorm-like "Find in Files". */
  async find(root: string, opts: FindOptions): Promise<{ matches: FindMatch[]; filesSearched: number; truncated: boolean }> {
    const max = Math.min(opts.maxResults ?? 1000, 5000)
    let source = opts.regex ? opts.query : opts.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (opts.wholeWord) source = `\\b(?:${source})\\b`
    let re: RegExp
    try {
      re = new RegExp(source, opts.caseSensitive ? 'g' : 'gi')
    } catch {
      throw new ReadOnlyViolation('Expressão regular inválida', 'input.regex')
    }

    const scope = (opts.scope ?? '').replace(/^\/+|\/+$/g, '')
    // vendor/ only when the scope explicitly points into it
    const files = scope.startsWith('vendor')
      ? this.rofs.walk(root, scope, { skip: ['node_modules', '.git'], maxFiles: 300_000 })
      : this.index(root).files.filter((f) => !scope || f === scope || f.startsWith(`${scope}/`))
    const inMask = maskMatcher(opts.mask)

    const matches: FindMatch[] = []
    let filesSearched = 0
    let n = 0
    for (const file of files) {
      if (matches.length >= max) break
      if (++n % BATCH === 0) await yieldLoop()
      if (!TEXT_EXT.test(file) || isSensitive(file) || !inMask(file)) continue
      const src = this.text(root, file)
      if (!src) continue
      filesSearched++
      const lines = src.split('\n')
      for (let i = 0; i < lines.length && matches.length < max; i++) {
        const line = lines[i]
        if (line.length > 4000) continue // minified lines: skip
        re.lastIndex = 0
        const m = re.exec(line)
        if (m) matches.push({ file, line: i + 1, col: m.index, length: Math.max(1, m[0].length), text: line.slice(0, 400) })
      }
    }
    return { matches, filesSearched, truncated: matches.length >= max }
  }

  invalidate(root: string) {
    this.indexes.delete(root)
    for (const key of [...this.content.keys()]) {
      if (key.startsWith(`${root}\0`)) {
        this.contentBytes -= this.content.get(key)!.length
        this.content.delete(key)
      }
    }
  }
}
