import type { FulfillmentStage, Order } from '../domain/types'
import { PAYMENT_LABEL } from '../domain/catalog'
import { useStore } from '../store/useStore'
import { brl, clockLabel } from './format'
import { FULFILLMENT_LABEL, STATUS_LABEL, STATUS_TONE } from './labels'

const STEPS: { label: string; stage: FulfillmentStage; icon: string }[] = [
  { label: 'Pedido realizado', stage: 'awaiting_payment', icon: '🧾' },
  { label: 'Pagamento', stage: 'invoiced', icon: '💳' },
  { label: 'Separação', stage: 'picking', icon: '📦' },
  { label: 'Embalagem', stage: 'packing', icon: '🎁' },
  { label: 'Enviado', stage: 'in_transit', icon: '🚚' },
  { label: 'Entregue', stage: 'delivered', icon: '🏠' },
]

const PROGRESS: Record<FulfillmentStage, number> = {
  awaiting_payment: 0,
  invoiced: 1,
  picking: 2,
  packing: 3,
  awaiting_pickup: 3,
  in_transit: 4,
  delivered: 5,
  canceled: 0,
}

export function OrderTracker() {
  const order = useStore((s) => (s.trackedOrderId ? s.orders[s.trackedOrderId] : undefined))
  const select = useStore((s) => s.select)
  const pinned = useStore((s) => s.trackingPinned)
  const track = useStore((s) => s.track)

  if (!order) {
    return (
      <section className="tracker card empty-state">
        <div className="panel-title">Rastreio de pedido</div>
        <p>Aguardando o primeiro pedido… os clientes estão navegando pela loja.</p>
      </section>
    )
  }

  const done = PROGRESS[order.stage]
  const canceled = order.stage === 'canceled'

  return (
    <section className="tracker card">
      <div className="tracker-head">
        <div className="panel-title">Rastreio de pedido</div>
        <span className={`badge ${STATUS_TONE[order.status]}`}>{STATUS_LABEL[order.status]}</span>
        <span className="muted">{FULFILLMENT_LABEL[order.stage]}</span>
        <button className="link-btn" onClick={() => (pinned ? track(null) : track(order.incrementId))}>
          {pinned ? 'Seguir pedidos automaticamente' : 'Acompanhando automaticamente · fixar este'}
        </button>
      </div>
      <div className="tracker-body">
        <ol className={`steps ${canceled ? 'canceled' : ''}`}>
          {STEPS.map((step, i) => {
            const state = canceled ? (i === 0 ? 'done' : 'off') : i < done || order.stage === 'delivered' ? 'done' : i === done ? 'current' : 'off'
            const at = order.stageAt[step.stage]
            return (
              <li key={step.stage} className={state}>
                <span className="step-icon">{step.icon}</span>
                <span className="step-label">{step.label}</span>
                <span className="step-time">{at !== undefined ? clockLabel(at) : '—'}</span>
              </li>
            )
          })}
        </ol>
        <OrderCard order={order} onOpen={() => select({ kind: 'order', id: order.incrementId })} />
      </div>
    </section>
  )
}

function OrderCard({ order, onOpen }: { order: Order; onOpen: () => void }) {
  return (
    <button className="order-card" onClick={onOpen}>
      <strong>#{order.incrementId}</strong>
      <span>Para: {order.city}</span>
      <span className="muted">
        {order.items.length} {order.items.length === 1 ? 'item' : 'itens'} · {brl(order.grandTotal)} · {PAYMENT_LABEL[order.paymentMethod]}
      </span>
      <span className="muted">{order.trackingNumber ? `${order.carrier} · ${order.trackingNumber}` : order.shippingMethod}</span>
    </button>
  )
}
