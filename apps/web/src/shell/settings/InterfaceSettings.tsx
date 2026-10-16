import { Marked } from 'marked'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { useDevMode } from '../devmode'
import { useUi, type UiAction } from '../ui-prefs'

/** The style guide comes from the server in Markdown, with no raw HTML */
const md = new Marked({ gfm: true, renderer: { html: ({ text }: { text: string }) => text.replace(/</g, '&lt;').replace(/>/g, '&gt;') } })

const BY: Record<string, string> = { tela: 'nesta tela', assistente: 'pelo assistente', mcp: 'por uma IA via MCP' }

/**
 * Configurações → Interface: the features of the menu and the blocks of the pages. The same changes
 * the global assistant and an AI connected through the MCP make.
 */
export function InterfaceSettings({ tech }: { tech?: string }) {
  const { loaded, features, pages, prefs, theme, canUndo, load, apply } = useUi()
  const [msg, setMsg] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [css, setCss] = useState<string | null>(null)
  const dev = useDevMode()
  const [guide, setGuide] = useState('')
  // the guide follows the theme: measured again after each change
  useEffect(() => {
    api.get<{ markdown: string }>('/ui/style-guide').then((g) => setGuide(g.markdown)).catch(() => undefined)
  }, [prefs.theme, prefs.css])
  useEffect(() => {
    if (!loaded) load().catch(() => undefined)
  }, [loaded, load])

  const run = async (actions: UiAction[]) => {
    try {
      setMsg((await apply(actions)).join(' · '))
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  if (!loaded) return <div className="sf-card"><span className="sf-spinner" /></div>
  const mine = features.filter((f) => !tech || f.techs.length === 0 || f.techs.includes(tech))
  const sections = [...new Set(mine.map((f) => f.section))]
  const myPages = pages.filter((p) => !tech || p.techs.length === 0 || p.techs.includes(tech))

  return (
    <div className="sf-card">
      <div className="sf-card-head">
        <div>
          <h2>Interface</h2>
          <span className="sub" style={{ marginBottom: 0 }}>
            Nomes, textos, cores, menu, blocos das páginas e CSS. Também dá para pedir ao assistente (botão ✦ ou Ctrl+K) ou a uma IA conectada pelo MCP; tudo pode ser desfeito.
            {prefs.updatedAt ? ` Última mudança ${BY[prefs.updatedBy ?? 'tela'] ?? ''} em ${new Date(prefs.updatedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.` : ''}
          </span>
        </div>
        <div className="sf-row" style={{ gap: 6 }}>
          <label className="sf-switch" title="Barra flutuante para arrastar blocos, editar textos, cores e CSS direto na tela (Ctrl+Shift+D)">
            <input type="checkbox" checked={dev.on} onChange={(e) => dev.setOn(e.target.checked)} />
            <span>Modo desenvolvedor</span>
          </label>
          <button className="sf-btn small" disabled={!canUndo} onClick={() => run([{ type: 'undo' }])} title="Desfaz a última mudança, venha de onde vier">
            ↶ Desfazer
          </button>
          <button className="sf-btn small" onClick={() => window.confirm('Voltar toda a interface ao padrão (nomes, textos, tema, menu, blocos e CSS)?') && run([{ type: 'reset', scope: 'tudo' }])}>
            Restaurar padrão
          </button>
        </div>
      </div>

      <div className="sf-ui-cols">
        <div>
          <h3>Funcionalidades</h3>
          {sections.map((section) => (
            <div key={section} className="sf-ui-group">
              <div className="sf-side-section" style={{ padding: '6px 0 2px' }}>
                {section}
              </div>
              {mine
                .filter((f) => f.section === section)
                .map((f) => (
                  <label key={f.id} className={`sf-ui-toggle ${f.locked ? 'locked' : ''}`} title={f.description}>
                    <input type="checkbox" checked={f.enabled} disabled={f.locked} onChange={(e) => run([{ type: 'feature', feature: f.id, enabled: e.target.checked }])} />
                    <span style={{ flex: 1 }}>
                      <strong>
                        {f.title}
                        {f.title !== f.originalTitle && <em className="sf-faint sf-no-custom"> · era “{f.originalTitle}”</em>}
                      </strong>
                      <small>{f.locked ? 'Fixa. ' : ''}{f.description}</small>
                    </span>
                    <button
                      className="sf-ui-mini"
                      title="Renomear"
                      onClick={(e) => {
                        e.preventDefault()
                        const name = window.prompt(`Novo nome para "${f.title}" (vazio volta ao original):`, f.title)
                        if (name !== null) void run([{ type: 'rename', feature: f.id, title: name.trim() || null }])
                      }}
                    >
                      ✎
                    </button>
                  </label>
                ))}
            </div>
          ))}
        </div>
        <div>
          <h3>Blocos das páginas</h3>
          {myPages.length === 0 && <div className="sf-empty">Nenhuma página desta tecnologia tem blocos configuráveis ainda.</div>}
          {myPages.map((p) => (
            <div key={p.id} className="sf-ui-group">
              <div className="sf-row" style={{ justifyContent: 'space-between' }}>
                <strong style={{ fontSize: 13 }}>{p.title}</strong>
                <button className="sf-link" style={{ fontSize: 12 }} onClick={() => run([{ type: 'reset', scope: p.id }])}>
                  padrão
                </button>
              </div>
              {p.blocks.map((b, i) => (
                <div key={b.id} className={`sf-ui-block ${b.visible ? '' : 'off'}`}>
                  <span className="sf-faint">{i + 1}</span>
                  <span style={{ flex: 1 }}>{b.title}</span>
                  <button className="sf-ui-mini" disabled={i === 0} title="Subir" onClick={() => run([{ type: 'block-move', page: p.id, block: b.id, position: 'up' }])}>
                    ↑
                  </button>
                  <button className="sf-ui-mini" disabled={i === p.blocks.length - 1} title="Descer" onClick={() => run([{ type: 'block-move', page: p.id, block: b.id, position: 'down' }])}>
                    ↓
                  </button>
                  <button className="sf-ui-mini" title={b.visible ? 'Ocultar' : 'Mostrar'} onClick={() => run([{ type: 'block-visibility', page: p.id, block: b.id, visible: !b.visible }])}>
                    {b.visible ? '◉' : '○'}
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="sf-ui-cols" style={{ marginTop: 18 }}>
        <div>
          <h3>Tema</h3>
          <span className="sub">Cores, fonte e tamanhos de todo o app.</span>
          {guide && (
            <details className="sf-style-guide sf-no-custom">
              <summary>Guia de estilo do tema atual (onde cada cor aparece, regras e contraste)</summary>
              <div dangerouslySetInnerHTML={{ __html: md.parse(guide) as string }} />
            </details>
          )}
          <div className="sf-ui-theme">
            {theme.map((t) => (
              <label key={t.id} className="sf-ui-token" title={t.variable}>
                {t.kind === 'color' && /^#[0-9a-f]{6}$/i.test(t.current) ? (
                  <input type="color" value={t.current} onChange={(e) => run([{ type: 'theme', token: t.id, value: e.target.value }])} />
                ) : (
                  <input
                    className="sf-input sf-mono"
                    defaultValue={t.current}
                    key={t.current}
                    onBlur={(e) => e.target.value.trim() !== t.current && run([{ type: 'theme', token: t.id, value: e.target.value.trim() || null }])}
                  />
                )}
                <span style={{ flex: 1 }}>{t.title}</span>
                {t.changed && (
                  <button className="sf-ui-mini" title="Voltar ao padrão" onClick={(e) => (e.preventDefault(), void run([{ type: 'theme', token: t.id, value: null }]))}>
                    ↺
                  </button>
                )}
              </label>
            ))}
          </div>
        </div>
        <div>
          <h3>Textos trocados</h3>
          <span className="sub">Qualquer texto da tela, exatamente como aparece, trocado em todas as telas.</span>
          <div className="sf-no-custom">
            {prefs.texts.length === 0 && <div className="sf-empty">Nenhum texto trocado.</div>}
            {prefs.texts.map((t) => (
              <div key={t.from} className="sf-ui-block">
                <span style={{ flex: 1 }}>
                  “{t.from}” → <strong>“{t.to}”</strong>
                </span>
                <button className="sf-ui-mini" title="Voltar ao original" onClick={() => run([{ type: 'text', from: t.from, to: null }])}>
                  ×
                </button>
              </div>
            ))}
            <form
              className="sf-row"
              style={{ gap: 6, marginTop: 8 }}
              onSubmit={(e) => {
                e.preventDefault()
                if (from.trim()) void run([{ type: 'text', from: from.trim(), to }]).then(() => (setFrom(''), setTo('')))
              }}
            >
              <input className="sf-input" placeholder="Texto atual" value={from} onChange={(e) => setFrom(e.target.value)} />
              <input className="sf-input" placeholder="Texto novo" value={to} onChange={(e) => setTo(e.target.value)} />
              <button className="sf-btn small" disabled={!from.trim()}>
                Trocar
              </button>
            </form>
          </div>

          <h3 style={{ marginTop: 16 }}>CSS personalizado</h3>
          <span className="sub">Para o que as opções acima não cobrem. Só estilo: sem @import, url() ou scripts.</span>
          <textarea className="sf-input sf-mono" rows={7} style={{ width: '100%', resize: 'vertical' }} value={css ?? prefs.css} onChange={(e) => setCss(e.target.value)} placeholder={'[data-block="stack"] .sf-card { border-color: var(--sf-accent); }'} />
          <div className="sf-row" style={{ gap: 6, marginTop: 6 }}>
            <button className="sf-btn small" disabled={css === null || css === prefs.css} onClick={() => run([{ type: 'css', css: css ?? '', mode: 'replace' }]).then(() => setCss(null))}>
              Aplicar CSS
            </button>
            {prefs.css && (
              <button className="sf-btn small" onClick={() => run([{ type: 'css', css: null }]).then(() => setCss(null))}>
                Remover
              </button>
            )}
          </div>
        </div>
      </div>
      {msg && <div className="sf-muted" style={{ fontSize: 12.5, marginTop: 8 }}>{msg}</div>}
    </div>
  )
}
