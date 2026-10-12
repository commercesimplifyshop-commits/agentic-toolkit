import { create } from 'zustand'
import type { ZoneId } from '../domain/zones'

export type ItemKind = 'rest' | 'graphql' | 'observer' | 'plugin' | 'preference' | 'route' | 'cron' | 'queue'
export type Origin = 'custom' | 'thirdparty' | 'native'
export type MapZone = ZoneId | 'outros'

export interface MapItem {
  id: string
  kind: ItemKind
  title: string
  subtitle: string
  details: Record<string, unknown>
  zone: MapZone
  reason: string
  module: string
  origin: Origin
  file: string
  line: number
  classFile?: string
  /** From Claude's annotations */
  summary?: string
  risk?: Risk
  zoneSource: 'regra' | 'claude' | 'confirmada'
}

export type RiskLevel = 'alto' | 'medio' | 'baixo'
export interface Risk {
  level: RiskLevel
  note: string
}

export interface InstallMap {
  project: {
    name: string
    root: string
    edition: string
    magentoVersion: string
    scannedAt: string
    nativeReference: string | null
    moduleOrder?: string[]
    disabledModules?: string[]
  }
  modules: { name: string; vendor: string; origin: Origin }[]
  items: MapItem[]
}

export interface Annotations {
  generatedAt?: string
  zones?: Partial<Record<MapZone, string>>
  items?: Record<string, { zone?: MapZone; summary?: string; risk?: Risk }>
}

interface MapIndexEntry {
  slug: string
  name: string
  edition: string
  magentoVersion: string
}

export const KIND_LABEL: Record<ItemKind, string> = {
  rest: 'REST',
  graphql: 'GraphQL',
  observer: 'Observer',
  plugin: 'Plugin',
  preference: 'Preference',
  route: 'Rota',
  cron: 'Cron',
  queue: 'Fila',
}

export const ORIGIN_LABEL: Record<Origin, string> = {
  custom: 'Customizado',
  thirdparty: 'Terceiros',
  native: 'Nativo',
}

interface MapState {
  available: MapIndexEntry[]
  slug: string | null
  map: InstallMap | null
  zoneNotes: Annotations['zones']
  annotatedCount: number
  error: string | null
  focusItemId: string | null
  init: () => Promise<void>
  load: (slug: string | null) => Promise<void>
  focusItem: (id: string | null) => void
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    return null
  }
}

export const useMap = create<MapState>((set, get) => ({
  available: [],
  slug: null,
  map: null,
  zoneNotes: {},
  annotatedCount: 0,
  error: null,
  focusItemId: null,

  init: async () => {
    const index = await fetchJson<{ maps: MapIndexEntry[] }>('/maps/index.json')
    set({ available: index?.maps ?? [] })
    const first = index?.maps[0]?.slug
    if (first && !get().slug) await get().load(first)
  },

  load: async (slug) => {
    if (!slug) return set({ slug: null, map: null, zoneNotes: {}, annotatedCount: 0 })
    const [map, notes] = await Promise.all([
      fetchJson<InstallMap>(`/maps/${slug}.json`),
      fetchJson<Annotations>(`/maps/${slug}.annotations.json`),
    ])
    if (!map) return set({ error: `Não foi possível carregar o mapa "${slug}"` })
    let annotatedCount = 0
    const items = map.items.map((it): MapItem => {
      const note = notes?.items?.[it.id]
      if (note) annotatedCount++
      return {
        ...it,
        zone: note?.zone ?? it.zone,
        summary: note?.summary,
        risk: note?.risk,
        zoneSource: !note?.zone ? 'regra' : note.zone !== it.zone ? 'claude' : 'confirmada',
      }
    })
    set({ slug, map: { ...map, items }, zoneNotes: notes?.zones ?? {}, annotatedCount, error: null })
  },

  focusItem: (focusItemId) => set({ focusItemId }),
}))

export function vscodeLink(root: string, file: string, line = 1) {
  return `vscode://file/${root.replace(/\\/g, '/')}/${file}:${line}`
}
