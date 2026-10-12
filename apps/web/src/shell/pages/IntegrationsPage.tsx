import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { KIND_LABEL, useMap, type ItemKind, type MapItem, type Origin } from '../../map/useMap'
import { ItemDetails, KindBadge, OriginBadge, RiskBadge } from '../components/ItemDetails'

/** Sidebar entries map to groups of kinds */
const GROUPS: Record<string, { title: string; description: string; kinds: ItemKind[]; icon: string }> = {
  all: { title: 'Mapa de integrações', description: 'Todos os pontos onde o projeto se pluga no Magento.', kinds: ['rest', 'graphql', 'plugin', 'preference', 'observer', 'route', 'cron', 'queue'], icon: '⇄' },
  api: { title: 'APIs REST & GraphQL', description: 'Rotas de webapi.xml (com ACL) e operações de schema.graphqls. Rotas customizadas que sobrescrevem rotas nativas aparecem marcadas.', kinds: ['rest', 'graphql'], icon: '⇄' },
  plugins: { title: 'Plugins & preferences', description: 'Interceptors (before/around/after) e classes do core reescritas por preference.', kinds: ['plugin', 'preference'], icon: '⟲' },
  events: { title: 'Eventos & observers', description: 'Observers declarados em events.xml, por evento e área.', kinds: ['observer'], icon: '⚡' },
  async: { title: 'Crons & filas', description: 'Jobs de crontab.xml e tópicos de fila (communication.xml).', kinds: ['cron', 'queue'], icon: '◷' },
  routes: { title: 'Rotas & controllers', description: 'frontNames de routes.xml (frontend e admin).', kinds: ['route'], icon: '⌁' },
}

const ORIGINS: Origin[] = ['custom', 'thirdparty', 'native']
const ZONES = ['entrada', 'catalogo', 'produto', 'carrinho', 'checkout', 'admin', 'armazem', 'expedicao', 'integracoes', 'outros']

export function IntegrationsPage() {
  const { id = '', kind = 'all' } = useParams()
  const group = GROUPS[kind] ?? GROUPS.all
  const { map, loadWorkspace } = useMap()
  const [origins, setOrigins] = useState<Set<Origin>>(new Set(['custom', 'thirdparty']))
  const [kinds, setKinds] = useState<Set<ItemKind>>(new Set(group.kinds))
  const [zone, setZone] = useState('')
  const [query, setQuery] = useState('')
  const [onlyRisks, setOnlyRisks] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [limit, setLimit] = useState(150)

  useEffect(() => {
    loadWorkspace(id)
  }, [id, loadWorkspace])
  useEffect(() => {
    setKinds(new Set(group.kinds))
    setOpen(null)
  }, [group])

  const inGroup = useMemo(() => map?.items.filter((i) => group.kinds.includes(i.kind)) ?? [], [map, group])
  const visible = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    return inGroup.filter(
      (i) =>
        origins.has(i.origin) &&
        kinds.has(i.kind) &&
        (!zone || i.zone === zone) &&
        (!onlyRisks || i.risk) &&
        terms.every((t) => [i.title, i.subtitle, i.module, i.summary, JSON.stringify(i.details)].join(' ').toLowerCase().includes(t)),
    )
  }, [inGroup, origins, kinds, zone, onlyRisks, query])

  const toggle = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    apply(next)
  }

  if (!map) return <div className="sf-page"><span className="sf-spinner" /></div>

  return (
    <div className="sf-page">
      <div className="sf-page-head">
        <div className="sf-page-icon">{group.icon}</div>
        <div className="sf-page-title">
          <h1>{group.title}</h1>
          <p>{group.description}</p>
        </div>
      </div>

      <div className="sf-card" style={{ marginBottom: 14 }}>
        <div className="sf-row" style={{ flexWrap: 'wrap', gap: 12 }}>
          <input className="sf-input" style={{ maxWidth: 360 }} placeholder="Filtrar: classe, evento, URL, módulo…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select className="sf-input" style={{ maxWidth: 200 }} value={zone} onChange={(e) => setZone(e.target.value)}>
            <option value="">Todas as etapas</option>
            {ZONES.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          <div className="sf-chips">
            {ORIGINS.map((o) => (
              <button key={o} className={`sf-chip ${origins.has(o) ? 'on' : ''}`} onClick={() => toggle(origins, o, setOrigins)}>
                {o === 'custom' ? 'Customizado' : o === 'thirdparty' ? 'Terceiros' : 'Nativo'}
                <b>{inGroup.filter((i) => i.origin === o).length}</b>
              </button>
            ))}
          </div>
          {group.kinds.length > 1 && (
            <div className="sf-chips">
              {group.kinds.map((k) => (
                <button key={k} className={`sf-chip ${kinds.has(k) ? 'on' : ''}`} onClick={() => toggle(kinds, k, setKinds)}>
                  {KIND_LABEL[k]}
                  <b>{inGroup.filter((i) => i.kind === k && origins.has(i.origin)).length}</b>
                </button>
              ))}
            </div>
          )}
          <button className={`sf-chip ${onlyRisks ? 'on' : ''}`} onClick={() => setOnlyRisks(!onlyRisks)}>
            ⚠ só com risco
          </button>
        </div>
      </div>

      <div className="sf-card" style={{ padding: 0 }}>
        <table className="sf-table">
          <thead>
            <tr>
              <th style={{ width: 90 }}>Tipo</th>
              <th>Ponto de integração</th>
              <th style={{ width: 220 }}>Módulo</th>
              <th style={{ width: 120 }}>Etapa</th>
              <th style={{ width: 96, textAlign: 'right' }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {visible.slice(0, limit).map((i) => (
              <Row key={i.id} item={i} open={open === i.id} onToggle={() => setOpen(open === i.id ? null : i.id)} workspaceId={id} />
            ))}
          </tbody>
        </table>
        {visible.length === 0 && <div className="sf-empty">Nada com esses filtros.</div>}
        {visible.length > limit && (
          <div style={{ padding: 12, textAlign: 'center' }}>
            <button className="sf-btn small" onClick={() => setLimit(limit + 300)}>
              Mostrar mais ({visible.length - limit})
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ item, open, onToggle, workspaceId }: { item: MapItem; open: boolean; onToggle: () => void; workspaceId: string }) {
  const overrides = item.details.overridesNative as string | undefined
  const acl = item.details.acl as string[] | undefined
  return (
    <>
      <tr className={`clickable ${open ? 'sf-row-open' : ''}`} onClick={onToggle}>
        <td>
          <KindBadge kind={item.kind} />
        </td>
        <td>
          <div className="sf-mono" style={{ color: 'var(--sf-text)', overflowWrap: 'anywhere' }}>
            {item.title}
          </div>
          <div className="sf-muted" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>
            {item.subtitle}
          </div>
          {!open && item.summary && <div style={{ fontSize: 12, color: '#fdba74', marginTop: 3 }}>{item.summary}</div>}
          <div className="sf-row" style={{ marginTop: 4, gap: 6, flexWrap: 'wrap' }}>
            <RiskBadge item={item} />
            {acl?.includes('anonymous') && <span className="sf-badge yellow">ACL anonymous</span>}
            {overrides && <span className="sf-badge purple">sobrescreve rota nativa</span>}
            {(item.details.aroundWithoutProceed as string[] | undefined)?.length ? <span className="sf-badge red">around sem $proceed</span> : null}
          </div>
        </td>
        <td>
          <div style={{ fontSize: 12.5 }}>{item.module}</div>
          <OriginBadge origin={item.origin} />
        </td>
        <td className="sf-muted">{item.zone}</td>
        <td style={{ textAlign: 'right' }}>
          <button
            className={`sf-actions-btn ${open ? 'on' : ''}`}
            aria-expanded={open}
            title={open ? 'Fechar ações' : 'Abrir XML, classe PHP' + (item.kind === 'rest' || item.kind === 'graphql' ? ', testar no simulador' : '')}
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
          >
            Ações <span className="chev">▾</span>
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} style={{ background: 'var(--sf-panel-2)' }}>
            <ItemDetails item={item} workspaceId={workspaceId} />
          </td>
        </tr>
      )}
    </>
  )
}
