import { useEffect, useMemo, useRef, useState } from 'react'
import { zoneById } from '../domain/zones'
import { KIND_LABEL, ORIGIN_LABEL, useMap, vscodeLink, type ItemKind, type MapItem, type MapZone, type Origin, type RiskLevel } from '../map/useMap'

const KIND_ORDER: ItemKind[] = ['rest', 'graphql', 'plugin', 'preference', 'observer', 'route', 'cron', 'queue']
const ORIGINS: Origin[] = ['custom', 'thirdparty', 'native']

export const zoneLabel = (z: MapZone) => (z === 'outros' ? 'Não classificados' : zoneById(z).name)

export function InstallationPanel({ zone }: { zone: MapZone }) {
  const map = useMap((s) => s.map)
  const note = useMap((s) => s.zoneNotes?.[zone])
  const focusItemId = useMap((s) => s.focusItemId)
  const [origins, setOrigins] = useState<Set<Origin>>(new Set(['custom', 'thirdparty']))
  const [kinds, setKinds] = useState<Set<ItemKind>>(new Set(KIND_ORDER))
  const [query, setQuery] = useState('')

  const inZone = useMemo(() => map?.items.filter((i) => i.zone === zone) ?? [], [map, zone])
  const focused = inZone.find((i) => i.id === focusItemId)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return inZone.filter(
      (i) => origins.has(i.origin) && kinds.has(i.kind) && (!q || searchText(i).includes(q)) && i.id !== focused?.id,
    )
  }, [inZone, origins, kinds, query, focused])

  if (!map) return null

  const toggle = <T,>(set: Set<T>, value: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    apply(next)
  }

  const originCount = (o: Origin) => inZone.filter((i) => i.origin === o).length
  const kindCount = (k: ItemKind) => inZone.filter((i) => i.kind === k && origins.has(i.origin)).length

  return (
    <div className="install">
      <div className="chips">
        {ORIGINS.map((o) => (
          <button key={o} className={`chip origin-${o} ${origins.has(o) ? 'on' : ''}`} onClick={() => toggle(origins, o, setOrigins)}>
            {ORIGIN_LABEL[o]} <b>{originCount(o)}</b>
          </button>
        ))}
      </div>

      {note && (
        <div className="claude-note">
          <span className="eyebrow">Análise do Claude</span>
          <p>{note}</p>
        </div>
      )}

      <div className="chips small">
        {KIND_ORDER.filter((k) => inZone.some((i) => i.kind === k)).map((k) => (
          <button key={k} className={`chip kind ${kinds.has(k) ? 'on' : ''}`} onClick={() => toggle(kinds, k, setKinds)}>
            {KIND_LABEL[k]} <b>{kindCount(k)}</b>
          </button>
        ))}
      </div>

      <input className="search" placeholder="Filtrar nesta zona (classe, evento, módulo…)" value={query} onChange={(e) => setQuery(e.target.value)} />

      {focused && <ItemRow item={focused} root={map.project.root} reference={map.project.nativeReference} initiallyOpen highlight />}

      {KIND_ORDER.map((k) => {
        const list = visible.filter((i) => i.kind === k)
        if (list.length === 0) return null
        return (
          <section key={k}>
            <h3>
              {KIND_LABEL[k]} <span className="muted small">· {list.length}</span>
            </h3>
            <ul className="items">
              {list.map((i) => (
                <ItemRow key={i.id} item={i} root={map.project.root} reference={map.project.nativeReference} />
              ))}
            </ul>
          </section>
        )
      })}
      {visible.length === 0 && !focused && <p className="muted small">Nada com esses filtros nesta zona.</p>}
    </div>
  )
}

function searchText(i: MapItem) {
  return [i.title, i.subtitle, i.module, i.summary, JSON.stringify(i.details)].join(' ').toLowerCase()
}

const DETAIL_LABEL: Record<string, string> = {
  method: 'Método HTTP',
  url: 'URL',
  serviceClass: 'Service',
  serviceMethod: 'Método',
  acl: 'ACL',
  operation: 'Operação',
  resolver: 'Resolver',
  description: 'Descrição',
  event: 'Evento',
  instance: 'Classe',
  area: 'Área',
  target: 'Alvo',
  type: 'Classe',
  methods: 'Intercepta',
  for: 'Reescreve',
  frontName: 'frontName',
  router: 'Router',
  schedule: 'Agenda',
  group: 'Grupo',
  topic: 'Tópico',
  request: 'Payload',
  disabled: 'Desativado',
  sortOrder: 'sortOrder',
}

export const RISK_LABEL: Record<RiskLevel, string> = { alto: 'Risco alto', medio: 'Risco médio', baixo: 'Atenção' }

export function ItemRow({ item, root, reference, initiallyOpen = false, highlight = false }: { item: MapItem; root: string; reference: string | null; initiallyOpen?: boolean; highlight?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen)
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [highlight, item.id])

  const isNative = item.origin === 'native'
  const tag = reference?.replace('magento2-', '') ?? '2.4-develop'
  const xmlLink = isNative ? `https://github.com/magento/magento2/blob/${tag}/${item.file}#L${item.line}` : vscodeLink(root, item.file, item.line)
  const details = Object.entries(item.details).filter(([k, v]) => v !== undefined && v !== '' && k !== 'name' && !(Array.isArray(v) && v.length === 0))

  return (
    <li ref={ref} className={`item ${highlight ? 'highlight' : ''}`}>
      <button className="item-head" onClick={() => setOpen(!open)}>
        <span className={`kind-tag k-${item.kind}`}>{KIND_LABEL[item.kind]}</span>
        <span className="row-main">
          <strong className="mono">{item.title}</strong>
          <span className="muted">{item.subtitle}</span>
          {item.summary && !open && <span className="summary-preview">{item.summary}</span>}
          {item.risk && <span className={`risk-tag risk-${item.risk.level}`}>⚠ {RISK_LABEL[item.risk.level]}</span>}
        </span>
        <span className={`origin-dot origin-${item.origin}`} title={ORIGIN_LABEL[item.origin]} />
      </button>
      {open && (
        <div className="item-body">
          {item.summary && <p className="summary">{item.summary}</p>}
          {item.risk && (
            <p className={`risk-box risk-${item.risk.level}`}>
              <strong>⚠ {RISK_LABEL[item.risk.level]}:</strong> {item.risk.note}
            </p>
          )}
          <dl className="facts">
            <dt>Módulo</dt>
            <dd>
              {item.module} <span className={`badge origin-${item.origin}`}>{ORIGIN_LABEL[item.origin]}</span>
            </dd>
            {details.map(([k, v]) => (
              <FactRow key={k} label={DETAIL_LABEL[k] ?? k} value={v} />
            ))}
            <dt>Zona</dt>
            <dd>
              {item.zoneSource === 'claude' ? 'reclassificada pelo Claude' : item.zoneSource === 'confirmada' ? 'confirmada pelo Claude' : `regra: ${item.reason}`}
            </dd>
          </dl>
          <div className="links">
            <a href={xmlLink} target={isNative ? '_blank' : undefined} rel="noreferrer">
              {isNative ? 'Ver no GitHub' : 'Abrir XML no VS Code'}
            </a>
            {item.classFile && <a href={vscodeLink(root, item.classFile)}>Abrir classe PHP</a>}
          </div>
        </div>
      )}
    </li>
  )
}

function FactRow({ label, value }: { label: string; value: unknown }) {
  const text = Array.isArray(value)
    ? value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ')
    : typeof value === 'boolean'
      ? value ? 'sim' : 'não'
      : String(value)
  return (
    <>
      <dt>{label}</dt>
      <dd className="mono">{text}</dd>
    </>
  )
}
