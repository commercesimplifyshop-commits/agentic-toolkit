import { useMemo, useState } from 'react'
import { useDebug } from '../debug/useDebug'
import { KIND_LABEL, useMap } from '../map/useMap'
import { useStore } from '../store/useStore'
import { zoneLabel } from './InstallationPanel'

/** Project selector + search across every integration point of the installation. */
export function MapBar() {
  const { available, slug, map, load, focusItem, annotatedCount } = useMap()
  const select = useStore((s) => s.select)
  const debugging = useDebug((s) => s.active)
  const openDebug = useDebug((s) => s.open)
  const closeDebug = useDebug((s) => s.close)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!map || q.length < 2) return []
    const terms = q.split(/\s+/)
    return map.items
      .filter((i) => {
        const text = [i.title, i.subtitle, i.module, i.summary, JSON.stringify(i.details)].join(' ').toLowerCase()
        return terms.every((t) => text.includes(t))
      })
      .sort((a, b) => (a.origin === 'native' ? 1 : 0) - (b.origin === 'native' ? 1 : 0))
      .slice(0, 40)
  }, [map, query])

  if (available.length === 0) {
    return (
      <div className="mapbar card empty">
        Nenhum mapa de instalação. Rode <code>node tools/extract.mjs &lt;magento-root&gt; --name projeto</code>
      </div>
    )
  }

  const custom = map?.items.filter((i) => i.origin !== 'native').length ?? 0
  const risks = map?.items.filter((i) => i.risk).length ?? 0
  const highRisks = map?.items.filter((i) => i.risk?.level === 'alto').length ?? 0

  return (
    <div className="mapbar card">
      <select value={slug ?? ''} onChange={(e) => load(e.target.value || null)}>
        {available.map((m) => (
          <option key={m.slug} value={m.slug}>
            {m.name} · {m.edition} {m.magentoVersion}
          </option>
        ))}
      </select>
      {map && (
        <span className="map-meta">
          {map.modules.filter((m) => m.origin !== 'native').length} módulos · {custom} customizações · {annotatedCount} analisadas pelo Claude
        </span>
      )}
      {map && (
        <button className="debug-btn" onClick={() => (debugging ? closeDebug() : openDebug(map))} title="Simula um único pedido e mostra cada chamada em ordem">
          {debugging ? '✕ Sair do debug' : '🐞 Debug de fluxo'}
        </button>
      )}
      {risks > 0 && (
        <button className="risk-btn" onClick={() => select({ kind: 'risks' })} title="Pontos de atenção encontrados pelo Claude">
          ⚠ {risks} pontos de atenção{highRisks ? ` · ${highRisks} altos` : ''}
        </button>
      )}
      <div className="search-wrap">
        <input
          placeholder="Buscar na instalação: placeOrder, sales_order_save_after, payment…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        />
        {open && results.length > 0 && (
          <ul className="results card">
            {results.map((i) => (
              <li key={i.id}>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    select(i.zone === 'outros' ? { kind: 'unmapped' } : { kind: 'zone', id: i.zone })
                    focusItem(i.id)
                    setOpen(false)
                  }}
                >
                  <span className={`kind-tag k-${i.kind}`}>{KIND_LABEL[i.kind]}</span>
                  <span className="row-main">
                    <strong className="mono">{i.title}</strong>
                    <span className="muted">
                      {zoneLabel(i.zone)} · {i.module}
                    </span>
                  </span>
                  <span className={`origin-dot origin-${i.origin}`} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
