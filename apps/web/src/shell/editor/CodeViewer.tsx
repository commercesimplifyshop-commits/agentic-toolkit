import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { less } from '@codemirror/lang-less'
import { php } from '@codemirror/lang-php'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { defaultKeymap } from '@codemirror/commands'
import { bracketMatching, codeFolding, foldGutter, foldKeymap, indentOnInput } from '@codemirror/language'
import { gotoLine, highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { darcula } from './darcula'

function languageFor(path: string): Extension[] {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  // php() mixes in HTML outside <?php ?> blocks, which is exactly what .phtml needs
  if (ext === 'php' || ext === 'phtml') return [php()]
  if (['xml', 'xsd', 'dist'].includes(ext) || path.endsWith('.xml.dist')) return [xml()]
  if (['js', 'mjs', 'cjs'].includes(ext)) return [javascript()]
  if (ext === 'ts' || ext === 'tsx') return [javascript({ typescript: true, jsx: ext === 'tsx' })]
  if (ext === 'json' || ext === 'lock') return [json()]
  if (ext === 'less') return [less()]
  if (ext === 'css' || ext === 'scss') return [css()]
  if (ext === 'html' || ext === 'htm') return [html()]
  if (ext === 'yml' || ext === 'yaml' || ext === 'neon') return [yaml()]
  return []
}

// ---- target line (the line we jumped to) -------------------------------------------

const setTarget = StateEffect.define<number | null>()
const targetLine = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setTarget)) {
        if (!e.value || e.value > tr.state.doc.lines) return Decoration.none
        const line = tr.state.doc.line(e.value)
        return Decoration.set([Decoration.line({ class: 'sf-target-line' }).range(line.from)])
      }
    }
    return deco.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f),
})

/** The PHP class name (with backslashes) under a document position. */
function wordAt(view: EditorView, pos: number) {
  const line = view.state.doc.lineAt(pos)
  const text = line.text
  let from = pos - line.from
  let to = from
  while (from > 0 && /[\w\\]/.test(text[from - 1])) from--
  while (to < text.length && /[\w\\]/.test(text[to])) to++
  return text.slice(from, to)
}

export interface CodeViewerProps {
  path: string
  content: string
  line?: number
  /** Ctrl/Cmd+click on an identifier (PhpStorm "Go to declaration") */
  onDeclaration?: (word: string, doc: string) => void
  compact?: boolean
}

/** Read-only CodeMirror editor with PhpStorm's Darcula colors. */
export function CodeViewer({ path, content, line, onDeclaration, compact }: CodeViewerProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onDecl = useRef(onDeclaration)
  onDecl.current = onDeclaration

  // (Re)create the state when the file changes
  useEffect(() => {
    if (!host.current) return
    const state = EditorState.create({
      doc: content,
      extensions: [
        EditorState.readOnly.of(true),
        lineNumbers(),
        compact ? [] : foldGutter(),
        codeFolding(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        bracketMatching(),
        indentOnInput(),
        highlightSelectionMatches(),
        search({ top: true }),
        keymap.of([...searchKeymap, ...foldKeymap, { key: 'Mod-g', run: gotoLine, preventDefault: true }, ...defaultKeymap]),
        targetLine,
        EditorView.domEventHandlers({
          mousedown(e, v) {
            if (!(e.ctrlKey || e.metaKey) || !onDecl.current) return false
            const pos = v.posAtCoords({ x: e.clientX, y: e.clientY })
            if (pos === null) return false
            const word = wordAt(v, pos)
            if (!word) return false
            e.preventDefault()
            onDecl.current(word, v.state.doc.toString())
            return true
          },
        }),
        ...languageFor(path),
        darcula,
      ],
    })
    if (!view.current) view.current = new EditorView({ state, parent: host.current })
    else view.current.setState(state)
  }, [path, content, compact])

  // Jump to the requested line
  useEffect(() => {
    const v = view.current
    if (!v) return
    const n = line && line <= v.state.doc.lines ? line : null
    v.dispatch({
      effects: [setTarget.of(n), ...(n ? [EditorView.scrollIntoView(v.state.doc.line(n).from, { y: 'center' })] : [])],
      selection: n ? { anchor: v.state.doc.line(n).from } : undefined,
    })
  }, [line, path, content])

  useEffect(
    () => () => {
      view.current?.destroy()
      view.current = null
    },
    [],
  )

  return <div ref={host} className="sf-codemirror" />
}
