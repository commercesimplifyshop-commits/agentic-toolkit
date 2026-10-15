import { ReactFlowProvider } from '@xyflow/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, waitJob, type Job } from '../api'
import { parseGraphSource, type Graph } from '../diagrams/graph'
import { SkillUses } from '../skills'
import { LiveArchitectureCanvas } from './LiveArchitectureCanvas'

/** Mirrors apps/api/src/diagrams/live-architecture.service.ts */
interface LiveView {
  tech: 'adobe-commerce' | 'salesforce-b2c'
  basedOn: string | null
  graph: Graph
  details: Record<string, { title: string; lines: string[] }>
  arranged: boolean
  autoClaude: boolean
  claude: { diagramId: string; name: string; basedOn: string | null; at: string; stale: boolean } | null
  claudeJob: string | null
}

const POLL_MS = 15_000
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—')

/** Arquitetura → Arquitetura viva: the platform drawn from the mapping, following each analysis */
export function LiveArchitecturePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [view, setView] = useState<LiveView | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'live' | 'claude'>('live')
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [job, setJob] = useState<Job | null>(null)
  const [claudeGraph, setClaudeGraph] = useState<Graph | null>(null)
  const [busy, setBusy] = useState('')
  const basedOn = useRef<string | null | undefined>(undefined)

  const load = useCallback(async () => {
    try {
      const v = await api.get<LiveView>(`/workspaces/${id}/architecture/live`)
      if (basedOn.current !== undefined && v.basedOn !== basedOn.current) setNotice(`Arquitetura atualizada com a análise de ${when(v.basedOn)}.`)
      basedOn.current = v.basedOn
      setView(v)
      setError('')
      return v
    } catch (e) {
      setError((e as Error).message)
      return null
    }
  }, [id])

  // live: the drawing follows the analysis by itself
  useEffect(() => {
    basedOn.current = undefined
    load()
    const t = window.setInterval(load, POLL_MS)
    return () => window.clearInterval(t)
  }, [load])

  // Claude's version, when there is one
  useEffect(() => {
    if (!view?.claude) return setClaudeGraph(null)
    api
      .get<{ source: string }>(`/workspaces/${id}/diagrams/${view.claude.diagramId}`)
      .then((d) => setClaudeGraph(parseGraphSource(d.source)))
      .catch(() => setClaudeGraph(null))
  }, [id, view?.claude?.diagramId])

  // follow a drawing Claude is making (started here or by the automatic option)
  useEffect(() => {
    if (!view?.claudeJob || job?.id === view.claudeJob) return
    let cancelled = false
    waitJob(view.claudeJob, (j) => !cancelled && setJob(j))
      .then(async (j) => {
        if (cancelled) return
        if (j.status === 'done') {
          await load()
          setTab('claude')
          setNotice('O Claude terminou de desenhar a arquitetura.')
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [view?.claudeJob, job?.id, load])

  const drawWithClaude = async () => {
    setBusy('claude')
    setError('')
    try {
      const r = await api.post<{ jobId: string }>(`/workspaces/${id}/architecture/live/claude`, {})
      setView((v) => (v ? { ...v, claudeJob: r.jobId } : v))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }
  const openInEditor = async () => {
    setBusy('editor')
    try {
      const r = await api.post<{ diagramId: string }>(`/workspaces/${id}/architecture/live/diagram`, { from: tab })
      navigate(`/w/${id}/diagrams?diagram=${r.diagramId}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }
  const sync = async () => {
    setBusy('sync')
    setError('')
    try {
      await api.post(`/workspaces/${id}/settings/sync`, {})
      setNotice('Analisando o projeto de novo: a arquitetura se atualiza sozinha quando terminar.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  if (error && !view) return <div className="sf-page"><div className="sf-callout red">{error}</div></div>
  if (!view) return <div className="sf-page"><span className="sf-spinner" /></div>
  const running = job?.status === 'running' || Boolean(view.claudeJob && !job)
  const detail = selected ? view.details[selected] : null
  const skills = (job?.log ?? []).filter((l) => l.startsWith('⚡ Skill:')).map((l) => l.replace('⚡ Skill: ', ''))
  const showing = tab === 'claude' && claudeGraph ? claudeGraph : view.graph

  return (
    <div className="sf-live">
      <div className="sf-live-head">
        <div style={{ minWidth: 0 }}>
          <h1>Arquitetura viva</h1>
          <p>
            A arquitetura de referência da plataforma, em camadas: storefront, APIs e processamento, os domínios da plataforma e a infraestrutura, com os sistemas do cliente e os parceiros nas laterais. É montada a partir do mapeamento do projeto e atualizada a cada nova análise. Módulos, plugins, observers e cartuchos entram como evidência: clique num elemento para ver. Arraste as caixas para organizar; o arranjo é mantido.
          </p>
        </div>
        <div className="sf-row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="sf-btn small" disabled={!!busy} onClick={sync} title="Busca as mudanças do código e analisa de novo">
            {busy === 'sync' ? 'Iniciando…' : '↻ Analisar de novo'}
          </button>
          <button className="sf-btn small" disabled={!!busy || (tab === 'claude' && !view.claude)} onClick={openInEditor}>
            Abrir no editor de diagramas
          </button>
          <button className="sf-btn small accent" disabled={!!busy || running} onClick={drawWithClaude}>
            {running ? 'O Claude está desenhando…' : view.claude ? '✦ Redesenhar com o Claude' : '✦ Desenhar com o Claude'}
          </button>
        </div>
      </div>

      <div className="sf-live-bar">
        <div className="sf-row" style={{ gap: 2 }}>
          <button className={`sf-tab ${tab === 'live' ? 'on' : ''}`} onClick={() => setTab('live')}>
            Do mapeamento
          </button>
          <button className={`sf-tab ${tab === 'claude' ? 'on' : ''}`} onClick={() => setTab('claude')} disabled={!view.claude && !running}>
            Desenhada pelo Claude {view.claude?.stale && <span className="sf-badge orange">desatualizada</span>}
          </button>
        </div>
        <span className="sf-faint" style={{ fontSize: 12 }}>
          <span className="sf-live-dot" /> {tab === 'live' ? `Análise de ${when(view.basedOn)} · confere a cada ${POLL_MS / 1000}s` : view.claude ? `Desenhada em ${when(view.claude.at)}${view.claude.stale ? ' sobre uma análise anterior' : ''}` : ''}
        </span>
        <span style={{ flex: 1 }} />
        {tab === 'live' && view.arranged && (
          <button className="sf-link" style={{ fontSize: 12 }} onClick={() => api.del(`/workspaces/${id}/architecture/live/positions`).then(load)}>
            Reorganizar automaticamente
          </button>
        )}
        <label className="sf-faint" style={{ fontSize: 12, display: 'inline-flex', gap: 6, alignItems: 'center' }} title="Cada novo desenho usa o Claude Code (tem custo)">
          <input type="checkbox" checked={view.autoClaude} onChange={(e) => api.put(`/workspaces/${id}/architecture/live/settings`, { autoClaude: e.target.checked }).then(load)} />
          Redesenhar com o Claude após cada nova análise
        </label>
      </div>

      {notice && (
        <div className="sf-callout green sf-live-notice" onClick={() => setNotice('')}>
          {notice}
        </div>
      )}
      {error && <div className="sf-callout red sf-live-notice">{error}</div>}
      {running && (
        <div className="sf-callout blue sf-live-notice">
          <span className="sf-spinner" /> O Claude está lendo o código e desenhando a arquitetura a partir do mapeamento.{' '}
          {job?.log.length ? <span className="sf-faint">{job.log.filter((l) => !l.startsWith('⚡')).at(-1)}</span> : null}
          {skills.length > 0 && <SkillUses skills={skills.map((title) => ({ name: title, title }))} compact />}
        </div>
      )}
      {job?.status === 'error' && <div className="sf-callout red sf-live-notice">O Claude não conseguiu desenhar: {job.error}</div>}

      <div className="sf-live-body">
        <div className="sf-live-canvas">
          {tab === 'claude' && !claudeGraph ? (
            <div className="sf-faint" style={{ padding: 24 }}>{running ? 'Aguardando o desenho do Claude…' : 'O Claude ainda não desenhou esta arquitetura.'}</div>
          ) : (
            <ReactFlowProvider>
              <LiveArchitectureCanvas
                graph={showing}
                revision={`${tab}|${tab === 'live' ? view.basedOn : view.claude?.at}`}
                onSelect={setSelected}
                onMoved={tab === 'live' ? (p) => void api.put(`/workspaces/${id}/architecture/live/positions`, { positions: p }) : undefined}
              />
            </ReactFlowProvider>
          )}
        </div>
        {tab === 'live' && detail && (
          <aside className="sf-live-detail">
            <div className="sf-row" style={{ justifyContent: 'space-between' }}>
              <strong className="sf-mono" style={{ overflowWrap: 'anywhere' }}>{detail.title}</strong>
              <button className="sf-link" onClick={() => setSelected(null)}>
                ×
              </button>
            </div>
            {detail.lines.length === 0 ? (
              <div className="sf-faint" style={{ fontSize: 12.5 }}>Nada mapeado neste elemento.</div>
            ) : (
              <ul>
                {detail.lines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            )}
            <Link className="sf-link" style={{ fontSize: 12 }} to={`/w/${id}/ask`}>
              Perguntar ao código sobre isto →
            </Link>
          </aside>
        )}
      </div>
    </div>
  )
}
