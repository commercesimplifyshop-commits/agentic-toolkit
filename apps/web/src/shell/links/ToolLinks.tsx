import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'

export type ToolKind = 'diagram' | 'board'

export interface ToolLink {
  id: string
  change: string
  kind: ToolKind
  refId: string
  title: string
  createdBy: 'usuário' | 'claude'
  /** The diagram or board was deleted after it was linked */
  missing: boolean
}

/** One tool a change needs, as Claude proposed it or as it was created */
export interface ToolPlan {
  kind: ToolKind
  type?: string
  request?: string
  name?: string
  reason: string
}

export interface ToolResult {
  kind: ToolKind
  ok: boolean
  title: string
  reason: string
  jobId?: string
  refId?: string
  error?: string
}

const KIND_LABEL: Record<ToolKind, string> = { diagram: 'Diagrama', board: 'Quadro' }

/** Where a tool lives in the app */
export function toolHref(workspaceId: string, kind: ToolKind, refId: string) {
  return kind === 'diagram' ? `/w/${workspaceId}/diagrams?diagram=${refId}` : `/w/${workspaceId}/board?board=${refId}`
}

/** Shown inside a diagram or board: which changes use it. Clicking a change opens its workspace. */
export function UsedBy({ workspaceId, kind, refId }: { workspaceId: string; kind: ToolKind; refId: string }) {
  const [links, setLinks] = useState<ToolLink[] | null>(null)
  useEffect(() => {
    api
      .get<ToolLink[]>(`/workspaces/${workspaceId}/links?kind=${kind}&refId=${refId}`)
      .then(setLinks)
      .catch(() => setLinks([]))
  }, [workspaceId, kind, refId])
  if (!links) return null
  return (
    <div className="sf-used-by" aria-label="Mudanças que usam esta ferramenta">
      <span className="sf-faint" style={{ fontSize: 12 }}>
        {links.length ? 'Usado em:' : 'Ainda não usado em nenhuma mudança.'}
      </span>
      {links.map((l) => (
        <Link key={l.id} className="sf-chip" to={`/w/${workspaceId}/openspec/change/${encodeURIComponent(l.change)}`}>
          {l.change}
        </Link>
      ))}
    </div>
  )
}

/**
 * The tools panel of a change workspace: what is linked, a link to an existing item,
 * and Claude's analysis, which creates the tools the change needs.
 */
export function ToolsPanel({ workspaceId, change, onChanged }: { workspaceId: string; change: string; onChanged?: () => void }) {
  const [links, setLinks] = useState<ToolLink[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notes, setNotes] = useState<ToolResult[]>([])
  const [pending, setPending] = useState(0)
  const [existing, setExisting] = useState<{ kind: ToolKind; id: string; name: string }[]>([])
  const [pick, setPick] = useState('')
  const [boardName, setBoardName] = useState('')
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(
    () =>
      api
        .get<ToolLink[]>(`/workspaces/${workspaceId}/links?change=${encodeURIComponent(change)}`)
        .then((l) => (setLinks(l), l))
        .catch((e) => (setError((e as Error).message), [] as ToolLink[])),
    [workspaceId, change],
  )

  const loadExisting = useCallback(async () => {
    const [diagrams, boards] = await Promise.all([
      api.get<{ id: string; name: string }[]>(`/workspaces/${workspaceId}/diagrams`),
      api.get<{ id: string; name: string }[]>(`/workspaces/${workspaceId}/boards`),
    ])
    setExisting([...diagrams.map((d) => ({ kind: 'diagram' as const, id: d.id, name: d.name })), ...boards.map((b) => ({ kind: 'board' as const, id: b.id, name: b.name }))])
  }, [workspaceId])

  useEffect(() => {
    load()
    loadExisting().catch(() => setExisting([]))
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [load, loadExisting])

  // Diagrams are drawn in the background: refresh the list until they are linked, at most 5 minutes
  const follow = (expected: number, target: number) => {
    if (timer.current) clearInterval(timer.current)
    setPending(expected)
    const started = Date.now()
    timer.current = setInterval(async () => {
      const list = await load()
      const linkedDiagrams = list.filter((l) => l.kind === 'diagram' && l.createdBy === 'claude').length
      if (Date.now() - started > 5 * 60_000 || linkedDiagrams >= target) {
        if (timer.current) clearInterval(timer.current)
        setPending(0)
      }
      onChanged?.()
    }, 4000)
  }

  const analyze = async () => {
    setBusy('analyze')
    setError('')
    setNotes([])
    try {
      const r = await api.post<{ plans: ToolPlan[]; results: ToolResult[] }>(`/workspaces/${workspaceId}/links/assist`, { change })
      setNotes(r.results)
      const diagrams = r.results.filter((x) => x.kind === 'diagram' && x.ok).length
      const before = (await load()).filter((l) => l.kind === 'diagram' && l.createdBy === 'claude').length
      if (diagrams) follow(diagrams, before + diagrams)
      onChanged?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const addBoard = async () => {
    setBusy('board')
    setError('')
    try {
      const r = await api.post<{ results: ToolResult[] }>(`/workspaces/${workspaceId}/links/create`, { change, tools: [{ kind: 'board', name: boardName.trim() || 'Quadro da mudança', reason: 'Criado pelo engenheiro' }] })
      setNotes(r.results)
      setBoardName('')
      await load()
      onChanged?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const linkExisting = async () => {
    const [kind, refId] = pick.split(':') as [ToolKind, string]
    if (!kind || !refId) return
    setBusy('link')
    setError('')
    try {
      await api.post(`/workspaces/${workspaceId}/links`, { change, kind, refId })
      setPick('')
      await load()
      onChanged?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const unlink = async (linkId: string) => {
    try {
      await api.del(`/workspaces/${workspaceId}/links/${linkId}`)
      await load()
      onChanged?.()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const linkedKeys = new Set((links ?? []).map((l) => `${l.kind}:${l.refId}`))
  const available = existing.filter((x) => !linkedKeys.has(`${x.kind}:${x.id}`))

  return (
    <div className="sf-ws-tools">
      <p className="sf-faint" style={{ fontSize: 12.5, margin: '0 0 10px' }}>
        O Claude lê a proposta e as tarefas, decide que diagramas ou quadros a mudança precisa e os cria já vinculados. Cada um aparece aqui e na própria ferramenta.
      </p>
      <button className="sf-btn accent small" style={{ width: '100%', justifyContent: 'center' }} onClick={analyze} disabled={busy !== null}>
        {busy === 'analyze' ? 'O Claude está analisando…' : '✦ Analisar com o Claude e criar o que faltar'}
      </button>

      {error && <div className="sf-callout red" style={{ marginTop: 10 }}>{error}</div>}

      {notes.length > 0 && (
        <div className="sf-ws-notes">
          {notes.map((n, i) => (
            <div key={i} className={`sf-callout ${n.ok ? 'green' : 'red'}`} style={{ fontSize: 12.5 }}>
              <b>{n.ok ? (n.kind === 'diagram' ? 'Diagrama em desenho' : 'Quadro criado') : 'Não criado'}:</b> {n.title || KIND_LABEL[n.kind]}
              <div className="sf-faint">{n.reason}</div>
              {!n.ok && n.error && <div>{n.error}</div>}
            </div>
          ))}
        </div>
      )}
      {pending > 0 && <div className="sf-faint" style={{ fontSize: 12, marginTop: 6 }}>Desenhando {pending} diagrama(s) em segundo plano; a lista atualiza sozinha.</div>}

      <div className="sf-ws-section-title">Vinculadas a esta mudança</div>
      {links === null && <span className="sf-spinner" />}
      {links?.length === 0 && <div className="sf-faint" style={{ fontSize: 12.5 }}>Nenhuma ferramenta vinculada ainda.</div>}
      {links?.map((l) => (
        <div key={l.id} className="sf-ws-link">
          <div style={{ flex: 1, minWidth: 0 }}>
            <span className="sf-badge">{KIND_LABEL[l.kind]}</span>{' '}
            {l.missing ? (
              <span className="sf-faint">{l.title} (removido)</span>
            ) : (
              <Link to={toolHref(workspaceId, l.kind, l.refId)}>{l.title}</Link>
            )}
            <div className="sf-faint" style={{ fontSize: 11.5 }}>{l.createdBy === 'claude' ? 'criado pelo Claude' : 'vinculado por você'}</div>
          </div>
          <button className="sf-link" onClick={() => unlink(l.id)} title="Desvincula sem apagar a ferramenta">
            Desvincular
          </button>
        </div>
      ))}

      <div className="sf-ws-section-title">Adicionar</div>
      <div className="sf-row" style={{ gap: 6 }}>
        <select className="sf-input" value={pick} onChange={(e) => setPick(e.target.value)} disabled={!available.length}>
          <option value="">{available.length ? 'Vincular um existente…' : 'Nada disponível para vincular'}</option>
          {available.map((x) => (
            <option key={`${x.kind}:${x.id}`} value={`${x.kind}:${x.id}`}>
              {KIND_LABEL[x.kind]}: {x.name}
            </option>
          ))}
        </select>
        <button className="sf-btn small" onClick={linkExisting} disabled={!pick || busy !== null}>
          Vincular
        </button>
      </div>
      <div className="sf-row" style={{ gap: 6, marginTop: 6 }}>
        <input className="sf-input" value={boardName} onChange={(e) => setBoardName(e.target.value)} placeholder="Nome de um quadro em branco" maxLength={80} />
        <button className="sf-btn small" onClick={addBoard} disabled={busy !== null}>
          + Quadro
        </button>
      </div>
    </div>
  )
}
