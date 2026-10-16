import { create } from 'zustand'

/** The tools of the developer bar: one at a time changes how clicks and drags on the page behave */
export type DevTool = 'layout' | 'texts' | 'colors' | 'css' | null

const KEY = 'agentic-toolkit.devMode'

/** Per-viewer convenience: storage may be unavailable (private mode), so it simply starts off */
function readOn() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

interface DevState {
  on: boolean
  tool: DevTool
  setOn: (on: boolean) => void
  setTool: (tool: DevTool) => void
}

export const useDevMode = create<DevState>((set, get) => ({
  on: readOn(),
  tool: null,
  setOn: (on) => {
    try {
      localStorage.setItem(KEY, on ? '1' : '0')
    } catch {
      // preference just won't persist
    }
    set({ on, tool: on ? get().tool : null })
  },
  setTool: (tool) => set({ tool: get().tool === tool ? null : tool }),
}))

/** Opens the assistant from anywhere (the developer bar, a link) */
export const useAssistantPanel = create<{ open: boolean; draft: string; setOpen: (open: boolean | ((o: boolean) => boolean)) => void; ask: (draft: string) => void }>((set) => ({
  open: false,
  draft: '',
  setOpen: (open) => set((s) => ({ open: typeof open === 'function' ? open(s.open) : open })),
  ask: (draft) => set({ open: true, draft }),
}))
