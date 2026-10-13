import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { api, waitJob, type Job } from '../api'
import { JobProgress } from '../components/JobProgress'
import { TextEditor } from '../editor/TextEditor'
import { download, readDiagramFile, slugFile, sourceBlob, agenticToolkitBlob, svgBlob, svgToPng, type DiagramFile } from '../diagrams/exchange'
import { CanvasEditor } from '../diagrams/CanvasEditor'
import { UsedBy } from '../links/ToolLinks'
import { emptyGraph, mermaidToGraph, parseGraphSource, type GraphFamily } from '../diagrams/graph'
import { renderMermaid } from '../diagrams/render'
import { BLANK_SOURCE, KIND_LABEL, MAGENTO_TEMPLATES, TEMPLATES, type DiagramKind, type Template } from '../diagrams/templates'
import { useShell } from '../store'

const SCENARIOS: { id: string; label: string }[] = [
  { id: 'b2c', label: 'Magento B2C' },
  { id: 'b2b', label: 'Magento B2B' },
  { id: 'd2c', label: 'Magento D2C' },
  { id: 'marketplace', label: 'Magento Marketplace' },
  { id: 'custom', label: 'Outro (sem cenário)' },
]
const MODEL_TYPES: { id: string; label: string }[] = [
  { id: 'c4-context', label: 'C4 · Contexto' },
  { id: 'c4-container', label: 'C4 · Contêineres' },
  { id: 'c4-component', label: 'C4 · Componentes' },
  { id: 'uml-class', label: 'UML · Classes' },
  { id: 'uml-sequence', label: 'UML · Sequência' },
  { id: 'uml-state', label: 'UML · Estados' },
  { id: 'flow', label: 'Fluxo' },
  { id: 'er', label: 'Entidades (ER)' },
]

interface DiagramMeta {
  id: string
  name: string
  kind: DiagramKind
  createdAt: string
  updatedAt: string
  lines: number
  mode?: 'code' | 'canvas'
}

type Start = { name: string; kind: DiagramKind; mode: 'code' | 'canvas'; source: string }

/** Templates in C4 and flow open as an editable canvas; the others stay as code. */
function startFrom(t: { label: string; kind: DiagramKind; source: string }): Start {
  const g = t.kind === 'c4' || t.kind === 'flow' ? mermaidToGraph(t.source, t.kind) : null
  return g ? { name: t.label, kind: t.kind, mode: 'canvas', source: JSON.stringify(g) } : { name: t.label, kind: t.kind, mode: 'code', source: t.source }
}

interface Diagram extends DiagramMeta {
  source: string
}

type SaveState = { kind: 'saved'; at?: string } | { kind: 'dirty' } | { kind: 'saving' } | { kind: 'error'; message: string }

const AUTOSAVE_MS = 900
const RENDER_MS = 350

export function DiagramsPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const diagramId = params.get('diagram')
  const creating = params.get('new') === '1'
  const [list, setList] = useState<DiagramMeta[] | null>(null)
  const [error, setError] = useState('')

  const refresh = useCallback(
    () =>
      api
        .get<DiagramMeta[]>(`/workspaces/${id}/diagrams`)
        .then((l) => (setList(l), l))
        .catch((e) => (setError(e.message), [] as DiagramMeta[])),
    [id],
  )
  useEffect(() => {
    refresh()
  }, [refresh])

  const create = async (start: Start) => {
    setError('')
    try {
      const d = await api.post<Diagram>(`/workspaces/${id}/diagrams`, start)
      await refresh()
      setParams({ diagram: d.id })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="sf-diagrams">
      <aside className="sf-board-list">
        <button className="sf-btn accent" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setParams({ new: '1' })}>
          + Novo diagrama
        </button>
        <div className="sf-docs-items">
          {list?.map((d) => (
            <button key={d.id} className={`sf-docs-item ${d.id === diagramId ? 'on' : ''}`} onClick={() => setParams({ diagram: d.id })}>
              <span className="t">{d.name}</span>
              <span className="m">
                <span className="sf-badge">{KIND_LABEL[d.kind]}</span>
                <span className="sf-faint">{new Date(d.updatedAt).toLocaleDateString('pt-BR')}</span>
              </span>
            </button>
          ))}
          {list?.length === 0 && <div className="sf-faint" style={{ fontSize: 12.5, padding: '14px 4px' }}>Nenhum diagrama ainda.</div>}
        </div>
        <p className="sf-faint" style={{ fontSize: 11.5, margin: 0 }}>
          Diagramas em código (Mermaid): ficam salvos no Agentic Toolkit e podem ser importados e exportados.
        </p>
      </aside>

      <section className="sf-board-main">
        {error && <div className="sf-callout red" style={{ margin: 12 }}>{error}</div>}
        {creating ? (
          <NewDiagram
            workspaceId={id}
            onPick={(t) => create(startFrom(t))}
            onVisual={(family: GraphFamily) =>
              create({ name: family === 'c4' ? 'Canvas C4' : 'Canvas de fluxo', kind: family, mode: 'canvas', source: JSON.stringify(emptyGraph(family)) })
            }
            onImport={(f) => create({ name: f.name, kind: f.kind, mode: f.mode ?? 'code', source: f.source })}
            onCancel={() => setParams({})}
            onGenerated={async (newId) => {
              await refresh()
              setParams({ diagram: newId })
            }}
          />
        ) : diagramId ? (
          <DiagramEditor key={diagramId} workspaceId={id} diagramId={diagramId} onChanged={refresh} onDeleted={() => (setParams({}), refresh())} onError={setError} />
        ) : (
          list?.length === 0 && (
            <div className="sf-empty" style={{ marginTop: 60 }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}>⬡</div>
              Diagramas de arquitetura: C4, UML, fluxos e modelos de dados.
              <div style={{ marginTop: 16 }}>
                <button className="sf-btn accent" onClick={() => setParams({ new: '1' })}>
                  + Criar o primeiro diagrama
                </button>
              </div>
            </div>
          )
        )}
      </section>
    </div>
  )
}

// ---- new --------------------------------------------------------------------------------------

function NewDiagram({
  workspaceId,
  onPick,
  onVisual,
  onImport,
  onCancel,
  onGenerated,
}: {
  workspaceId: string
  onPick: (t: Template) => void
  onVisual: (family: GraphFamily) => void
  onImport: (f: DiagramFile) => void
  onCancel: () => void
  onGenerated: (id: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const pickFile = async (file: File) => {
    setError('')
    try {
      onImport(await readDiagramFile(file))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const tech = useShell((st) => st.workspaces.find((w) => w.id === workspaceId)?.tech)
  return (
    <div className="sf-docs-new" style={{ maxWidth: 900 }}>
      <div className="sf-page-head" style={{ marginBottom: 18 }}>
        <div className="sf-page-icon">⬡</div>
        <div className="sf-page-title">
          <h1>Novo diagrama</h1>
          <p>Use um modelo pronto, peça ao Claude para desenhar a partir da sua descrição, ou importe um arquivo.</p>
        </div>
      </div>

      <ClaudeGenerator workspaceId={workspaceId} onDone={onGenerated} />

      <div className="sf-apic-section" style={{ marginTop: 26 }}>
        Desenhar no canvas (arrastar e conectar)
      </div>
      <div className="sf-diagram-templates">
        <button onClick={() => onVisual('c4')}>
          <span className="sf-badge">C4</span>
          <strong>Canvas C4 em branco</strong>
          <span>Pessoas, sistemas, contêineres, bancos, filas e fronteiras, arrastados e ligados.</span>
        </button>
        <button onClick={() => onVisual('flow')}>
          <span className="sf-badge">Fluxo</span>
          <strong>Canvas de fluxo em branco</strong>
          <span>Início, passos, decisões e fim, arrastados e ligados.</span>
        </button>
      </div>

      {tech !== 'salesforce-b2c' && (
        <>
          <div className="sf-apic-section" style={{ marginTop: 26 }}>
            Arquiteturas de referência Magento 2 (editáveis no canvas)
          </div>
          <div className="sf-diagram-templates">
            {MAGENTO_TEMPLATES.map((t) => (
              <button key={t.id} onClick={() => onPick(t)}>
                <span className="sf-badge orange">Magento 2</span>
                <strong>{t.label.replace('Magento 2 · ', '')}</strong>
                <span>{t.hint}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="sf-apic-section" style={{ marginTop: 22 }}>
        Modelos gerais
      </div>
      <div className="sf-diagram-templates">
        {TEMPLATES.map((t) => (
          <button key={t.id} onClick={() => onPick(t)}>
            <span className="sf-badge">{KIND_LABEL[t.kind]}</span>
            <strong>{t.label}</strong>
            <span>{t.hint}</span>
          </button>
        ))}
        <button onClick={() => onPick({ id: 'blank', kind: 'flow', label: 'Em branco', hint: 'Começar do zero.', source: BLANK_SOURCE })}>
          <span className="sf-badge">Fluxo</span>
          <strong>Em branco</strong>
          <span>Um fluxo simples, para editar do zero.</span>
        </button>
      </div>

      <div className="sf-row" style={{ marginTop: 22, gap: 10 }}>
        <input ref={input} type="file" accept=".json,.mmd,.mermaid,.txt,.md" hidden onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])} />
        <button className="sf-btn" onClick={() => input.current?.click()}>
          ⤒ Importar arquivo
        </button>
        <span className="sf-faint" style={{ fontSize: 12 }}>.json do Agentic Toolkit, .mmd / .mermaid / .txt ou .md com um bloco mermaid</span>
        <span style={{ flex: 1 }} />
        <button className="sf-link" onClick={onCancel}>
          Cancelar
        </button>
      </div>
      {error && <div className="sf-callout red" style={{ marginTop: 12 }}>{error}</div>}
    </div>
  )
}

// ---- generate with Claude ---------------------------------------------------------------

/** Describes the model; Claude Code (read-only) draws it from the installation's code. */
function ClaudeGenerator({ workspaceId, onDone }: { workspaceId: string; onDone: (id: string) => void }) {
  const [request, setRequest] = useState('')
  const [scenario, setScenario] = useState('b2c')
  const [type, setType] = useState('c4-container')
  const [jobId, setJobId] = useState<string | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState('')
  const busy = jobId !== null && job?.status !== 'error' && job?.status !== 'done'

  const start = async () => {
    setError('')
    setJob(null)
    try {
      const r = await api.post<{ jobId: string }>(`/workspaces/${workspaceId}/diagrams/generate`, { request, scenario, type })
      setJobId(r.jobId)
      const finished = await waitJob(r.jobId, setJob)
      setJobId(null)
      if (finished.status === 'done' && finished.result?.diagramId) onDone(String(finished.result.diagramId))
      else setError(finished.error ?? 'A geração não terminou.')
    } catch (e) {
      setJobId(null)
      setError((e as Error).message)
    }
  }

  const cancel = async () => {
    if (!jobId) return
    try {
      await api.post(`/workspaces/${workspaceId}/diagrams/generate/${jobId}/cancel`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="sf-card" style={{ padding: 16 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>✦ Criar com o Claude</div>
      <div className="sf-faint" style={{ fontSize: 12, marginBottom: 12 }}>
        Descreva a arquitetura que você quer. O seu Claude Code lê o código desta instalação (somente leitura) e desenha o modelo. Leva de alguns segundos a alguns minutos.
      </div>

      {jobId ? (
        <>
          {job ? <JobProgress job={job} /> : <span className="sf-spinner" />}
          {busy && (
            <button className="sf-btn small danger" style={{ marginTop: 12 }} onClick={cancel}>
              ■ Cancelar
            </button>
          )}
        </>
      ) : (
        <>
          <textarea
            className="sf-input"
            rows={3}
            placeholder="Ex.: loja B2B com contas de empresa, cotação e integração com o ERP via fila; integração de pagamento com Pix"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            style={{ resize: 'vertical', font: 'inherit', marginBottom: 10 }}
          />
          <div className="sf-row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <select className="sf-input" style={{ width: 'auto' }} value={scenario} onChange={(e) => setScenario(e.target.value)}>
              {SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <select className="sf-input" style={{ width: 'auto' }} value={type} onChange={(e) => setType(e.target.value)}>
              {MODEL_TYPES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <span style={{ flex: 1 }} />
            <button className="sf-btn accent" disabled={request.trim().length < 3} onClick={start}>
              ✦ Gerar com o Claude
            </button>
          </div>
        </>
      )}
      {error && <div className="sf-callout red" style={{ marginTop: 12 }}>{error}</div>}
    </div>
  )
}

// ---- editor -------------------------------------------------------------------------------------

function DiagramEditor({
  workspaceId,
  diagramId,
  onChanged,
  onDeleted,
  onError,
}: {
  workspaceId: string
  diagramId: string
  onChanged: () => void
  onDeleted: () => void
  onError: (m: string) => void
}) {
  const url = `/workspaces/${workspaceId}/diagrams/${diagramId}`
  const [diagram, setDiagram] = useState<Diagram | null>(null)
  const [source, setSource] = useState('')
  const [name, setName] = useState('')
  const [save, setSave] = useState<SaveState>({ kind: 'saved' })
  const [render, setRender] = useState<{ svg?: string; error?: string; busy: boolean }>({ busy: true })
  const [zoom, setZoom] = useState(1)
  const [busyExport, setBusyExport] = useState(false)
  const lastSaved = useRef({ source: '', name: '' })
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const current = useRef({ source: '', name: '' })
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api
      .get<Diagram>(url)
      .then((d) => {
        setDiagram(d)
        setSource(d.source)
        setName(d.name)
        lastSaved.current = { source: d.source, name: d.name }
        current.current = { source: d.source, name: d.name }
      })
      .catch((e) => onError(e.message))
  }, [url, onError])

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const c = current.current
    if (c.source === lastSaved.current.source && c.name === lastSaved.current.name) return
    setSave({ kind: 'saving' })
    try {
      const r = await api.put<{ updatedAt: string }>(url, { source: c.source, name: c.name })
      lastSaved.current = { ...c }
      setSave({ kind: 'saved', at: r.updatedAt })
      onChanged()
    } catch (e) {
      setSave({ kind: 'error', message: (e as Error).message })
    }
  }, [url, onChanged])

  // Pending changes are saved when leaving the diagram or closing the tab
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      const c = current.current
      if (c.source !== lastSaved.current.source || c.name !== lastSaved.current.name) {
        flush()
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('beforeunload', warn)
      flush()
    }
  }, [flush])

  // Render after a short pause; a broken source keeps the last good drawing
  useEffect(() => {
    if (!diagram || diagram.mode === 'canvas') return
    setRender((r) => ({ ...r, busy: true }))
    const t = setTimeout(async () => {
      const r = await renderMermaid(source)
      setRender((prev) => (r.ok ? { svg: r.svg, busy: false } : { svg: prev.svg, error: r.error, busy: false }))
    }, RENDER_MS)
    return () => clearTimeout(t)
  }, [source, diagram])

  const edit = (patch: { source?: string; name?: string }) => {
    if (patch.source !== undefined) setSource(patch.source)
    if (patch.name !== undefined) setName(patch.name)
    current.current = { source: patch.source ?? current.current.source, name: patch.name ?? current.current.name }
    const dirty = current.current.source !== lastSaved.current.source || current.current.name !== lastSaved.current.name
    setSave(dirty ? { kind: 'dirty' } : { kind: 'saved' })
    clearTimeout(timer.current)
    if (dirty) timer.current = setTimeout(flush, AUTOSAVE_MS)
  }

  const remove = async () => {
    if (!diagram || !confirm(`Excluir o diagrama "${diagram.name}"? Não dá para desfazer.`)) return
    clearTimeout(timer.current)
    current.current = lastSaved.current
    try {
      await api.del(url)
      onDeleted()
    } catch (e) {
      onError((e as Error).message)
    }
  }

  const exportAs = async (format: 'svg' | 'png' | 'mmd' | 'json') => {
    if (!render.svg && format !== 'mmd' && format !== 'json') return onError('Este diagrama ainda não tem uma imagem válida para exportar.')
    const base = slugFile(name || 'diagrama')
    setBusyExport(true)
    try {
      if (format === 'svg') download(`${base}.svg`, svgBlob(render.svg!))
      if (format === 'png') download(`${base}.png`, await svgToPng(render.svg!))
      if (format === 'mmd') download(`${base}.mmd`, sourceBlob(source))
      if (format === 'json') download(`${base}.storeflow.json`, agenticToolkitBlob({ name, kind: diagram!.kind, source }))
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusyExport(false)
    }
  }

  const importHere = async (file: File) => {
    try {
      const f = await readDiagramFile(file)
      if (source.trim() && !confirm(`Substituir o código atual por "${file.name}"? O que está aqui hoje será perdido.`)) return
      edit({ source: f.source, name: f.name && f.name !== name ? f.name : undefined })
    } catch (e) {
      onError((e as Error).message)
    }
  }

  if (!diagram) return <span className="sf-spinner" style={{ margin: 16 }} />

  const convertToCanvas = async () => {
    const g = mermaidToGraph(current.current.source, diagram.kind)
    if (!g) return onError('Este código usa elementos que o editor visual ainda não desenha. Ele continua editável em código.')
    if (!confirm('Converter para o editor visual? Depois disso o desenho é editado no canvas, e o código Mermaid vira uma exportação.')) return
    try {
      await api.put(url, { mode: 'canvas', source: JSON.stringify(g) })
      const d = await api.get<Diagram>(url)
      setDiagram(d)
      setSource(d.source)
      setSave({ kind: 'saved', at: d.updatedAt })
      current.current = { source: d.source, name: d.name }
      lastSaved.current = { source: d.source, name: d.name }
      onChanged()
    } catch (e) {
      onError((e as Error).message)
    }
  }

  if (diagram.mode === 'canvas') {
    const graph = parseGraphSource(diagram.source)
    return (
      <div className="sf-board-editor">
        <div className="sf-board-bar">
          <input className="sf-board-name" value={name} maxLength={120} onChange={(e) => edit({ name: e.target.value })} onBlur={() => name.trim() || edit({ name: diagram.name })} title="Renomear" />
          <span className="sf-badge orange">Visual</span>
          <span className={`sf-board-status ${save.kind === 'error' ? 'error' : save.kind === 'dirty' || save.kind === 'saving' ? 'dirty' : ''}`}>
            {save.kind === 'saving' && 'Salvando…'}
            {save.kind === 'dirty' && 'Alterações não salvas'}
            {save.kind === 'saved' && (save.at ? `Salvo às ${new Date(save.at).toLocaleTimeString('pt-BR', { timeStyle: 'short' })}` : 'Salvo')}
            {save.kind === 'error' && `Falha ao salvar: ${save.message}`}
          </span>
          <span style={{ flex: 1 }} />
          <button className="sf-btn small danger" onClick={remove}>
            Excluir
          </button>
        </div>
        <div style={{ padding: '6px 12px' }}>
          <UsedBy workspaceId={workspaceId} kind="diagram" refId={diagramId} />
        </div>
        {graph ? (
          <CanvasEditor
            key={diagram.id}
            name={name}
            family={graph.family}
            initial={graph}
            onChange={(g) => {
              const s = JSON.stringify(g)
              if (s !== current.current.source) edit({ source: s })
            }}
          />
        ) : (
          <div className="sf-callout red" style={{ margin: 12 }}>
            Não consegui abrir este desenho. Ele pode estar corrompido; exclua e crie de novo.
          </div>
        )}
      </div>
    )
  }

  const status =
    save.kind === 'saving' ? 'Salvando…' : save.kind === 'dirty' ? 'Alterações não salvas' : save.kind === 'saved' ? (save.at ? `Salvo às ${new Date(save.at).toLocaleTimeString('pt-BR', { timeStyle: 'short' })}` : 'Salvo') : `Falha ao salvar: ${save.message}`

  return (
    <div className="sf-board-editor">
      <div className="sf-board-bar">
        <input className="sf-board-name" value={name} maxLength={120} onChange={(e) => edit({ name: e.target.value })} onBlur={() => name.trim() || edit({ name: diagram.name })} title="Renomear" />
        <span className="sf-badge">{KIND_LABEL[diagram.kind]}</span>
        <span className={`sf-board-status ${save.kind === 'error' ? 'error' : save.kind === 'dirty' || save.kind === 'saving' ? 'dirty' : ''}`}>{status}</span>
        <span style={{ flex: 1 }} />
        {(diagram.kind === 'c4' || diagram.kind === 'flow') && mermaidToGraph(source, diagram.kind) && (
          <button className="sf-btn small accent" onClick={convertToCanvas} title="Passa o diagrama para o editor visual">
            ✎ Converter para visual
          </button>
        )}
        <input ref={fileInput} type="file" accept=".json,.mmd,.mermaid,.txt,.md" hidden onChange={(e) => e.target.files?.[0] && importHere(e.target.files[0])} />
        <button className="sf-btn small" onClick={() => fileInput.current?.click()}>
          ⤒ Importar
        </button>
        <span className="sf-faint" style={{ fontSize: 12 }}>Exportar:</span>
        {(['svg', 'png', 'mmd', 'json'] as const).map((f) => (
          <button key={f} className="sf-btn small" disabled={busyExport} onClick={() => exportAs(f)} title={{ svg: 'Imagem vetorial', png: 'Imagem para colar em documentos', mmd: 'Código Mermaid', json: 'Formato do Agentic Toolkit (importa com nome e tipo)' }[f]}>
            {f.toUpperCase()}
          </button>
        ))}
        <button className="sf-btn small danger" onClick={remove}>
          Excluir
        </button>
      </div>

      <div className="sf-diagram-split">
        <div className="sf-diagram-code">
          <TextEditor language="text" value={source} onChange={(v) => edit({ source: v })} />
        </div>
        <div className="sf-diagram-preview">
          <div className="sf-diagram-zoom">
            <button className="sf-btn small" onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.1).toFixed(2)))}>
              −
            </button>
            <span className="sf-mono" style={{ minWidth: 48, textAlign: 'center' }}>
              {Math.round(zoom * 100)}%
            </span>
            <button className="sf-btn small" onClick={() => setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)))}>
              +
            </button>
            <button className="sf-btn small" onClick={() => setZoom(1)}>
              100%
            </button>
            {render.busy && <span className="sf-spinner" style={{ marginLeft: 8 }} />}
          </div>
          {render.error && (
            <div className="sf-diagram-error">
              <strong>Erro de sintaxe</strong>
              <pre>{render.error}</pre>
              {render.svg && <span className="sf-faint">Mostrando a última versão válida.</span>}
            </div>
          )}
          <div className="sf-diagram-canvas">
            {render.svg ? (
              <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }} dangerouslySetInnerHTML={{ __html: render.svg }} />
            ) : (
              !render.busy && !render.error && <div className="sf-faint">Escreva o diagrama à esquerda.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
