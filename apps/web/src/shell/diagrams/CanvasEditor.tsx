import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { toPng, toSvg } from 'html-to-image'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { download, slugFile, sourceBlob, svgBlob } from './exchange'
import { autoLayout, boundaryBox, EL_H, EL_W, NODE_TYPES, toMermaid, TYPE_LABEL, type GraphFamily as GFamily, type GNode, type Graph } from './graph'

type ElementData = Omit<GNode, 'id' | 'parent' | 'x' | 'y'>
type RFNode = Node<ElementData & { parentless?: boolean }>
type RFEdge = Edge<{ label?: string; tech?: string; dashed?: boolean }>

const PALETTE: Record<GFamily, { type: string; hint: string }[]> = {
  c4: [
    { type: 'person', hint: 'Usuário ou ator' },
    { type: 'system', hint: 'Sistema do escopo' },
    { type: 'external', hint: 'Sistema de terceiros' },
    { type: 'container', hint: 'Aplicação ou serviço' },
    { type: 'db', hint: 'Banco de dados' },
    { type: 'queue', hint: 'Fila ou barramento' },
    { type: 'boundary', hint: 'Agrupa elementos do mesmo sistema' },
  ],
  flow: [
    { type: 'start', hint: 'Entrada do processo' },
    { type: 'process', hint: 'Passo' },
    { type: 'decision', hint: 'Pergunta com saídas' },
    { type: 'end', hint: 'Saída do processo' },
    { type: 'database', hint: 'Persistência' },
    { type: 'external', hint: 'Sistema externo' },
  ],
}

const MAX_HISTORY = 60

// ---- node components -------------------------------------------------------------------------

function ElementNode({ data, selected }: NodeProps<RFNode>) {
  return (
    <div className={`sf-el sf-el-${data.type} ${selected ? 'on' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="sf-el-type">{TYPE_LABEL[data.type] ?? data.type}</div>
      <div className="sf-el-title">{data.title}</div>
      {data.tech && <div className="sf-el-tech">[{data.tech}]</div>}
      {data.description && <div className="sf-el-desc">{data.description}</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function BoundaryNode({ data, selected }: NodeProps<RFNode>) {
  return (
    <div className={`sf-el-boundary ${selected ? 'on' : ''}`}>
      <div className="sf-el-boundary-title">
        {data.title}
        <span>{TYPE_LABEL.boundary}</span>
      </div>
    </div>
  )
}

const nodeTypes = { element: ElementNode, boundary: BoundaryNode }

// ---- conversions -----------------------------------------------------------------------------

const edgeLabel = (d: { label?: string; tech?: string }) => [d.label, d.tech ? `[${d.tech}]` : ''].filter(Boolean).join(' ')

export function graphToFlow(g: Graph): { nodes: RFNode[]; edges: RFEdge[] } {
  const layout = autoLayout(g)
  const pos = (n: GNode) => (n.x !== undefined && n.y !== undefined ? { x: n.x, y: n.y } : (layout.get(n.id) ?? { x: 0, y: 0 }))
  const kids = (id: string) => g.nodes.filter((n) => n.parent === id).map(pos)
  // Parents must come before their children for React Flow
  const ordered = [...g.nodes].sort((a, b) => Number(b.type === 'boundary') - Number(a.type === 'boundary'))
  const nodes: RFNode[] = ordered.map((n) => {
    const isBoundary = n.type === 'boundary'
    const parentOk = n.parent && g.nodes.some((p) => p.id === n.parent && p.type === 'boundary')
    const box = isBoundary ? boundaryBox(kids(n.id)) : undefined
    return {
      id: n.id,
      type: isBoundary ? 'boundary' : 'element',
      position: pos(n),
      parentId: parentOk ? n.parent : undefined,
      data: { type: n.type, title: n.title, tech: n.tech, description: n.description },
      style: box ? { width: box.w, height: box.h } : { width: EL_W },
      zIndex: isBoundary ? 0 : 2,
    }
  })
  const edges: RFEdge[] = g.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: edgeLabel({ label: e.label, tech: e.tech }),
    data: { label: e.label, tech: e.tech, dashed: e.dashed },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#a1a1aa' },
    style: { stroke: '#a1a1aa', strokeWidth: 1.6, strokeDasharray: e.dashed ? '6 4' : undefined },
    labelStyle: { fill: '#e4e4e7', fontSize: 12 },
    labelBgStyle: { fill: '#0a0a0b', fillOpacity: 0.85 },
    labelBgPadding: [6, 3],
    // Connections sit under the boundaries; boundary bodies let the mouse through (see shell.css)
    zIndex: -1,
  }))
  return { nodes, edges }
}

export function flowToGraph(family: GFamily, nodes: RFNode[], edges: RFEdge[]): Graph {
  return {
    version: 1,
    family,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.type,
      title: n.data.title,
      tech: n.data.tech || undefined,
      description: n.data.description || undefined,
      parent: n.parentId || undefined,
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.data?.label || undefined,
      tech: e.data?.tech || undefined,
      dashed: e.data?.dashed || undefined,
    })),
  }
}

/** Absolute top-left of a node (children are stored relative to their boundary). */
function absolute(node: RFNode, all: RFNode[]) {
  if (!node.parentId) return node.position
  const parent = all.find((n) => n.id === node.parentId)
  return parent ? { x: parent.position.x + node.position.x, y: parent.position.y + node.position.y } : node.position
}

function boundaryAt(point: { x: number; y: number }, all: RFNode[], exceptId?: string) {
  return all.find((b) => {
    if (b.type !== 'boundary' || b.id === exceptId) return false
    const w = Number((b.style as { width?: number })?.width ?? 420)
    const h = Number((b.style as { height?: number })?.height ?? 260)
    return point.x >= b.position.x && point.x <= b.position.x + w && point.y >= b.position.y && point.y <= b.position.y + h
  })
}

// ---- editor ----------------------------------------------------------------------------------

export interface CanvasEditorProps {
  name: string
  family: GFamily
  initial: Graph
  onChange: (g: Graph) => void
  onStatus?: (m: string) => void
}

export function CanvasEditor(props: CanvasEditorProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}

function Canvas({ name, family, initial, onChange, onStatus }: CanvasEditorProps) {
  const init = useMemo(() => graphToFlow(initial), [initial])
  const [nodes, setNodes] = useState<RFNode[]>(init.nodes)
  const [edges, setEdges] = useState<RFEdge[]>(init.edges)
  const [selected, setSelected] = useState<{ kind: 'node' | 'edge'; id: string } | null>(null)
  const [mermaidOpen, setMermaidOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const history = useRef<{ nodes: RFNode[]; edges: RFEdge[] }[]>([])
  const wrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition, fitView, getNodes } = useReactFlow<RFNode, RFEdge>()

  // Every change is reported upward; the parent saves it (debounced)
  useEffect(() => {
    onChange(flowToGraph(family, nodes, edges))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges])

  const snapshot = useCallback(() => {
    history.current = [...history.current.slice(-(MAX_HISTORY - 1)), { nodes, edges }]
  }, [nodes, edges])

  const undo = useCallback(() => {
    const prev = history.current.pop()
    if (!prev) return onStatus?.('Nada para desfazer')
    setNodes(prev.nodes)
    setEdges(prev.edges)
    setSelected(null)
  }, [onStatus])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [undo])

  // Deleting a boundary keeps its children on the canvas, at their absolute place
  const onNodesChange = useCallback(
    (changes: NodeChange<RFNode>[]) => {
      const removed = changes.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id)
      setNodes((prev) => {
        const next = applyNodeChanges(changes, prev) as RFNode[]
        if (!removed.length) return next
        return next.map((n) => {
          if (!n.parentId || !removed.includes(n.parentId)) return n
          const before = prev.find((p) => p.id === n.parentId)
          const abs = before ? { x: before.position.x + n.position.x, y: before.position.y + n.position.y } : n.position
          return { ...n, parentId: undefined, position: abs }
        })
      })
      if (changes.some((c) => c.type === 'remove')) setSelected(null)
    },
    [],
  )

  const onEdgesChange = useCallback((changes: EdgeChange<RFEdge>[]) => setEdges((prev) => applyEdgeChanges(changes, prev) as RFEdge[]), [])

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return
      snapshot()
      const id = `e-${Math.random().toString(36).slice(2, 8)}`
      setEdges((prev) =>
        addEdge(
          {
            ...c,
            id,
            data: { label: '', tech: '', dashed: false },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#a1a1aa' },
            style: { stroke: '#a1a1aa', strokeWidth: 1.6 },
          },
          prev,
        ) as RFEdge[],
      )
    },
    [snapshot],
  )

  /** Puts a node inside the boundary under it, or takes it out, when it is dropped. */
  const placeAt = useCallback(
    (id: string, abs: { x: number; y: number }) => {
      setNodes((prev) => {
        const self = prev.find((n) => n.id === id)
        if (!self) return prev
        const box = boundaryAt({ x: abs.x + EL_W / 2, y: abs.y + EL_H / 2 }, prev, id)
        const parentId = self.type === 'boundary' ? undefined : box?.id
        const position = parentId && box ? { x: abs.x - box.position.x, y: abs.y - box.position.y } : abs
        return prev.map((n) => (n.id === id ? { ...n, parentId, position, extent: undefined } : n))
      })
    },
    [],
  )

  const onNodeDragStart = useCallback(() => snapshot(), [snapshot])

  const onNodeDragStop = useCallback(
    (_: unknown, node: RFNode) => {
      const all = getNodes()
      placeAt(node.id, absolute(node, all))
    },
    [getNodes, placeAt],
  )

  const addNode = useCallback(
    (type: string, at: { x: number; y: number }) => {
      snapshot()
      const id = `${type}-${Math.random().toString(36).slice(2, 6)}`
      const title = type === 'boundary' ? 'Nova fronteira' : TYPE_LABEL[type] ? `Novo ${TYPE_LABEL[type].toLowerCase()}` : 'Novo elemento'
      setNodes((prev) => {
        const box = type === 'boundary' ? undefined : boundaryAt(at, prev)
        const isBoundary = type === 'boundary'
        const position = box ? { x: at.x - box.position.x, y: at.y - box.position.y } : at
        const created: RFNode = {
          id,
          type: isBoundary ? 'boundary' : 'element',
          position,
          parentId: box?.id,
          data: { type, title },
          style: isBoundary ? { width: 420, height: 260 } : { width: EL_W },
          zIndex: isBoundary ? 0 : 2,
        }
        return [...prev, created]
      })
      setSelected({ kind: 'node', id })
      setEditing(true)
    },
    [snapshot],
  )

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      const raw = e.dataTransfer.getData('application/sf-node')
      if (!raw) return
      const { type } = JSON.parse(raw) as { type: string }
      addNode(type, screenToFlowPosition({ x: e.clientX, y: e.clientY }))
    },
    [addNode, screenToFlowPosition],
  )

  const addAtCenter = (type: string) => {
    const rect = wrapper.current?.getBoundingClientRect()
    const at = rect ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: 0, y: 0 }
    addNode(type, { x: at.x + Math.round(Math.random() * 60), y: at.y + Math.round(Math.random() * 60) })
  }

  // ---- properties ----
  const selectedNode = selected?.kind === 'node' ? nodes.find((n) => n.id === selected.id) : undefined
  const selectedEdge = selected?.kind === 'edge' ? edges.find((e) => e.id === selected.id) : undefined

  const updateNode = (id: string, patch: Partial<ElementData>) => {
    snapshot()
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)))
  }
  /** Moves an element into a boundary (or out of it), keeping it where it visually is. */
  const setParent = (id: string, parentId: string | undefined) => {
    snapshot()
    setNodes((prev) => {
      const self = prev.find((n) => n.id === id)
      if (!self) return prev
      const abs = absolute(self, prev)
      const box = parentId ? prev.find((b) => b.id === parentId) : undefined
      const position = box ? { x: abs.x - box.position.x, y: abs.y - box.position.y } : abs
      return prev.map((n) => (n.id === id ? { ...n, parentId: box?.id, position } : n))
    })
  }
  const updateEdge = (id: string, patch: { label?: string; tech?: string; dashed?: boolean }) => {
    snapshot()
    setEdges((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e
        const data = { ...e.data, ...patch }
        return {
          ...e,
          data,
          label: edgeLabel(data),
          style: { ...e.style, strokeDasharray: data.dashed ? '6 4' : undefined },
        }
      }),
    )
  }
  const deleteSelected = () => {
    if (!selected) return
    snapshot()
    if (selected.kind === 'node') {
      setNodes((prev) => prev.filter((n) => n.id !== selected.id))
      setEdges((prev) => prev.filter((e) => e.source !== selected.id && e.target !== selected.id))
    } else setEdges((prev) => prev.filter((e) => e.id !== selected.id))
    setSelected(null)
  }

  // ---- exports ----
  const exportImage = async (kind: 'png' | 'svg') => {
    const el = wrapper.current?.querySelector('.react-flow') as HTMLElement | null
    if (!el) return
    onStatus?.('Gerando imagem…')
    await fitView({ padding: 0.12, duration: 0 })
    await new Promise((r) => setTimeout(r, 120))
    const filter = (node: HTMLElement) => !(node.classList?.contains('react-flow__controls') || node.classList?.contains('react-flow__minimap') || node.classList?.contains('react-flow__background') || node.classList?.contains('react-flow__panel'))
    // Fonts are skipped: the export uses the system font and avoids cross-origin CSS reads
    const opts = { backgroundColor: '#0a0a0b', pixelRatio: 2, filter, skipFonts: true }
    try {
      if (kind === 'png') download(`${slugFile(name)}.png`, await (await fetch(await toPng(el, opts))).blob())
      else download(`${slugFile(name)}.svg`, svgBlob(await toSvg(el, opts)))
      onStatus?.(`${kind.toUpperCase()} exportado`)
    } catch (err) {
      onStatus?.(`Falha ao exportar: ${(err as Error).message}`)
    }
  }

  const graph = flowToGraph(family, nodes, edges)
  const mermaid = mermaidOpen ? toMermaid(graph) : ''
  const otherBoundaries = nodes.filter((n) => n.type === 'boundary')

  return (
    <div className="sf-canvas">
      <div className="sf-canvas-tools">
        <span className="sf-faint" style={{ fontSize: 12 }}>
          Arraste da paleta · ligue pelas alças (direita → esquerda) · duplo clique edita · Del apaga · Ctrl+Z desfaz
        </span>
        <span style={{ flex: 1 }} />
        <button className="sf-btn small" onClick={() => undo()} title="Desfazer (Ctrl+Z)">
          ↶ Desfazer
        </button>
        <button className="sf-btn small" onClick={() => fitView({ padding: 0.12, duration: 300 })}>
          Ajustar
        </button>
        <button className="sf-btn small" onClick={() => exportImage('png')}>
          PNG
        </button>
        <button className="sf-btn small" onClick={() => exportImage('svg')}>
          SVG
        </button>
        <button className="sf-btn small" onClick={() => setMermaidOpen((v) => !v)}>
          {mermaidOpen ? 'Fechar código' : 'Ver código Mermaid'}
        </button>
      </div>

      <div className="sf-canvas-body">
        <aside className="sf-canvas-palette">
          <div className="sf-apic-section">Paleta</div>
          {PALETTE[family].map((p) => (
            <button
              key={p.type}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/sf-node', JSON.stringify({ type: p.type }))
                e.dataTransfer.effectAllowed = 'move'
              }}
              onClick={() => addAtCenter(p.type)}
              title={`${p.hint}. Arraste para o canvas ou clique para adicionar`}
            >
              <span className={`sf-el-chip sf-el-${p.type}`} />
              <span>
                <strong>{TYPE_LABEL[p.type]}</strong>
                <small>{p.hint}</small>
              </span>
            </button>
          ))}
          <div className="sf-faint" style={{ fontSize: 11.5, marginTop: 12, lineHeight: 1.5 }}>
            Para colocar um elemento dentro de uma fronteira, arraste-o até ela. Para tirar, arraste para fora.
          </div>
        </aside>

        <div className="sf-canvas-stage" ref={wrapper} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          <ReactFlow<RFNode, RFEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            onSelectionChange={({ nodes: ns, edges: es }) => {
              if (ns.length === 1 && es.length === 0) setSelected({ kind: 'node', id: ns[0].id })
              else if (es.length === 1 && ns.length === 0) setSelected({ kind: 'edge', id: es[0].id })
              else setSelected(null)
            }}
            onNodeDoubleClick={(_, n) => {
              setSelected({ kind: 'node', id: n.id })
              setEditing(true)
            }}
            connectionRadius={40}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.2}
            maxZoom={2.5}
            proOptions={{ hideAttribution: true }}
            colorMode="dark"
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="#26262b" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor="#3f3f46" maskColor="rgba(10,10,11,0.6)" />
          </ReactFlow>
        </div>

        <aside className="sf-canvas-props">
          {selectedNode && (
            <div className="sf-props">
              <div className="sf-apic-section">Elemento</div>
              <label className="sf-field">
                <span>Tipo</span>
                <select className="sf-input" value={selectedNode.data.type} disabled={selectedNode.data.type === 'boundary'} onChange={(e) => updateNode(selectedNode.id, { type: e.target.value })}>
                  {NODE_TYPES[family]
                    .filter((t) => t !== 'boundary')
                    .concat(selectedNode.data.type === 'boundary' ? ['boundary'] : [])
                    .map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </option>
                    ))}
                </select>
              </label>
              <label className="sf-field">
                <span>Título</span>
                <input
                  className="sf-input"
                  autoFocus={editing}
                  value={selectedNode.data.title}
                  onFocus={() => setEditing(true)}
                  onBlur={() => setEditing(false)}
                  onChange={(e) => updateNode(selectedNode.id, { title: e.target.value.slice(0, 120) })}
                />
              </label>
              {selectedNode.data.type !== 'boundary' && (
                <>
                  <label className="sf-field">
                    <span>Tecnologia</span>
                    <input className="sf-input" value={selectedNode.data.tech ?? ''} placeholder="ex.: PHP, MySQL, REST" onChange={(e) => updateNode(selectedNode.id, { tech: e.target.value.slice(0, 120) })} />
                  </label>
                  <label className="sf-field">
                    <span>Descrição</span>
                    <textarea className="sf-input" rows={3} value={selectedNode.data.description ?? ''} onChange={(e) => updateNode(selectedNode.id, { description: e.target.value.slice(0, 400) })} />
                  </label>
                  {family === 'c4' && (
                    <label className="sf-field">
                      <span>Dentro de</span>
                      <select className="sf-input" value={selectedNode.parentId ?? ''} onChange={(e) => setParent(selectedNode.id, e.target.value || undefined)}>
                        <option value="">Nenhuma fronteira</option>
                        {otherBoundaries.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.data.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              )}
              <button className="sf-btn small danger" onClick={deleteSelected}>
                Excluir elemento
              </button>
            </div>
          )}

          {selectedEdge && (
            <div className="sf-props">
              <div className="sf-apic-section">Conexão</div>
              <label className="sf-field">
                <span>Rótulo</span>
                <input className="sf-input" value={selectedEdge.data?.label ?? ''} placeholder={family === 'c4' ? 'ex.: Consulta pedidos' : 'ex.: sim'} onChange={(e) => updateEdge(selectedEdge.id, { label: e.target.value.slice(0, 120) })} />
              </label>
              {family === 'c4' && (
                <label className="sf-field">
                  <span>Protocolo</span>
                  <input className="sf-input" value={selectedEdge.data?.tech ?? ''} placeholder="ex.: HTTPS, SQL" onChange={(e) => updateEdge(selectedEdge.id, { tech: e.target.value.slice(0, 120) })} />
                </label>
              )}
              <label className="sf-apic-check" style={{ marginBottom: 12 }}>
                <input type="checkbox" checked={Boolean(selectedEdge.data?.dashed)} onChange={(e) => updateEdge(selectedEdge.id, { dashed: e.target.checked })} /> Linha tracejada
              </label>
              <button className="sf-btn small danger" onClick={deleteSelected}>
                Excluir conexão
              </button>
            </div>
          )}

          {!selectedNode && !selectedEdge && (
            <div className="sf-props">
              <div className="sf-apic-section">Resumo</div>
              <div className="sf-muted" style={{ fontSize: 13 }}>
                {nodes.filter((n) => n.type !== 'boundary').length} elementos · {otherBoundaries.length} {otherBoundaries.length === 1 ? 'fronteira' : 'fronteiras'} · {edges.length} {edges.length === 1 ? 'conexão' : 'conexões'}
              </div>
              <div className="sf-faint" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>
                Selecione um elemento ou uma conexão para editar. Duplo clique abre o título para editar.
              </div>
            </div>
          )}
        </aside>
      </div>

      {mermaidOpen && (
        <div className="sf-canvas-code">
          <div className="sf-row" style={{ marginBottom: 6 }}>
            <span className="sf-faint" style={{ fontSize: 12 }}>
              Código gerado a partir do desenho (somente leitura: o desenho é a fonte da verdade)
            </span>
            <span style={{ flex: 1 }} />
            <button className="sf-btn small" onClick={() => navigator.clipboard?.writeText(mermaid)}>
              Copiar
            </button>
            <button className="sf-btn small" onClick={() => download(`${slugFile(name)}.mmd`, sourceBlob(mermaid))}>
              MMD
            </button>
          </div>
          <pre className="sf-mono">{mermaid}</pre>
        </div>
      )}
    </div>
  )
}
