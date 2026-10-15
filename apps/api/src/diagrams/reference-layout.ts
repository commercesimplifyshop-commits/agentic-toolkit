import type { Graph, GraphNode } from './graph'

// sizes shared with the live view's renderer (apps/web/src/shell/pages/LiveArchitectureCanvas.tsx)
export const BOX_W = 176
export const BOX_H = 64
export const PERSON_W = 220
export const PERSON_H = 84
const GAP = 18
const PAD_X = 28
const PAD_TOP = 56
const PAD_BOTTOM = 24
const ROW_GAP = 70
const SIDE_GAP = 120
const MAX_COLS = 6

/**
 * The layers of the reference architecture: the platform stacked top to bottom (storefront, APIs and
 * processing, the commerce core, infrastructure), the external systems in columns on its sides.
 */
export const LAYERS = { store: 'b_store', api: 'b_api', core: 'b_core', infra: 'b_infra', client: 'b_cliente', saas: 'b_saas' } as const
const CENTER: string[] = [LAYERS.store, LAYERS.api, LAYERS.core, LAYERS.infra]
const SIDES: string[] = [LAYERS.client, LAYERS.saas]
const colsFor = (n: number) => (n <= MAX_COLS ? Math.max(n, 1) : Math.ceil(n / Math.ceil(n / MAX_COLS)))
const rowWidth = (k: number) => k * BOX_W + Math.max(k - 1, 0) * GAP

/** Places the children of a layer in centered rows; returns the layer height */
function fill(kids: GraphNode[], width: number, cols: number) {
  kids.forEach((k, i) => {
    const row = Math.floor(i / cols)
    const inRow = Math.min(cols, kids.length - row * cols)
    k.x = Math.round((width - rowWidth(inRow)) / 2 + (i % cols) * (BOX_W + GAP))
    k.y = PAD_TOP + row * (BOX_H + GAP)
  })
  const rows = Math.max(1, Math.ceil(kids.length / cols))
  return PAD_TOP + rows * (BOX_H + GAP) - GAP + PAD_BOTTOM
}

/**
 * Lays out a C4 graph like a reference architecture: people on top, then what they reach first (CDN,
 * admin), each under its person, then the platform layers, all the same width, with the client's
 * systems on the left and the SaaS partners on the right, each at the height of the layer it talks
 * to. Layers and elements it does not know go in the middle column and at the end.
 */
export function referenceLayout(graph: Graph): Graph {
  const nodes = graph.nodes.map((n) => ({ ...n, x: undefined, y: undefined }) as GraphNode)
  const boundaries = new Set(nodes.filter((n) => n.type === 'boundary').map((n) => n.id))
  const top = nodes.filter((n) => !n.parent || !boundaries.has(n.parent))
  const kids = (id: string) => nodes.filter((n) => n.parent === id)
  const from = (n: GraphNode) => graph.edges.some((e) => e.source === n.id)
  const to = (n: GraphNode) => graph.edges.some((e) => e.target === n.id)
  const people = top.filter((n) => n.type === 'person' || (n.type !== 'boundary' && from(n) && !to(n)))
  const sides = SIDES.map((id) => top.find((n) => n.id === id)).filter((n): n is GraphNode => Boolean(n))
  const center = [...CENTER.map((id) => top.find((n) => n.id === id)).filter((n): n is GraphNode => Boolean(n)), ...top.filter((n) => n.type === 'boundary' && !CENTER.includes(n.id) && !SIDES.includes(n.id))]
  const placed = new Set([...people, ...sides, ...center])
  const loose = top.filter((n) => !placed.has(n))
  const reachedBy = (n: GraphNode) => people.find((p) => graph.edges.some((e) => e.source === p.id && e.target === n.id))
  const entry = loose.filter((n) => reachedBy(n))
  const last = loose.filter((n) => !reachedBy(n))

  const width = Math.max(760, people.length * PERSON_W + Math.max(people.length - 1, 0) * 40, ...center.map((b) => rowWidth(colsFor(kids(b.id).length)) + 2 * PAD_X))
  const row = (list: GraphNode[], w: number, y: number, gap: number) => {
    const total = list.length * w + Math.max(list.length - 1, 0) * gap
    list.forEach((n, i) => {
      n.x = Math.round((width - total) / 2 + i * (w + gap))
      n.y = y
    })
  }

  let y = 0
  if (people.length) {
    row(people, PERSON_W, y, 40)
    y += PERSON_H + ROW_GAP
  }
  if (entry.length) {
    // each one right under the person who reaches it, so the line goes straight down
    let right = -Infinity
    for (const n of entry) {
      const p = reachedBy(n)!
      n.x = Math.max(Math.round(p.x! + (PERSON_W - BOX_W) / 2), right + 24)
      n.y = y
      right = n.x + BOX_W
    }
    y += BOX_H + ROW_GAP
  }
  const layerY = new Map<string, number>()
  for (const b of center) {
    const h = fill(kids(b.id), width, colsFor(kids(b.id).length))
    b.x = 0
    b.y = y
    layerY.set(b.id, y)
    y += h + ROW_GAP
  }
  // the systems at the sides, ordered by the layer they talk to, top to bottom
  const layerOf = (id: string) => {
    const n = nodes.find((x) => x.id === id)
    return n && (layerY.has(n.id) ? n.id : n.parent && layerY.has(n.parent) ? n.parent : undefined)
  }
  const rank = (k: GraphNode) => Math.min(Infinity, ...graph.edges.filter((e) => e.source === k.id || e.target === k.id).map((e) => center.findIndex((c) => c.id === layerOf(e.source === k.id ? e.target : e.source))).filter((i) => i >= 0))
  for (const s of sides) {
    const list = kids(s.id)
      .map((k, i) => ({ k, i, r: rank(k) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.k)
    const cols = list.length > 8 ? 2 : 1
    const w = rowWidth(cols) + 2 * PAD_X
    fill(list, w, cols)
    s.x = s.id === LAYERS.client ? -SIDE_GAP - w : width + SIDE_GAP
    s.y = center.length ? center[0].y! : y
  }
  for (let i = 0; i < last.length; i += 6) {
    row(last.slice(i, i + 6), BOX_W, y, 40)
    y += BOX_H + ROW_GAP
  }
  return { ...graph, nodes }
}
