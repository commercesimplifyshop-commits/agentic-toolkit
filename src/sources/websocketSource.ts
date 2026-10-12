import type { StoreEvent } from '../domain/types'
import type { SimSource } from './types'

/**
 * Real-data source (not wired yet). A Magento 2 module publishes StoreEvents
 * from observers (sales_order_place_after, sales_order_invoice_pay, ...) and
 * the storefront publishes navigation events; a small relay pushes them here.
 * Events arrive with real timestamps, so `at` is rewritten to the sim clock.
 */
export function createWebSocketSource(url: string): SimSource {
  let socket: WebSocket | null = null

  return {
    label: 'Magento ao vivo',

    start(ctx) {
      socket = new WebSocket(url)
      socket.onmessage = (msg) => {
        const ev = JSON.parse(msg.data) as StoreEvent
        ctx.emit({ ...ev, at: ctx.now() })
      }
    },

    stop() {
      socket?.close()
      socket = null
    },
  }
}
