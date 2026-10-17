import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAssistantPanel, useDevMode, type DevTool } from '../devmode'
import { useUi, type UiAction } from '../ui-prefs'
import { originalText } from './UiCustomizer'

/** Never targeted by the text and CSS tools: the bar itself, the assistant and the fields */
const OWN = '.sf-devbar, .sf-assist, .sf-assist-fab, textarea, input, select'

const HINT: Record<Exclude<DevTool, null>, string> = {
  layout: 'Arraste um bloco para antes ou depois de outro do mesmo grupo (as seções da página, ou os cartões de uma linha); "ocultar" tira o bloco da tela. Vale para todas as páginas, menos as ferramentas de tela cheia.',
  texts: 'Clique em qualquer texto da tela para trocá-lo. Nos itens do menu, clicar renomeia a funcionalidade.',
  colors: 'Cores do tema. O contraste é conferido a cada mudança; o guia de estilo explica onde cada cor aparece.',
  css: 'Passe o mouse para ver o seletor de um elemento e clique para levá-lo ao CSS. Só estilo: sem @import, url() ou scripts.',
}

/** The stable selector of an element, for custom CSS: the block, the menu item, or its own classes inside the page */
function selectorOf(el: Element): string {
  const block = el.closest('[data-block]')
  const nav = el.closest('.sf-nav[data-feature]')
  if (nav) return `.sf-nav[data-feature="${nav.getAttribute('data-feature')}"]`
  const own = [...el.classList].filter((c) => c.startsWith('sf-')).slice(0, 2)
  const self = own.length ? `.${own.join('.')}` : el.tagName.toLowerCase()
  if (block) return block === el ? `[data-block="${block.getAttribute('data-block')}"]` : `[data-block="${block.getAttribute('data-block')}"] ${self}`
  const page = el.closest('.sf-content[data-feature]')
  return page ? `.sf-content[data-feature="${page.getAttribute('data-feature')}"] ${self}` : self
}

/**
 * The developer mode bar (Ctrl+Shift+D): the tools to customize the interface right on the page —
 * drag blocks, edit any text, colors, CSS with an inspector, undo — and the assistant for the rest.
 */
export function DevToolbar({ workspaceId, hideBar = false }: { workspaceId: string; hideBar?: boolean }) {
  const { on, tool, setOn, setTool } = useDevMode()
  const { theme, prefs, canUndo, apply } = useUi()
  const openAssistant = useAssistantPanel((s) => s.setOpen)
  const [msg, setMsg] = useState('')
  const [css, setCss] = useState<string | null>(null)
  const [hoverSel, setHoverSel] = useState('')

  const run = async (actions: UiAction[]) => {
    try {
      setMsg((await apply(actions)).join(' · '))
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  // Ctrl+Shift+D turns the developer mode on and off, from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        setOn(!useDevMode.getState().on)
      }
      if (e.key === 'Escape' && useDevMode.getState().tool) setTool(useDevMode.getState().tool)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOn, setTool])

  // the texts and CSS tools take over the clicks on the page (captured before the page sees them)
  useEffect(() => {
    if (!on || (tool !== 'texts' && tool !== 'css')) return
    document.body.classList.add(`sf-dev-${tool}`)
    let outlined: Element | null = null
    const onOver = (e: MouseEvent) => {
      const el = e.target as Element
      if (!(el instanceof Element) || el.closest(OWN)) return
      outlined?.classList.remove('sf-dev-outline')
      outlined = el
      el.classList.add('sf-dev-outline')
      if (tool === 'css') setHoverSel(selectorOf(el))
    }
    const onClick = (e: MouseEvent) => {
      const el = e.target as Element
      if (!(el instanceof Element) || el.closest(OWN) || !el.closest('.sf-root')) return
      e.preventDefault()
      e.stopPropagation()
      if (tool === 'css') {
        const sel = selectorOf(el)
        setCss((c) => `${c ?? prefs.css}${(c ?? prefs.css) ? '\n' : ''}${sel} {\n  \n}`)
        return
      }
      // texts: a menu item is renamed; anything else has its text replaced
      const nav = el.closest('.sf-nav[data-feature]')
      if (nav) {
        const feature = nav.getAttribute('data-feature')!
        const current = nav.querySelector('.sf-nav-label')?.textContent ?? ''
        const name = window.prompt(`Novo nome para "${current}" (vazio volta ao original):`, current)
        if (name !== null) void run([{ type: 'rename', feature, title: name.trim() || null }])
        return
      }
      const node = [...el.childNodes].find((n): n is Text => n.nodeType === Node.TEXT_NODE && Boolean(n.nodeValue?.trim()))
      if (!node) return setMsg('Clique direto sobre um texto (não num espaço vazio ou num ícone).')
      const from = originalText(node)
      const to = window.prompt(`Trocar "${node.nodeValue?.trim()}" por (vazio volta ao original):`, node.nodeValue?.trim() ?? '')
      if (to !== null) void run([{ type: 'text', from, to: to.trim() && to.trim() !== from ? to.trim() : null }])
    }
    document.addEventListener('mouseover', onOver, true)
    document.addEventListener('click', onClick, true)
    return () => {
      document.body.classList.remove(`sf-dev-${tool}`)
      outlined?.classList.remove('sf-dev-outline')
      document.removeEventListener('mouseover', onOver, true)
      document.removeEventListener('click', onClick, true)
      setHoverSel('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, tool])

  // the shortcut keeps working where the bar is hidden (the Studio)
  if (!on || hideBar) return null
  const colors = theme.filter((t) => t.kind === 'color')

  return (
    <div className="sf-devbar sf-no-custom" role="toolbar" aria-label="Modo desenvolvedor">
      {tool === 'colors' && (
        <div className="sf-devbar-pop">
          <div className="sf-devbar-colors">
            {colors.map((t) => (
              <label key={t.id} title={`${t.title} (${t.variable})`}>
                <input type="color" value={/^#[0-9a-f]{6}$/i.test(t.current) ? t.current : '#000000'} onChange={(e) => run([{ type: 'theme', token: t.id, value: e.target.value }])} />
                <span>{t.title.split(' (')[0]}</span>
                {t.changed && (
                  <button title="Voltar ao padrão" onClick={(e) => (e.preventDefault(), void run([{ type: 'theme', token: t.id, value: null }]))}>
                    ↺
                  </button>
                )}
              </label>
            ))}
          </div>
          <Link to={`/w/${workspaceId}/settings?secao=interface`}>Tema completo e guia de estilo →</Link>
        </div>
      )}
      {tool === 'css' && (
        <div className="sf-devbar-pop">
          <div className="sf-devbar-sel sf-mono">{hoverSel || 'Passe o mouse sobre um elemento da página'}</div>
          <textarea className="sf-input sf-mono" rows={8} value={css ?? prefs.css} onChange={(e) => setCss(e.target.value)} placeholder="Clique num elemento da página para trazer o seletor" />
          <div className="sf-row" style={{ gap: 6 }}>
            <button className="sf-btn small primary" disabled={css === null || css === prefs.css} onClick={() => run([{ type: 'css', css: css ?? '', mode: 'replace' }]).then(() => setCss(null))}>
              Aplicar
            </button>
            {css !== null && (
              <button className="sf-btn small" onClick={() => setCss(null)}>
                Descartar
              </button>
            )}
          </div>
        </div>
      )}
      <div className="sf-devbar-main">
        <strong>⚒ Modo desenvolvedor</strong>
        {(
          [
            ['layout', '⠿ Layout'],
            ['texts', 'T Textos'],
            ['colors', '◐ Cores'],
            ['css', '{ } CSS'],
          ] as [Exclude<DevTool, null>, string][]
        ).map(([id, label]) => (
          <button key={id} className={tool === id ? 'on' : ''} onClick={() => setTool(id)}>
            {label}
          </button>
        ))}
        <span className="sep" />
        <button disabled={!canUndo} onClick={() => run([{ type: 'undo' }])} title="Desfaz a última mudança de interface">
          ↶ Desfazer
        </button>
        <Link className="sf-devbar-link" to={`/w/${workspaceId}/studio`} title="Desenvolver o Agentic Toolkit: conversa com o Claude Code direto no código, com prévia">
          ⌘ Estúdio
        </Link>
        <button onClick={() => openAssistant(true)} title="Peça em linguagem natural (também cria e liga diagramas, tarefas, simulador)">
          ✦ Assistente
        </button>
        <button className="close" onClick={() => setOn(false)} title="Sair do modo desenvolvedor (Ctrl+Shift+D)">
          ×
        </button>
      </div>
      {(tool || msg) && <div className="sf-devbar-hint">{msg || HINT[tool!]}</div>}
    </div>
  )
}
