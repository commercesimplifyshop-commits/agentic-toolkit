import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMap } from '../../map/useMap'
import { ItemDetails, KindBadge, OriginBadge, RiskBadge } from '../components/ItemDetails'
import { useShell } from '../store'

const ORDER = { alto: 0, medio: 1, baixo: 2 }

export function RisksPage() {
  const { id = '' } = useParams()
  const { map, loadWorkspace, annotatedCount } = useMap()
  const o = useShell((s) => s.overviews[id])
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    loadWorkspace(id)
  }, [id, loadWorkspace])

  const risky = useMemo(() => (map?.items.filter((i) => i.risk) ?? []).sort((a, b) => ORDER[a.risk!.level] - ORDER[b.risk!.level]), [map])
  const custom = map?.items.filter((i) => i.origin !== 'native').length ?? 0

  return (
    <div className="sf-page">
      <div className="sf-page-head">
        <div className="sf-page-icon">⚠</div>
        <div className="sf-page-title">
          <h1>Pontos de atenção</h1>
          <p>Achados da leitura do código pela IA. São hipóteses fortes, não vulnerabilidades confirmadas: reproduza em ambiente dev antes de reportar.</p>
        </div>
      </div>

      <div className="sf-callout" style={{ marginBottom: 14 }}>
        Cobertura da análise: <strong>{annotatedCount}</strong> de <strong>{custom}</strong> customizações analisadas. Para analisar o resto, pergunte em{' '}
        <Link to={`/w/${id}/ask`} style={{ textDecoration: 'underline' }}>
          Pergunte ao código
        </Link>{' '}
        ou rode a skill <code>/magento-map</code> no Claude Code dentro do repositório do StoreFlow (ela grava as anotações no diretório de dados).
      </div>

      {o && o.highlights.filter((h) => h.level === 'critical').length > 0 && (
        <div className="sf-card" style={{ marginBottom: 14 }}>
          <h2>Configuração e plataforma</h2>
          <span className="sub">Detectados automaticamente (sem IA)</span>
          {o.highlights
            .filter((h) => h.level !== 'info')
            .map((h) => (
              <div key={h.title} className="sf-highlight">
                <span className={`lvl ${h.level}`} />
                <div>
                  <strong>{h.title}</strong>
                  <p>{h.detail}</p>
                </div>
              </div>
            ))}
        </div>
      )}

      <div className="sf-card" style={{ padding: 0 }}>
        <table className="sf-table">
          <thead>
            <tr>
              <th style={{ width: 120 }}>Risco</th>
              <th>Ponto de integração</th>
              <th style={{ width: 220 }}>Módulo</th>
            </tr>
          </thead>
          <tbody>
            {risky.map((i) => (
              <Fragment key={i.id}>
                <tr className="clickable" onClick={() => setOpen(open === i.id ? null : i.id)}>
                  <td>
                    <RiskBadge item={i} />
                  </td>
                  <td>
                    <div className="sf-row" style={{ gap: 8 }}>
                      <KindBadge kind={i.kind} />
                      <span className="sf-mono" style={{ overflowWrap: 'anywhere' }}>
                        {i.title}
                      </span>
                    </div>
                    <div className="sf-muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                      {i.risk!.note}
                    </div>
                  </td>
                  <td>
                    <div style={{ fontSize: 12.5 }}>{i.module}</div>
                    <OriginBadge origin={i.origin} />
                  </td>
                </tr>
                {open === i.id && (
                  <tr>
                    <td colSpan={3} style={{ background: 'var(--sf-panel-2)' }}>
                      <ItemDetails item={i} workspaceId={id} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {risky.length === 0 && <div className="sf-empty">Nenhum ponto de atenção anotado ainda.</div>}
      </div>
    </div>
  )
}
