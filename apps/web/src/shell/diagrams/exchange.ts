import type { DiagramKind } from './templates'

/** Agentic Toolkit's own file: keeps name and kind, so an import restores the diagram as it was. */
export const FORMAT = 'agentic-toolkit-diagram'
export const FORMAT_VERSION = 1
export const MAX_SOURCE = 200_000

export interface DiagramFile {
  name: string
  kind: DiagramKind
  /** "canvas": source is the JSON graph; "code": Mermaid */
  mode?: 'code' | 'canvas'
  source: string
}

export function download(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const slugFile = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'diagrama'

// ---- export --------------------------------------------------------------------------------

export function svgBlob(svg: string) {
  return new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
}

export function sourceBlob(source: string) {
  return new Blob([source], { type: 'text/plain;charset=utf-8' })
}

export function agenticToolkitBlob(file: DiagramFile) {
  const doc = { format: FORMAT, version: FORMAT_VERSION, ...file }
  return new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
}

function svgSize(svg: string) {
  const vb = svg.match(/viewBox="([\d.\-\s,]+)"/)?.[1].trim().split(/[\s,]+/).map(Number)
  if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { width: Math.ceil(vb[2]), height: Math.ceil(vb[3]) }
  const w = Number(svg.match(/\swidth="([\d.]+)"/)?.[1] ?? 800)
  const h = Number(svg.match(/\sheight="([\d.]+)"/)?.[1] ?? 600)
  return { width: Math.ceil(w), height: Math.ceil(h) }
}

/**
 * PNG on the dark theme background (the diagram text is light, so a white
 * background would hide it). Scale 2 keeps it sharp when pasted into documents.
 */
export async function svgToPng(svg: string, scale = 2): Promise<Blob> {
  const { width, height } = svgSize(svg)
  // Fixed size on the root: width="100%" would load the image at 300 px
  const sized = svg.replace(/^<svg([^>]*)>/, (_, attrs: string) => `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, '').replace(/style="[^"]*"/, '')} width="${width}" height="${height}">`)
  const url = URL.createObjectURL(svgBlob(sized))
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('A imagem demorou demais para ser gerada.')), 10_000)
      img.onload = () => (clearTimeout(timer), resolve())
      img.onerror = () => (clearTimeout(timer), reject(new Error('Não foi possível gerar a imagem deste diagrama.')))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = width * scale
    canvas.height = height * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Este navegador não permite gerar PNG.')
    ctx.fillStyle = '#0a0a0b'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => {
      try {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar o PNG'))), 'image/png')
      } catch {
        // A canvas tainted by an external reference in the SVG cannot be exported
        reject(new Error('Este diagrama usa um recurso externo que o navegador não deixa exportar como PNG. Exporte em SVG.'))
      }
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ---- import --------------------------------------------------------------------------------

const KINDS: DiagramKind[] = ['c4', 'uml', 'flow', 'other']

/**
 * Reads a file the user picked. Accepts Agentic Toolkit's .json, Mermaid source
 * (.mmd, .mermaid, .txt) and Markdown with ```mermaid blocks (the first one wins).
 */
export async function readDiagramFile(file: File): Promise<DiagramFile> {
  if (file.size > MAX_SOURCE * 2) throw new Error('Arquivo grande demais para um diagrama.')
  const text = await file.text()
  const baseName = file.name.replace(/\.[^.]+$/, '')
  const lower = file.name.toLowerCase()

  if (lower.endsWith('.json')) {
    let doc: Partial<DiagramFile> & { format?: string; version?: number }
    try {
      doc = JSON.parse(text)
    } catch {
      throw new Error('Este JSON não é um diagrama do Agentic Toolkit.')
    }
    if (doc.format !== FORMAT) throw new Error('Este JSON não é um diagrama do Agentic Toolkit.')
    if ((doc.version ?? 0) > FORMAT_VERSION) throw new Error('Este diagrama foi exportado por uma versão mais nova do Agentic Toolkit.')
    return checked({
      name: String(doc.name || baseName),
      kind: KINDS.includes(doc.kind as DiagramKind) ? (doc.kind as DiagramKind) : 'other',
      mode: (doc as { mode?: string }).mode === 'canvas' ? 'canvas' : 'code',
      source: String(doc.source ?? ''),
    })
  }

  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    const block = text.match(/```mermaid\s*\n([\s\S]*?)```/)
    if (!block) throw new Error('Nenhum bloco ```mermaid encontrado neste Markdown.')
    return checked({ name: baseName, kind: guessKind(block[1]), source: block[1].trim() })
  }

  // .mmd, .mermaid, .txt or anything else plain: the whole file is the diagram
  return checked({ name: baseName, kind: guessKind(text), source: text.trim() })
}

function checked(file: DiagramFile): DiagramFile {
  if (!file.source.trim()) throw new Error('O arquivo está vazio.')
  if (file.source.length > MAX_SOURCE) throw new Error('O diagrama passa do limite de 200 KB.')
  return file
}

/** Guesses the family from the first keyword of the Mermaid source. */
export function guessKind(source: string): DiagramKind {
  const first = source.trim().split('\n')[0]?.trim().toLowerCase() ?? ''
  if (/^c4(context|container|component|dynamic|deployment)/.test(first)) return 'c4'
  if (/^(classdiagram|sequencediagram|statediagram|usecase)/.test(first)) return 'uml'
  if (/^(flowchart|graph)/.test(first)) return 'flow'
  return 'other'
}
