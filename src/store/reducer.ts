import { categoryName, createProducts, PAYMENT_LABEL } from '../domain/catalog'
import type { Customer, Order, Product, StoreEvent, Truck } from '../domain/types'
import { brl } from '../ui/format'

export interface Stats {
  sessions: number
  productViews: number
  addsToCart: number
  reachedCart: number
  reachedShipping: number
  reachedPayment: number
  orders: number
  revenue: number
  abandonedCarts: number
  abandonedValue: number
  canceled: number
  delivered: number
}

export type Ref = { kind: 'customer' | 'order'; id: string }

export interface LoggedEvent {
  id: number
  at: number
  type: StoreEvent['type']
  text: string
  magento: string
  ref?: Ref
}

export interface WorldState {
  customers: Record<string, Customer>
  orders: Record<string, Order>
  orderIds: string[] // newest first
  products: Product[]
  truck: Truck
  events: LoggedEvent[]
  stats: Stats
}

const MAX_EVENTS = 80
const MAX_HISTORY = 24
const MAX_ORDERS = 120

export function initialWorld(): WorldState {
  return {
    customers: {},
    orders: {},
    orderIds: [],
    products: createProducts(),
    truck: { id: 'TRK-01', phase: 'docked', phaseStartedAt: 0, orderIds: [] },
    events: [],
    stats: {
      sessions: 0, productViews: 0, addsToCart: 0, reachedCart: 0, reachedShipping: 0, reachedPayment: 0,
      orders: 0, revenue: 0, abandonedCarts: 0, abandonedValue: 0, canceled: 0, delivered: 0,
    },
  }
}

let logSeq = 0

const cartTotal = (c: Customer) => c.cart.reduce((sum, i) => sum + i.price * i.qty, 0)

function withHistory<T extends { history: { at: number; label: string }[] }>(entity: T, at: number, label: string): T {
  return { ...entity, history: [...entity.history, { at, label }].slice(-MAX_HISTORY) }
}

export function applyEvent(s: WorldState, ev: StoreEvent): WorldState {
  const log = (text: string, magento: string, ref?: Ref): LoggedEvent[] =>
    [{ id: ++logSeq, at: ev.at, type: ev.type, text, magento, ref }, ...s.events].slice(0, MAX_EVENTS)

  const patchCustomer = (id: string, patch: Partial<Customer>, label: string) => {
    const c = s.customers[id]
    return c ? { ...s.customers, [id]: withHistory({ ...c, ...patch }, ev.at, label) } : s.customers
  }

  const patchOrder = (id: string, patch: Partial<Order>, label: string) => {
    const o = s.orders[id]
    if (!o) return s.orders
    const stageAt = patch.stage ? { ...o.stageAt, [patch.stage]: ev.at } : o.stageAt
    return { ...s.orders, [id]: withHistory({ ...o, ...patch, stageAt, updatedAt: ev.at }, ev.at, label) }
  }

  const product = (sku: string) => s.products.find((p) => p.sku === sku)

  switch (ev.type) {
    case 'session.started': {
      const customer: Customer = {
        id: ev.customerId, label: ev.label, isGuest: ev.isGuest, source: ev.source, color: ev.color,
        stage: 'arriving', cart: [], history: [{ at: ev.at, label: `Entrou na loja via ${ev.source}` }],
      }
      return {
        ...s,
        customers: { ...s.customers, [ev.customerId]: customer },
        stats: { ...s.stats, sessions: s.stats.sessions + 1 },
        events: log(`${ev.label} entrou na loja${ev.isGuest ? ' (visitante)' : ' (logado)'}`, 'customer_session_init', { kind: 'customer', id: ev.customerId }),
      }
    }

    case 'category.viewed': {
      const c = s.customers[ev.customerId]
      if (!c) return s
      const name = categoryName(ev.categoryId)
      return {
        ...s,
        customers: patchCustomer(ev.customerId, { stage: 'browsing', categoryId: ev.categoryId, viewingSku: undefined }, `Navegou na categoria ${name}`),
        events: log(`${c.label} está vendo ${name}`, 'catalog_controller_category_init_after', { kind: 'customer', id: c.id }),
      }
    }

    case 'product.viewed': {
      const c = s.customers[ev.customerId]
      const p = product(ev.sku)
      if (!c || !p) return s
      return {
        ...s,
        customers: patchCustomer(c.id, { stage: 'viewing_product', viewingSku: p.sku, categoryId: p.categoryId }, `Abriu o produto ${p.name}`),
        products: s.products.map((x) => (x.sku === p.sku ? { ...x, views: x.views + 1 } : x)),
        stats: { ...s.stats, productViews: s.stats.productViews + 1 },
        events: log(`${c.label} abriu ${p.name}`, 'catalog_controller_product_view', { kind: 'customer', id: c.id }),
      }
    }

    case 'cart.item_added': {
      const c = s.customers[ev.customerId]
      const p = product(ev.sku)
      if (!c || !p) return s
      const existing = c.cart.find((i) => i.sku === p.sku)
      const cart = existing
        ? c.cart.map((i) => (i.sku === p.sku ? { ...i, qty: i.qty + ev.qty } : i))
        : [...c.cart, { sku: p.sku, name: p.name, qty: ev.qty, price: p.price }]
      const firstTime = c.cart.length === 0
      return {
        ...s,
        customers: patchCustomer(c.id, { stage: 'cart', cart, quoteId: ev.quoteId }, `Adicionou ${ev.qty}× ${p.name} ao carrinho`),
        products: s.products.map((x) => (x.sku === p.sku ? { ...x, addsToCart: x.addsToCart + 1 } : x)),
        stats: { ...s.stats, addsToCart: s.stats.addsToCart + 1, reachedCart: s.stats.reachedCart + (firstTime ? 1 : 0) },
        events: log(`${c.label} adicionou ${p.name} ao carrinho`, 'checkout_cart_add_product_complete', { kind: 'customer', id: c.id }),
      }
    }

    case 'cart.viewed': {
      const c = s.customers[ev.customerId]
      if (!c) return s
      return {
        ...s,
        customers: patchCustomer(c.id, { stage: 'cart' }, 'Voltou ao carrinho'),
        events: log(`${c.label} revisando o carrinho`, 'checkout_cart_index', { kind: 'customer', id: c.id }),
      }
    }

    case 'checkout.shipping_step': {
      const c = s.customers[ev.customerId]
      if (!c) return s
      return {
        ...s,
        customers: patchCustomer(c.id, { stage: 'checkout_shipping', shippingMethod: ev.shippingMethod, city: ev.city }, `Checkout: entrega para ${ev.city} (${ev.shippingMethod})`),
        stats: { ...s.stats, reachedShipping: s.stats.reachedShipping + 1 },
        events: log(`${c.label} preenchendo endereço de entrega`, 'checkout_index_index · shipping', { kind: 'customer', id: c.id }),
      }
    }

    case 'checkout.payment_step': {
      const c = s.customers[ev.customerId]
      if (!c) return s
      return {
        ...s,
        customers: patchCustomer(c.id, { stage: 'checkout_payment', paymentMethod: ev.paymentMethod }, `Checkout: pagamento via ${PAYMENT_LABEL[ev.paymentMethod]}`),
        stats: { ...s.stats, reachedPayment: s.stats.reachedPayment + 1 },
        events: log(`${c.label} escolheu ${PAYMENT_LABEL[ev.paymentMethod]}`, 'checkout_index_index · payment', { kind: 'customer', id: c.id }),
      }
    }

    case 'session.ended': {
      const c = s.customers[ev.customerId]
      if (!c) return s
      const abandoned = ev.reason === 'abandoned_cart' || ev.reason === 'checkout_abandoned'
      const value = cartTotal(c)
      const label = {
        left: 'Saiu da loja sem comprar',
        abandoned_cart: `Abandonou o carrinho (${brl(value)})`,
        checkout_abandoned: `Desistiu no checkout (${brl(value)})`,
        ordered: 'Saiu da loja após comprar',
      }[ev.reason]
      return {
        ...s,
        customers: patchCustomer(c.id, { stage: 'leaving', endReason: ev.reason, leftAt: ev.at }, label),
        stats: abandoned
          ? { ...s.stats, abandonedCarts: s.stats.abandonedCarts + 1, abandonedValue: s.stats.abandonedValue + value }
          : s.stats,
        events: ev.reason === 'ordered' ? s.events : log(`${c.label}: ${label[0].toLowerCase()}${label.slice(1)}`, abandoned ? 'quote ativa sem pedido' : 'fim da sessão', { kind: 'customer', id: c.id }),
      }
    }

    case 'order.placed': {
      const c = s.customers[ev.customerId]
      if (!c || c.cart.length === 0) return s
      const subtotal = cartTotal(c)
      const payment = c.paymentMethod ?? 'cartao'
      const order: Order = {
        incrementId: ev.incrementId,
        customerId: c.id,
        customerLabel: c.label,
        items: c.cart,
        subtotal,
        shippingAmount: ev.shippingAmount,
        grandTotal: subtotal + ev.shippingAmount,
        paymentMethod: payment,
        shippingMethod: c.shippingMethod ?? 'Correios PAC',
        city: c.city ?? 'São Paulo, SP',
        status: payment === 'cartao' ? 'pending' : 'pending_payment',
        stage: 'awaiting_payment',
        placedAt: ev.at,
        updatedAt: ev.at,
        stageAt: { awaiting_payment: ev.at },
        history: [{ at: ev.at, label: `Pedido realizado · ${PAYMENT_LABEL[payment]}` }],
      }
      // MSI reserves salable qty when the order is placed
      const products = s.products.map((p) => {
        const item = c.cart.find((i) => i.sku === p.sku)
        return item ? { ...p, stock: Math.max(0, p.stock - item.qty) } : p
      })
      const orderIds = [ev.incrementId, ...s.orderIds]
      const orders = { ...s.orders, [ev.incrementId]: order }
      for (const old of orderIds.slice(MAX_ORDERS)) delete orders[old]
      return {
        ...s,
        orders,
        orderIds: orderIds.slice(0, MAX_ORDERS),
        products,
        customers: patchCustomer(c.id, { cart: [] }, `Finalizou o pedido #${ev.incrementId}`),
        stats: { ...s.stats, orders: s.stats.orders + 1, revenue: s.stats.revenue + order.grandTotal },
        events: log(`Pedido #${ev.incrementId} criado · ${brl(order.grandTotal)}`, 'sales_order_place_after', { kind: 'order', id: ev.incrementId }),
      }
    }

    case 'order.invoiced':
      if (!s.orders[ev.incrementId]) return s
      return {
        ...s,
        orders: patchOrder(ev.incrementId, { status: 'processing', stage: 'invoiced', invoiceId: ev.invoiceId }, `Pagamento confirmado · fatura ${ev.invoiceId}`),
        events: log(`Pedido #${ev.incrementId} faturado`, 'sales_order_invoice_pay', { kind: 'order', id: ev.incrementId }),
      }

    case 'order.canceled': {
      const o = s.orders[ev.incrementId]
      if (!o) return s
      // Cancel compensates the MSI reservation
      const products = s.products.map((p) => {
        const item = o.items.find((i) => i.sku === p.sku)
        return item ? { ...p, stock: p.stock + item.qty } : p
      })
      return {
        ...s,
        products,
        orders: patchOrder(o.incrementId, { status: 'canceled', stage: 'canceled' }, `Cancelado: ${ev.reason}`),
        stats: { ...s.stats, canceled: s.stats.canceled + 1, revenue: s.stats.revenue - o.grandTotal },
        events: log(`Pedido #${o.incrementId} cancelado (${ev.reason})`, 'order_cancel_after', { kind: 'order', id: o.incrementId }),
      }
    }

    case 'fulfillment.picking':
      return {
        ...s,
        orders: patchOrder(ev.incrementId, { stage: 'picking' }, 'Em separação no CD'),
        events: log(`Pedido #${ev.incrementId} em separação`, 'WMS: pick list', { kind: 'order', id: ev.incrementId }),
      }

    case 'fulfillment.packing':
      return {
        ...s,
        orders: patchOrder(ev.incrementId, { stage: 'packing' }, 'Em embalagem'),
        events: log(`Pedido #${ev.incrementId} sendo embalado`, 'WMS: packing', { kind: 'order', id: ev.incrementId }),
      }

    case 'fulfillment.awaiting_pickup':
      return {
        ...s,
        orders: patchOrder(ev.incrementId, { stage: 'awaiting_pickup' }, 'Aguardando coleta na doca'),
        events: log(`Pedido #${ev.incrementId} pronto na doca`, 'WMS: ready to ship', { kind: 'order', id: ev.incrementId }),
      }

    case 'truck.departed': {
      let orders = s.orders
      for (const sh of ev.shipments) {
        const o = orders[sh.incrementId]
        if (!o) continue
        orders = {
          ...orders,
          [o.incrementId]: withHistory(
            { ...o, stage: 'in_transit', status: 'complete', trackingNumber: sh.trackingNumber, carrier: sh.carrier, updatedAt: ev.at, stageAt: { ...o.stageAt, in_transit: ev.at } },
            ev.at,
            `Enviado · ${sh.carrier} ${sh.trackingNumber}`,
          ),
        }
      }
      return {
        ...s,
        orders,
        truck: { ...s.truck, phase: 'outbound', phaseStartedAt: ev.at, orderIds: ev.shipments.map((x) => x.incrementId) },
        events: log(`Caminhão saiu com ${ev.shipments.length} envio(s)`, 'sales_order_shipment_save_after'),
      }
    }

    case 'shipment.delivered':
      if (!s.orders[ev.incrementId]) return s
      return {
        ...s,
        orders: patchOrder(ev.incrementId, { stage: 'delivered' }, 'Entregue ao cliente'),
        stats: { ...s.stats, delivered: s.stats.delivered + 1 },
        events: log(`Pedido #${ev.incrementId} entregue em ${s.orders[ev.incrementId].city}`, 'tracking webhook (transportadora)', { kind: 'order', id: ev.incrementId }),
      }

    case 'truck.returning':
      return { ...s, truck: { ...s.truck, phase: 'inbound', phaseStartedAt: ev.at, orderIds: [] } }

    case 'truck.returned':
      return { ...s, truck: { ...s.truck, phase: 'docked', phaseStartedAt: ev.at } }

    case 'inventory.restocked': {
      const p = product(ev.sku)
      if (!p) return s
      return {
        ...s,
        products: s.products.map((x) => (x.sku === ev.sku ? { ...x, stock: x.stock + ev.qty } : x)),
        events: log(`Reposição: +${ev.qty} un. de ${p.name}`, 'inventory_source_item_save'),
      }
    }
  }
}
