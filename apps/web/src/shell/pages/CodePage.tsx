import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api'

interface Entry {
  name: string
  path: string
  type: 'dir' | 'file'
  size?: number
  sensitive?: boolean
}

/** Read-only code browser with text search. Sensitive files are listed but never opened. */
export function CodePage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const filePath = params.get('path') ?? ''
  const line = Number(params.get('line') ?? 0)
  const [tree, setTree] = useState<Record<string, Entry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']))
  const [file, setFile] = useState<{ path: string; content: string; truncated: boolean } | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ file: string; line: number; text: string }[] | null>(null)
  const [searching, setSearching] = useState(false)
  const viewer = useRef<HTMLDivElement>(null)

  const loadDir = async (dir: string) => {
    if (tree[dir]) return
    const r = await api.get<{ entries: Entry[] }>(`/workspaces/${id}/files?path=${encodeURIComponent(dir)}`)
    setTree((t) => ({ ...t, [dir]: r.entries }))
  }

  useEffect(() => {
    loadDir('').catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Open the file in the URL and expand its folders
  useEffect(() => {
    if (!filePath) return
    setError('')
    const parts = filePath.split('/')
    const dirs = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
    setExpanded((e) => new Set([...e, ...dirs]))
    dirs.forEach((d) => loadDir(d).catch(() => undefined))
    api
      .get<{ path: string; content: string; truncated: boolean }>(`/workspaces/${id}/file?path=${encodeURIComponent(filePath)}`)
      .then(setFile)
      .catch((e: ApiError) => {
        setFile(null)
        setError(e.rule === 'read.sensitive-file' ? 'Arquivo sensível: o StoreFlow não exibe o conteúdo de arquivos de credenciais.' : e.message)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, filePath])

  useEffect(() => {
    if (line && file) viewer.current?.querySelector('.hl')?.scrollIntoView({ block: 'center' })
  }, [file, line])

  const toggle = (dir: string) => {
    const next = new Set(expanded)
    if (next.has(dir)) next.delete(dir)
    else {
      next.add(dir)
      loadDir(dir).catch((e) => setError(e.message))
    }
    setExpanded(next)
  }

  const search = async () => {
    if (query.trim().length < 3) return
    setSearching(true)
    try {
      const r = await api.get<{ matches: { file: string; line: number; text: string }[] }>(`/workspaces/${id}/search?q=${encodeURIComponent(query)}&under=app/code`)
      setResults(r.matches)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSearching(false)
    }
  }

  const renderDir = (dir: string, depth: number): JSX.Element[] =>
    (tree[dir] ?? []).flatMap((e) => {
      const row = (
        <button
          key={e.path}
          className={`sf-tree-item ${filePath === e.path ? 'on' : ''}`}
          style={{ paddingLeft: 8 + depth * 14, opacity: e.sensitive ? 0.6 : 1 }}
          onClick={() => (e.type === 'dir' ? toggle(e.path) : setParams({ path: e.path }))}
          title={e.sensitive ? 'Arquivo sensível: conteúdo bloqueado' : e.path}
        >
          {e.type === 'dir' ? (expanded.has(e.path) ? '▾' : '▸') : e.sensitive ? '🔒' : ' '} {e.name}
        </button>
      )
      return e.type === 'dir' && expanded.has(e.path) ? [row, ...renderDir(e.path, depth + 1)] : [row]
    })

  return (
    <div className="sf-code">
      <div className="sf-tree">
        <div className="sf-row" style={{ marginBottom: 8, padding: '0 4px' }}>
          <input className="sf-input" placeholder="Buscar em app/code…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
        </div>
        {searching && <span className="sf-spinner" style={{ margin: 8 }} />}
        {results && (
          <div style={{ marginBottom: 10 }}>
            <div className="sf-row" style={{ padding: '4px 8px' }}>
              <span className="sf-faint" style={{ flex: 1, fontSize: 12 }}>
                {results.length} resultados
              </span>
              <button className="sf-link" onClick={() => setResults(null)}>
                limpar
              </button>
            </div>
            {results.map((r) => (
              <button key={`${r.file}:${r.line}`} className="sf-tree-item" onClick={() => setParams({ path: r.file, line: String(r.line) })} title={r.text}>
                <span className="sf-mono" style={{ fontSize: 11.5 }}>
                  {r.file.split('/').slice(-2).join('/')}:{r.line}
                </span>
              </button>
            ))}
          </div>
        )}
        {renderDir('', 0)}
      </div>
      <div className="sf-viewer" ref={viewer}>
        {file ? (
          <>
            <div className="sf-row" style={{ padding: '10px 18px', borderBottom: '1px solid var(--sf-border)', position: 'sticky', top: 0, background: 'var(--sf-bg)' }}>
              <span className="sf-mono" style={{ flex: 1 }}>
                {file.path}
              </span>
              <span className="sf-badge green">somente leitura</span>
              {file.truncated && <span className="sf-badge yellow">truncado</span>}
            </div>
            <pre>
              {file.content.split('\n').map((l, i) => (
                <span key={i} className={`ln ${line === i + 1 ? 'hl' : ''}`}>
                  {l || ' '}
                </span>
              ))}
            </pre>
          </>
        ) : (
          <div className="sf-empty">{error || 'Escolha um arquivo na árvore ou busque no código.'}</div>
        )}
      </div>
    </div>
  )
}
