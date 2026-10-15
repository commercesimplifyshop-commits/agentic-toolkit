import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { autoLayout, type GNode, type Graph } from '../diagrams/graph'

// sizes shared with apps/api/src/diagrams/reference-layout.ts
const BOX_W = 176
const BOX_H = 64
const PERSON_W = 220
const PERSON_H = 84
const PAD_BOTTOM = 24

/** What each colour stands for: the families of the reference architecture */
type Family = 'person' | 'platform' | 'vendor' | 'infra' | 'client' | 'saas'
const FAMILY: Record<Family, { label: string; fill: string; border: string }> = {
  person: { label: 'Personas', fill: '#1f1f23', border: '#d4d4d8' },
  platform: {
    label: 'Plataforma de commerce',
    fill: 'rgba(248, 113, 113, 0.14)',
    border: '#f87171',
  },
  vendor: {
    label: 'Serviços SaaS da plataforma',
    fill: 'rgba(96, 165, 250, 0.15)',
    border: '#60a5fa',
  },
  infra: {
    label: 'Infraestrutura',
    fill: 'rgba(161, 161, 170, 0.12)',
    border: '#71717a',
  },
  client: {
    label: 'Sistemas do cliente',
    fill: 'rgba(251, 191, 36, 0.12)',
    border: '#fbbf24',
  },
  saas: {
    label: 'SaaS e parceiros',
    fill: 'rgba(74, 222, 128, 0.12)',
    border: '#4ade80',
  },
}
const LAYER_FAMILY: Record<string, Family> = {
  b_store: 'platform',
  b_api: 'platform',
  b_core: 'platform',
  b_infra: 'infra',
  b_cliente: 'client',
  b_saas: 'saas',
}

function familyOf(n: GNode, byId: Map<string, GNode>): Family {
  if (n.type === 'person') return 'person'
  if (n.type === 'boundary') return LAYER_FAMILY[n.id] ?? 'platform'
  if (/^SaaS /.test(n.tech ?? '')) return 'vendor'
  const layer = n.parent ? LAYER_FAMILY[n.parent] : undefined
  if (layer && layer !== 'platform') return layer
  if (n.type === 'db' || n.type === 'queue') return 'infra'
  if (n.type === 'external') return byId.get(n.parent ?? '')?.title.match(/SaaS|parceir/i) ? 'saas' : 'client'
  return 'platform'
}

type Data = {
  title: string
  tech?: string
  description?: string
  family: Family
  person?: boolean
}
type RFNode = Node<Data>

const SIDES = [
  ['t', Position.Top],
  ['b', Position.Bottom],
  ['l', Position.Left],
  ['r', Position.Right],
] as const
function Handles() {
  return (
    <>
      {SIDES.map(([k, p]) => (
        <Fragment key={k}>
          <Handle type="source" id={`s${k}`} position={p} className="sf-ref-handle" />
          <Handle type="target" id={`t${k}`} position={p} className="sf-ref-handle" />
        </Fragment>
      ))}
    </>
  )
}

function BoxNode({ data, selected }: NodeProps<RFNode>) {
  const f = FAMILY[data.family]
  return (
    <div className={`sf-ref-box ${data.person ? 'person' : ''} ${selected ? 'on' : ''}`} style={{ background: f.fill, borderColor: f.border }} title={data.description}>
      <Handles />
      <div className="sf-ref-title">{data.title}</div>
      {data.tech && <div className="sf-ref-tech">{data.tech}</div>}
      {data.person && data.description && <div className="sf-ref-tech">{data.description}</div>}
    </div>
  )
}

function LayerNode({ data, selected }: NodeProps<RFNode>) {
  const f = FAMILY[data.family]
  return (
    <div className={`sf-ref-layer ${selected ? 'on' : ''}`} style={{ borderColor: f.border }} title={data.description}>
      <Handles />
      <div className="sf-ref-layer-title">{data.title}</div>
      {data.description && <div className="sf-ref-layer-sub">{data.description}</div>}
    </div>
  )
}

const nodeTypes = { box: BoxNode, layer: LayerNode }

/** The graph as React Flow nodes and edges: layers sized around their boxes, edges leaving by the side that faces the other end */
function toFlow(g: Graph) {
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const fallback = g.nodes.some((n) => n.x === undefined || n.y === undefined) ? autoLayout(g) : new Map<string, { x: number; y: number }>()
  const pos = (n: GNode) => (n.x !== undefined && n.y !== undefined ? { x: n.x, y: n.y } : (fallback.get(n.id) ?? { x: 0, y: 0 }))
  const isLayer = (id?: string) => Boolean(id && byId.get(id)?.type === 'boundary')
  const size = (n: GNode): { w: number; h: number } => {
    if (n.type === 'person') return { w: PERSON_W, h: PERSON_H }
    if (n.type !== 'boundary') return { w: BOX_W, h: BOX_H }
    const kids = g.nodes.filter((k) => k.parent === n.id).map(pos)
    if (!kids.length) return { w: 420, h: 120 }
    // the boxes are centered: as much room on the right as on the left
    const left = Math.min(...kids.map((k) => k.x))
    return {
      w: Math.max(...kids.map((k) => k.x + BOX_W)) + Math.max(left, 24),
      h: Math.max(...kids.map((k) => k.y + BOX_H)) + PAD_BOTTOM,
    }
  }
  const abs = (n: GNode): { x: number; y: number } => {
    const p = pos(n)
    const parent = isLayer(n.parent) ? byId.get(n.parent!) : undefined
    if (!parent) return p
    const q = abs(parent)
    return { x: p.x + q.x, y: p.y + q.y }
  }
  const rect = (n: GNode) => {
    const p = abs(n)
    const s = size(n)
    return { x1: p.x, y1: p.y, x2: p.x + s.w, y2: p.y + s.h }
  }
  const atSide = (n: GNode) => n.id === 'b_cliente' || n.id === 'b_saas' || n.parent === 'b_cliente' || n.parent === 'b_saas'
  const centerLayers = g.nodes.filter((n) => n.type === 'boundary' && !n.parent && !atSide(n)).map((n) => ({ id: n.id, ...rect(n) }))

  const ordered = [...g.nodes].sort((a, b) => Number(b.type === 'boundary') - Number(a.type === 'boundary'))
  const nodes: RFNode[] = ordered.map((n) => {
    const s = size(n)
    return {
      id: n.id,
      type: n.type === 'boundary' ? 'layer' : 'box',
      position: pos(n),
      parentId: isLayer(n.parent) ? n.parent : undefined,
      data: {
        title: n.title,
        tech: n.tech,
        description: n.description,
        family: familyOf(n, byId),
        person: n.type === 'person',
      },
      style: { width: s.w, height: s.h },
      zIndex: n.type === 'boundary' ? 0 : 2,
    }
  })

  // a line that leaves a layer stops at the border of the other layer, not at a box inside it, like the
  // reference drawings; the lines between the same two ends become one. Lines inside a layer stay.
  const centerIds = new Set(centerLayers.map((l) => l.id))
  const toLayer = (n: GNode, other: GNode) => (n.parent && centerIds.has(n.parent) && other.type !== 'person' && other.parent !== n.parent && other.id !== n.parent ? byId.get(n.parent)! : n)
  const merged = new Map<string, { e: Graph['edges'][number]; s: GNode; t: GNode; labels: string[] }>()
  for (const e of g.edges) {
    const s0 = byId.get(e.source)
    const t0 = byId.get(e.target)
    if (!s0 || !t0) continue
    const s = toLayer(s0, t0)
    const t = toLayer(t0, s0)
    const key = `${s.id}>${t.id}`
    const label = [e.label, e.tech ? `[${e.tech}]` : ''].filter(Boolean).join(' ')
    const m = merged.get(key)
    if (m) {
      if (label && !m.labels.includes(label)) m.labels.push(label)
    } else merged.set(key, { e, s, t, labels: label ? [label] : [] })
  }

  const edges: Edge[] = [...merged.values()].map(({ e, s, t, labels }) => {
    const a = rect(s)
    const b = rect(t)
    let sh: string
    let th: string
    let around = false
    if (atSide(s) !== atSide(t) || (a.y2 > b.y1 - 10 && b.y2 > a.y1 - 10)) {
      // to and from the side columns, or side by side: horizontal
      const right = (a.x1 + a.x2) / 2 < (b.x1 + b.x2) / 2
      sh = right ? 'sr' : 'sl'
      th = right ? 'tl' : 'tr'
    } else {
      const down = a.y2 <= b.y1
      // a layer in between: go around it on the left, like the reference drawings do
      const between = centerLayers.some(
        (l) =>
          l.id !== s.id &&
          l.id !== t.id &&
          l.id !== s.parent &&
          l.id !== t.parent &&
          (down ? l.y1 >= a.y2 && l.y2 <= b.y1 : l.y1 >= b.y2 && l.y2 <= a.y1) &&
          l.x1 < Math.max(a.x2, b.x2) &&
          l.x2 > Math.min(a.x1, b.x1),
      )
      around = between
      // around on the side the target box is on: the admin, at the right of its layer, gets the line from the right
      const mid = centerLayers.length ? (Math.min(...centerLayers.map((l) => l.x1)) + Math.max(...centerLayers.map((l) => l.x2))) / 2 : 0
      const side = (b.x1 + b.x2) / 2 > mid ? 'r' : 'l'
      sh = between ? `s${side}` : down ? 'sb' : 'st'
      th = between ? `t${side}` : down ? 'tt' : 'tb'
    }
    // a line that goes around a layer runs next to the side columns: only the protocol, to keep it clear
    const label = around ? (e.tech ?? '') : labels.length > 2 ? `${labels[0]} +${labels.length - 1}` : labels.join(' · ')
    return {
      id: e.id,
      source: s.id,
      target: t.id,
      sourceHandle: sh,
      targetHandle: th,
      type: 'smoothstep',
      pathOptions: { borderRadius: 10, offset: 22 },
      label,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: '#a1a1aa',
        width: 16,
        height: 16,
      },
      style: {
        stroke: '#a1a1aa',
        strokeWidth: 1.4,
        strokeDasharray: e.dashed ? '6 4' : undefined,
      },
      labelStyle: { fill: '#e4e4e7', fontSize: 11 },
      labelBgStyle: { fill: '#0a0a0b', fillOpacity: 0.9 },
      labelBgPadding: [5, 2] as [number, number],
      zIndex: 1,
    }
  })
  const families = [...new Set(nodes.filter((n) => n.type === 'box').map((n) => n.data.family))]
  return { nodes, edges, families }
}

/** The live architecture on a canvas, in the style of a reference architecture; boxes can be moved, nothing else is edited */
export function LiveArchitectureCanvas({
  graph,
  revision,
  onMoved,
  onSelect,
}: {
  graph: Graph
  revision: string
  onMoved?: (positions: Record<string, { x: number; y: number }>) => void
  onSelect: (id: string | null) => void
}) {
  const init = useMemo(() => toFlow(graph), [graph])
  const [nodes, setNodes] = useState<RFNode[]>(init.nodes)
  const { fitView } = useReactFlow()
  useEffect(() => {
    setNodes(init.nodes)
    // a new version of the drawing fits the screen again
    window.setTimeout(() => fitView({ padding: 0.08, duration: 300 }), 60)
  }, [init, revision, fitView])
  const onNodesChange = useCallback(
    (changes: NodeChange<RFNode>[]) =>
      setNodes((ns) =>
        applyNodeChanges(
          changes.filter((c) => c.type === 'position' || c.type === 'select' || c.type === 'dimensions'),
          ns,
        ),
      ),
    [],
  )
  return (
    <ReactFlow
      className="sf-ref"
      nodes={nodes}
      edges={init.edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStop={(_e, node) => onMoved?.({ [node.id]: { x: node.position.x, y: node.position.y } })}
      onNodeClick={(_e, node) => onSelect(node.id)}
      onPaneClick={() => onSelect(null)}
      nodesDraggable={Boolean(onMoved)}
      nodesConnectable={false}
      edgesFocusable={false}
      deleteKeyCode={null}
      fitView
      fitViewOptions={{ padding: 0.08 }}
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#2a2a2e" />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable maskColor="rgba(0,0,0,0.55)" nodeColor={(n) => FAMILY[(n.data as Data).family]?.border ?? '#3f3f46'} />
      <Panel position="top-left" className="sf-ref-legend">
        <strong>Legenda</strong>
        {init.families.map((f) => (
          <span key={f}>
            <i
              style={{
                background: FAMILY[f].fill,
                borderColor: FAMILY[f].border,
              }}
            />
            {FAMILY[f].label}
          </span>
        ))}
      </Panel>
    </ReactFlow>
  )
}
