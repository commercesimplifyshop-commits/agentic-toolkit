import { create } from 'zustand'
import { api } from './api'

/** Mirrors apps/api/src/ui/ui-prefs.service.ts (view) */
export interface UiFeature {
  id: string
  title: string
  section: string
  techs: string[]
  description: string
  locked?: boolean
  enabled: boolean
  /** The name before the person renamed it */
  originalTitle: string
}
export interface ThemeTokenView {
  id: string
  variable: string
  title: string
  kind: 'color' | 'length' | 'font'
  value: string
  current: string
  changed: boolean
}
export interface UiPageView {
  id: string
  title: string
  techs: string[]
  blocks: { id: string; title: string; visible: boolean }[]
}
export interface UiPrefs {
  disabled: string[]
  pages: Record<string, { order: string[]; hidden: string[] }>
  labels: Record<string, string>
  texts: { from: string; to: string }[]
  theme: Record<string, string>
  menu: { order: string[]; sections: Record<string, string> }
  css: string
  updatedAt?: string
  updatedBy?: 'tela' | 'assistente' | 'mcp'
}
export type UiAction =
  | { type: 'feature'; feature: string; enabled: boolean }
  | { type: 'block-visibility'; page: string; block: string; visible: boolean }
  | { type: 'block-move'; page: string; block: string; position: 'top' | 'bottom' | 'up' | 'down' | 'before' | 'after'; ref?: string }
  | { type: 'rename'; feature: string; title: string | null }
  | { type: 'text'; from: string; to: string | null }
  | { type: 'theme'; token: string; value: string | null }
  | { type: 'menu-move'; feature: string; position?: 'top' | 'bottom' | 'up' | 'down' | 'before' | 'after'; ref?: string; section?: string }
  | { type: 'css'; css: string | null; mode?: 'replace' | 'append' }
  | { type: 'reset'; scope: string }
  | { type: 'undo' }

/** Mirrors apps/api/src/ui/ui-commands.service.ts: what the assistant or an AI through the MCP asks the open screens to do */
export type UiCommand =
  | { type: 'navigate'; workspace: string; path: string }
  | {
      type: 'api-client-fill'
      workspace: string
      routeId: string
      request: { pathParams?: Record<string, string>; query?: Record<string, string>; headers?: Record<string, string>; body?: string; graphqlQuery?: string; graphqlVariables?: string; note?: string }
    }

/** The last command, for the layout (navigation) and the API simulator (filling) to act on */
export const useUiCommands = create<{ command: (UiCommand & { at: number }) | null; fill: Extract<UiCommand, { type: 'api-client-fill' }> | null; takeFill: () => void }>((set) => ({
  command: null,
  fill: null,
  takeFill: () => set({ fill: null }),
}))

interface UiState {
  loaded: boolean
  features: UiFeature[]
  pages: UiPageView[]
  theme: ThemeTokenView[]
  cssMap: [string, string][]
  canUndo: boolean
  prefs: UiPrefs
  /** The last change made by someone else (assistant or MCP), to tell the person */
  notice: string
  load: () => Promise<void>
  apply: (actions: UiAction[]) => Promise<string[]>
  clearNotice: () => void
}

const BY: Record<string, string> = { assistente: 'pelo assistente', mcp: 'por uma IA conectada pelo MCP' }

export const useUi = create<UiState>((set, get) => ({
  loaded: false,
  features: [],
  pages: [],
  theme: [],
  cssMap: [],
  canUndo: false,
  prefs: { disabled: [], pages: {}, labels: {}, texts: [], theme: {}, menu: { order: [], sections: {} }, css: '' },
  notice: '',
  load: async () => {
    const v = await api.get<{ prefs: UiPrefs; features: UiFeature[]; pages: UiPageView[]; theme: ThemeTokenView[]; cssMap: [string, string][]; canUndo: boolean }>('/ui')
    set({ loaded: true, ...v })
  },
  apply: async (actions) => {
    const r = await api.post<{ done: string[]; prefs: UiPrefs }>('/ui/actions', { actions })
    await get().load()
    return r.done
  },
  clearNotice: () => set({ notice: '' }),
}))

let source: EventSource | null = null

/** Follows the changes as they happen, from this screen, the assistant or an AI through the MCP */
export function followUiChanges() {
  if (source) return
  useUi
    .getState()
    .load()
    .catch(() => undefined)
  try {
    source = new EventSource('/api/ui/events')
    source.addEventListener('prefs', (e) => {
      let by = ''
      try {
        by = (JSON.parse((e as MessageEvent).data) as UiPrefs).updatedBy ?? ''
      } catch {
        // just reload
      }
      useUi
        .getState()
        .load()
        .then(() => BY[by] && useUi.setState({ notice: `A interface foi ajustada ${BY[by]}.` }))
        .catch(() => undefined)
    })
    source.addEventListener('command', (e) => {
      try {
        const c = JSON.parse((e as MessageEvent).data) as UiCommand
        useUiCommands.setState({ command: { ...c, at: Date.now() }, ...(c.type === 'api-client-fill' ? { fill: c } : {}) })
      } catch {
        // ignore a malformed command
      }
    })
  } catch {
    // no live updates: the preferences still load on each visit
  }
}

/** Whether a sidebar feature is on (unknown ids are always on) */
export const isEnabled = (prefs: UiPrefs, feature: string) => !prefs.disabled.includes(feature)

/** The sidebar feature a path of the workspace belongs to ('' is the overview) */
export function featureOfPath(sub: string, ids: string[]) {
  if (!sub) return 'overview'
  return ids.filter((id) => sub === id || sub.startsWith(`${id}/`)).sort((a, b) => b.length - a.length)[0]
}
