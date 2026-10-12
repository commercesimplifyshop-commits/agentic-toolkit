import { useShallow } from 'zustand/react/shallow'
import { clock } from '../sources/clock'
import { useStore } from '../store/useStore'
import { brl, clockLabel, pct } from './format'
import { useTick } from './useTick'

export function TopBar({ sourceLabel, onReset }: { sourceLabel: string; onReset: () => void }) {
  useTick(500)
  const stats = useStore((s) => s.stats)
  const { online, carts, cartValue } = useStore(
    useShallow((s) => {
      const active = Object.values(s.customers).filter((c) => c.stage !== 'leaving')
      const withCart = active.filter((c) => c.cart.length > 0)
      return {
        online: active.length,
        carts: withCart.length,
        cartValue: withCart.reduce((sum, c) => sum + c.cart.reduce((t, i) => t + i.price * i.qty, 0), 0),
      }
    }),
  )
  const { speed, paused, setSpeed, togglePause } = useStore(
    useShallow((s) => ({ speed: s.speed, paused: s.paused, setSpeed: s.setSpeed, togglePause: s.togglePause })),
  )
  const validOrders = stats.orders - stats.canceled

  return (
    <header className="topbar">
      <div className="brand card">
        <div className="logo">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <path d="M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 2.3 6.6 3.7L12 11.7 5.4 8 12 4.3ZM5 9.7l6 3.4v6.6l-6-3.4V9.7Zm8 10v-6.6l6-3.4v6.6l-6 3.4Z" fill="currentColor" />
          </svg>
        </div>
        <div>
          <strong>StoreFlow 3D</strong>
          <span>Magento 2 · Fluxo de pedido B2C</span>
        </div>
      </div>

      <div className="kpis">
        <Kpi label="Visitantes online" value={String(online)} hint={`${stats.sessions} sessões hoje`} />
        <Kpi label="Carrinhos ativos" value={String(carts)} hint={brl(cartValue)} />
        <Kpi label="Pedidos" value={String(stats.orders)} hint={`${stats.canceled} cancelados · ${stats.delivered} entregues`} />
        <Kpi label="Receita" value={brl(stats.revenue)} hint={`Ticket médio ${brl(validOrders ? stats.revenue / validOrders : 0)}`} />
        <Kpi label="Conversão" value={pct(stats.sessions ? stats.orders / stats.sessions : 0)} hint={`${stats.abandonedCarts} carrinhos abandonados`} />
      </div>

      <div className="controls card">
        <div className="live">
          <span className={`dot ${paused ? 'off' : ''}`} />
          <div>
            <strong>{sourceLabel}</strong>
            <span>Hora da loja {clockLabel(clock.t)}</span>
          </div>
        </div>
        <button className="icon-btn" onClick={togglePause} title={paused ? 'Continuar' : 'Pausar'}>
          {paused ? '▶' : '❚❚'}
        </button>
        <div className="segmented">
          {[1, 2, 4].map((v) => (
            <button key={v} className={speed === v ? 'on' : ''} onClick={() => setSpeed(v)}>
              {v}×
            </button>
          ))}
        </div>
        <button className="icon-btn" onClick={onReset} title="Reiniciar simulação">
          ↺
        </button>
      </div>
    </header>
  )
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="kpi card">
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      <span className="kpi-hint">{hint}</span>
    </div>
  )
}
