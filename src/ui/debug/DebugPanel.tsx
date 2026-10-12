import { useEffect, useMemo, useRef } from 'react'
import { zoneById } from '../../domain/zones'
import type { Frame, FrameKind } from '../../debug/trace'
import { useDebug } from '../../debug/useDebug'
import { KIND_LABEL, ORIGIN_LABEL, useMap, vscodeLink, type MapItem } from '../../map/useMap'
import { RISK_LABEL } from '../InstallationPanel'

const KIND_ICON: Record<FrameKind, string> = {
  request: '⇢',
  call: 'ƒ',
  preference: '⇄',
  'plugin-before': '▸',
  'plugin-around': '⟲',
  'plugin-around-end': '⟳',
  'plugin-after': '◂',
  original: '●',
  event: '⚡',
  observer: '👁',
  note: 'ⓘ',
}

const KIND_TEXT: Record<FrameKind, string> = {
  request: 'requisição',
  call: 'chamada',
  preference: 'preference',
  'plugin-before': 'plugin before',
  'plugin-around': 'plugin around',
  'plugin-around-end': 'around (retorno)',
  'plugin-after': 'plugin after',
  original: 'método original',
  event: 'evento',
  observer: 'observer',
  note: 'nota',
}

/** Right-hand call stack: every frame of the current step, in execution order. */
export function DebugPanel() {
  const { traces, stepIndex, executed, onlyCustom, openFrame, toggleOnlyCustom, toggleFrame } = useDebug()
  const map = useMap((s) => s.map)
  const trace = traces[stepIndex]
  const listRef = useRef<HTMLOListElement>(null)

  const items = useMemo(() => new Map(map?.items.map((i) => [i.id, i]) ?? []), [map])

  useEffect(() => {
    const el = listRef.current?.querySelector('.frame.current')
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [executed, stepIndex])

  if (!trace || !map) return null
  const zone = zoneById(trace.step.zone)
  const visible = trace.frames.filter((f) => !onlyCustom || f.origin !== 'native' || f.kind === 'request')

  return (
    <aside className="sidepanel card debug-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">
            Etapa {stepIndex + 1}/{traces.length} · {zone.name}
          </span>
          <h2>{trace.step.title}</h2>
          <p className="mono request-line">{trace.step.request}</p>
          <p className="muted">{trace.step.description}</p>
        </div>
      </div>
      <div className="debug-toolbar">
        <span className="counts">
          <b className="c-custom">★ {trace.counts.custom}</b> customizados · <b className="c-third">◆ {trace.counts.thirdparty}</b> terceiros ·{' '}
          <b>{trace.counts.native}</b> nativos
        </span>
        <label className="toggle">
          <input type="checkbox" checked={onlyCustom} onChange={toggleOnlyCustom} /> só customizações
        </label>
      </div>
      <div className="panel-body">
        <ol className="frames" ref={listRef}>
          {visible.map((f) => (
            <FrameRow
              key={f.n}
              frame={f}
              state={f.n <= executed ? (f.n === executed ? 'current' : 'done') : 'pending'}
              item={f.itemId ? items.get(f.itemId) : undefined}
              open={openFrame === f.n}
              onToggle={() => toggleFrame(f.n)}
              root={map.project.root}
              compact={onlyCustom}
            />
          ))}
        </ol>

        {trace.extras.length > 0 && (
          <section className="extras">
            <h3>Também nesta etapa</h3>
            <p className="muted small">
              Pontos de entrada customizados desta zona que não estão no fluxo nativo (crons, endpoints e rotas chamados pelo front ou por sistemas externos). A ordem deles
              não dá para deduzir só pelo código.
            </p>
            <ul className="items">
              {trace.extras.map((i) => (
                <li key={i.id} className="item">
                  <div className="item-head static">
                    <span className={`kind-tag k-${i.kind}`}>{KIND_LABEL[i.kind]}</span>
                    <span className="row-main">
                      <strong className="mono">{i.title}</strong>
                      <span className="muted">{i.summary ?? i.subtitle}</span>
                      {i.risk && <span className={`risk-tag risk-${i.risk.level}`}>⚠ {RISK_LABEL[i.risk.level]}</span>}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  )
}

function FrameRow({ frame: f, state, item, open, onToggle, root, compact }: { frame: Frame; state: 'done' | 'current' | 'pending'; item?: MapItem; open: boolean; onToggle: () => void; root: string; compact: boolean }) {
  const clickable = Boolean(item) || Boolean(f.warn)
  return (
    <li className={`frame ${state} o-${f.origin} fk-${f.kind}`} style={{ paddingLeft: 4 + Math.min(f.depth, compact ? 3 : 8) * (compact ? 8 : 11) }}>
      <button className="frame-head" onClick={clickable ? onToggle : undefined} disabled={!clickable}>
        <span className="frame-n">{f.n}</span>
        <span className="frame-icon" title={KIND_TEXT[f.kind]}>
          {KIND_ICON[f.kind]}
        </span>
        <span className="frame-main">
          <span className="frame-label">{f.label}</span>
          {f.detail && <span className="frame-detail">{f.detail}</span>}
          {item?.summary && !open && <span className="frame-summary">{item.summary}</span>}
        </span>
        {(f.warn || item?.risk) && <span className="frame-warn" title={f.warn ?? item?.risk?.note}>⚠</span>}
      </button>
      {open && (
        <div className="frame-body">
          <span className="muted small">
            {KIND_TEXT[f.kind]} · {item ? `${item.module} (${ORIGIN_LABEL[item.origin]})` : ''}
          </span>
          {f.warn && <p className="risk-box risk-medio">⚠ {f.warn}</p>}
          {item?.summary && <p className="summary">{item.summary}</p>}
          {item?.risk && (
            <p className={`risk-box risk-${item.risk.level}`}>
              <strong>⚠ {RISK_LABEL[item.risk.level]}:</strong> {item.risk.note}
            </p>
          )}
          {item && item.origin !== 'native' && (
            <div className="links">
              <a href={vscodeLink(root, item.file, item.line)}>Abrir XML</a>
              {item.classFile && <a href={vscodeLink(root, item.classFile)}>Abrir classe PHP</a>}
            </div>
          )}
        </div>
      )}
    </li>
  )
}
