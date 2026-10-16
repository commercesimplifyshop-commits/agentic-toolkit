import { useEffect } from 'react'
import { followUiChanges, useUi } from '../ui-prefs'

/** Where texts are never replaced: what the person types, code, and the conversation with the assistant */
const SKIP = 'textarea, input, select, pre, code, [contenteditable], .cm-editor, .monaco-editor, .sf-assist, .sf-mcp-code, .sf-no-custom'
const ATTRS = ['placeholder', 'title', 'aria-label'] as const

/** What was replaced, to put the original back when a replacement is removed */
const replacedNodes = new Map<Text, string>()
const replacedAttrs = new Map<Element, Map<string, string>>()

/** The text a node had before any replacement: what a new replacement must start from */
export function originalText(node: Text) {
  return (replacedNodes.get(node) ?? node.nodeValue ?? '').trim()
}

function restore() {
  for (const [node, original] of replacedNodes) if (node.isConnected) node.nodeValue = original
  replacedNodes.clear()
  for (const [el, attrs] of replacedAttrs) if (el.isConnected) for (const [name, value] of attrs) el.setAttribute(name, value)
  replacedAttrs.clear()
}

function replaceIn(root: Node, map: Map<string, string>) {
  if (!map.size) return
  const doText = (node: Text) => {
    const raw = node.nodeValue ?? ''
    const t = raw.trim()
    if (!t || !map.has(t) || node.parentElement?.closest(SKIP)) return
    if (!replacedNodes.has(node)) replacedNodes.set(node, raw)
    node.nodeValue = raw.replace(t, map.get(t)!)
  }
  const doAttrs = (el: Element) => {
    // a field's placeholder is changed, its value never; other attributes inside skipped areas are left alone
    if (el.closest(SKIP) && !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return
    for (const name of ATTRS) {
      const v = el.getAttribute(name)?.trim()
      if (!v || !map.has(v)) continue
      const saved = replacedAttrs.get(el) ?? new Map<string, string>()
      if (!saved.has(name)) saved.set(name, el.getAttribute(name)!)
      replacedAttrs.set(el, saved)
      el.setAttribute(name, map.get(v)!)
    }
  }
  if (root.nodeType === Node.TEXT_NODE) return doText(root as Text)
  if (!(root instanceof Element)) return
  doAttrs(root)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) doText(n as Text)
  for (const el of root.querySelectorAll('[placeholder],[title],[aria-label]')) doAttrs(el)
}

/**
 * Applies the interface preferences that are not a component's own: the theme (CSS variables), the
 * custom CSS and the replaced texts (any exact visible text, on every screen, including the ones that
 * appear later). Feature names count as replaced texts too, so the old name changes everywhere.
 */
export function UiCustomizer() {
  const prefs = useUi((s) => s.prefs)
  const theme = useUi((s) => s.theme)
  const features = useUi((s) => s.features)

  useEffect(() => {
    followUiChanges()
  }, [])

  // theme: each changed token as a CSS variable of the whole page
  useEffect(() => {
    const root = document.documentElement
    for (const t of theme) {
      const v = prefs.theme[t.id]
      if (v) root.style.setProperty(t.variable, v)
      else root.style.removeProperty(t.variable)
    }
    // the soft accent (backgrounds of active items) follows the accent
    if (prefs.theme.accent) root.style.setProperty('--sf-accent-soft', `color-mix(in srgb, ${prefs.theme.accent} 16%, transparent)`)
    else root.style.removeProperty('--sf-accent-soft')
  }, [prefs.theme, theme])

  // custom CSS
  useEffect(() => {
    let el = document.getElementById('sf-custom-css') as HTMLStyleElement | null
    if (!prefs.css) return void el?.remove()
    if (!el) {
      el = document.createElement('style')
      el.id = 'sf-custom-css'
      document.head.appendChild(el)
    }
    el.textContent = prefs.css
  }, [prefs.css])

  // texts: the replacements and the new names of features, kept applied as the screens change
  useEffect(() => {
    const map = new Map<string, string>()
    for (const f of features) if (prefs.labels[f.id]) map.set(f.originalTitle, prefs.labels[f.id])
    for (const t of prefs.texts) map.set(t.from, t.to)
    restore()
    const root = document.getElementById('root') ?? document.body
    replaceIn(root, map)
    if (!map.size) return
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'characterData') replaceIn(m.target, map)
        else if (m.type === 'attributes') replaceIn(m.target, map)
        else m.addedNodes.forEach((n) => replaceIn(n, map))
      }
    })
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] })
    return () => observer.disconnect()
  }, [prefs.texts, prefs.labels, features])

  return null
}
