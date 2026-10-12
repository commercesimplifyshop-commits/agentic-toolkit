import type { StoreEvent } from '../domain/types'
import type { WorldState } from '../store/reducer'

export interface SourceContext {
  emit: (ev: StoreEvent) => void
  getState: () => WorldState
  now: () => number
}

/**
 * Anything that produces StoreEvents: the mock simulator today, a WebSocket
 * fed by a Magento module tomorrow. The 3D world only consumes events.
 */
export interface SimSource {
  label: string
  start(ctx: SourceContext): void
  /** Called every simulation step (only needed by time-driven sources). */
  tick?(now: number): void
  stop(): void
}
