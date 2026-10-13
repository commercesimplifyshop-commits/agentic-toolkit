import { Marked } from 'marked'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMap } from '../../map/useMap'
import { api, waitJob, type Job } from '../api'
import { JobProgress } from '../components/JobProgress'

type DocKind = 'tema' | 'modulo' | 'funcionalidade' | 'fluxo'

interface ClaudeDocsState {
  status: 'publishing' | 'published' | 'error'
  url?: string
  error?: string
  publishedAt?: string
  jobId?: string
}

interface DocMeta {
  id: string
  kind: DocKind
  subject: string
  instructions?: string
  title: string
  status: 'generating' | 'ready' | 'error'
  error?: string
  createdAt: string
  updatedAt: string
  jobId?: string
  claudeDocs?: ClaudeDocsState
}

interface Doc extends DocMeta {
  markdown: string
  filesRead: string[]
}

const KINDS: { id: DocKind; label: string; hint: string; placeholder: string }[] = [
  { id: 'modulo', label: 'Módulo', hint: 'Tudo sobre um módulo: arquivos, APIs, plugins, observers, configuração e dados.', placeholder: 'Ex.: Vendor_Checkout' },
  { id: 'funcionalidade', label: 'Funcionalidade', hint: 'Como uma funcionalidade funciona de ponta a ponta, em todos os módulos envolvidos.', placeholder: 'Ex.: estorno parcial de pedido' },
  { id: 'fluxo', label: 'Fluxo', hint: 'A ordem real de execução: entrada, serviços, plugins, observers, persistência e integrações.', placeholder: 'Ex.: do carrinho até a criação do pedido' },
  { id: 'tema', label: 'Tema', hint: 'Um assunto transversal: todos os pontos do código ligados a ele e como se conectam.', placeholder: 'Ex.: integrações com o ERP' },
]
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.id, k.label])) as Record<DocKind, string>
const FLOW_SUGGESTIONS = ['do carrinho até a criação do pedido', 'cadastro e login do cliente', 'cálculo de frete no checkout', 'faturamento e envio do pedido', 'importação de catálogo e estoque']

/** Markdown from Claude rendered without raw HTML (escaped), so nothing in a doc can run as markup. */
const md = new Marked({ gfm: true, renderer: { html: ({ text }: { text: string }) => text.replace(/</g, '&lt;').replace(/>/g, '&gt;') } })

export function DocsPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const [docs, setDocs] = useState<DocMeta[]>([])
  const docId = params.get('doc')
  const editing = params.get('edit') === '1' ? docs.find((d) => d.id === docId) : undefined
  const [error, setError] = useState('')

  const refresh = useCallback(() => {
    api
      .get<DocMeta[]>(`/workspaces/${id}/docs`)
      .then(setDocs)
      .catch((e) => setError(e.message))
  }, [id])

  useEffect(refresh, [refresh])

  return (
    <div className="sf-docs">
      <aside className="sf-docs-list">
        <button className={`sf-btn accent ${!docId ? 'on' : ''}`} style={{ width: '100%', justifyContent: 'center' }} onClick={() => setParams({})}>
          + Nova documentação
        </button>
        <div className="sf-docs-items">
          {docs.map((d) => (
            <button key={d.id} className={`sf-docs-item ${d.id === docId ? 'on' : ''}`} onClick={() => setParams({ doc: d.id })}>
              <span className="t">{d.title}</span>
              <span className="m">
                <span className="sf-badge">{KIND_LABEL[d.kind]}</span>
                {d.status === 'generating' && <span className="sf-badge blue">gerando…</span>}
                {d.status === 'error' && <span className="sf-badge red">erro</span>}
                {d.claudeDocs?.status === 'published' && <span className="sf-badge green">Claude Docs</span>}
                <span className="sf-faint">{new Date(d.updatedAt).toLocaleDateString('pt-BR')}</span>
              </span>
            </button>
          ))}
          {docs.length === 0 && <div className="sf-faint" style={{ fontSize: 12.5, padding: '14px 4px' }}>Nenhuma documentação ainda.</div>}
        </div>
      </aside>
      <section className="sf-docs-main">
        {error && <div className="sf-callout red">{error}</div>}
        {editing ? (
          <NewDoc key={`edit-${editing.id}`} workspaceId={id} regenerate={editing} onCancel={() => setParams({ doc: editing.id })} onCreated={(newId) => (refresh(), setParams({ doc: newId }))} />
        ) : docId ? (
          params.get('edit') === '1' ? (
            <span className="sf-spinner" />
          ) : (
            <DocView key={docId} workspaceId={id} docId={docId} onChanged={refresh} onDeleted={() => (setParams({}), refresh())} onRegenerate={() => setParams({ doc: docId, edit: '1' })} />
          )
        ) : (
          <NewDoc key="new" workspaceId={id} onCreated={(newId) => (refresh(), setParams({ doc: newId }))} />
        )}
      </section>
    </div>
  )
}

// ---- new doc --------------------------------------------------------------------------------------

function NewDoc({ workspaceId, onCreated, regenerate, onCancel }: { workspaceId: string; onCreated: (id: string) => void; regenerate?: DocMeta; onCancel?: () => void }) {
  const { map, loadWorkspace } = useMap()
  const [kind, setKind] = useState<DocKind>(regenerate?.kind ?? 'modulo')
  const [subject, setSubject] = useState(regenerate?.subject ?? '')
  const [instructions, setInstructions] = useState(regenerate?.instructions ?? '')
  const [publish, setPublish] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadWorkspace(workspaceId)
  }, [workspaceId, loadWorkspace])

  const suggestions = useMemo(() => {
    if (kind === 'fluxo') return FLOW_SUGGESTIONS
    if (kind !== 'modulo') return []
    const custom = new Map<string, boolean>()
    for (const i of map?.items ?? []) if (i.module) custom.set(i.module, (custom.get(i.module) ?? false) || i.origin !== 'native')
    return [...custom.entries()].sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0])).map(([m]) => m)
  }, [kind, map])

  const current = KINDS.find((k) => k.id === kind)!

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await api.post<{ doc: DocMeta }>(`/workspaces/${workspaceId}/docs`, { kind, subject, instructions, publish, regenerate: regenerate?.id })
      onCreated(r.doc.id)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="sf-docs-new">
      <div className="sf-page-head" style={{ marginBottom: 18 }}>
        <div className="sf-page-icon">▤</div>
        <div className="sf-page-title">
          <h1>{regenerate ? 'Regerar documentação' : 'Nova documentação'}</h1>
          <p>
            {regenerate
              ? `Ajuste o que precisar. O conteúdo atual de "${regenerate.title}" é substituído${regenerate.claudeDocs?.url ? ', e o mesmo documento no Claude Docs é atualizado' : ''}.`
              : 'O seu Claude Code lê o código desta instalação (só com ferramentas de leitura) e escreve uma documentação estruturada.'}
          </p>
        </div>
      </div>

      <div className="sf-field">
        <label>Tipo</label>
        <div className="sf-docs-kinds">
          {KINDS.map((k) => (
            <button key={k.id} className={kind === k.id ? 'on' : ''} onClick={() => (setKind(k.id), kind !== k.id && setSubject(''))}>
              <strong>{k.label}</strong>
              <span>{k.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="sf-field">
        <label>{kind === 'modulo' ? 'Módulo' : 'Assunto'}</label>
        <input className="sf-input" list="sf-doc-suggestions" placeholder={current.placeholder} value={subject} onChange={(e) => setSubject(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && subject.trim().length >= 2 && !busy && submit()} autoFocus />
        <datalist id="sf-doc-suggestions">
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        {kind === 'modulo' && <small>Os módulos customizados aparecem primeiro na lista.</small>}
      </div>

      <div className="sf-field">
        <label>Orientações (opcional)</label>
        <textarea className="sf-input" rows={3} placeholder="Público, perguntas que a doc deve responder, o que deixar de fora…" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      </div>

      <label className="sf-apic-check" style={{ marginBottom: 18 }}>
        <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />{' '}
        {regenerate?.claudeDocs?.url ? 'Atualizar o documento no Claude Docs ao terminar' : 'Publicar automaticamente no Claude Docs (privado na sua conta claude.ai até você compartilhar)'}
      </label>

      {error && <div className="sf-callout red" style={{ marginBottom: 14 }}>{error}</div>}
      <div className="sf-row">
        <button className="sf-btn accent" onClick={submit} disabled={busy || subject.trim().length < 2}>
          {busy ? <span className="sf-spinner" /> : '✦'} {regenerate ? 'Regerar documentação' : 'Gerar documentação'}
        </button>
        {onCancel && (
          <button className="sf-btn" onClick={onCancel} disabled={busy}>
            Voltar
          </button>
        )}
      </div>
      <p className="sf-faint" style={{ fontSize: 12, marginTop: 12 }}>
        Leva alguns minutos, conforme o tamanho do assunto. Você pode sair desta tela: a geração continua e o documento aparece na lista.
      </p>
    </div>
  )
}

// ---- doc view -----------------------------------------------------------------------------------

function DocView({ workspaceId, docId, onChanged, onDeleted, onRegenerate }: { workspaceId: string; docId: string; onChanged: () => void; onDeleted: () => void; onRegenerate: () => void }) {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState('')
  const [showSources, setShowSources] = useState(false)

  const load = useCallback(() => api.get<Doc>(`/workspaces/${workspaceId}/docs/${docId}`).then(setDoc).catch((e) => setError(e.message)), [workspaceId, docId])
  useEffect(() => {
    load()
  }, [load])

  // Follow the running job (generation or publishing), then reload the doc
  const runningJob = doc?.status === 'generating' ? doc.jobId : doc?.claudeDocs?.status === 'publishing' ? doc.claudeDocs.jobId : undefined
  useEffect(() => {
    if (!runningJob) return
    let alive = true
    waitJob(runningJob, (j) => alive && setJob(j))
      .catch(() => undefined)
      .finally(() => {
        if (!alive) return
        load()
        onChanged()
      })
    return () => {
      alive = false
    }
  }, [runningJob, load, onChanged])

  const html = useMemo(() => (doc?.markdown ? (md.parse(doc.markdown) as string) : ''), [doc?.markdown])

  if (!doc) return error ? <div className="sf-callout red">{error}</div> : <span className="sf-spinner" />

  const act = async (fn: () => Promise<unknown>) => {
    setError('')
    try {
      await fn()
      await load()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const publish = () => act(() => api.post(`/workspaces/${workspaceId}/docs/${docId}/publish`))
  const cancel = () => {
    if (!confirm(doc.status === 'generating' ? 'Cancelar a geração? O Claude Code é interrompido e o que já foi lido é descartado.' : 'Cancelar a publicação no Claude Docs?')) return
    act(() => api.post(`/workspaces/${workspaceId}/docs/${docId}/cancel`))
  }
  const remove = () => {
    if (!confirm(`Remover "${doc.title}" do Agentic Toolkit?${doc.claudeDocs?.url ? '\n\nO documento no Claude Docs continua lá.' : ''}`)) return
    api.del(`/workspaces/${workspaceId}/docs/${docId}`).then(onDeleted, (e) => setError(e.message))
  }
  const exportUrl = (format: 'docx' | 'pdf') => `/api/workspaces/${workspaceId}/docs/${docId}/export?format=${format}`
  const cd = doc.claudeDocs
  const ready = doc.status === 'ready' && Boolean(doc.markdown)

  return (
    <div className="sf-docs-view">
      <div className="sf-docs-bar">
        <div className="sf-docs-link">
          {cd?.status === 'published' && cd.url ? (
            <>
              <span className="sf-badge green">Claude Docs</span>
              <a href={cd.url} target="_blank" rel="noreferrer" className="sf-mono">
                {cd.url}
              </a>
              <button className="sf-link" onClick={() => navigator.clipboard?.writeText(cd.url!)} title="Copiar link">
                ⧉
              </button>
            </>
          ) : cd?.status === 'publishing' ? (
            <>
              <span className="sf-spinner" /> <span className="sf-muted">Publicando no Claude Docs…</span>
            </>
          ) : cd?.status === 'error' ? (
            <>
              <span className="sf-badge red">Claude Docs</span>
              <span className="sf-muted" title={cd.error}>
                Falhou: {cd.error?.slice(0, 120)}
              </span>
              {cd.url && (
                <a href={cd.url} target="_blank" rel="noreferrer">
                  abrir
                </a>
              )}
            </>
          ) : (
            <span className="sf-faint">Ainda não publicado no Claude Docs</span>
          )}
        </div>
        <div className="sf-row">
          {ready && cd?.status !== 'publishing' && (
            <button className="sf-btn small" onClick={publish}>
              {cd?.url ? '↻ Republicar' : 'Publicar no Claude Docs'}
            </button>
          )}
          <a className={`sf-btn small ${ready ? '' : 'disabled'}`} href={ready ? exportUrl('docx') : undefined} download>
            ⤓ Word
          </a>
          <a className={`sf-btn small ${ready ? '' : 'disabled'}`} href={ready ? exportUrl('pdf') : undefined} download>
            ⤓ PDF
          </a>
          {(doc.status === 'generating' || cd?.status === 'publishing') && (
            <button className="sf-btn small danger" onClick={cancel}>
              ■ Cancelar
            </button>
          )}
          <button className="sf-btn small" onClick={onRegenerate} disabled={doc.status === 'generating' || cd?.status === 'publishing'} title="Abre o formulário para gerar de novo a partir do código atual">
            ✦ Regerar
          </button>
          <button className="sf-btn small danger" onClick={remove} disabled={doc.status === 'generating' || cd?.status === 'publishing'}>
            Excluir
          </button>
        </div>
      </div>

      {error && <div className="sf-callout red" style={{ margin: '12px 0' }}>{error}</div>}

      {(doc.status === 'generating' || (cd?.status === 'publishing' && job)) && (
        <div className="sf-card" style={{ marginBottom: 16 }}>
          <div className="sf-muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
            {KIND_LABEL[doc.kind]}: <b>{doc.subject}</b>
          </div>
          {job ? <JobProgress job={job} /> : <span className="sf-spinner" />}
          {job?.status === 'running' && job.log.length > 1 && (
            <details style={{ marginTop: 8 }}>
              <summary className="sf-faint" style={{ fontSize: 12, cursor: 'pointer' }}>
                O que o Claude já consultou ({job.log.length})
              </summary>
              <div className="sf-mono sf-faint sf-docs-log">
                {job.log.slice(-60).map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {doc.status === 'error' && <div className="sf-callout red" style={{ marginBottom: 16 }}>{doc.error ?? 'A geração falhou.'}</div>}
      {doc.status === 'ready' && doc.error && <div className="sf-callout orange" style={{ marginBottom: 16 }}>A última regeneração falhou ({doc.error}); mostrando a versão anterior.</div>}

      {html && (
        <>
          <article className="sf-doc" dangerouslySetInnerHTML={{ __html: html }} />
          {doc.filesRead.length > 0 && (
            <div className="sf-docs-sources">
              <button className="sf-link" onClick={() => setShowSources(!showSources)}>
                {showSources ? '▾' : '▸'} {doc.filesRead.length} arquivos consultados pelo Claude
              </button>
              {showSources && (
                <ul>
                  {doc.filesRead.map((f) => (
                    <li key={f}>
                      <Link className="sf-mono" to={`/w/${workspaceId}/code?path=${encodeURIComponent(f)}`}>
                        {f}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
