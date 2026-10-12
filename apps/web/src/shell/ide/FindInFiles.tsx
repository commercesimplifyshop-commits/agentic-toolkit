import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { CodeViewer } from '../editor/CodeViewer'
import { useIde } from './useIde'

interface Match {
  file: string
  line: number
  col: number
  length: number
  text: string
}
interface FindResult {
  matches: Match[]
  filesSearched: number
  truncated: boolean
  ms: number
}

const SCOPES: [string, string][] = [
  ['', 'Projeto'],
  ['app/code', 'app/code'],
  ['app/design', 'app/design'],
  ['vendor', 'vendor'],
  ['custom', 'Diretório…'],
]

/** PhpStorm "Find in Files" (Ctrl+Shift+F): options, scope, file mask and a live preview. */
export function FindInFiles({ workspaceId, initial }: { workspaceId: string; initial?: string }) {
  const navigate = useNavigate()
  const { close, openTab } = useIde()
  const [query, setQuery] = useState(initial ?? '')
  const [caseSensitive, setCase] = useState(false)
  const [word, setWord] = useState(false)
  const [regex, setRegex] = useState(false)
  const [scope, setScope] = useState('')
  const [customDir, setCustomDir] = useState('app/code/')
  const [maskOn, setMaskOn] = useState(false)
  const [mask, setMask] = useState('*.php,*.xml')
  const [result, setResult] = useState<FindResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sel, setSel] = useState(0)
  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const seq = useRef(0)

  const effectiveScope = scope === 'custom' ? customDir.replace(/^\/+|\/+$/g, '') : scope

  // Debounced live search, like PhpStorm
  useEffect(() => {
    setError('')
    if (query.length < 2) {
      setResult(null)
      return
    }
    const mine = ++seq.current
    const t = setTimeout(async () => {
      setBusy(true)
      const params = new URLSearchParams({ q: query, scope: effectiveScope })
      if (caseSensitive) params.set('case', '1')
      if (word) params.set('word', '1')
      if (regex) params.set('regex', '1')
      if (maskOn && mask.trim()) params.set('mask', mask)
      try {
        const r = await api.get<FindResult>(`/workspaces/${workspaceId}/find?${params}`)
        if (mine === seq.current) {
          setResult(r)
          setSel(0)
        }
      } catch (e) {
        if (mine === seq.current) setError((e as ApiError).message)
      } finally {
        if (mine === seq.current) setBusy(false)
      }
    }, 280)
    return () => clearTimeout(t)
  }, [query, caseSensitive, word, regex, effectiveScope, maskOn, mask, workspaceId])

  const current = result?.matches[sel]

  // Preview of the selected match
  useEffect(() => {
    if (!current) return setPreview(null)
    if (preview?.path === current.file) return
    let cancelled = false
    api
      .get<{ path: string; content: string }>(`/workspaces/${workspaceId}/file?path=${encodeURIComponent(current.file)}`)
      .then((f) => !cancelled && setPreview({ path: f.path, content: f.content }))
      .catch(() => !cancelled && setPreview(null))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.file, workspaceId])

  useEffect(() => {
    // Scroll only the list (scrollIntoView would also scroll the popup itself)
    const box = list.current
    const row = box?.querySelector<HTMLElement>('.on')
    if (box && row) {
      if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop
      else if (row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight
    }
  }, [sel])

  const files = useMemo(() => new Set(result?.matches.map((m) => m.file)).size, [result])

  const open = (m?: Match) => {
    if (!m) return
    openTab(workspaceId, m.file)
    navigate(`/w/${workspaceId}/code?path=${encodeURIComponent(m.file)}&line=${m.line}`)
    close()
  }

  const onKey = (e: React.KeyboardEvent) => {
    const n = result?.matches.length ?? 0
    if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(s + 1, n - 1)))
    else if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)))
    else if (e.key === 'Enter') open(current)
    else if (e.key === 'Escape') close()
    else if (e.altKey && e.key.toLowerCase() === 'c') (e.preventDefault(), setCase((v) => !v))
    else if (e.altKey && e.key.toLowerCase() === 'w') (e.preventDefault(), setWord((v) => !v))
    else if (e.altKey && e.key.toLowerCase() === 'x') (e.preventDefault(), setRegex((v) => !v))
  }

  return (
    <div className="sf-modal-back ide" onMouseDown={close}>
      <div className="sf-ide-popup find" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="sf-ide-tabs">
          <strong style={{ fontSize: 13 }}>Find in Files</strong>
          <span className="sf-faint" style={{ marginLeft: 10, fontSize: 11.5 }}>
            {busy ? 'buscando…' : result ? `${result.matches.length}${result.truncated ? '+' : ''} ocorrências em ${files} arquivos · ${result.filesSearched} lidos · ${result.ms} ms` : 'mínimo 2 caracteres'}
          </span>
          <div className="sf-ide-scopes">
            {SCOPES.map(([v, label]) => (
              <button key={v} className={scope === v ? 'on' : ''} onClick={() => setScope(v)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="sf-ide-findbar">
          <input autoFocus className="sf-ide-input" placeholder="Texto, classe, evento, método…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className={`sf-ide-toggle ${caseSensitive ? 'on' : ''}`} title="Diferenciar maiúsculas (Alt+C)" onClick={() => setCase(!caseSensitive)}>
            Cc
          </button>
          <button className={`sf-ide-toggle ${word ? 'on' : ''}`} title="Palavra inteira (Alt+W)" onClick={() => setWord(!word)}>
            W
          </button>
          <button className={`sf-ide-toggle ${regex ? 'on' : ''}`} title="Expressão regular (Alt+X)" onClick={() => setRegex(!regex)}>
            .*
          </button>
          <label className="sf-ide-mask">
            <input type="checkbox" checked={maskOn} onChange={(e) => setMaskOn(e.target.checked)} /> Máscara
            <input className="sf-ide-input small" disabled={!maskOn} value={mask} onChange={(e) => setMask(e.target.value)} />
          </label>
        </div>
        {scope === 'custom' && (
          <div style={{ padding: '0 14px 8px' }}>
            <input className="sf-ide-input small" style={{ width: '100%' }} placeholder="pasta relativa, ex.: app/code/Vendor/Checkout" value={customDir} onChange={(e) => setCustomDir(e.target.value)} />
          </div>
        )}
        <div className="sf-ide-list sf-find-results" ref={list}>
          {result?.matches.map((m, i) => (
            <div key={`${m.file}:${m.line}:${i}`} className={`sf-ide-row match ${i === sel ? 'on' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => setSel(i)} onDoubleClick={() => open(m)}>
              <span className="code">
                {m.text.slice(0, m.col).trimStart()}
                <mark>{m.text.slice(m.col, m.col + m.length)}</mark>
                {m.text.slice(m.col + m.length)}
              </span>
              <span className="where">
                {m.file.split('/').pop()} <b>{m.line}</b>
              </span>
            </div>
          ))}
          {error && <div className="sf-error" style={{ padding: 12 }}>{error}</div>}
          {result && result.matches.length === 0 && !busy && <div className="sf-empty">Nenhuma ocorrência</div>}
        </div>
        <div className="sf-ide-preview">
          {current && preview?.path === current.file ? (
            <>
              <div className="sf-ide-preview-head sf-mono">
                {current.file}:{current.line}
                <span className="sf-faint" style={{ marginLeft: 'auto' }}>
                  Enter abre no explorador · duplo clique também
                </span>
              </div>
              <CodeViewer path={current.file} content={preview.content} line={current.line} compact />
            </>
          ) : (
            <div className="sf-empty">{current ? 'carregando…' : 'Selecione uma ocorrência para ver o trecho'}</div>
          )}
        </div>
      </div>
    </div>
  )
}
