import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import { bracketMatching, foldGutter, indentOnInput } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { darcula } from './darcula'

/**
 * Small editable CodeMirror (request bodies, GraphQL queries). Editing here only
 * changes the request being built in the browser, never any file.
 */
export function TextEditor({ value, onChange, language = 'json', readOnly = false }: { value: string; onChange?: (v: string) => void; language?: 'json' | 'text'; readOnly?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const change = useRef(onChange)
  change.current = onChange

  useEffect(() => {
    if (!host.current) return
    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          foldGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: true }),
          keymap.of([indentWithTab, ...searchKeymap, ...historyKeymap, ...defaultKeymap]),
          EditorState.readOnly.of(readOnly),
          EditorState.tabSize.of(2),
          language === 'json' ? json() : [],
          darcula,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) change.current?.(u.state.doc.toString())
          }),
        ],
      }),
    })
    return () => {
      view.current?.destroy()
      view.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly])

  // Replace the document when the value changes from outside (e.g. a new template)
  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
  }, [value])

  return <div ref={host} className="sf-codemirror" />
}
