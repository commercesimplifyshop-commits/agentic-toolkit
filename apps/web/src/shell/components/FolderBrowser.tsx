import { useEffect, useState } from 'react'
import { api } from '../api'

interface Listing {
  path: string
  parent: string | null
  home: string
  entries: { name: string; path: string; magento?: boolean }[]
}

/** Server-side folder picker: the browser can't hand out real local paths, the local API can. */
export function FolderBrowser({ initial, onPick, onClose }: { initial?: string; onPick: (path: string) => void; onClose: () => void }) {
  const [listing, setListing] = useState<Listing | null>(null)
  const [error, setError] = useState('')

  const open = (path: string) => {
    setError('')
    api
      .get<Listing>(`/host/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`)
      .then(setListing)
      .catch((e) => setError(e.message))
  }

  useEffect(() => open(initial ?? ''), [initial])

  return (
    <div className="sf-modal-back" onClick={onClose}>
      <div className="sf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sf-modal-head">
          <strong style={{ flex: 1 }}>Escolher pasta</strong>
          {listing?.home && (
            <button className="sf-btn small" onClick={() => open(listing.home)}>
              Pasta do usuário
            </button>
          )}
          <button className="sf-btn small" onClick={() => open('')}>
            Discos
          </button>
        </div>
        <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--sf-border)' }} className="sf-mono sf-muted">
          {listing?.path || 'Computador'}
        </div>
        <div className="sf-modal-body">
          {listing?.parent !== null && listing?.path && (
            <button className="sf-tree-item" onClick={() => open(listing.parent ?? '')}>
              ↑ ..
            </button>
          )}
          {listing?.entries.map((e) => (
            <button key={e.path} className="sf-tree-item" onDoubleClick={() => open(e.path)} onClick={() => open(e.path)}>
              📁 {e.name}
              {e.magento && <span className="sf-badge orange" style={{ marginLeft: 8 }}>Magento</span>}
            </button>
          ))}
          {listing && listing.entries.length === 0 && <div className="sf-empty">Pasta sem subpastas</div>}
          {error && <div className="sf-error" style={{ padding: 12 }}>{error}</div>}
        </div>
        <div className="sf-modal-foot">
          <span className="sf-faint" style={{ marginRight: 'auto', fontSize: 12 }}>
            Só os nomes das pastas são listados.
          </span>
          <button className="sf-btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="sf-btn primary" disabled={!listing?.path} onClick={() => listing && onPick(listing.path)}>
            Usar esta pasta
          </button>
        </div>
      </div>
    </div>
  )
}
