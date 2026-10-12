import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

/** PhpStorm's Darcula palette */
const c = {
  bg: '#2b2b2b',
  gutterBg: '#313335',
  gutterText: '#606366',
  text: '#a9b7c6',
  keyword: '#cc7832',
  string: '#6a8759',
  number: '#6897bb',
  comment: '#808080',
  docComment: '#629755',
  func: '#ffc66d',
  variable: '#9876aa',
  constant: '#9876aa',
  type: '#a9b7c6',
  tag: '#e8bf6a',
  attribute: '#bababa',
  meta: '#bbb529',
  selection: '#214283',
  activeLine: '#323232',
  match: '#32593d',
  caret: '#bbbbbb',
}

const theme = EditorView.theme(
  {
    '&': { color: c.text, backgroundColor: c.bg, fontSize: '13px', height: '100%' },
    '.cm-scroller': { fontFamily: "'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, monospace", lineHeight: '1.6' },
    '.cm-content': { caretColor: c.caret, padding: '6px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: c.caret },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: c.selection },
    '.cm-gutters': { backgroundColor: c.gutterBg, color: c.gutterText, border: 'none', borderRight: '1px solid #3c3f41' },
    '.cm-activeLineGutter': { backgroundColor: '#3a3a3a', color: '#a4a3a3' },
    '.cm-activeLine': { backgroundColor: c.activeLine },
    '.cm-foldPlaceholder': { backgroundColor: '#3c3f41', border: 'none', color: '#888' },
    '.cm-searchMatch': { backgroundColor: c.match, outline: '1px solid #3b6e47' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#155221' },
    '.cm-selectionMatch': { backgroundColor: '#344134' },
    '.cm-panels': { backgroundColor: '#3c3f41', color: c.text, borderTop: '1px solid #515151' },
    '.cm-panels input, .cm-panels button': { color: c.text },
    '.cm-textfield': { backgroundColor: '#45494a', border: '1px solid #646464', borderRadius: '3px' },
    '.cm-button': { backgroundImage: 'none', backgroundColor: '#4c5052', border: '1px solid #5e6060', borderRadius: '3px' },
    '.sf-target-line': { backgroundColor: 'rgba(249, 115, 22, 0.16)', boxShadow: 'inset 3px 0 0 #f97316' },
    '.sf-decl-link': { textDecoration: 'underline', color: '#589df6', cursor: 'pointer' },
  },
  { dark: true },
)

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword, t.self, t.null, t.bool], color: c.keyword },
  { tag: [t.string, t.special(t.string), t.regexp], color: c.string },
  { tag: [t.number, t.integer, t.float], color: c.number },
  { tag: t.lineComment, color: c.comment },
  { tag: [t.blockComment, t.docComment], color: c.docComment, fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: c.func },
  { tag: [t.variableName, t.special(t.variableName)], color: c.variable },
  { tag: [t.propertyName], color: c.variable },
  { tag: [t.constant(t.variableName), t.standard(t.variableName)], color: c.constant, fontStyle: 'italic' },
  { tag: [t.className, t.typeName, t.namespace], color: c.type },
  { tag: [t.tagName, t.angleBracket], color: c.tag },
  { tag: t.attributeName, color: c.attribute },
  { tag: t.attributeValue, color: c.string },
  { tag: [t.meta, t.annotation, t.processingInstruction], color: c.meta },
  { tag: t.heading, color: c.func, fontWeight: 'bold' },
  { tag: t.link, color: '#287bde', textDecoration: 'underline' },
  { tag: t.invalid, color: '#ff6b68' },
])

export const darcula = [theme, syntaxHighlighting(highlight)]
