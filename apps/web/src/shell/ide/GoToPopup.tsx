import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fuzzy, rank, useIde, type ClassEntry } from './useIde'

type Mode = 'all' | 'class' | 'file'
type Row = { type: 'class'; entry: ClassEntry; label: string; hits: number[] } | { type: 'file'; path: string; label: string; hits: number[] }

const MODES: [Mode, string, string][] = [
  ['all', 'Tudo', 'Shift Shift'],
  ['class', 'Classes', 'Alt+N'],
  ['file', 'Arquivos', 'Alt+Shift+N'],
]

function Highlighted({ text, hits }: { text: string; hits: number[] }) {
  const set = new Set(hits)
  return (
    <>
      {text.split('').map((ch, i) => (set.has(i) ? <b key={i}>{ch}</b> : ch))}
    </>
  )
}

/** PhpStorm "Search Everywhere" / "Go to Class" (Ctrl+N) / "Go to File" (Ctrl+Shift+N). */
export function GoToPopup({ workspaceId, mode: initialMode, initial }: { workspaceId: string; mode: Mode; initial?: string }) {
  const navigate = useNavigate()
  const { files, classes, loadingIndex, close, openTab } = useIde()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [query, setQuery] = useState(initial ?? '')
  const [sel, setSel] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  // "QuotePlugin:25" opens at line 25, like PhpStorm
  const [term, lineStr] = query.split(':')
  const line = Number(lineStr) || undefined

  const rows = useMemo<Row[]>(() => {
    const q = term.trim()
    if (!q) return []
    const scored: (Row & { score: number })[] = []
    if (mode !== 'file') {
      const byFqcn = q.includes('\\')
      for (const r of rank(classes, q, (c) => (byFqcn ? c.fqcn : c.fqcn.split('\\').pop()!), 60)) {
        // classes win ties in Search Everywhere, like PhpStorm
        scored.push({ type: 'class', entry: r.item, label: byFqcn ? r.item.fqcn : r.item.fqcn.split('\\').pop()!, hits: r.hits, score: r.score + 20 })
      }
    }
    if (mode !== 'class') {
      const byPath = q.includes('/')
      for (const path of files) {
        const base = path.slice(path.lastIndexOf('/') + 1)
        // match the file name; fall back to the whole path (e.g. "PayInfMan" → PaymentInformationManagement/Plugin.php)
        const onName = byPath ? null : fuzzy(q, base)
        const onPath = onName ? null : fuzzy(q, path)
        if (onName) scored.push({ type: 'file', path, label: base, hits: onName.hits, score: onName.score })
        else if (onPath) scored.push({ type: 'file', path, label: path, hits: onPath.hits, score: onPath.score - (byPath ? 0 : 40) })
      }
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, mode === 'all' ? 50 : 80)
  }, [term, mode, classes, files])

  useEffect(() => setSel(0), [term, mode])
  useEffect(() => {
    // Scroll only the list (scrollIntoView would also scroll the popup itself)
    const box = list.current
    const row = box?.querySelector<HTMLElement>('.on')
    if (box && row) {
      if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop
      else if (row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight
    }
  }, [sel])

  const go = (row?: Row) => {
    if (!row) return
    const path = row.type === 'class' ? row.entry.path : row.path
    openTab(workspaceId, path)
    navigate(`/w/${workspaceId}/code?path=${encodeURIComponent(path)}${line ? `&line=${line}` : ''}`)
    close()
  }

  return (
    <div className="sf-modal-back ide" onMouseDown={close}>
      <div className="sf-ide-popup" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sf-ide-tabs">
          {MODES.map(([m, label, key]) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
              {label} <span>{key}</span>
            </button>
          ))}
          <span className="sf-faint" style={{ marginLeft: 'auto', fontSize: 11.5 }}>
            {loadingIndex ? 'indexando…' : `${classes.length} classes · ${files.length} arquivos`}
          </span>
        </div>
        <input
          autoFocus
          className="sf-ide-input"
          placeholder={mode === 'class' ? 'Nome da classe (ex.: QuotePlugin, Checkout\\Model\\Cart)' : mode === 'file' ? 'Nome do arquivo (ex.: di.xml, checkout/etc/webapi, Index.php:30)' : 'Classe ou arquivo'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(s + 1, rows.length - 1)))
            else if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)))
            else if (e.key === 'Enter') go(rows[sel])
            else if (e.key === 'Escape') close()
            else if (e.key === 'Tab') {
              e.preventDefault()
              const i = MODES.findIndex(([m]) => m === mode)
              setMode(MODES[(i + (e.shiftKey ? MODES.length - 1 : 1)) % MODES.length][0])
            }
          }}
        />
        <div className="sf-ide-list" ref={list}>
          {rows.map((r, i) => (
            <div key={r.type === 'class' ? `c:${r.entry.fqcn}` : `f:${r.path}`} className={`sf-ide-row ${i === sel ? 'on' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => go(r)}>
              {r.type === 'class' ? (
                <>
                  <span className={`sf-ide-icon k-${r.entry.kind}`}>{r.entry.kind[0].toUpperCase()}</span>
                  <span className="name">
                    <Highlighted text={r.label} hits={r.hits} />
                  </span>
                  <span className="where">{r.entry.fqcn.split('\\').slice(0, -1).join('\\')}</span>
                </>
              ) : (
                <>
                  <span className="sf-ide-icon file">{r.path.split('.').pop()?.slice(0, 3)}</span>
                  <span className="name">
                    <Highlighted text={r.label} hits={r.hits} />
                  </span>
                  <span className="where">{r.path.split('/').slice(0, -1).join('/')}</span>
                </>
              )}
            </div>
          ))}
          {term.trim() && rows.length === 0 && !loadingIndex && <div className="sf-empty">Nada encontrado</div>}
          {!term.trim() && (
            <div className="sf-ide-hint">
              Digite parte do nome: camel case funciona (<code>QuPl</code> → QuotePlugin). Use <code>/</code> para casar o caminho, <code>\</code> para o namespace e <code>:25</code> para abrir
              numa linha. <kbd>Tab</kbd> alterna entre Tudo, Classes e Arquivos.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
