import { useStore } from '../store/useStore'
import { clock } from './clock'
import type { SimSource } from './types'

const STEP_MS = 100

/** Drives the simulation clock and feeds a source's events into the store. */
export function startRuntime(source: SimSource) {
  const store = useStore
  source.start({
    emit: (ev) => store.getState().dispatch(ev),
    getState: () => store.getState(),
    now: () => clock.t,
  })

  const timer = window.setInterval(() => {
    const { paused, speed, purge } = store.getState()
    if (paused) return
    clock.t += (STEP_MS / 1000) * speed
    source.tick?.(clock.t)
    purge(clock.t)
  }, STEP_MS)

  return () => {
    window.clearInterval(timer)
    source.stop()
  }
}
