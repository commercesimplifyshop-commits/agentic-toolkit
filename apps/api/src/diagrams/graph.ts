import { BadRequestException } from '@nestjs/common'

/**
 * Canvas diagrams are stored as a JSON graph. The web editor (React Flow) draws
 * it; this validator makes sure what is saved, or what Claude returns, is well formed.
 */
export const GRAPH_FAMILIES = ['c4', 'flow'] as const
export type GraphFamily = (typeof GRAPH_FAMILIES)[number]

export const NODE_TYPES: Record<GraphFamily, readonly string[]> = {
  c4: ['person', 'system', 'external', 'container', 'db', 'queue', 'boundary'],
  flow: ['start', 'process', 'decision', 'end', 'database', 'external'],
}

const MAX_NODES = 300
const MAX_EDGES = 600
const ID = /^[A-Za-z0-9_-]{1,40}$/

export interface GraphNode {
  id: string
  type: string
  title: string
  tech?: string
  description?: string
  parent?: string
  x?: number
  y?: number
}

export interface GraphEdge {
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
  nodes: GraphNode[]
  edges: GraphEdge[]
}

const str = (v: unknown, max: number, field: string): string | undefined => {
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v !== 'string' || v.length > max) throw new BadRequestException(`Campo "${field}" inválido (até ${max} caracteres)`)
  return v.trim()
}

const num = (v: unknown, field: string): number | undefined => {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 100_000) throw new BadRequestException(`Posição "${field}" inválida`)
  return Math.round(v)
}

/** Parses and normalizes a graph; anything unexpected is rejected, nothing is trusted. */
export function parseGraph(raw: unknown): Graph {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      throw new BadRequestException('O desenho não é um JSON válido')
    }
  }
  const g = value as Partial<Graph>
  if (!g || typeof g !== 'object') throw new BadRequestException('Desenho inválido')
  if (!GRAPH_FAMILIES.includes(g.family as GraphFamily)) throw new BadRequestException('Família do desenho inválida (c4 ou flow)')
  const family = g.family as GraphFamily
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) throw new BadRequestException('O desenho precisa de listas "nodes" e "edges"')
  if (g.nodes.length > MAX_NODES || g.edges.length > MAX_EDGES) throw new BadRequestException(`Desenho grande demais (máx. ${MAX_NODES} elementos e ${MAX_EDGES} conexões)`)

  const nodes: GraphNode[] = []
  const ids = new Set<string>()
  for (const n of g.nodes as Partial<GraphNode>[]) {
    if (typeof n?.id !== 'string' || !ID.test(n.id)) throw new BadRequestException(`Identificador de elemento inválido: ${String(n?.id)}`)
    if (ids.has(n.id)) throw new BadRequestException(`Elemento repetido: ${n.id}`)
    ids.add(n.id)
    if (!NODE_TYPES[family].includes(String(n.type))) throw new BadRequestException(`Tipo "${String(n.type)}" não existe no modelo ${family}`)
    const title = str(n.title, 120, 'title')
    if (!title) throw new BadRequestException(`O elemento ${n.id} precisa de um título`)
    nodes.push({
      id: n.id,
      type: String(n.type),
      title,
      tech: str(n.tech, 120, 'tech'),
      description: str(n.description, 400, 'description'),
      parent: str(n.parent, 40, 'parent'),
      x: num(n.x, 'x'),
      y: num(n.y, 'y'),
    })
  }
  for (const n of nodes) if (n.parent && !nodes.some((p) => p.id === n.parent && p.type === 'boundary')) n.parent = undefined

  const edges: GraphEdge[] = []
  const edgeIds = new Set<string>()
  for (const e of g.edges as Partial<GraphEdge>[]) {
    if (typeof e?.id !== 'string' || !ID.test(e.id) || edgeIds.has(e.id)) throw new BadRequestException('Identificador de conexão inválido ou repetido')
    edgeIds.add(e.id)
    if (!ids.has(String(e.source)) || !ids.has(String(e.target))) throw new BadRequestException(`A conexão ${e.id} aponta para um elemento que não existe`)
    edges.push({
      id: e.id,
      source: String(e.source),
      target: String(e.target),
      label: str(e.label, 120, 'label'),
      tech: str(e.tech, 120, 'tech'),
      dashed: e.dashed === true,
    })
  }
  return { version: 1, family, nodes, edges }
}
