import { useShallow } from 'zustand/react/shallow'
import type { CustomerStage, FulfillmentStage } from '../domain/types'
import { ZONES, type ZoneId } from '../domain/zones'
import { useMap } from '../map/useMap'
import { useStore } from '../store/useStore'

const CUSTOMER_STAGES: Partial<Record<ZoneId, CustomerStage[]>> = {
  entrada: ['arriving'],
  catalogo: ['browsing'],
  produto: ['viewing_product'],
  carrinho: ['cart'],
  checkout: ['checkout_shipping', 'checkout_payment'],
}

const ORDER_STAGES: Partial<Record<ZoneId, FulfillmentStage[]>> = {
  admin: ['awaiting_payment', 'invoiced'],
  armazem: ['picking', 'packing'],
  expedicao: ['awaiting_pickup', 'in_transit'],
}

export function FlowNav() {
  const selection = useStore((s) => s.selection)
  const select = useStore((s) => s.select)
  const counts = useStore(
    useShallow((s) => {
      const out: Record<string, number> = {}
      const customers = Object.values(s.customers)
      const orders = Object.values(s.orders)
      for (const z of ZONES) {
        const cs = CUSTOMER_STAGES[z.id]
        const os = ORDER_STAGES[z.id]
        out[z.id] = cs ? customers.filter((c) => cs.includes(c.stage)).length : os ? orders.filter((o) => os.includes(o.stage)).length : -1
      }
      return out
    }),
  )

  const map = useMap((s) => s.map)
  const customCount = (zone: string) => map?.items.filter((i) => i.zone === zone && i.origin !== 'native').length ?? 0
  const riskCount = (zone: string) => map?.items.filter((i) => i.zone === zone && (i.risk?.level === 'alto' || i.risk?.level === 'medio')).length ?? 0
  let lastSide = ''
  return (
    <nav className="flownav card">
      <div className="panel-title">Fluxo do pedido</div>
      {ZONES.map((z) => {
        const header = z.side !== lastSide ? <div className="side-label">{z.side}</div> : null
        lastSide = z.side
        const active = selection?.kind === 'zone' && selection.id === z.id
        const isOrders = Boolean(ORDER_STAGES[z.id])
        return (
          <div key={z.id}>
            {header}
            <button className={`flow-item ${active ? 'active' : ''}`} onClick={() => select({ kind: 'zone', id: z.id })}>
              <span className="num" style={{ background: z.color }}>{z.step}</span>
              <span className="flow-name">{z.name}</span>
              {counts[z.id] >= 0 && (
                <span className="count" title={isOrders ? 'pedidos nesta etapa' : 'clientes nesta etapa'}>
                  {counts[z.id]}
                  <small>{isOrders ? 'ped.' : 'cli.'}</small>
                </span>
              )}
              {map && riskCount(z.id) > 0 && <span className="risk-chip" title="pontos de atenção (alto/médio)">⚠{riskCount(z.id)}</span>}
              {map && <span className="custom-chip" title="customizações nesta etapa">{customCount(z.id)}</span>}
            </button>
          </div>
        )
      })}
      {map && (
        <button className={`flow-item ${selection?.kind === 'unmapped' ? 'active' : ''}`} onClick={() => select({ kind: 'unmapped' })}>
          <span className="num" style={{ background: '#e2e8f0' }}>?</span>
          <span className="flow-name">Não classificados</span>
          <span className="custom-chip">{customCount('outros')}</span>
        </button>
      )}
    </nav>
  )
}
