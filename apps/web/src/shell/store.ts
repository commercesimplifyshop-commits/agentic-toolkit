import { create } from 'zustand'
import { api, type Overview, type Workspace } from './api'

interface ShellState {
  workspaces: Workspace[]
  loaded: boolean
  overviews: Record<string, Overview | undefined>
  refreshWorkspaces: () => Promise<Workspace[]>
  loadOverview: (id: string, refresh?: boolean) => Promise<Overview>
}

export const useShell = create<ShellState>((set, get) => ({
  workspaces: [],
  loaded: false,
  overviews: {},

  refreshWorkspaces: async () => {
    const workspaces = await api.get<Workspace[]>('/workspaces')
    set({ workspaces, loaded: true })
    return workspaces
  },

  loadOverview: async (id, refresh = false) => {
    if (!refresh && get().overviews[id]) return get().overviews[id]!
    const overview = await api.get<Overview>(`/workspaces/${id}/overview${refresh ? '?refresh=1' : ''}`)
    set((s) => ({ overviews: { ...s.overviews, [id]: overview } }))
    return overview
  },
}))

export const initials = (name: string) =>
  name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || 'M'

export const nf = new Intl.NumberFormat('pt-BR')
export const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')
export const ago = (iso?: string) => {
  if (!iso) return '—'
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'agora'
  if (s < 3600) return `há ${Math.round(s / 60)} min`
  if (s < 86400) return `há ${Math.round(s / 3600)} h`
  return `há ${Math.round(s / 86400)} dias`
}
