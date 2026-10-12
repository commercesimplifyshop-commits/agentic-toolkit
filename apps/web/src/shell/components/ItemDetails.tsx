import { Link } from 'react-router-dom'
import { KIND_LABEL, ORIGIN_LABEL, type MapItem } from '../../map/useMap'

const RISK_TONE = { alto: 'red', medio: 'yellow', baixo: 'blue' } as const

export function OriginBadge({ origin }: { origin: MapItem['origin'] }) {
  return <span className={`sf-badge ${origin === 'custom' ? 'orange' : origin === 'thirdparty' ? 'purple' : ''}`}>{ORIGIN_LABEL[origin]}</span>
}

export function KindBadge({ kind }: { kind: MapItem['kind'] }) {
  return <span className="sf-badge blue">{KIND_LABEL[kind]}</span>
}

export function RiskBadge({ item }: { item: MapItem }) {
  if (!item.risk) return null
  return <span className={`sf-badge ${RISK_TONE[item.risk.level]}`}>⚠ risco {item.risk.level}</span>
}

/** Expanded view of one integration point: summary, risk, facts and links into the code explorer. */
export function ItemDetails({ item, workspaceId }: { item: MapItem; workspaceId: string }) {
  const facts = Object.entries(item.details).filter(([k, v]) => v !== undefined && v !== '' && k !== 'name' && !(Array.isArray(v) && v.length === 0))
  const native = item.origin === 'native'
  return (
    <div style={{ padding: '4px 0 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {item.summary && <div className="sf-callout orange">{item.summary}</div>}
      {item.risk && (
        <div className={`sf-callout ${item.risk.level === 'alto' ? 'red' : ''}`}>
          <strong>⚠ Risco {item.risk.level}:</strong> {item.risk.note}
        </div>
      )}
      <table className="sf-table">
        <tbody>
          <tr>
            <td className="sf-muted" style={{ width: 140 }}>Módulo</td>
            <td>
              {item.module} <OriginBadge origin={item.origin} />
            </td>
          </tr>
          {facts.map(([k, v]) => (
            <tr key={k}>
              <td className="sf-muted">{k}</td>
              <td className="sf-mono" style={{ overflowWrap: 'anywhere' }}>
                {Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') : String(v)}
              </td>
            </tr>
          ))}
          <tr>
            <td className="sf-muted">Zona do fluxo</td>
            <td>
              {item.zone} <span className="sf-faint">({item.zoneSource === 'regra' ? `regra: ${item.reason}` : `${item.zoneSource} pelo Claude`})</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div className="sf-row">
        {native ? (
          <span className="sf-faint" style={{ fontSize: 12 }}>
            Declarado no core: {item.file}:{item.line}
          </span>
        ) : (
          <>
            <Link className="sf-btn small" to={`/w/${workspaceId}/code?path=${encodeURIComponent(item.file)}&line=${item.line}`}>
              Abrir XML
            </Link>
            {item.classFile && (
              <Link className="sf-btn small" to={`/w/${workspaceId}/code?path=${encodeURIComponent(item.classFile)}`}>
                Abrir classe PHP
              </Link>
            )}
          </>
        )}
        {(item.kind === 'rest' || item.kind === 'graphql') && (
          <Link className="sf-btn small accent" to={`/w/${workspaceId}/api-client?route=${encodeURIComponent(item.id)}`}>
            ➤ Testar no simulador
          </Link>
        )}
      </div>
    </div>
  )
}
