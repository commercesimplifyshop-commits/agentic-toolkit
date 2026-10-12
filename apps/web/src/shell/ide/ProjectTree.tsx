import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { fuzzy } from './useIde'

interface Entry {
  name: string
  path: string
  type: 'dir' | 'file'
  size?: number
  sensitive?: boolean
}

interface Row {
  entry: Entry
  depth: number
  parent: string
}

/**
 * Speed-search match like PhpStorm: a substring of the name, or camel humps /
 * word starts ("SMM" → ShippingMethodManagement). Returns matched indices.
 */
function speedMatch(q: string, name: string): number[] | null {
  const at = name.toLowerCase().indexOf(q.toLowerCase())
  if (at >= 0) return Array.from({ length: q.length }, (_, i) => at + i)
  const m = fuzzy(q, name)
  if (!m) return null
  const boundary = (i: number) => i === 0 || /[^A-Za-z0-9]/.test(name[i - 1]) || (/[A-Z]/.test(name[i]) && /[a-z0-9]/.test(name[i - 1]))
  return m.hits.every((h, k) => boundary(h) || (k > 0 && m.hits[k - 1] === h - 1)) ? m.hits : null
}

/**
 * The project tree with PhpStorm's keyboard "speed search": typing filters/selects
 * by name, ↑/↓ jump between matches, → opens/enters a folder, ← closes/goes up,
 * Enter opens the file. No mouse needed.
 */
export function ProjectTree({ workspaceId, activeFile, onOpenFile, onError }: { workspaceId: string; activeFile: string; onOpenFile: (path: string) => void; onError: (msg: string) => void }) {
  const [tree, setTree] = useState<Record<string, Entry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']))
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const loading = useRef(new Set<string>())

  const loadDir = useCallback(
    async (dir: string) => {
      if (tree[dir] || loading.current.has(dir)) return
      loading.current.add(dir)
      try {
        const r = await api.get<{ entries: Entry[] }>(`/workspaces/${workspaceId}/files?path=${encodeURIComponent(dir)}`)
        setTree((t) => ({ ...t, [dir]: r.entries }))
      } catch (e) {
        onError((e as Error).message)
      } finally {
        loading.current.delete(dir)
      }
    },
    [tree, workspaceId, onError],
  )

  useEffect(() => {
    loadDir('')
    // Focus the tree as soon as the explorer opens: typing starts a speed search
    box.current?.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  // Reveal the file opened in the editor
  useEffect(() => {
    if (!activeFile) return
    const parts = activeFile.split('/')
    const dirs = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
    setExpanded((e) => new Set([...e, ...dirs]))
    dirs.forEach((d) => loadDir(d))
    setSelected(activeFile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile])

  /** Visible rows in display order */
  const rows = useMemo(() => {
    const out: Row[] = []
    const walk = (dir: string, depth: number) => {
      for (const entry of tree[dir] ?? []) {
        out.push({ entry, depth, parent: dir })
        if (entry.type === 'dir' && expanded.has(entry.path)) walk(entry.path, depth + 1)
      }
    }
    walk('', 0)
    return out
  }, [tree, expanded])

  const indexOf = (path: string) => rows.findIndex((r) => r.entry.path === path)
  const matches = (r: Row, q: string) => q !== '' && speedMatch(q, r.entry.name) !== null

  // Keep the selected row visible (scroll the tree only)
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>('.sel')
    const b = box.current
    if (!el || !b) return
    if (el.offsetTop < b.scrollTop + 40) b.scrollTop = el.offsetTop - 40
    else if (el.offsetTop + el.offsetHeight > b.scrollTop + b.clientHeight) b.scrollTop = el.offsetTop + el.offsetHeight - b.clientHeight + 8
  }, [selected, rows])

  /** First match at or after the current selection (wrapping), so searching right after entering a folder finds its children first. */
  const findFrom = (q: string, start: number, step: 1 | -1, includeStart: boolean) => {
    const n = rows.length
    for (let k = includeStart ? 0 : 1; k <= n; k++) {
      const i = (((start + step * k) % n) + n) % n
      if (matches(rows[i], q)) return rows[i].entry.path
    }
    return null
  }

  const toggle = (path: string, open?: boolean) => {
    setExpanded((e) => {
      const next = new Set(e)
      const shouldOpen = open ?? !next.has(path)
      if (shouldOpen) {
        next.add(path)
        loadDir(path)
      } else next.delete(path)
      return next
    })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return // leave Alt/Ctrl shortcuts to the IDE layer
    const cur = Math.max(0, indexOf(selected))
    const row = rows[cur]

    // Printable character: extend the speed search
    if (e.key.length === 1 && e.key !== ' ') {
      e.preventDefault()
      const q = query + e.key
      setQuery(q)
      const hit = findFrom(q, cur, 1, true)
      if (hit) setSelected(hit)
      return
    }
    switch (e.key) {
      case 'Backspace': {
        e.preventDefault()
        const q = query.slice(0, -1)
        setQuery(q)
        if (q) {
          const hit = findFrom(q, cur, 1, true)
          if (hit) setSelected(hit)
        }
        return
      }
      case 'Escape':
        if (query) {
          e.preventDefault()
          e.stopPropagation()
          setQuery('')
        }
        return
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : -1
        if (query) {
          // with an active search, arrows jump between matches (app → appCode → …)
          const hit = findFrom(query, cur, step, false)
          if (hit) setSelected(hit)
        } else {
          const next = rows[Math.min(rows.length - 1, Math.max(0, cur + step))]
          if (next) setSelected(next.entry.path)
        }
        return
      }
      case 'ArrowRight': {
        e.preventDefault()
        setQuery('')
        if (!row || row.entry.type !== 'dir') return
        if (!expanded.has(row.entry.path)) toggle(row.entry.path, true)
        else {
          const child = tree[row.entry.path]?.[0]
          if (child) setSelected(child.path)
        }
        return
      }
      case 'ArrowLeft': {
        e.preventDefault()
        setQuery('')
        if (!row) return
        if (row.entry.type === 'dir' && expanded.has(row.entry.path)) toggle(row.entry.path, false)
        else if (row.parent) setSelected(row.parent)
        return
      }
      case 'Enter': {
        e.preventDefault()
        setQuery('')
        if (!row) return
        if (row.entry.type === 'dir') toggle(row.entry.path)
        else if (!row.entry.sensitive) onOpenFile(row.entry.path)
        return
      }
      case 'Home':
        e.preventDefault()
        if (rows[0]) setSelected(rows[0].entry.path)
        return
      case 'End':
        e.preventDefault()
        if (rows.length) setSelected(rows[rows.length - 1].entry.path)
        return
    }
  }

  const noMatch = query !== '' && !rows.some((r) => matches(r, query))

  return (
    <div className="sf-ptree" ref={box} tabIndex={0} onKeyDown={onKeyDown} onBlur={() => setQuery('')}>
      {query && (
        <div className={`sf-speed ${noMatch ? 'miss' : ''}`}>
          <span>🔍</span> {query}
        </div>
      )}
      {rows.map((r) => {
        const hits = query ? new Set(speedMatch(query, r.entry.name) ?? []) : null
        return (
          <div
            key={r.entry.path}
            className={`sf-tree-item ${r.entry.path === selected ? 'sel' : ''} ${r.entry.path === activeFile ? 'on' : ''}`}
            style={{ paddingLeft: 8 + r.depth * 14, opacity: r.entry.sensitive ? 0.6 : 1 }}
            title={r.entry.sensitive ? 'Arquivo sensível: conteúdo bloqueado' : r.entry.path}
            onMouseDown={() => setSelected(r.entry.path)}
            onClick={() => (r.entry.type === 'dir' ? toggle(r.entry.path) : !r.entry.sensitive && onOpenFile(r.entry.path))}
          >
            <span className="tw">{r.entry.type === 'dir' ? (expanded.has(r.entry.path) ? '▾' : '▸') : r.entry.sensitive ? '🔒' : ''}</span>
            <span className={r.entry.type === 'dir' ? 'dir' : 'file'}>
              {hits && hits.size
                ? r.entry.name.split('').map((ch, i) => (hits.has(i) ? <b key={i}>{ch}</b> : ch))
                : r.entry.name}
            </span>
          </div>
        )
      })}
    </div>
  )
}
