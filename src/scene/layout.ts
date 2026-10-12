import * as THREE from 'three'
import type { Customer, FulfillmentStage } from '../domain/types'
import { POINTS, SHELF_ROWS, zoneById } from '../domain/zones'

/** Last rendered position of every moving entity, used by the camera to fly to it. */
export const livePositions = new Map<string, THREE.Vector3>()

/** Stable pseudo-random number in [0, 1) derived from an id + salt. */
export function hash(id: string, salt = 0) {
  let h = 2166136261 ^ salt
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10000) / 10000
}

/** Walkway every customer uses to move between zones, so nobody walks through shelves. */
export const CORRIDOR_Z = 2.2

export function customerTarget(c: Customer): [number, number] {
  const a = hash(c.id, 1)
  const b = hash(c.id, 2)
  switch (c.stage) {
    case 'arriving': {
      const [x, z] = zoneById('entrada').center
      return [x - 1.5 + a * 3.5, z - 2.5 + b * 5]
    }
    case 'browsing': {
      const row = SHELF_ROWS[c.categoryId ?? 'roupas']
      return [-14.5 + a * 9, row + 1.1]
    }
    case 'viewing_product': {
      const angle = a * Math.PI * 2
      const r = 1.6 + b * 0.8
      return [POINTS.pdpPedestal[0] + Math.cos(angle) * r * 1.5, POINTS.pdpPedestal[1] + Math.sin(angle) * r * 0.8]
    }
    case 'cart': {
      const [x, z] = zoneById('carrinho').center
      return [x - 2 + a * 4, z - 1.2 + b * 2.8]
    }
    case 'checkout_shipping':
      return [POINTS.shippingCounter[0] - 1 + a * 2, POINTS.shippingCounter[1] + 1.6 + b * 3.5]
    case 'checkout_payment':
      return [POINTS.paymentCounter[0] - 1 + a * 2, POINTS.paymentCounter[1] + 1.6 + b * 3.5]
    case 'leaving':
      return [POINTS.spawn[0], POINTS.spawn[1] - 1 + b * 2]
  }
}

const GRID = (origin: [number, number], cols: number, gapX: number, gapZ: number, idx: number, y: number) =>
  new THREE.Vector3(origin[0] + (idx % cols) * gapX, y + Math.floor(idx / (cols * 3)) * 0.5, origin[1] + (Math.floor(idx / cols) % 3) * gapZ)

/** Where an order sits in the world for its fulfillment stage. */
export function orderSlot(stage: FulfillmentStage, idx: number): THREE.Vector3 | null {
  const [ax, az] = POINTS.adminDesk
  switch (stage) {
    case 'awaiting_payment':
      return GRID([ax - 2.5, az - 1.8], 4, 0.75, 0.9, idx, 1.25)
    case 'canceled':
      return GRID([ax + 0.5, az + 1.1], 4, 0.75, 0.6, idx, 1.25)
    case 'invoiced':
      return GRID([ax + 0.5, az - 1.8], 4, 0.75, 0.9, idx, 1.25)
    case 'picking':
      return GRID([POINTS.picking[0] - 1.3, POINTS.picking[1] - 1], 4, 0.95, 1, idx, 0.4)
    case 'packing':
      return GRID([POINTS.packing[0] - 1.4, POINTS.packing[1] - 0.2], 4, 0.95, 0.8, idx, 1.28)
    case 'awaiting_pickup':
      return GRID([POINTS.dock[0] - 1.6, POINTS.dock[1] - 1], 5, 0.8, 0.9, idx, 0.54)
    case 'in_transit':
    case 'delivered':
      return null
  }
}
