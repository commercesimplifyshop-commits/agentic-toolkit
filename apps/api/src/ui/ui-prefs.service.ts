import { BadRequestException, Injectable } from '@nestjs/common'
import fs from 'node:fs'
import path from 'node:path'
import { Subject } from 'rxjs'
import { CORE_DIR } from '../config/paths'
import { contrastChecks, styleGuide } from './style-guide'
import { CSS_MAP, findBy, THEME_TOKENS, UI_FEATURES, UI_PAGES, type UiPage } from './ui-catalog'

export interface UiPrefs {
  /** Features turned off (sidebar ids) */
  disabled: string[]
  /** Per page: the order of the blocks and the hidden ones */
  pages: Record<string, { order: string[]; hidden: string[] }>
  /** New names of features (menu and page title), by feature id */
  labels: Record<string, string>
  /** Any visible text of the app replaced by another (exact text, as it shows on the screen) */
  texts: { from: string; to: string }[]
  /** Theme tokens (CSS variables) changed, by token id */
  theme: Record<string, string>
  /** The sidebar: the order of the features and the section each one is in */
  menu: { order: string[]; sections: Record<string, string> }
  /** Custom CSS, for what no preference covers */
  css: string
  updatedAt?: string
  /** Who made the last change: the person on the screen, the assistant or an AI through the MCP */
  updatedBy?: UiActor
}

export type UiActor = 'tela' | 'assistente' | 'mcp'
type Position = 'top' | 'bottom' | 'up' | 'down' | 'before' | 'after'

/**
 * One change to the interface. The settings screen, the in-app assistant and the MCP tools all go
 * through these, so whatever the source, only these changes are possible and each one is validated.
 */
export type UiAction =
  | { type: 'feature'; feature: string; enabled: boolean }
  | { type: 'block-visibility'; page: string; block: string; visible: boolean }
  | { type: 'block-move'; page: string; block: string; position: Position; ref?: string }
  | { type: 'rename'; feature: string; title: string | null }
  | { type: 'text'; from: string; to: string | null }
  | { type: 'theme'; token: string; value: string | null }
  | { type: 'menu-move'; feature: string; position?: Position; ref?: string; section?: string }
  | { type: 'css'; css: string | null; mode?: 'replace' | 'append' }
  | { type: 'reset'; scope: string }
  | { type: 'undo' }

const FILE = path.join(CORE_DIR, 'ui-preferences.json')
const HISTORY = path.join(CORE_DIR, 'ui-preferences.history.json')
/** The blocks the screens found on the pages that do not declare their own (every page but the overview) */
const FOUND = path.join(CORE_DIR, 'ui-blocks.json')
const BLOCK_ID = /^[a-z0-9][a-z0-9-]{0,59}$/
const MAX_HISTORY = 40
const EMPTY = (): UiPrefs => ({ disabled: [], pages: {}, labels: {}, texts: [], theme: {}, menu: { order: [], sections: {} }, css: '' })

const COLOR = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([\d\s.,%/-]{3,60}\)|[a-z]{3,20})$/i
const LENGTH = /^\d{1,3}(\.\d{1,2})?(px|rem|em|%)$/
const FONT = /^[\w\s,'"-]{1,120}$/
/** Custom CSS is styling only: nothing that loads or runs anything */
const CSS_FORBIDDEN = /@import|url\s*\(|expression\s*\(|javascript:|behavior\s*:|-moz-binding|<\/?style|<\/?script/i
const MAX_CSS = 20_000

const moveIn = (list: string[], id: string, position: Position, ref?: string) => {
  const at = list.indexOf(id)
  const rest = list.filter((x) => x !== id)
  let i: number
  if (position === 'top') i = 0
  else if (position === 'bottom') i = rest.length
  else if (position === 'up') i = Math.max(0, at - 1)
  else if (position === 'down') i = Math.min(rest.length, at + 1)
  else if (position === 'before' || position === 'after') {
    if (!ref || ref === id || !rest.includes(ref)) throw new BadRequestException('Informe outro item como referência')
    i = rest.indexOf(ref) + (position === 'after' ? 1 : 0)
  } else throw new BadRequestException(`Posição inválida: ${String(position)} (use top, bottom, up, down, before ou after)`)
  rest.splice(i, 0, id)
  return rest
}

@Injectable()
export class UiPrefsService {
  /** Each change, for the screens that are open (server-sent events) */
  readonly changes = new Subject<UiPrefs>()

  read(): UiPrefs {
    try {
      const p = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<UiPrefs>
      const e = EMPTY()
      return {
        ...e,
        ...p,
        disabled: (p.disabled ?? []).filter((id) => UI_FEATURES.some((f) => f.id === id && !f.locked)),
        pages: p.pages ?? {},
        labels: p.labels ?? {},
        texts: p.texts ?? [],
        theme: p.theme ?? {},
        menu: { order: p.menu?.order ?? [], sections: p.menu?.sections ?? {} },
        css: p.css ?? '',
      }
    } catch {
      return EMPTY()
    }
  }

  private history(): UiPrefs[] {
    try {
      return JSON.parse(fs.readFileSync(HISTORY, 'utf8')) as UiPrefs[]
    } catch {
      return []
    }
  }

  private write(p: UiPrefs, by: UiActor, remember = true) {
    if (remember) {
      // the state before the change, so it can be undone
      const h = [...this.history(), this.read()].slice(-MAX_HISTORY)
      fs.writeFileSync(HISTORY, JSON.stringify(h))
    }
    const next = { ...p, updatedAt: new Date().toISOString(), updatedBy: by }
    fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(next, null, 2))
    fs.renameSync(`${FILE}.tmp`, FILE)
    this.changes.next(next)
    return next
  }

  /** The pages with blocks: the declared ones, and those whose blocks the screens found */
  private allPages(): UiPage[] {
    let found: Record<string, { title: string; techs: UiPage['techs']; blocks: { id: string; title: string; container?: string }[] }> = {}
    try {
      found = JSON.parse(fs.readFileSync(FOUND, 'utf8'))
    } catch {
      // nothing found yet
    }
    const declared = new Set(UI_PAGES.map((p) => p.id))
    return [...UI_PAGES, ...Object.entries(found).filter(([id]) => !declared.has(id)).map(([id, p]) => ({ id, ...p }))]
  }

  /**
   * The blocks a screen found on a page (its sections and cards, named by their titles). The page is
   * a feature of the menu; what is found replaces what was found before for that page.
   */
  registerBlocks(pageId: unknown, blocks: unknown) {
    const feature = UI_FEATURES.find((f) => f.id === pageId)
    if (!feature) throw new BadRequestException('Página desconhecida')
    if (UI_PAGES.some((p) => p.id === feature.id)) return { ok: true }
    if (!Array.isArray(blocks) || blocks.length > 60) throw new BadRequestException('Blocos inválidos (até 60)')
    const list = blocks.map((b) => {
      const x = (b ?? {}) as Record<string, unknown>
      const id = String(x.id ?? '')
      const container = String(x.container ?? 'page')
      if (!BLOCK_ID.test(id) || !BLOCK_ID.test(container)) throw new BadRequestException(`Bloco inválido: ${id}`)
      return { id, title: String(x.title ?? id).slice(0, 120), container }
    })
    let found: Record<string, unknown> = {}
    try {
      found = JSON.parse(fs.readFileSync(FOUND, 'utf8'))
    } catch {
      // first page found
    }
    found[feature.id] = { title: feature.title, techs: feature.techs, blocks: list }
    fs.writeFileSync(FOUND, JSON.stringify(found, null, 2))
    return { ok: true }
  }

  /** The catalog and the preferences, as the screens and the AI see them */
  view() {
    const prefs = this.read()
    return {
      prefs,
      features: UI_FEATURES.map((f) => ({ ...f, title: prefs.labels[f.id] ?? f.title, originalTitle: f.title, section: prefs.menu.sections[f.id] ?? f.section, enabled: !prefs.disabled.includes(f.id) })),
      pages: this.allPages().map((p) => ({ id: p.id, title: p.title, techs: p.techs, blocks: this.blocksOf(p, prefs) })),
      theme: THEME_TOKENS.map((t) => ({ ...t, current: prefs.theme[t.id] ?? t.value, changed: prefs.theme[t.id] !== undefined })),
      cssMap: CSS_MAP,
      canUndo: this.history().length > 0,
    }
  }

  /** The style guide of the current theme (Markdown and data) */
  styleGuide() {
    const p = this.read()
    return styleGuide(p.theme, p.css)
  }

  /** The blocks of a page in the order they show, with the hidden ones marked */
  private blocksOf(page: UiPage, prefs: UiPrefs) {
    const saved = prefs.pages[page.id]
    const ids = page.blocks.map((b) => b.id)
    const order = [...(saved?.order ?? []).filter((id) => ids.includes(id)), ...ids.filter((id) => !saved?.order?.includes(id))]
    return order.map((id) => ({ ...page.blocks.find((b) => b.id === id)!, visible: !saved?.hidden.includes(id) }))
  }

  private page(q: string) {
    const pages = this.allPages()
    const page = findBy(pages, q)
    if (!page) throw new BadRequestException(`Página "${q}" sem blocos conhecidos. Os blocos de uma página aparecem depois que ela é aberta no app. Páginas com blocos: ${pages.map((p) => `${p.id} (${p.title})`).join(', ')}`)
    return page
  }

  private block(page: UiPage, q: string) {
    const block = findBy(page.blocks, q)
    if (!block) throw new BadRequestException(`Bloco "${q}" não existe em ${page.title}. Blocos: ${page.blocks.map((b) => `${b.id} (${b.title})`).join(', ')}`)
    return block
  }

  /** A feature by id, original title or the new name the person gave it */
  private feature(q: string, prefs: UiPrefs) {
    const f = findBy(UI_FEATURES, q) ?? findBy(UI_FEATURES.map((x) => ({ ...x, title: prefs.labels[x.id] ?? x.title })), q)
    if (!f) throw new BadRequestException(`Funcionalidade "${q}" não existe. Use uma destas: ${UI_FEATURES.map((x) => `${x.id} (${prefs.labels[x.id] ?? x.title})`).join(', ')}`)
    return UI_FEATURES.find((x) => x.id === f.id)!
  }

  /** Puts back the state before the last change */
  undo(by: UiActor) {
    const h = this.history()
    const last = h.pop()
    if (!last) throw new BadRequestException('Não há mudança para desfazer')
    fs.writeFileSync(HISTORY, JSON.stringify(h))
    // what went back, so whoever asked can say it
    const now = this.read()
    const parts: [keyof UiPrefs, string][] = [
      ['disabled', 'funcionalidades ativas'],
      ['pages', 'blocos das páginas'],
      ['labels', 'nomes das funcionalidades'],
      ['texts', 'textos trocados'],
      ['theme', 'tema'],
      ['menu', 'menu'],
      ['css', 'CSS personalizado'],
    ]
    const changed = parts.filter(([k]) => JSON.stringify(now[k]) !== JSON.stringify(last[k])).map(([, label]) => label)
    return { done: [`Desfeito: ${changed.join(', ') || 'nada mudou'}`], prefs: this.write(last, by, false) }
  }

  /** Applies the changes in order; each one is validated, and nothing is written if any is invalid */
  apply(actions: UiAction[], by: UiActor) {
    if (!Array.isArray(actions) || actions.length === 0) throw new BadRequestException('Nenhuma mudança informada')
    if (actions.length > 40) throw new BadRequestException('Mudanças demais de uma vez (máx. 40)')
    if (actions.some((a) => a?.type === 'undo')) {
      if (actions.length > 1) throw new BadRequestException('Desfazer vai sozinho, sem outras mudanças')
      return this.undo(by)
    }
    const prefs = this.read()
    const done: string[] = []
    for (const a of actions) {
      switch (a?.type) {
        case 'feature': {
          const f = this.feature(String(a.feature ?? ''), prefs)
          if (f.locked && !a.enabled) throw new BadRequestException(`${f.title} não pode ser desativada`)
          prefs.disabled = a.enabled ? prefs.disabled.filter((id) => id !== f.id) : [...new Set([...prefs.disabled, f.id])]
          done.push(`${prefs.labels[f.id] ?? f.title}: ${a.enabled ? 'ativada' : 'desativada'}`)
          break
        }
        case 'block-visibility':
        case 'block-move': {
          const page = this.page(String(a.page ?? ''))
          const block = this.block(page, String(a.block ?? ''))
          const order = this.blocksOf(page, prefs).map((b) => b.id)
          const saved = prefs.pages[page.id] ?? { order, hidden: [] }
          if (a.type === 'block-visibility') {
            saved.hidden = a.visible ? saved.hidden.filter((id) => id !== block.id) : [...new Set([...saved.hidden, block.id])]
            done.push(`${page.title} › ${block.title}: ${a.visible ? 'visível' : 'oculto'}`)
          } else {
            // blocks found on the page move among the blocks of their own group
            const ref = a.ref ? this.block(page, String(a.ref)) : undefined
            if (ref && (ref.container ?? 'page') !== (block.container ?? 'page')) throw new BadRequestException(`${block.title} e ${ref.title} estão em grupos diferentes da página: um bloco se move só dentro do seu grupo`)
            const peers = order.filter((id) => (page.blocks.find((b) => b.id === id)?.container ?? 'page') === (block.container ?? 'page'))
            const moved = moveIn(peers, block.id, a.position, ref?.id)
            let k = 0
            saved.order = order.map((id) => (peers.includes(id) ? moved[k++] : id))
            done.push(`${page.title} › ${block.title}: movido (${a.position}${a.ref ? ` ${a.ref}` : ''})`)
          }
          prefs.pages[page.id] = { order: saved.order.length ? saved.order : order, hidden: saved.hidden }
          break
        }
        case 'rename': {
          const f = this.feature(String(a.feature ?? ''), prefs)
          const title = typeof a.title === 'string' ? a.title.trim() : ''
          if (title && title.length > 60) throw new BadRequestException('Nome de até 60 caracteres')
          if (title && title !== f.title) prefs.labels[f.id] = title
          else delete prefs.labels[f.id]
          done.push(title && title !== f.title ? `${f.title} agora se chama "${title}"` : `${f.title}: nome original`)
          break
        }
        case 'text': {
          const from = String(a.from ?? '').trim()
          if (!from || from.length > 200) throw new BadRequestException('Informe o texto exato que aparece na tela (até 200 caracteres)')
          prefs.texts = prefs.texts.filter((t) => t.from !== from)
          if (a.to !== null && a.to !== undefined) {
            const to = String(a.to)
            if (to.length > 200) throw new BadRequestException('Texto novo de até 200 caracteres')
            if (prefs.texts.length >= 200) throw new BadRequestException('Limite de 200 textos trocados')
            prefs.texts.push({ from, to })
          }
          done.push(a.to === null || a.to === undefined ? `Texto "${from}" voltou ao original` : `"${from}" → "${a.to}"`)
          break
        }
        case 'theme': {
          const t = THEME_TOKENS.find((x) => x.id === a.token || x.variable === a.token) ?? findBy(THEME_TOKENS, String(a.token ?? ''))
          if (!t) throw new BadRequestException(`Item de tema desconhecido: ${a.token}. Use um destes: ${THEME_TOKENS.map((x) => `${x.id} (${x.title})`).join(', ')}`)
          if (a.value === null || a.value === undefined || a.value === '') {
            delete prefs.theme[t.id]
            done.push(`${t.title}: padrão`)
            break
          }
          const v = String(a.value).trim()
          const ok = t.kind === 'color' ? COLOR.test(v) : t.kind === 'length' ? LENGTH.test(v) : FONT.test(v)
          if (!ok) throw new BadRequestException(`Valor inválido para ${t.title}: ${v} (${t.kind === 'color' ? 'use uma cor, ex.: #2563eb' : t.kind === 'length' ? 'use um tamanho, ex.: 14px' : 'use nomes de fonte'})`)
          prefs.theme[t.id] = v
          done.push(`${t.title}: ${v}`)
          break
        }
        case 'menu-move': {
          const f = this.feature(String(a.feature ?? ''), prefs)
          if (a.section !== undefined) {
            const section = String(a.section).trim()
            if (section.length > 40) throw new BadRequestException('Nome de seção de até 40 caracteres')
            if (section && section !== f.section) prefs.menu.sections[f.id] = section
            else delete prefs.menu.sections[f.id]
            done.push(`${prefs.labels[f.id] ?? f.title}: seção "${section || f.section}"`)
          }
          if (a.position) {
            const current = [...prefs.menu.order.filter((id) => UI_FEATURES.some((x) => x.id === id)), ...UI_FEATURES.map((x) => x.id).filter((id) => !prefs.menu.order.includes(id))]
            const ref = a.ref ? this.feature(String(a.ref), prefs).id : undefined
            prefs.menu.order = moveIn(current, f.id, a.position, ref)
            done.push(`${prefs.labels[f.id] ?? f.title}: movido no menu (${a.position}${a.ref ? ` ${a.ref}` : ''})`)
          }
          if (a.section === undefined && !a.position) throw new BadRequestException('Informe a posição ou a seção')
          break
        }
        case 'css': {
          const css = a.css === null || a.css === undefined ? '' : String(a.css)
          if (CSS_FORBIDDEN.test(css)) throw new BadRequestException('O CSS personalizado não pode carregar nem executar nada (sem @import, url(), expression ou scripts)')
          const next = a.mode === 'append' && css ? `${prefs.css}\n${css}`.trim() : css
          if (next.length > MAX_CSS) throw new BadRequestException(`CSS personalizado de até ${MAX_CSS} caracteres`)
          if ((next.match(/{/g) ?? []).length !== (next.match(/}/g) ?? []).length) throw new BadRequestException('CSS com chaves desbalanceadas')
          prefs.css = next
          done.push(next ? `CSS personalizado ${a.mode === 'append' ? 'acrescentado' : 'atualizado'} (${next.length} caracteres)` : 'CSS personalizado removido')
          break
        }
        case 'reset': {
          const scope = String(a.scope ?? 'tudo')
          const e = EMPTY()
          const scopes: Record<string, () => void> = {
            tudo: () => Object.assign(prefs, e),
            funcionalidades: () => (prefs.disabled = []),
            textos: () => ((prefs.texts = []), (prefs.labels = {})),
            tema: () => (prefs.theme = {}),
            menu: () => (prefs.menu = e.menu),
            css: () => (prefs.css = ''),
          }
          const alias: Record<string, string> = { all: 'tudo', features: 'funcionalidades', nomes: 'textos', cores: 'tema' }
          const key = alias[scope] ?? scope
          if (scopes[key]) {
            scopes[key]()
            done.push(key === 'tudo' ? 'Interface restaurada ao padrão' : `${key}: padrão`)
          } else {
            const page = this.page(scope)
            delete prefs.pages[page.id]
            done.push(`${page.title}: blocos no padrão`)
          }
          break
        }
        default:
          throw new BadRequestException(`Mudança desconhecida: ${JSON.stringify(a).slice(0, 120)}`)
      }
    }
    // a theme change that makes text hard to read is applied, but said
    if (actions.some((a) => a?.type === 'theme')) {
      for (const c of contrastChecks(prefs.theme)) if (c.ok === false) done.push(`Atenção: ${c.label} ficou com contraste ${c.ratio}:1 (mínimo ${c.min}:1), difícil de ler`)
    }
    return { done, prefs: this.write(prefs, by) }
  }
}
