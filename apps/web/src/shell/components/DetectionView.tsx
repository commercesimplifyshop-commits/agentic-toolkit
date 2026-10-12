import type { Detection } from '../api'

/** Checklist proving (or not) that a folder is a Magento installation. */
export function DetectionView({ detection, onPickCandidate }: { detection: Detection; onPickCandidate?: (path: string) => void }) {
  return (
    <div>
      <div className="sf-row" style={{ marginBottom: 10 }}>
        {detection.isMagento ? (
          <span className="sf-badge green">✓ Instalação Magento reconhecida</span>
        ) : (
          <span className="sf-badge red">✕ Não parece ser a raiz de uma instalação Magento</span>
        )}
        {detection.version && (
          <span className="sf-badge blue">
            {detection.edition} {detection.version}
          </span>
        )}
        <span className="sf-faint" style={{ fontSize: 12 }}>
          confiança {detection.confidence}%
        </span>
      </div>
      {detection.checks.map((c) => (
        <div key={c.id} className="sf-check">
          <span className={`ic ${c.ok ? 'ok' : c.weight === 'hint' ? 'hint' : 'no'}`}>{c.ok ? '✓' : c.weight === 'hint' ? '–' : '✕'}</span>
          <span>{c.label}</span>
          {c.detail && <span className="det">{c.detail}</span>}
        </div>
      ))}
      {detection.candidates.length > 0 && (
        <div className="sf-callout orange" style={{ marginTop: 12 }}>
          <strong>Encontramos uma instalação Magento numa subpasta:</strong>
          {detection.candidates.map((c) => (
            <div key={c.path} className="sf-row" style={{ marginTop: 8 }}>
              <span className="sf-mono" style={{ flex: 1 }}>
                {c.relative}/ <span className="sf-muted">{c.edition} {c.version}</span>
              </span>
              {onPickCandidate && (
                <button className="sf-btn small primary" onClick={() => onPickCandidate(c.path)}>
                  Usar esta
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
