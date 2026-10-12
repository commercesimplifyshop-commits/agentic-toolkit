import { create } from 'zustand'
import type { StoreEvent } from '../domain/types'
import type { ZoneId } from '../domain/zones'
import { applyEvent, initialWorld, type WorldState } from './reducer'

export type Selection =
  | { kind: 'zone'; id: ZoneId }
  | { kind: 'customer'; id: string }
  | { kind: 'order'; id: string }
  | { kind: 'unmapped' }
  | { kind: 'risks' }
  | null

interface UiState {
  selection: Selection
  trackedOrderId: string | null
  trackingPinned: boolean // user picked an order; stop auto-following
  speed: number
  paused: boolean
  focusVersion: number // bumps when the camera should fly to the selection
}

interface Actions {
  dispatch: (ev: StoreEvent) => void
  purge: (now: number) => void
  select: (sel: Selection, focus?: boolean) => void
  track: (orderId: string | null) => void
  setSpeed: (speed: number) => void
  togglePause: () => void
  reset: () => void
}

export type Store = WorldState & UiState & Actions

const CUSTOMER_LINGER = 10 // seconds a leaving customer stays visible
const FINISHED_TRACK_HOLD = 5 // seconds a delivered/canceled order stays in the tracker

/** Follow one order end-to-end, then jump to the newest active one. */
function autoTrack(w: WorldState, current: string | null, now: number) {
  const o = current ? w.orders[current] : undefined
  const finished = o && (o.stage === 'delivered' || o.stage === 'canceled')
  if (o && (!finished || now - o.updatedAt < FINISHED_TRACK_HOLD)) return current
  const next = w.orderIds.find((id) => !['delivered', 'canceled'].includes(w.orders[id]?.stage))
  return next ?? current
}

export const useStore = create<Store>((set, get) => ({
  ...initialWorld(),
  selection: { kind: 'zone', id: 'entrada' },
  trackedOrderId: null,
  trackingPinned: false,
  speed: 1,
  paused: false,
  focusVersion: 0,

  dispatch: (ev) =>
    set((s) => {
      const next = applyEvent(s, ev)
      return { ...next, trackedOrderId: s.trackingPinned ? s.trackedOrderId : autoTrack(next, s.trackedOrderId, ev.at) }
    }),

  purge: (now) => {
    const { customers, selection } = get()
    const stale = Object.values(customers).filter((c) => c.leftAt !== undefined && now - c.leftAt > CUSTOMER_LINGER)
    if (stale.length === 0) return
    const next = { ...customers }
    for (const c of stale) delete next[c.id]
    const lostSelection = selection?.kind === 'customer' && !next[selection.id]
    set({ customers: next, ...(lostSelection ? { selection: { kind: 'zone', id: 'entrada' } } : {}) })
  },

  select: (selection, focus = true) =>
    set((s) => ({
      selection,
      focusVersion: focus ? s.focusVersion + 1 : s.focusVersion,
      trackedOrderId: selection?.kind === 'order' ? selection.id : s.trackedOrderId,
      trackingPinned: selection?.kind === 'order' ? true : s.trackingPinned,
    })),

  track: (trackedOrderId) => set({ trackedOrderId, trackingPinned: trackedOrderId !== null }),
  setSpeed: (speed) => set({ speed }),
  togglePause: () => set((s) => ({ paused: !s.paused })),
  reset: () => set({ ...initialWorld(), selection: { kind: 'zone', id: 'entrada' }, trackedOrderId: null, trackingPinned: false }),
}))
