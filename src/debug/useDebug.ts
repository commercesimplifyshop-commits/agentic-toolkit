import { create } from 'zustand'
import type { InstallMap } from '../map/useMap'
import { useStore } from '../store/useStore'
import { SCENARIO } from './scenario'
import { buildTrace, type Frame, type StepTrace } from './trace'

/** Seconds spent on each frame at 1×: customizations linger, core plumbing flies by */
const FRAME_SECONDS = { custom: 0.9, thirdparty: 0.9, native: 0.22, nativeHidden: 0.03 }
const WALK_SECONDS = 1.8

type Phase = 'idle' | 'walking' | 'running' | 'done'

interface DebugState {
  active: boolean
  traces: StepTrace[]
  stepIndex: number
  /** Frames of the current step already executed (0 = none) */
  executed: number
  phase: Phase
  playing: boolean
  speed: number
  onlyCustom: boolean
  openFrame: number | null
  elapsed: number

  open: (map: InstallMap) => void
  close: () => void
  play: () => void
  pause: () => void
  setSpeed: (speed: number) => void
  toggleOnlyCustom: () => void
  stepFrame: () => void
  nextStep: () => void
  goToStep: (index: number) => void
  restart: () => void
  toggleFrame: (n: number | null) => void
  tick: (dt: number) => void
}

const frameSeconds = (f: Frame, onlyCustom: boolean) =>
  f.origin === 'native' ? (onlyCustom ? FRAME_SECONDS.nativeHidden : FRAME_SECONDS.native) : FRAME_SECONDS[f.origin]

function focusStep(traces: StepTrace[], index: number) {
  const step = traces[index]?.step
  if (step) useStore.getState().select({ kind: 'zone', id: step.zone })
}

export const useDebug = create<DebugState>((set, get) => ({
  active: false,
  traces: [],
  stepIndex: 0,
  executed: 0,
  phase: 'idle',
  playing: false,
  speed: 1,
  onlyCustom: false,
  openFrame: null,
  elapsed: 0,

  open: (map) => {
    const traces = buildTrace(map, SCENARIO.steps)
    // The crowd simulation would only add noise while debugging a single flow
    useStore.setState({ paused: true })
    set({ active: true, traces, stepIndex: 0, executed: 0, phase: 'idle', playing: false, openFrame: null, elapsed: 0 })
    focusStep(traces, 0)
  },

  close: () => {
    useStore.setState({ paused: false })
    set({ active: false, playing: false })
  },

  play: () => {
    const { phase } = get()
    if (phase === 'done') get().restart()
    set((s) => ({ playing: true, phase: s.phase === 'idle' ? 'walking' : s.phase, elapsed: 0 }))
  },

  pause: () => set({ playing: false }),
  setSpeed: (speed) => set({ speed }),
  toggleOnlyCustom: () => set((s) => ({ onlyCustom: !s.onlyCustom })),
  toggleFrame: (n) => set((s) => ({ openFrame: s.openFrame === n ? null : n })),

  /** Executes exactly one frame (or the next customization when "only custom" is on). */
  stepFrame: () => {
    const { traces, stepIndex, executed, onlyCustom } = get()
    const frames = traces[stepIndex]?.frames ?? []
    if (executed >= frames.length) return get().nextStep()
    let next = executed + 1
    if (onlyCustom) while (next < frames.length && frames[next - 1].origin === 'native') next++
    set({ executed: next, phase: 'running', playing: false, elapsed: 0 })
  },

  nextStep: () => {
    const { traces, stepIndex } = get()
    if (stepIndex >= traces.length - 1) return set({ executed: traces[stepIndex].frames.length, phase: 'done', playing: false })
    set({ stepIndex: stepIndex + 1, executed: 0, phase: 'walking', elapsed: 0, openFrame: null })
    focusStep(traces, stepIndex + 1)
  },

  goToStep: (index) => {
    set({ stepIndex: index, executed: 0, phase: 'walking', elapsed: 0, openFrame: null })
    focusStep(get().traces, index)
  },

  restart: () => {
    set({ stepIndex: 0, executed: 0, phase: 'walking', elapsed: 0, openFrame: null })
    focusStep(get().traces, 0)
  },

  tick: (dt) => {
    const s = get()
    if (!s.active || !s.playing) return
    const elapsed = s.elapsed + dt * s.speed
    if (s.phase === 'walking') {
      if (elapsed >= WALK_SECONDS) set({ phase: 'running', elapsed: 0 })
      else set({ elapsed })
      return
    }
    if (s.phase !== 'running') return
    const frames = s.traces[s.stepIndex].frames
    if (s.executed >= frames.length) {
      if (elapsed >= 0.8) get().nextStep()
      else set({ elapsed })
      return
    }
    const current = frames[s.executed]
    if (elapsed >= frameSeconds(current, s.onlyCustom)) set({ executed: s.executed + 1, elapsed: 0 })
    else set({ elapsed })
  },
}))
