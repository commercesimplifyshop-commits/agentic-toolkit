import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import { useDevMode } from '../devmode'
import { useUi } from '../ui-prefs'
import { originalText } from './UiCustomizer'

interface Found {
  id: string
  title: string
  container: string
  el: HTMLElement
}

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)

/** The title of a block: its first heading, as originally written (a replaced text keeps the same id) */
/** The original text inside an element (a replaced text keeps the same id), counts like "(12)" left out */
function textOf(el: Element, max = 80) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const parts: string[] = []
  for (let n = walker.nextNode(); n && parts.join(' ').length < max * 2; n = walker.nextNode()) {
    if ((n.parentElement?.closest('.sf-nav-count, .sf-badge, .sf-spinner'))) continue
    const t = originalText(n as Text)
    if (t) parts.push(t)
  }
  return parts
    .join(' ')
    .replace(/\(\s*\d+\s*\)/g, '')
    .replace(/(^|\s)\d+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** The name of a block: its heading; or what it is (a table, filters, tabs); or its first words */
function titleOf(el: HTMLElement) {
  // a short first line opens the block (a column's header, a card's title): it names the block, not what is inside
  const first = el.firstElementChild
  const head = first && !first.matches('table, ul, ol, svg, canvas, .sf-row') ? textOf(first, 60) : ''
  if (head && head.length <= 40) return head
  const h = el.querySelector('h1, h2, h3, h4, .sf-card-head strong, strong')
  if (h && textOf(h)) return textOf(h)
  const th = [...el.querySelectorAll('thead th')].map((x) => textOf(x, 30)).filter(Boolean)
  if (th.length) return `Tabela: ${th.slice(0, 3).join(', ')}`
  return ''
}

/** On screen, or already known (a block hidden by the preferences has no size, but must stay in the catalog to be shown again) */
/** A bar of tabs has no heading: it is named by its tabs */
function tabsOf(el: HTMLElement) {
  const tabs = [...el.querySelectorAll('.sf-tab, [role="tab"]')].map((t) => (t.textContent ?? '').replace(/\s*\d+\s*$/, '').trim()).filter(Boolean)
  return tabs.length ? `Abas: ${tabs.slice(0, 3).join(', ')}${tabs.length > 3 ? '…' : ''}` : ''
}

const visible = (el: HTMLElement) => el.offsetWidth > 0 || el.offsetHeight > 0 || el.hasAttribute('data-auto-block')
const skip = (el: HTMLElement) => el.matches('.sf-page-head, script, style, template') || el.closest('.sf-blocks') !== null

/**
 * Finds the blocks of any page by itself: the sections of the page and the cards of each row (grid),
 * named by their headings. They are marked with data-auto-block and moved or hidden with CSS (order,
 * display), never by moving React's nodes. A block moves among the blocks of its own group.
 */
/** Side by side children: a grid, or a flex row of at least two real columns */
function isRow(el: HTMLElement) {
  const kids = [...el.children].filter((c): c is HTMLElement => c instanceof HTMLElement && visible(c))
  if (kids.length < 2) return false
  const st = getComputedStyle(el)
  if (st.display.includes('grid')) return true
  return st.display.includes('flex') && !st.flexDirection.startsWith('column') && kids.every((k) => k.offsetWidth > 160)
}

function discover(root: HTMLElement): Found[] {
  const out: Found[] = []
  const used = new Set<string>()
  const add = (el: HTMLElement, container: string, fallback: string, fixed?: string) => {
    const filters = el.querySelectorAll('button, .sf-chip').length >= 3 && !el.querySelector('table') ? 'Filtros' : ''
    // a bar of tabs with no heading of its own is named by its tabs, not by the first tab
    const tabs = el.querySelector('h1, h2, h3, h4') ? '' : tabsOf(el)
    const title = fixed || tabs || titleOf(el) || filters || textOf(el, 40) || fallback
    const base = slug(title) || slug(fallback)
    let id = base
    for (let k = 2; used.has(id); k++) id = `${base}-${k}`.slice(0, 60)
    used.add(id)
    el.setAttribute('data-auto-block', id)
    el.setAttribute('data-auto-container', container)
    out.push({ id, title, container, el })
  }
  // a page made of a single wrapper: its children are the sections
  let top = [...root.children].filter((c): c is HTMLElement => c instanceof HTMLElement && !skip(c) && visible(c))
  if (top.length === 1 && !isRow(top[0]) && top[0].children.length > 1 && !top[0].matches('.sf-card, table')) top = [...top[0].children].filter((c): c is HTMLElement => c instanceof HTMLElement && !skip(c) && visible(c))
  top.forEach((child, i) => {
    if (!isRow(child)) return add(child, 'page', `Seção ${i + 1}`)
    const group = `grupo-${i + 1}`
    const kids = [...child.children].filter((c): c is HTMLElement => c instanceof HTMLElement && visible(c))
    const names = kids.map((k) => titleOf(k) || textOf(k, 30)).filter(Boolean)
    // a row is named by its cards, never by the first card's title (that is the card's own name)
    add(child, 'page', `Linha ${i + 1}`, names.length ? `Linha: ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}` : undefined)
    child.setAttribute('data-auto-group', group)
    kids.forEach((k, j) => add(k, group, `Cartão ${j + 1}`))
  })
  return out
}

const known = new Map<string, string>()

/** Every page but the ones that declare their own blocks (Visão geral) and the full-screen tools */
export function AutoBlocks({ feature, enabled }: { feature?: string; enabled: boolean }) {
  const saved = useUi((s) => (feature ? s.prefs.pages[feature] : undefined))
  const apply = useUi((s) => s.apply)
  const load = useUi((s) => s.load)
  const editing = useDevMode((s) => s.on && s.tool === 'layout')
  const [found, setFound] = useState<Found[]>([])
  const [tick, setTick] = useState(0)
  const [dragging, setDragging] = useState<Found | null>(null)

  // find the blocks, and again when the page changes (data arriving, tabs)
  useEffect(() => {
    if (!enabled || !feature) return setFound([])
    const content = document.querySelector('.sf-content') as HTMLElement | null
    if (!content) return
    let timer = 0
    const scan = () => {
      const root = content.firstElementChild as HTMLElement | null
      if (!root || root.querySelector('.sf-blocks')) return setFound([])
      root.setAttribute('data-auto-root', '')
      const list = discover(root)
      setFound(list)
      // the server learns the blocks, so the assistant and the MCP see them too
      const sig = JSON.stringify(list.map((b) => [b.id, b.container, b.title]))
      if (list.length && known.get(feature) !== sig) {
        known.set(feature, sig)
        api
          .post('/ui/blocks', { page: feature, blocks: list.map(({ id, title, container }) => ({ id, title, container })) })
          .then(() => load())
          .catch(() => known.delete(feature))
      }
    }
    timer = window.setTimeout(scan, 400)
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(scan, 500)
    })
    observer.observe(content, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [feature, enabled, load])

  // the order and the hidden blocks of this page, as CSS (React's nodes stay where they are)
  useEffect(() => {
    let el = document.getElementById('sf-auto-blocks') as HTMLStyleElement | null
    if (!enabled || !feature || !saved || !found.length) return void el?.remove()
    if (!el) {
      el = document.createElement('style')
      el.id = 'sf-auto-blocks'
      document.head.appendChild(el)
    }
    const scope = `.sf-content[data-feature="${CSS.escape(feature)}"]`
    const rules = [`${scope} [data-auto-block][data-auto-container="page"] { }`, `${scope} :has(> [data-auto-container="page"]) { display: flex; flex-direction: column; }`]
    saved.order.forEach((id, i) => rules.push(`${scope} [data-auto-block="${CSS.escape(id)}"] { order: ${i}; }`))
    // while arranging, hidden blocks stay on screen, faded, so they can be shown again
    for (const id of saved.hidden) rules.push(editing ? `${scope} [data-auto-block="${CSS.escape(id)}"] { opacity: 0.3; }` : `${scope} [data-auto-block="${CSS.escape(id)}"] { display: none !important; }`)
    el.textContent = rules.join('\n')
  }, [saved, found, feature, enabled, editing])

  // the Layout tool follows the blocks as the page scrolls or resizes
  useEffect(() => {
    if (!editing) return
    const t = window.setInterval(() => setTick((x) => x + 1), 400)
    const on = () => setTick((x) => x + 1)
    window.addEventListener('scroll', on, true)
    window.addEventListener('resize', on)
    return () => {
      window.clearInterval(t)
      window.removeEventListener('scroll', on, true)
      window.removeEventListener('resize', on)
    }
  }, [editing])

  if (!editing || !enabled || !feature || !found.length) return null
  const hidden = (id: string) => Boolean(saved?.hidden.includes(id))
  void tick
  return createPortal(
    <div className="sf-auto-layer">
      {found.map((b) => {
        const r = b.el.getBoundingClientRect()
        if (!r.width || !r.height) return null
        const group = b.el.hasAttribute('data-auto-group')
        const canDrop = dragging && dragging !== b && dragging.container === b.container
        return (
          <div
            key={b.id}
            className={`sf-auto-box ${group ? 'group' : ''} ${hidden(b.id) ? 'is-hidden' : ''} ${canDrop ? 'can-drop' : ''} ${dragging === b ? 'is-dragging' : ''}`}
            style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
            draggable
            onDragStart={(e) => {
              setDragging(b)
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', b.id)
            }}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => {
              if (canDrop) e.preventDefault()
            }}
            onDrop={(e) => {
              e.preventDefault()
              const from = dragging
              setDragging(null)
              if (!from || from === b || from.container !== b.container) return
              const across = b.container !== 'page'
              const before = across ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2
              void apply([{ type: 'block-move', page: feature, block: from.id, position: before ? 'before' : 'after', ref: b.id }])
            }}
          >
            <div className="sf-auto-label">
              <span>⠿ {b.title}</span>
              <button onClick={() => void apply([{ type: 'block-visibility', page: feature, block: b.id, visible: hidden(b.id) }])}>{hidden(b.id) ? 'mostrar' : 'ocultar'}</button>
            </div>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
