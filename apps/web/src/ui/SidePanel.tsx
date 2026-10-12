import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { CATEGORIES, PAYMENT_LABEL } from '../domain/catalog'
import type { Customer, CustomerStage, FulfillmentStage, Order } from '../domain/types'
import { zoneById, type ZoneId } from '../domain/zones'
import { clock } from '../sources/clock'
import { useMap } from '../map/useMap'
import { useStore } from '../store/useStore'
import { InstallationPanel, ItemRow, zoneLabel } from './InstallationPanel'
import { brl, clockLabel, pct } from './format'
import { FULFILLMENT_LABEL, STAGE_LABEL, STATUS_LABEL, STATUS_TONE } from './labels'
import { useTick } from './useTick'

export function SidePanel() {
  const selection = useStore((s) => s.selection)
  if (!selection) return null
  return (
    <aside className="sidepanel card">
      {selection.kind === 'zone' && <ZonePanel id={selection.id} />}
      {selection.kind === 'customer' && <CustomerPanel id={selection.id} />}
      {selection.kind === 'order' && <OrderPanel id={selection.id} />}
      {selection.kind === 'unmapped' && <UnmappedPanel />}
      {selection.kind === 'risks' && <RisksPanel />}
    </aside>
  )
}

function PanelHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  const select = useStore((s) => s.select)
  return (
    <div className="panel-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      <button className="icon-btn" onClick={() => select(null, false)} title="Fechar">
        ✕
      </button>
    </div>
  )
}

function MagentoBox({ items }: { items: string[] }) {
  return (
    <div className="magento-box">
      <span className="eyebrow">No Magento 2</span>
      <ul>
        {items.map((i) => (
          <li key={i}>
            <code>{i}</code>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---- zones -------------------------------------------------------------------

const RISK_ORDER = { alto: 0, medio: 1, baixo: 2 }

function RisksPanel() {
  const map = useMap((s) => s.map)
  if (!map) return null
  const risky = map.items.filter((i) => i.risk).sort((a, b) => RISK_ORDER[a.risk!.level] - RISK_ORDER[b.risk!.level])
  return (
    <>
      <PanelHeader
        eyebrow="Análise do Claude"
        title="Pontos de atenção"
        subtitle="Achados na leitura do código. São hipóteses fortes, não vulnerabilidades confirmadas: reproduza em ambiente dev antes de reportar."
      />
      <div className="panel-body">
        <ul className="items install">
          {risky.map((i) => (
            <div key={i.id}>
              <span className="muted small">{zoneLabel(i.zone)}</span>
              <ItemRow item={i} root={map.project.root} reference={map.project.nativeReference} />
            </div>
          ))}
        </ul>
      </div>
    </>
  )
}

function UnmappedPanel() {
  return (
    <>
      <PanelHeader eyebrow="Mapa da instalação" title="Não classificados" subtitle="Pontos de integração que as regras não souberam encaixar no fluxo. Rode /magento-map para o Claude analisar o código e classificá-los." />
      <div className="panel-body">
        <InstallationPanel zone="outros" />
      </div>
    </>
  )
}

function ZonePanel({ id }: { id: ZoneId }) {
  const zone = zoneById(id)
  const hasMap = useMap((s) => s.map !== null)
  const [tab, setTab] = useState<'install' | 'live'>('install')
  const showInstall = hasMap && tab === 'install'
  return (
    <>
      <PanelHeader eyebrow={`Etapa ${zone.step} · ${zone.side}`} title={zone.name} subtitle={zone.summary} />
      {hasMap && (
        <div className="tabs">
          <button className={tab === 'install' ? 'on' : ''} onClick={() => setTab('install')}>
            Na instalação
          </button>
          <button className={tab === 'live' ? 'on' : ''} onClick={() => setTab('live')}>
            Simulação ao vivo
          </button>
        </div>
      )}
      {showInstall ? (
        <div className="panel-body">
          <InstallationPanel zone={id} />
        </div>
      ) : (
      <div className="panel-body">
        {id === 'entrada' && <EntradaZone />}
        {id === 'catalogo' && <CatalogZone />}
        {id === 'produto' && <ProductZone />}
        {id === 'carrinho' && <CartZone />}
        {id === 'checkout' && <CheckoutZone />}
        {id === 'admin' && <AdminZone />}
        {id === 'armazem' && <WarehouseZone />}
        {id === 'expedicao' && <ShippingZone />}
        {id === 'integracoes' && <p className="muted small">A simulação não gera eventos de integração. Veja a aba "Na instalação".</p>}
        <MagentoBox items={zone.magento} />
      </div>
      )}
    </>
  )
}

function useCustomersIn(stages: CustomerStage[]) {
  return useStore(useShallow((s) => Object.values(s.customers).filter((c) => stages.includes(c.stage))))
}

function useOrdersIn(stages: FulfillmentStage[]) {
  return useStore(useShallow((s) => s.orderIds.map((id) => s.orders[id]).filter((o) => o && stages.includes(o.stage))))
}

function CustomerList({ customers, detail }: { customers: Customer[]; detail: (c: Customer) => string }) {
  const select = useStore((s) => s.select)
  if (customers.length === 0) return <p className="muted small">Ninguém nesta etapa agora.</p>
  return (
    <ul className="rows">
      {customers.map((c) => (
        <li key={c.id}>
          <button onClick={() => select({ kind: 'customer', id: c.id })}>
            <span className="avatar-dot" style={{ background: c.color }} />
            <span className="row-main">
              <strong>{c.label}</strong>
              <span className="muted">{detail(c)}</span>
            </span>
            <span className="chev">›</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function OrderList({ orders, empty = 'Nenhum pedido nesta etapa.' }: { orders: Order[]; empty?: string }) {
  const select = useStore((s) => s.select)
  if (orders.length === 0) return <p className="muted small">{empty}</p>
  return (
    <ul className="rows">
      {orders.map((o) => (
        <li key={o.incrementId}>
          <button onClick={() => select({ kind: 'order', id: o.incrementId })}>
            <span className="row-main">
              <strong>#{o.incrementId}</strong>
              <span className="muted">
                {o.customerLabel} · {brl(o.grandTotal)} · {PAYMENT_LABEL[o.paymentMethod]}
              </span>
            </span>
            <span className={`badge ${STATUS_TONE[o.status]}`}>{STATUS_LABEL[o.status]}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <div className="stat">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
)

function EntradaZone() {
  const stats = useStore((s) => s.stats)
  const customers = useStore(useShallow((s) => Object.values(s.customers).filter((c) => c.stage !== 'leaving')))
  const guests = customers.filter((c) => c.isGuest).length
  return (
    <>
      <div className="stats">
        <Stat label="Online agora" value={customers.length} />
        <Stat label="Visitantes / logados" value={`${guests} / ${customers.length - guests}`} />
        <Stat label="Sessões hoje" value={stats.sessions} />
      </div>
      <h3>Sessões ativas</h3>
      <CustomerList customers={customers} detail={(c) => `${STAGE_LABEL[c.stage]} · ${c.source}`} />
    </>
  )
}

function CatalogZone() {
  const products = useStore((s) => s.products)
  const browsing = useCustomersIn(['browsing'])
  return (
    <>
      {CATEGORIES.map((cat) => (
        <div key={cat.id} className="category">
          <h3>
            <span className="swatch" style={{ background: cat.color }} /> {cat.name}
            <span className="muted small"> · {browsing.filter((c) => c.categoryId === cat.id).length} navegando</span>
          </h3>
          <ul className="products">
            {products
              .filter((p) => p.categoryId === cat.id)
              .map((p) => (
                <li key={p.sku}>
                  <span className="product-thumb" style={{ background: p.color }} />
                  <span className="row-main">
                    <strong>{p.name}</strong>
                    <span className="muted">{p.sku}</span>
                  </span>
                  <span className="product-meta">
                    <strong>{brl(p.price)}</strong>
                    <span className={p.stock <= 2 ? 'stock low' : 'stock'}>{p.stock} em estoque</span>
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </>
  )
}

function ProductZone() {
  const products = useStore((s) => s.products)
  const viewing = useCustomersIn(['viewing_product'])
  const top = [...products].sort((a, b) => b.views - a.views).slice(0, 6)
  return (
    <>
      <h3>Vendo um produto agora</h3>
      <CustomerList customers={viewing} detail={(c) => products.find((p) => p.sku === c.viewingSku)?.name ?? ''} />
      <h3>Mais vistos (PDP → carrinho)</h3>
      <ul className="products">
        {top.map((p) => (
          <li key={p.sku}>
            <span className="product-thumb" style={{ background: p.color }} />
            <span className="row-main">
              <strong>{p.name}</strong>
              <span className="muted">
                {p.views} views · {p.addsToCart} add-to-cart
              </span>
            </span>
            <span className="product-meta">
              <strong>{pct(p.views ? p.addsToCart / p.views : 0)}</strong>
              <span className="muted small">conversão</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

const cartValue = (c: Customer) => c.cart.reduce((t, i) => t + i.price * i.qty, 0)

function CartZone() {
  const stats = useStore((s) => s.stats)
  const withCart = useStore(useShallow((s) => Object.values(s.customers).filter((c) => c.cart.length > 0 && c.stage !== 'leaving')))
  return (
    <>
      <div className="stats">
        <Stat label="Quotes ativas" value={withCart.length} />
        <Stat label="Abandonados" value={stats.abandonedCarts} />
        <Stat label="Valor abandonado" value={brl(stats.abandonedValue)} />
      </div>
      <h3>Carrinhos ativos</h3>
      <CustomerList
        customers={withCart}
        detail={(c) => `Quote ${c.quoteId} · ${c.cart.reduce((n, i) => n + i.qty, 0)} itens · ${brl(cartValue(c))}`}
      />
    </>
  )
}

function CheckoutZone() {
  const stats = useStore((s) => s.stats)
  const shipping = useCustomersIn(['checkout_shipping'])
  const payment = useCustomersIn(['checkout_payment'])
  const steps = [
    { label: 'Sessões', value: stats.sessions },
    { label: 'Adicionou ao carrinho', value: stats.reachedCart },
    { label: 'Etapa de entrega', value: stats.reachedShipping },
    { label: 'Etapa de pagamento', value: stats.reachedPayment },
    { label: 'Pedido realizado', value: stats.orders },
  ]
  const max = Math.max(1, steps[0].value)
  return (
    <>
      <h3>Funil de conversão</h3>
      <ul className="funnel">
        {steps.map((s) => (
          <li key={s.label}>
            <span>{s.label}</span>
            <div className="bar">
              <div style={{ width: `${(s.value / max) * 100}%` }} />
            </div>
            <strong>{s.value}</strong>
          </li>
        ))}
      </ul>
      <h3>Etapa 1 · Entrega ({shipping.length})</h3>
      <CustomerList customers={shipping} detail={(c) => `${c.city} · ${c.shippingMethod}`} />
      <h3>Etapa 2 · Pagamento ({payment.length})</h3>
      <CustomerList customers={payment} detail={(c) => `${c.paymentMethod ? PAYMENT_LABEL[c.paymentMethod] : ''} · ${brl(cartValue(c))}`} />
    </>
  )
}

function AdminZone() {
  const recent = useStore(useShallow((s) => s.orderIds.slice(0, 14).map((id) => s.orders[id])))
  const awaiting = useOrdersIn(['awaiting_payment'])
  const invoiced = useOrdersIn(['invoiced'])
  const ordersToday = useStore((s) => s.stats.orders)
  return (
    <>
      <div className="stats">
        <Stat label="Aguardando pagamento" value={awaiting.length} />
        <Stat label="Faturados" value={invoiced.length} />
        <Stat label="Pedidos hoje" value={ordersToday} />
      </div>
      <h3>Vendas › Pedidos</h3>
      <OrderList orders={recent} empty="Nenhum pedido ainda." />
    </>
  )
}

function WarehouseZone() {
  const picking = useOrdersIn(['picking'])
  const packing = useOrdersIn(['packing'])
  const invoiced = useOrdersIn(['invoiced'])
  return (
    <>
      <div className="stats">
        <Stat label="Na fila" value={invoiced.length} />
        <Stat label="Separando" value={picking.length} />
        <Stat label="Embalando" value={packing.length} />
      </div>
      <h3>Separação (picking)</h3>
      <OrderList orders={picking} />
      <h3>Embalagem (packing)</h3>
      <OrderList orders={packing} />
    </>
  )
}

const TRUCK_LABEL = { docked: 'Na doca, carregando', outbound: 'Em rota de entrega', inbound: 'Voltando para a doca' }

function ShippingZone() {
  useTick(1000)
  const truck = useStore((s) => s.truck)
  const ready = useOrdersIn(['awaiting_pickup'])
  const transit = useOrdersIn(['in_transit'])
  const delivered = useOrdersIn(['delivered'])
  return (
    <>
      <div className="truck-status">
        <span className="truck-icon">🚚</span>
        <div>
          <strong>{truck.id}</strong>
          <span className="muted">
            {TRUCK_LABEL[truck.phase]}
            {truck.phase !== 'docked' && ` · há ${Math.round(clock.t - truck.phaseStartedAt)}s`}
          </span>
        </div>
      </div>
      <h3>Aguardando coleta ({ready.length})</h3>
      <OrderList orders={ready} />
      <h3>Em trânsito ({transit.length})</h3>
      <OrderList orders={transit} />
      <h3>Entregues recentemente</h3>
      <OrderList orders={delivered.slice(0, 6)} empty="Nenhuma entrega ainda." />
    </>
  )
}

// ---- entities -----------------------------------------------------------------

function History({ entries }: { entries: { at: number; label: string }[] }) {
  return (
    <ol className="history">
      {[...entries].reverse().map((h, i) => (
        <li key={`${h.at}-${i}`}>
          <time>{clockLabel(h.at)}</time>
          <span>{h.label}</span>
        </li>
      ))}
    </ol>
  )
}

function CustomerPanel({ id }: { id: string }) {
  const c = useStore((s) => s.customers[id])
  const orders = useStore(useShallow((s) => s.orderIds.map((oid) => s.orders[oid]).filter((o) => o?.customerId === id)))
  if (!c) return <PanelHeader eyebrow="Cliente" title="Sessão encerrada" />
  return (
    <>
      <PanelHeader eyebrow={c.isGuest ? 'Visitante (guest)' : 'Cliente logado'} title={c.label} subtitle={`Origem: ${c.source}`} />
      <div className="panel-body">
        <div className="stage-pill" style={{ borderColor: c.color }}>
          <span className="avatar-dot" style={{ background: c.color }} />
          {STAGE_LABEL[c.stage]}
        </div>
        <h3>Carrinho {c.quoteId && <span className="muted small">· quote {c.quoteId}</span>}</h3>
        {c.cart.length === 0 ? (
          <p className="muted small">{orders.length ? 'Carrinho convertido em pedido.' : 'Carrinho vazio.'}</p>
        ) : (
          <ul className="rows plain">
            {c.cart.map((i) => (
              <li key={i.sku}>
                <span className="row-main">
                  <strong>
                    {i.qty}× {i.name}
                  </strong>
                  <span className="muted">{i.sku}</span>
                </span>
                <strong>{brl(i.price * i.qty)}</strong>
              </li>
            ))}
            <li className="total">
              <span>Subtotal</span>
              <strong>{brl(cartValue(c))}</strong>
            </li>
          </ul>
        )}
        {orders.length > 0 && (
          <>
            <h3>Pedidos</h3>
            <OrderList orders={orders} />
          </>
        )}
        <h3>Jornada</h3>
        <History entries={c.history} />
      </div>
    </>
  )
}

function OrderPanel({ id }: { id: string }) {
  const o = useStore((s) => s.orders[id])
  if (!o) return <PanelHeader eyebrow="Pedido" title="Pedido não encontrado" />
  return (
    <>
      <PanelHeader eyebrow="Vendas › Pedido" title={`#${o.incrementId}`} subtitle={`${o.customerLabel} · ${o.city}`} />
      <div className="panel-body">
        <div className="stats">
          <div className="stat">
            <span>Status Magento</span>
            <span className={`badge ${STATUS_TONE[o.status]}`}>{STATUS_LABEL[o.status]}</span>
          </div>
          <Stat label="Etapa" value={FULFILLMENT_LABEL[o.stage]} />
        </div>
        <h3>Itens</h3>
        <ul className="rows plain">
          {o.items.map((i) => (
            <li key={i.sku}>
              <span className="row-main">
                <strong>
                  {i.qty}× {i.name}
                </strong>
                <span className="muted">{i.sku}</span>
              </span>
              <strong>{brl(i.price * i.qty)}</strong>
            </li>
          ))}
          <li className="sub">
            <span>Subtotal</span>
            <span>{brl(o.subtotal)}</span>
          </li>
          <li className="sub">
            <span>Frete · {o.shippingMethod}</span>
            <span>{brl(o.shippingAmount)}</span>
          </li>
          <li className="total">
            <span>Total</span>
            <strong>{brl(o.grandTotal)}</strong>
          </li>
        </ul>
        <dl className="facts">
          <dt>Pagamento</dt>
          <dd>{PAYMENT_LABEL[o.paymentMethod]}</dd>
          <dt>Fatura</dt>
          <dd>{o.invoiceId ?? '—'}</dd>
          <dt>Rastreio</dt>
          <dd>{o.trackingNumber ? `${o.carrier} · ${o.trackingNumber}` : '—'}</dd>
        </dl>
        <h3>Histórico</h3>
        <History entries={o.history} />
      </div>
    </>
  )
}
