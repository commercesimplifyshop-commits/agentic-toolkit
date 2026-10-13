/**
 * Canvas model shared with the API (see apps/api/src/diagrams/graph.ts). The
 * editor (React Flow) draws it; Mermaid is generated from it for export.
 */
export type GraphFamily = 'c4' | 'flow'

export const NODE_TYPES: Record<GraphFamily, string[]> = {
  c4: ['person', 'system', 'external', 'container', 'db', 'queue', 'boundary'],
  flow: ['start', 'process', 'decision', 'end', 'database', 'external'],
}

export const TYPE_LABEL: Record<string, string> = {
  person: 'Pessoa',
  system: 'Sistema',
  external: 'Sistema externo',
  container: 'Contêiner',
  db: 'Banco de dados',
  queue: 'Fila',
  boundary: 'Fronteira',
  start: 'Início',
  process: 'Processo',
  decision: 'Decisão',
  end: 'Fim',
  database: 'Banco de dados',
}

export interface GNode {
  id: string
  type: string
  title: string
  tech?: string
  description?: string
  parent?: string
  x?: number
  y?: number
}

export interface GEdge {
  id: string
  source: string
  target: string
  label?: string
  tech?: string
  dashed?: boolean
}

export interface Graph {
  version: 1
  family: GraphFamily
  nodes: GNode[]
  edges: GEdge[]
}

export const emptyGraph = (family: GraphFamily): Graph => ({ version: 1, family, nodes: [], edges: [] })

export function parseGraphSource(source: string): Graph | null {
  try {
    const g = JSON.parse(source) as Graph
    return g && Array.isArray(g.nodes) && Array.isArray(g.edges) ? g : null
  } catch {
    return null
  }
}

// ---- layout ---------------------------------------------------------------------------------

export const EL_W = 200
export const EL_H = 120
const CELL_W = 240
const CELL_H = 150

/** Positions for nodes saved without x/y (relative to their boundary when they have one). */
export function autoLayout(g: Graph): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>()
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const missing = (n: GNode) => n.x === undefined || n.y === undefined

  if (g.family === 'flow') {
    // Left to right by depth from the entry nodes; the rest of each column stacks down
    const depth = new Map<string, number>()
    const incoming = new Map<string, number>()
    for (const e of g.edges) incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1)
    const roots = g.nodes.filter((n) => !incoming.get(n.id))
    const visit = (id: string, d: number, stack: Set<string>) => {
      if (stack.has(id) || (depth.get(id) ?? -1) >= d) return
      depth.set(id, d)
      stack.add(id)
      for (const e of g.edges) if (e.source === id) visit(e.target, d + 1, stack)
      stack.delete(id)
    }
    for (const r of roots.length ? roots : g.nodes.slice(0, 1)) visit(r.id, 0, new Set())
    let extra = 0
    for (const n of g.nodes) if (!depth.has(n.id)) depth.set(n.id, extra++ === 0 ? 0 : (depth.get(n.id) ?? 0))
    const perColumn = new Map<number, number>()
    for (const n of g.nodes) {
      if (!missing(n)) continue
      const col = depth.get(n.id) ?? 0
      const row = perColumn.get(col) ?? 0
      perColumn.set(col, row + 1)
      out.set(n.id, { x: col * 280, y: row * 150 })
    }
    return out
  }

  // C4: children sit in a grid inside their boundary; top-level items flow in rows
  const children = new Map<string, GNode[]>()
  for (const n of g.nodes) if (n.parent && byId.get(n.parent)?.type === 'boundary') children.set(n.parent, [...(children.get(n.parent) ?? []), n])
  for (const kids of children.values()) {
    const cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(kids.length))))
    kids.forEach((k, i) => {
      if (!missing(k)) return
      out.set(k.id, { x: 32 + (i % cols) * CELL_W, y: 64 + Math.floor(i / cols) * CELL_H })
    })
  }
  let x = 0
  let y = 0
  let rowH = 0
  for (const n of g.nodes) {
    if (n.parent && byId.get(n.parent)?.type === 'boundary') continue
    if (!missing(n)) continue
    const size = n.type === 'boundary' ? boundarySize(children.get(n.id) ?? []) : { w: EL_W, h: EL_H }
    if (x > 0 && x + size.w > 1500) {
      x = 0
      y += rowH + 60
      rowH = 0
    }
    out.set(n.id, { x, y })
    x += size.w + 60
    rowH = Math.max(rowH, size.h)
  }
  return out
}

function boundarySize(kids: GNode[]) {
  const cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(kids.length || 1))))
  const rows = Math.max(1, Math.ceil((kids.length || 1) / cols))
  return { w: Math.max(420, 32 + cols * CELL_W), h: Math.max(260, 64 + rows * CELL_H + 24) }
}

/** Current size of a boundary, from where its children really are. */
export function boundaryBox(children: { x: number; y: number }[]) {
  if (!children.length) return { w: 420, h: 260 }
  const w = Math.max(...children.map((c) => c.x)) + EL_W + 32
  const h = Math.max(...children.map((c) => c.y)) + EL_H + 32
  return { w: Math.max(420, w), h: Math.max(260, h) }
}

// ---- Mermaid export -------------------------------------------------------------------------

const q = (s: string) => `"${s.replace(/"/g, "'").replace(/\n/g, ' ')}"`

/** Mermaid for the canvas model, so a diagram can still be exported as code. */
export function toMermaid(g: Graph): string {
  if (g.family === 'flow') {
    const lines = ['flowchart LR']
    for (const n of g.nodes) {
      const t = n.title.replace(/[\[\]{}()|"]/g, ' ')
      const shape =
        n.type === 'start' || n.type === 'end' ? `([${t}])` : n.type === 'decision' ? `{${t}}` : n.type === 'database' ? `[(${t})]` : n.type === 'external' ? `[/${t}/]` : `[${t}]`
      lines.push(`  ${n.id}${shape}`)
    }
    for (const e of g.edges) {
      const arrow = e.dashed ? '-.->' : '-->'
      lines.push(`  ${e.source} ${arrow}${e.label ? `|${e.label.replace(/[|]/g, ' ')}|` : ''} ${e.target}`)
    }
    return lines.join('\n') + '\n'
  }
  const hasContainers = g.nodes.some((n) => ['container', 'db', 'queue', 'boundary'].includes(n.type))
  const lines = [hasContainers ? 'C4Container' : 'C4Context']
  const write = (n: GNode, indent: string) => {
    const t = q(n.title)
    const desc = n.description ? `, ${q(n.description)}` : ''
    switch (n.type) {
      case 'person':
        return `${indent}Person(${n.id}, ${t}${desc})`
      case 'system':
        return `${indent}System(${n.id}, ${t}${desc})`
      case 'external':
        return `${indent}System_Ext(${n.id}, ${t}${desc})`
      case 'db':
        return `${indent}ContainerDb(${n.id}, ${t}, ${q(n.tech ?? '')}${desc})`
      case 'queue':
        return `${indent}ContainerQueue(${n.id}, ${t}, ${q(n.tech ?? '')}${desc})`
      default:
        return `${indent}Container(${n.id}, ${t}, ${q(n.tech ?? '')}${desc})`
    }
  }
  for (const b of g.nodes.filter((n) => n.type === 'boundary')) {
    lines.push(`  System_Boundary(${b.id}, ${q(b.title)}) {`)
    for (const k of g.nodes.filter((n) => n.parent === b.id)) lines.push(write(k, '    '))
    lines.push('  }')
  }
  for (const n of g.nodes.filter((n) => n.type !== 'boundary' && !n.parent)) lines.push(write(n, '  '))
  for (const e of g.edges) {
    const label = q(e.label ?? '')
    lines.push(`  Rel(${e.source}, ${e.target}, ${label}${e.tech ? `, ${q(e.tech)}` : ''})`)
  }
  return lines.join('\n') + '\n'
}

// ---- Mermaid import (the subset this editor draws) ------------------------------------------

const C4_CALLS: Record<string, { type: string; boundary?: boolean; tech?: boolean }> = {
  Person: { type: 'person' },
  Person_Ext: { type: 'external' },
  System: { type: 'system' },
  System_Ext: { type: 'external' },
  Container: { type: 'container', tech: true },
  Container_Ext: { type: 'external', tech: true },
  Component: { type: 'container', tech: true },
  ContainerDb: { type: 'db', tech: true },
  ContainerQueue: { type: 'queue', tech: true },
  System_Boundary: { type: 'boundary', boundary: true },
  Container_Boundary: { type: 'boundary', boundary: true },
  Enterprise_Boundary: { type: 'boundary', boundary: true },
}

/** Splits "a, \"b, c\", d" into ["a", "\"b, c\"", "d"] without breaking quoted text. */
function splitArgs(s: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (const ch of s) {
    if (ch === '"') quoted = !quoted
    if (ch === ',' && !quoted) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out.map((a) => a.replace(/^"(.*)"$/, '$1'))
}

export function parseC4(source: string): Graph {
  const g = emptyGraph('c4')
  const stack: string[] = []
  for (const raw of source.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('%%') || /^(C4Context|C4Container|C4Component|C4Dynamic|title\b|UpdateLayoutConfig|UpdateElementStyle|UpdateRelStyle)/.test(line)) continue
    if (line === '}') {
      stack.pop()
      continue
    }
    const rel = line.match(/^(Rel|BiRel|Rel_[A-Za-z]+)\((.*)\)$/)
    if (rel) {
      const [from, to, label, tech] = splitArgs(rel[2])
      g.edges.push({ id: `e${g.edges.length + 1}`, source: from, target: to, label: label || undefined, tech: tech || undefined })
      continue
    }
    const call = line.match(/^(\w+)\((.*?)\)\s*(\{)?$/)
    if (!call || !C4_CALLS[call[1]]) throw new Error(`Elemento "${call?.[1] ?? line}" não tem equivalente no canvas`)
    const spec = C4_CALLS[call[1]]
    const args = splitArgs(call[2])
    const id = args[0]
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Identificador "${id}" não é suportado no canvas`)
    const parent = stack[stack.length - 1]
    if (spec.boundary) {
      g.nodes.push({ id, type: 'boundary', title: args[1] ?? id })
      if (call[3]) stack.push(id)
      continue
    }
    const title = args[1] ?? id
    const node: GNode = spec.tech
      ? { id, type: spec.type, title, tech: args[2] || undefined, description: args[3] || undefined, parent }
      : { id, type: spec.type, title, description: args[2] || undefined, parent }
    if (!parent) delete node.parent
    g.nodes.push(node)
  }
  return g
}

export function parseFlow(source: string): Graph {
  const g = emptyGraph('flow')
  const lines = source
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^(flowchart|graph)\b/i.test(l) && !l.startsWith('%%') && !/^(style|classDef|class|linkStyle|click)\b/.test(l))
  const byId = new Map<string, GNode>()
  const NODE = /^([A-Za-z0-9_]+)\s*(?:\(\[(.*?)\]\)|\[\((.*?)\)\]|\{\{(.*?)\}\}|\[\/(.*?)\/\]|\[(.*?)\]|\((.*?)\)|\{(.*?)\})?/
  const ARROW = /^\s*(-\.\s*(.*?)\s*\.->|--\s*(.*?)\s*-->|==>|-->|-\.->|---)\s*(?:\|([^|]*)\|)?\s*/

  const take = (rest: string): { id: string; rest: string } => {
    const m = rest.match(NODE)
    if (!m) throw new Error(`Não entendi este trecho: "${rest}"`)
    const [whole, id, stadium, dbShape, hex, ext, box, round, diamond] = m
    const label = stadium ?? dbShape ?? hex ?? ext ?? box ?? round ?? diamond
    let type = 'process'
    if (stadium !== undefined) type = /fim|end|final|conclu/i.test(label ?? '') ? 'end' : 'start'
    else if (dbShape !== undefined) type = 'database'
    else if (ext !== undefined) type = 'external'
    else if (diamond !== undefined) type = 'decision'
    const existing = byId.get(id)
    if (existing) {
      if (label) existing.title = label
    } else {
      const node: GNode = { id, type, title: label ?? id }
      byId.set(id, node)
      g.nodes.push(node)
    }
    return { id, rest: rest.slice(whole.length) }
  }

  for (const line of lines) {
    let rest = line
    let prev = take(rest)
    rest = prev.rest
    while (rest.trim()) {
      const a = rest.match(ARROW)
      if (!a) throw new Error(`Não entendi a conexão em "${rest.trim()}"`)
      const label = a[2] ?? a[3] ?? a[4]
      const dashed = a[1].includes('.')
      rest = rest.slice(a[0].length)
      const next = take(rest)
      rest = next.rest
      g.edges.push({ id: `e${g.edges.length + 1}`, source: prev.id, target: next.id, label: label?.trim() || undefined, dashed: dashed || undefined })
      prev = next
    }
  }
  return g
}

/** Converts Mermaid code to a canvas graph, or returns null when the syntax is out of the editor's subset. */
export function mermaidToGraph(source: string, kind: string): Graph | null {
  try {
    const first = source.trim().split('\n')[0]?.trim() ?? ''
    if (/^C4(Context|Container|Component)/.test(first)) return parseC4(source)
    if (/^(flowchart|graph)\b/i.test(first) && kind !== 'uml') return parseFlow(source)
    return null
  } catch {
    return null
  }
}
