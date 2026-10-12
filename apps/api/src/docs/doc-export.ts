import { AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, LevelFormat, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import { marked, type Token, type Tokens } from 'marked'
import PdfPrinter from 'pdfmake'
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'

/**
 * Markdown → Word / PDF, generated locally from the doc saved in StoreFlow's data
 * dir. Works offline and with any AI provider; nothing is sent anywhere.
 */

interface Inline {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
  link?: string
}

/** Flattens marked inline tokens into styled runs. */
function inlines(tokens: Token[] | undefined, style: Omit<Inline, 'text'> = {}): Inline[] {
  const out: Inline[] = []
  for (const t of tokens ?? []) {
    switch (t.type) {
      case 'strong':
        out.push(...inlines((t as Tokens.Strong).tokens, { ...style, bold: true }))
        break
      case 'em':
        out.push(...inlines((t as Tokens.Em).tokens, { ...style, italic: true }))
        break
      case 'codespan':
        out.push({ ...style, text: decode((t as Tokens.Codespan).text), code: true })
        break
      case 'link':
        out.push(...inlines((t as Tokens.Link).tokens, { ...style, link: (t as Tokens.Link).href }))
        break
      case 'br':
        out.push({ ...style, text: '\n' })
        break
      case 'text':
        if ((t as Tokens.Text).tokens?.length) out.push(...inlines((t as Tokens.Text).tokens, style))
        else out.push({ ...style, text: decode((t as Tokens.Text).text) })
        break
      default:
        out.push({ ...style, text: decode((t as { text?: string }).text ?? t.raw) })
    }
  }
  return out
}

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

const lex = (markdown: string) => marked.lexer(markdown, { gfm: true })

// ---- Word -------------------------------------------------------------------------------

const MONO = 'Consolas'
const ACCENT = 'C2410C'

function docxRuns(runs: Inline[], base: { size?: number; color?: string } = {}) {
  return runs.map((r) => {
    const run = new TextRun({
      text: r.text,
      bold: r.bold,
      italics: r.italic,
      font: r.code ? MONO : undefined,
      size: r.code ? 19 : base.size,
      color: r.link ? '1D4ED8' : (base.color ?? (r.code ? '9A3412' : undefined)),
      underline: r.link ? {} : undefined,
      shading: r.code ? { type: ShadingType.CLEAR, fill: 'F3F4F6', color: 'auto' } : undefined,
    })
    return r.link && /^https?:/.test(r.link) ? new ExternalHyperlink({ link: r.link, children: [run] }) : run
  })
}

function docxBlocks(tokens: Token[], depth = 0): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  for (const t of tokens) {
    switch (t.type) {
      case 'heading': {
        const h = t as Tokens.Heading
        // "# Title" is the document title; ## sections are Heading 1, and so on
        const level = [HeadingLevel.TITLE, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5][Math.min(h.depth, 6) - 1]
        out.push(new Paragraph({ heading: level, children: docxRuns(inlines(h.tokens)), spacing: { before: 240, after: 120 } }))
        break
      }
      case 'paragraph':
        out.push(new Paragraph({ children: docxRuns(inlines((t as Tokens.Paragraph).tokens)), spacing: { after: 120 } }))
        break
      case 'list': {
        const l = t as Tokens.List
        for (const item of l.items) {
          const [first, ...rest] = item.tokens
          const firstRuns = first && (first.type === 'text' || first.type === 'paragraph') ? inlines((first as Tokens.Text).tokens ?? [first]) : []
          out.push(
            new Paragraph({
              children: docxRuns(item.task ? [{ text: item.checked ? '☑ ' : '☐ ' }, ...firstRuns] : firstRuns),
              numbering: { reference: l.ordered ? 'sf-ordered' : 'sf-bullets', level: Math.min(depth, 4) },
              spacing: { after: 60 },
            }),
          )
          const nested = first && (first.type === 'text' || first.type === 'paragraph') ? rest : item.tokens
          out.push(...docxBlocks(nested, depth + 1))
        }
        break
      }
      case 'code': {
        const lines = (t as Tokens.Code).text.split('\n')
        out.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    shading: { type: ShadingType.CLEAR, fill: 'F3F4F6', color: 'auto' },
                    margins: { top: 100, bottom: 100, left: 140, right: 140 },
                    children: lines.map((line) => new Paragraph({ children: [new TextRun({ text: line || ' ', font: MONO, size: 18 })] })),
                  }),
                ],
              }),
            ],
          }),
          new Paragraph({ text: '', spacing: { after: 60 } }),
        )
        break
      }
      case 'table': {
        const tb = t as Tokens.Table
        const row = (cells: Tokens.TableCell[], header: boolean) =>
          new TableRow({
            tableHeader: header,
            children: cells.map(
              (c) =>
                new TableCell({
                  shading: header ? { type: ShadingType.CLEAR, fill: 'F3F4F6', color: 'auto' } : undefined,
                  margins: { top: 60, bottom: 60, left: 100, right: 100 },
                  children: [new Paragraph({ children: docxRuns(inlines(c.tokens, header ? { bold: true } : {}), { size: 19 }) })],
                }),
            ),
          })
        out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [row(tb.header, true), ...tb.rows.map((r) => row(r, false))] }), new Paragraph({ text: '', spacing: { after: 60 } }))
        break
      }
      case 'blockquote':
        for (const q of (t as Tokens.Blockquote).tokens) {
          if (q.type !== 'paragraph') {
            out.push(...docxBlocks([q], depth))
            continue
          }
          out.push(
            new Paragraph({
              children: docxRuns(inlines((q as Tokens.Paragraph).tokens), { color: '374151' }),
              indent: { left: 240 },
              border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'F97316', space: 8 } },
              shading: { type: ShadingType.CLEAR, fill: 'FFF7ED', color: 'auto' },
              spacing: { after: 120 },
            }),
          )
        }
        break
      case 'hr':
        out.push(new Paragraph({ text: '', border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB', space: 1 } }, spacing: { after: 160 } }))
        break
      case 'space':
        break
      default:
        if ('text' in t && t.text) out.push(new Paragraph({ text: decode(String(t.text)) }))
    }
  }
  return out
}

export async function toDocx(markdown: string, meta: { title: string; subtitle: string }): Promise<Buffer> {
  const bulletLevels = [0, 1, 2, 3, 4].map((level) => ({ level, format: LevelFormat.BULLET, text: ['•', '◦', '▪', '•', '◦'][level], alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } } } }))
  const orderedLevels = [0, 1, 2, 3, 4].map((level) => ({ level, format: LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 300 } } } }))
  const doc = new Document({
    creator: 'StoreFlow',
    title: meta.title,
    description: meta.subtitle,
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', run: { size: 40, bold: true, color: '111827' }, paragraph: { spacing: { after: 80 } } },
        { id: 'Heading1', name: 'Heading 1', run: { size: 30, bold: true, color: ACCENT } },
        { id: 'Heading2', name: 'Heading 2', run: { size: 26, bold: true, color: '111827' } },
        { id: 'Heading3', name: 'Heading 3', run: { size: 23, bold: true, color: '374151' } },
      ],
    },
    numbering: { config: [{ reference: 'sf-bullets', levels: bulletLevels }, { reference: 'sf-ordered', levels: orderedLevels }] },
    sections: [
      {
        children: [new Paragraph({ children: [new TextRun({ text: meta.subtitle, color: '6B7280', size: 18 })], spacing: { after: 200 } }), ...docxBlocks(lex(markdown))],
      },
    ],
  })
  return Packer.toBuffer(doc)
}

// ---- PDF --------------------------------------------------------------------------------------

let printer: PdfPrinter | null = null
function pdfPrinter() {
  if (printer) return printer
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const vfsModule = require('pdfmake/build/vfs_fonts.js')
  const vfs: Record<string, string> = vfsModule.pdfMake?.vfs ?? vfsModule
  const font = (name: string) => Buffer.from(vfs[name], 'base64')
  printer = new PdfPrinter({
    Roboto: { normal: font('Roboto-Regular.ttf'), bold: font('Roboto-Medium.ttf'), italics: font('Roboto-Italic.ttf'), bolditalics: font('Roboto-MediumItalic.ttf') },
  })
  return printer
}

function pdfText(runs: Inline[]) {
  return runs.map((r) => ({
    text: r.text,
    bold: r.bold,
    italics: r.italic,
    link: r.link && /^https?:/.test(r.link) ? r.link : undefined,
    color: r.link ? '#1d4ed8' : r.code ? '#9a3412' : undefined,
    background: r.code ? '#f3f4f6' : undefined,
    fontSize: r.code ? 9 : undefined,
  }))
}

function pdfBlocks(tokens: Token[]): Content[] {
  const out: Content[] = []
  for (const t of tokens) {
    switch (t.type) {
      case 'heading': {
        const h = t as Tokens.Heading
        out.push({ text: pdfText(inlines(h.tokens)), style: `h${Math.min(h.depth, 4)}` })
        break
      }
      case 'paragraph':
        out.push({ text: pdfText(inlines((t as Tokens.Paragraph).tokens)), margin: [0, 0, 0, 6] })
        break
      case 'list': {
        const l = t as Tokens.List
        const items = l.items.map((item) => {
          const [first, ...rest] = item.tokens
          const isText = first && (first.type === 'text' || first.type === 'paragraph')
          const head = isText ? { text: pdfText([...(item.task ? [{ text: item.checked ? '[x] ' : '[ ] ' }] : []), ...inlines((first as Tokens.Text).tokens ?? [first])]) } : null
          const nested = pdfBlocks(isText ? rest : item.tokens)
          return nested.length ? { stack: [...(head ? [head] : []), ...nested] } : (head ?? '')
        })
        out.push(l.ordered ? { ol: items, margin: [0, 0, 0, 6] } : { ul: items, margin: [0, 0, 0, 6] })
        break
      }
      case 'code':
        out.push({
          table: { widths: ['*'], body: [[{ text: (t as Tokens.Code).text, style: 'code' }]] },
          layout: { fillColor: () => '#f3f4f6', hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 6, paddingBottom: () => 6 },
          margin: [0, 2, 0, 8],
        })
        break
      case 'table': {
        const tb = t as Tokens.Table
        out.push({
          table: {
            headerRows: 1,
            widths: tb.header.map(() => '*'),
            body: [tb.header.map((c) => ({ text: pdfText(inlines(c.tokens)), bold: true, fillColor: '#f3f4f6' })), ...tb.rows.map((r) => r.map((c) => ({ text: pdfText(inlines(c.tokens)) })))],
          },
          layout: { hLineColor: () => '#e5e7eb', vLineColor: () => '#e5e7eb', hLineWidth: () => 0.5, vLineWidth: () => 0.5 },
          fontSize: 9,
          margin: [0, 2, 0, 10],
        })
        break
      }
      case 'blockquote':
        out.push({
          table: { widths: ['*'], body: [[{ stack: pdfBlocks((t as Tokens.Blockquote).tokens), color: '#374151' }]] },
          layout: { fillColor: () => '#fff7ed', hLineWidth: () => 0, vLineWidth: (i: number) => (i === 0 ? 2 : 0), vLineColor: () => '#f97316', paddingLeft: () => 10 },
          margin: [0, 2, 0, 8],
        })
        break
      case 'hr':
        out.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#d1d5db' }], margin: [0, 6, 0, 10] })
        break
      case 'space':
        break
      default:
        if ('text' in t && t.text) out.push({ text: decode(String(t.text)) })
    }
  }
  return out
}

export function toPdf(markdown: string, meta: { title: string; subtitle: string }): Promise<Buffer> {
  const def: TDocumentDefinitions = {
    info: { title: meta.title, creator: 'StoreFlow' },
    pageSize: 'A4',
    pageMargins: [40, 48, 40, 52],
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.3, color: '#1f2937' },
    styles: {
      h1: { fontSize: 20, bold: true, color: '#111827', margin: [0, 0, 0, 6] },
      h2: { fontSize: 14, bold: true, color: '#c2410c', margin: [0, 14, 0, 6] },
      h3: { fontSize: 12, bold: true, color: '#111827', margin: [0, 10, 0, 4] },
      h4: { fontSize: 10.5, bold: true, color: '#374151', margin: [0, 8, 0, 3] },
      code: { fontSize: 8.5, color: '#111827', preserveLeadingSpaces: true, lineHeight: 1.15 },
    },
    footer: (page, count) => ({ text: `${meta.title} · ${page}/${count}`, alignment: 'right', fontSize: 8, color: '#9ca3af', margin: [40, 16, 40, 0] }),
    content: [{ text: meta.subtitle, fontSize: 8.5, color: '#6b7280', margin: [0, 0, 0, 10] }, ...pdfBlocks(lex(markdown))],
  }
  return new Promise((resolve, reject) => {
    const pdf = pdfPrinter().createPdfKitDocument(def)
    const chunks: Buffer[] = []
    pdf.on('data', (c: Buffer) => chunks.push(c))
    pdf.on('end', () => resolve(Buffer.concat(chunks)))
    pdf.on('error', reject)
    pdf.end()
  })
}
