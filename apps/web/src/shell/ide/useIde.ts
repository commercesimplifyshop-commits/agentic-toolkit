import { create } from 'zustand'
import { api } from '../api'

export interface ClassEntry {
  fqcn: string
  path: string
  kind: string
}

export type Popup = { kind: 'goto'; mode: 'file' | 'class' | 'all'; initial?: string } | { kind: 'find'; initial?: string } | null

interface IdeState {
  workspaceId: string | null
  files: string[]
  classes: ClassEntry[]
  loadingIndex: boolean
  popup: Popup
  /** Open editor tabs per workspace (most recent last) */
  tabs: Record<string, string[]>
  ensureIndex: (id: string) => Promise<void>
  open: (p: Popup) => void
  close: () => void
  openTab: (id: string, path: string) => void
  closeTab: (id: string, path: string) => string | undefined
}

export const useIde = create<IdeState>((set, get) => ({
  workspaceId: null,
  files: [],
  classes: [],
  loadingIndex: false,
  popup: null,
  tabs: {},

  ensureIndex: async (id) => {
    const s = get()
    if (s.workspaceId === id && (s.files.length || s.loadingIndex)) return
    set({ workspaceId: id, files: [], classes: [], loadingIndex: true })
    try {
      const [files, classes] = await Promise.all([api.get<{ files: string[] }>(`/workspaces/${id}/files/index`), api.get<{ classes: ClassEntry[] }>(`/workspaces/${id}/files/classes`)])
      if (get().workspaceId === id) set({ files: files.files, classes: classes.classes })
    } finally {
      set({ loadingIndex: false })
    }
  },

  open: (popup) => set({ popup }),
  close: () => set({ popup: null }),

  openTab: (id, path) =>
    set((s) => {
      const list = (s.tabs[id] ?? []).filter((p) => p !== path)
      return { tabs: { ...s.tabs, [id]: [...list, path].slice(-12) } }
    }),

  closeTab: (id, path) => {
    const list = (get().tabs[id] ?? []).filter((p) => p !== path)
    set((s) => ({ tabs: { ...s.tabs, [id]: list } }))
    return list[list.length - 1]
  },
}))

// ---- PhpStorm-like fuzzy matching ------------------------------------------------

export interface Scored<T> {
  item: T
  score: number
  /** Indices of the matched characters in the label */
  hits: number[]
}

/**
 * Subsequence match with bonuses for camel humps, word starts and consecutive
 * characters, so "QuPl" finds QuotePlugin and "chk/ctrl" finds Checkout/Controller.
 */
export function fuzzy(query: string, label: string): { score: number; hits: number[] } | null {
  const q = query.replace(/\s+/g, '')
  if (!q) return { score: 0, hits: [] }
  const lower = label.toLowerCase()
  const ql = q.toLowerCase()
  // Plain substring first: strongest signal
  const sub = lower.indexOf(ql)
  if (sub >= 0) {
    const start = sub === 0 || /[/\\_.-]/.test(label[sub - 1]) || /[A-Z]/.test(label[sub])
    return { score: 1000 - sub - label.length / 10 + (start ? 200 : 0), hits: Array.from({ length: ql.length }, (_, i) => sub + i) }
  }
  const isBoundary = (j: number) => j === 0 || /[/\\_.\-\s]/.test(label[j - 1]) || (/[A-Z]/.test(label[j]) && /[a-z0-9]/.test(label[j - 1]))
  const hits: number[] = []
  let score = 0
  let li = 0
  for (let qi = 0; qi < ql.length; qi++) {
    // Like PhpStorm: an uppercase letter in the query must start a word/camel hump
    const hump = /[A-Z]/.test(q[qi])
    let found = -1
    if (!hump && li > 0 && lower[li] === ql[qi]) {
      found = li // keep extending the current hump ("Pay" in Payment)
    } else {
      for (let j = li; j < lower.length; j++) {
        if (lower[j] !== ql[qi]) continue
        if (isBoundary(j)) {
          found = j
          break
        }
        if (!hump && found < 0) found = j
      }
    }
    if (found < 0) return null
    score += isBoundary(found) ? 30 : 4
    if (hits.length && found === hits[hits.length - 1] + 1) score += 15
    hits.push(found)
    li = found + 1
  }
  // Big gaps between matched characters mean a weak, accidental match
  const spread = hits[hits.length - 1] - hits[0] - hits.length
  return { score: score - label.length / 10 - spread / 4, hits }
}

export function rank<T>(items: T[], query: string, label: (t: T) => string, limit = 60): Scored<T>[] {
  const out: Scored<T>[] = []
  for (const item of items) {
    const m = fuzzy(query, label(item))
    if (m) out.push({ item, ...m })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** Resolves a PHP identifier at the caret to a FQCN using the file's namespace and use statements. */
export function resolveClass(word: string, doc: string, classes: ClassEntry[]): { fqcn: string; entry?: ClassEntry } {
  const clean = word.replace(/^\\/, '').replace(/::.*$/, '')
  const byFqcn = (f: string) => classes.find((c) => c.fqcn.toLowerCase() === f.toLowerCase())
  if (word.startsWith('\\') || clean.includes('\\')) {
    const direct = byFqcn(clean)
    if (direct || word.startsWith('\\')) return { fqcn: clean, entry: direct }
  }
  const [head, ...rest] = clean.split('\\')
  for (const m of doc.matchAll(/^\s*use\s+([\w\\]+)(?:\s+as\s+(\w+))?\s*;/gm)) {
    const alias = m[2] ?? m[1].split('\\').pop()
    if (alias === head) {
      const fqcn = [m[1], ...rest].join('\\')
      return { fqcn, entry: byFqcn(fqcn) }
    }
  }
  const ns = doc.match(/^\s*namespace\s+([\w\\]+)\s*;/m)?.[1]
  const local = ns ? `${ns}\\${clean}` : clean
  const entry = byFqcn(local) ?? byFqcn(clean)
  return { fqcn: entry?.fqcn ?? local, entry }
}

/** Public GitHub URL of a Magento core class, for classes that live in vendor/. */
export function coreClassUrl(fqcn: string, version?: string) {
  const parts = fqcn.split('\\')
  if (parts[0] !== 'Magento') return null
  const tag = version?.match(/^\d+\.\d+\.\d+(-p\d+)?/)?.[0] ?? '2.4-develop'
  const file = parts[1] === 'Framework' ? `lib/internal/${parts.join('/')}.php` : `app/code/${parts.join('/')}.php`
  return `https://github.com/magento/magento2/blob/${tag}/${file}`
}
