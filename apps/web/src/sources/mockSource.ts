import { AVATAR_COLORS, CATEGORIES, CITIES, SHIPPING_METHODS, TRAFFIC_SOURCES } from '../domain/catalog'
import type { CategoryId, Customer, PaymentMethod } from '../domain/types'
import { TRUCK_DRIVE_SECONDS } from '../domain/zones'
import type { SimSource, SourceContext } from './types'

const rand = (min: number, max: number) => min + Math.random() * (max - min)
const chance = (p: number) => Math.random() < p
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)]

function weighted<T>(entries: [T, number][]): T {
  let r = Math.random() * entries.reduce((s, [, w]) => s + w, 0)
  for (const [value, w] of entries) {
    if ((r -= w) <= 0) return value
  }
  return entries[0][0]
}

const MAX_ACTIVE_CUSTOMERS = 22

/**
 * Simulates a native Magento 2 B2C storefront and back-office:
 * sessions browsing → PDP → cart → two-step checkout → order → invoice →
 * WMS picking/packing → shipment → carrier delivery.
 */
export function createMockSource(): SimSource {
  let ctx: SourceContext
  let now = 0
  let queue: { at: number; run: () => void }[] = []
  let nextSpawnAt = 0.5
  let nextRestockCheck = 5
  const restocking = new Set<string>()
  let seq = { customer: 0, order: 100, quote: 4200, invoice: 300 }

  const schedule = (delay: number, run: () => void) => queue.push({ at: now + delay, run })
  const customer = (id: string): Customer | undefined => ctx.getState().customers[id]
  const emit: SourceContext['emit'] = (ev) => ctx.emit(ev)

  // ---- storefront ---------------------------------------------------------

  function spawn() {
    const id = `c${++seq.customer}`
    const label = `Cliente #${(0xa00 + seq.customer * 37).toString(16).toUpperCase()}`
    emit({ type: 'session.started', at: now, customerId: id, label, isGuest: chance(0.6), source: pick(TRAFFIC_SOURCES), color: pick(AVATAR_COLORS) })
    schedule(rand(2.5, 4), () => browse(id))
  }

  function browse(id: string) {
    const c = customer(id)
    if (!c) return
    const categoryId: CategoryId = c.categoryId && chance(0.4) ? c.categoryId : pick(CATEGORIES).id
    emit({ type: 'category.viewed', at: now, customerId: id, categoryId })
    schedule(rand(4, 7), () => (chance(0.82) ? viewProduct(id) : leave(id)))
  }

  function viewProduct(id: string) {
    const c = customer(id)
    if (!c) return
    const options = ctx.getState().products.filter((p) => p.categoryId === c.categoryId && p.stock > 0)
    if (options.length === 0) return browse(id)
    emit({ type: 'product.viewed', at: now, customerId: id, sku: pick(options).sku })
    schedule(rand(3.5, 6), () => afterProductView(id))
  }

  function afterProductView(id: string) {
    const c = customer(id)
    if (!c) return
    const hasCart = c.cart.length > 0
    const next = weighted<'add' | 'browse' | 'cart' | 'leave'>(
      hasCart ? [['add', 45], ['browse', 20], ['cart', 30], ['leave', 5]] : [['add', 52], ['browse', 30], ['leave', 18]],
    )
    if (next === 'add') return addToCart(id)
    if (next === 'browse') return browse(id)
    if (next === 'cart') {
      emit({ type: 'cart.viewed', at: now, customerId: id })
      return schedule(rand(3, 5), () => afterCart(id))
    }
    leave(id)
  }

  function addToCart(id: string) {
    const c = customer(id)
    if (!c?.viewingSku) return browse(id)
    const quoteId = c.quoteId ?? String(++seq.quote)
    emit({ type: 'cart.item_added', at: now, customerId: id, quoteId, sku: c.viewingSku, qty: chance(0.12) ? 2 : 1 })
    schedule(rand(3, 5), () => afterCart(id))
  }

  function afterCart(id: string) {
    const c = customer(id)
    if (!c) return
    if (c.cart.length < 3 && chance(0.3)) return browse(id)
    if (chance(0.8)) return shippingStep(id)
    leave(id, 'abandoned_cart')
  }

  function shippingStep(id: string) {
    const method = pick(SHIPPING_METHODS)
    emit({ type: 'checkout.shipping_step', at: now, customerId: id, shippingMethod: method.label, city: pick(CITIES) })
    schedule(rand(4, 6.5), () => (chance(0.87) ? paymentStep(id) : leave(id, 'checkout_abandoned')))
  }

  function paymentStep(id: string) {
    const method = weighted<PaymentMethod>([['pix', 45], ['cartao', 40], ['boleto', 15]])
    emit({ type: 'checkout.payment_step', at: now, customerId: id, paymentMethod: method })
    schedule(rand(4, 6), () => (chance(0.9) ? placeOrder(id) : leave(id, 'checkout_abandoned')))
  }

  function placeOrder(id: string) {
    const c = customer(id)
    if (!c || c.cart.length === 0) return
    const incrementId = String(++seq.order).padStart(9, '0')
    const shipping = SHIPPING_METHODS.find((m) => m.label === c.shippingMethod) ?? SHIPPING_METHODS[0]
    emit({ type: 'order.placed', at: now, customerId: id, incrementId, shippingAmount: shipping.price })
    schedule(1, () => leave(id, 'ordered'))
    orderLifecycle(incrementId, c.paymentMethod ?? 'cartao')
  }

  function leave(id: string, reason?: NonNullable<Customer['endReason']>) {
    const c = customer(id)
    if (!c || c.stage === 'leaving') return
    emit({ type: 'session.ended', at: now, customerId: id, reason: reason ?? (c.cart.length ? 'abandoned_cart' : 'left') })
  }

  // ---- back-office --------------------------------------------------------

  function orderLifecycle(incrementId: string, method: PaymentMethod) {
    const rules: Record<PaymentMethod, { delay: [number, number]; approve: number; reason: string }> = {
      cartao: { delay: [2, 4], approve: 0.92, reason: 'pagamento recusado pela operadora' },
      pix: { delay: [3, 7], approve: 0.95, reason: 'Pix expirado' },
      boleto: { delay: [14, 22], approve: 0.7, reason: 'boleto não compensado' },
    }
    const rule = rules[method]
    schedule(rand(...rule.delay), () => {
      if (!chance(rule.approve)) {
        return emit({ type: 'order.canceled', at: now, incrementId, reason: rule.reason })
      }
      emit({ type: 'order.invoiced', at: now, incrementId, invoiceId: `INV-${++seq.invoice}` })
      schedule(rand(2.5, 4), () => {
        emit({ type: 'fulfillment.picking', at: now, incrementId })
        schedule(rand(5, 8), () => {
          emit({ type: 'fulfillment.packing', at: now, incrementId })
          schedule(rand(3, 5), () => emit({ type: 'fulfillment.awaiting_pickup', at: now, incrementId }))
        })
      })
    })
  }

  function maybeDispatchTruck() {
    const { truck, orders } = ctx.getState()
    if (truck.phase !== 'docked' || now - truck.phaseStartedAt < 5) return
    const ready = Object.values(orders).filter((o) => o.stage === 'awaiting_pickup')
    if (ready.length === 0) return
    const oldestWait = now - Math.min(...ready.map((o) => o.updatedAt))
    if (ready.length < 3 && oldestWait < 10) return

    const shipments = ready.slice(0, 8).map((o) => ({
      incrementId: o.incrementId,
      carrier: o.shippingMethod.startsWith('Correios') ? 'Correios' : 'Transportadora Expressa',
      trackingNumber: o.shippingMethod.startsWith('Correios')
        ? `BR${Math.floor(rand(1e8, 1e9))}BR`
        : `TE-${Math.floor(rand(1e5, 1e6))}`,
    }))
    emit({ type: 'truck.departed', at: now, truckId: truck.id, shipments })
    for (const sh of shipments) {
      schedule(TRUCK_DRIVE_SECONDS + rand(1, 6), () => emit({ type: 'shipment.delivered', at: now, incrementId: sh.incrementId }))
    }
    schedule(TRUCK_DRIVE_SECONDS + 7, () => {
      emit({ type: 'truck.returning', at: now, truckId: truck.id })
      schedule(TRUCK_DRIVE_SECONDS, () => emit({ type: 'truck.returned', at: now, truckId: truck.id }))
    })
  }

  function restockLowInventory() {
    for (const p of ctx.getState().products) {
      if (p.stock > 2 || restocking.has(p.sku)) continue
      restocking.add(p.sku)
      schedule(rand(5, 9), () => {
        restocking.delete(p.sku)
        emit({ type: 'inventory.restocked', at: now, sku: p.sku, qty: 15 })
      })
    }
  }

  return {
    label: 'Simulação (dados mock)',

    start(c) {
      ctx = c
      now = c.now()
      queue = []
      seq = { customer: 0, order: 100, quote: 4200, invoice: 300 }
    },

    tick(t) {
      now = t
      if (now >= nextSpawnAt) {
        const active = Object.values(ctx.getState().customers).filter((c) => c.stage !== 'leaving').length
        if (active < MAX_ACTIVE_CUSTOMERS) spawn()
        nextSpawnAt = now + (now < 12 ? rand(0.8, 1.6) : rand(1.8, 3.4))
      }

      const due = queue.filter((q) => q.at <= now).sort((a, b) => a.at - b.at)
      if (due.length) {
        queue = queue.filter((q) => q.at > now)
        for (const task of due) task.run()
      }

      maybeDispatchTruck()
      if (now >= nextRestockCheck) {
        restockLowInventory()
        nextRestockCheck = now + 5
      }
    },

    stop() {
      queue = []
    },
  }
}
