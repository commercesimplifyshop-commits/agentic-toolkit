import type { Mermaid } from 'mermaid'

let mermaidPromise: Promise<Mermaid> | null = null
let counter = 0

/** Mermaid is large: it loads the first time a diagram is rendered, not with the app. */
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: 'dark',
        // strict: no click handlers or HTML labels from the diagram source
        securityLevel: 'strict',
        fontFamily: 'Inter, system-ui, sans-serif',
        // Plain SVG text (no foreignObject) keeps PNG export working: a canvas drawn
        // from an SVG with foreignObject is tainted and cannot be exported
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        er: { useMaxWidth: false },
        sequence: { useMaxWidth: false },
      })
      return m.default
    })
  }
  return mermaidPromise
}

export type RenderResult = { ok: true; svg: string } | { ok: false; error: string }

/** Renders Mermaid source to SVG; errors come back as text, never thrown. */
export async function renderMermaid(source: string): Promise<RenderResult> {
  if (!source.trim()) return { ok: false, error: 'O diagrama está vazio.' }
  const mermaid = await loadMermaid()
  const id = `sf-diagram-${++counter}`
  try {
    await mermaid.parse(source)
    const { svg } = await mermaid.render(id, source)
    return { ok: true, svg }
  } catch (err) {
    // Mermaid leaves its error scratch element behind on failure
    document.getElementById(`d${id}`)?.remove()
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: firstLines(message) }
  }
}

function firstLines(message: string) {
  return message
    .split('\n')
    .filter((l) => l.trim())
    .slice(0, 4)
    .join('\n')
}
