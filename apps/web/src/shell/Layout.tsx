import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { FEATURE_NEEDS, featureOf, PrereqNotice } from './prereqs'
import { IdeLayer } from './ide/IdeLayer'
import { LogoMark } from './Logo'
import { initials, useShell } from './store'
import { AutoBlocks } from './components/AutoBlocks'
import { DevToolbar } from './components/DevToolbar'
import { InterfaceAssistant } from './components/InterfaceAssistant'
import { featureOfPath, isEnabled, useUi, useUiCommands, type UiPrefs } from './ui-prefs'

interface NavItem {
  to: string
  label: string
  icon: string
  count?: (o: NonNullable<ReturnType<typeof useShell.getState>['overviews'][string]>) => { value: number; tone?: 'red' | 'orange' } | null
}

/** Sidebar features grouped by area. New features plug in here. */
const SECTIONS: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { to: '', label: 'Visão geral', icon: '◫' },
      { to: 'ask', label: 'Pergunte ao código', icon: '✦' },
    ],
  },
  {
    title: 'Desenvolvimento',
    items: [
      { to: 'code', label: 'Explorador de código', icon: '{ }' },
      { to: 'diagrams', label: 'Diagramas de arquitetura', icon: '⬡' },
      { to: 'openspec', label: 'OpenSpec', icon: '◎' },
      { to: 'refinamento', label: 'Refinamento', icon: '✓' },
      { to: 'git', label: 'Git', icon: '⎇' },
    ],
  },
  {
    title: 'Arquitetura',
    items: [
      { to: 'arquitetura-viva', label: 'Arquitetura viva', icon: '◉' },
      { to: 'modules', label: 'Módulos & extensões', icon: '▦', count: (o) => ({ value: o.modules.byOrigin.custom }) },
      { to: 'integrations/api', label: 'APIs REST & GraphQL', icon: '⇄', count: (o) => ({ value: (o.integration.byKind.rest ?? 0) + (o.integration.byKind.graphql ?? 0) }) },
      { to: 'integrations/plugins', label: 'Plugins & preferences', icon: '⟲', count: (o) => ({ value: (o.integration.byKind.plugin ?? 0) + (o.integration.byKind.preference ?? 0) }) },
      { to: 'integrations/events', label: 'Eventos & observers', icon: '⚡', count: (o) => ({ value: o.integration.byKind.observer ?? 0 }) },
      { to: 'integrations/async', label: 'Crons & filas', icon: '◷', count: (o) => ({ value: (o.integration.byKind.cron ?? 0) + (o.integration.byKind.queue ?? 0) }) },
      { to: 'integrations/routes', label: 'Rotas & controllers', icon: '⌁', count: (o) => ({ value: o.integration.byKind.route ?? 0 }) },
    ],
  },
  {
    title: 'IA',
    items: [{ to: 'ia/harness', label: 'Harness da IA', icon: '◇' }],
  },
  {
    title: 'Ferramentas & plugins',
    items: [
      { to: 'api-client', label: 'Simulador de API', icon: '➤' },
      { to: 'docs', label: 'Documentação', icon: '▤' },
      { to: 'board', label: 'Quadro branco', icon: '✎' },
    ],
  },
  {
    title: 'Fluxo de pedido',
    items: [
      { to: 'flow', label: 'Fluxo 3D', icon: '◈' },
      { to: 'debug', label: 'Debug de fluxo', icon: '⏵' },
    ],
  },
  {
    title: 'Qualidade & segurança',
    items: [
      { to: 'risks', label: 'Pontos de atenção', icon: '⚠', count: (o) => (o.integration.risks.alto ? { value: o.integration.risks.alto, tone: 'red' } : null) },
      { to: 'security', label: 'Segurança & patches', icon: '⛨', count: (o) => ({ value: o.highlights.filter((h) => h.level === 'critical').length, tone: 'red' }) },
    ],
  },
]

/** Salesforce B2C menu: its own architecture, and the same planning tools under Desenvolvimento */
const SFCC_SECTIONS: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { to: '', label: 'Visão geral', icon: '◫' },
      { to: 'ask', label: 'Pergunte ao código', icon: '✦' },
    ],
  },
  {
    title: 'Tutorial',
    items: [
      { to: 'tutorial', label: 'Como é uma solução', icon: '▶' },
      { to: 'tutorial/customizacoes', label: 'Customizações frequentes', icon: '✚' },
    ],
  },
  {
    title: 'Desenvolvimento',
    items: [
      { to: 'code', label: 'Explorador de código', icon: '{ }' },
      { to: 'diagrams', label: 'Diagramas de arquitetura', icon: '⬡' },
      { to: 'board', label: 'Quadro branco', icon: '✎' },
      { to: 'openspec', label: 'OpenSpec', icon: '◎' },
      { to: 'refinamento', label: 'Refinamento', icon: '✓' },
      { to: 'git', label: 'Git', icon: '⎇' },
      { to: 'api-client', label: 'Simulador de API', icon: '➤' },
    ],
  },
  {
    title: 'Arquitetura',
    items: [
      { to: 'arquitetura-viva', label: 'Arquitetura viva', icon: '◉' },
      { to: 'sfcc/cartridges', label: 'Cartuchos & dependências', icon: '▦' },
      { to: 'sfcc/controllers', label: 'Controllers & rotas', icon: '⌁' },
      { to: 'sfcc/templates', label: 'Templates ISML', icon: '▤' },
      { to: 'sfcc/jobs', label: 'Jobs & agendamentos', icon: '◷' },
      { to: 'sfcc/services', label: 'Integrações & serviços', icon: '⇄' },
      { to: 'sfcc/sites', label: 'Sites & atributos', icon: '◉' },
    ],
  },
  {
    title: 'IA',
    items: [{ to: 'ia/harness', label: 'Harness da IA', icon: '◇' }],
  },
  {
    title: 'Instância',
    items: [
      { to: 'sfcc/instance', label: 'Perfil da instância', icon: '☁' },
      { to: 'sfcc/upload', label: 'Upload para a instância', icon: '⇪' },
    ],
  },
]

/** Adobe Commerce keeps its own menu; the shared sections are added to both */
function sectionsOf(tech?: string) {
  return tech === 'salesforce-b2c' ? SFCC_SECTIONS : SECTIONS
}

/**
 * The menu as the person arranged it (Configurações → Interface, the assistant or the MCP): features
 * turned off leave it, each one may have a new name, another section and another place.
 */
function arrangedMenu(tech: string | undefined, prefs: UiPrefs) {
  const items = sectionsOf(tech).flatMap((section, si) =>
    section.items.map((item, ii) => ({ item, id: item.to || 'overview', section: section.title ?? '', base: si * 100 + ii })),
  )
  const order = prefs.menu.order
  const rank = (x: { id: string; base: number }) => {
    const i = order.indexOf(x.id)
    return i >= 0 ? i : order.length + x.base
  }
  const visible = items
    .filter((x) => isEnabled(prefs, x.id))
    .map((x) => ({ ...x, section: prefs.menu.sections[x.id] ?? x.section, label: prefs.labels[x.id] ?? x.item.label }))
    .sort((a, b) => (order.length ? rank(a) - rank(b) : a.base - b.base))
  // sections in the order of their first feature
  const groups = new Map<string, typeof visible>()
  for (const x of visible) groups.set(x.section, [...(groups.get(x.section) ?? []), x])
  return [...groups].map(([title, list]) => ({ title, items: list }))
}

/** Every sidebar path, to find the feature a page belongs to */
const FEATURE_IDS = [...new Set([...SECTIONS, ...SFCC_SECTIONS].flatMap((s) => s.items.map((i) => i.to || 'overview')))]

const TITLES: Record<string, string> = Object.fromEntries([...SECTIONS, ...SFCC_SECTIONS].flatMap((s) => s.items.map((i) => [i.to, i.label])))

const COLLAPSE_KEY = 'agentic-toolkit.sidebarCollapsed'

/** Per-viewer UI preference; storage may be unavailable (private mode), so never rely on it. */
function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

export function Layout() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { workspaces, loaded, refreshWorkspaces, loadOverview } = useShell()
  const overview = useShell((s) => s.overviews[id])
  const ws = workspaces.find((w) => w.id === id)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const prefs = useUi((s) => s.prefs)
  const uiNotice = useUi((s) => s.notice)
  const clearUiNotice = useUi((s) => s.clearNotice)
  const applyUi = useUi((s) => s.apply)

  // the assistant or an AI through the MCP opening a screen (a diagram, a card, the API simulator)
  const command = useUiCommands((s) => s.command)
  useEffect(() => {
    if (!command || Date.now() - command.at > 10_000) return
    if (command.type === 'navigate') navigate(`/w/${command.workspace}/${command.path}`)
    if (command.type === 'api-client-fill') navigate(`/w/${command.workspace}/api-client?route=${encodeURIComponent(command.routeId)}`)
  }, [command, navigate])

  // the interface preferences, kept in step with the assistant and the MCP while the app is open
  useEffect(() => {
    if (!uiNotice) return
    const t = window.setTimeout(clearUiNotice, 6000)
    return () => window.clearTimeout(t)
  }, [uiNotice, clearUiNotice])

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1')
      } catch {
        // preference just won't persist
      }
      return !c
    })

  useEffect(() => {
    if (!loaded) refreshWorkspaces()
  }, [loaded, refreshWorkspaces])

  useEffect(() => {
    if (!loaded) return
    if (!ws) return void navigate('/', { replace: true })
    if (ws.status !== 'analyzed') return void navigate(`/connect/${ws.id}`, { replace: true })
    loadOverview(id).catch(() => undefined)
  }, [loaded, ws, id, navigate, loadOverview])

  const sub = location.pathname.replace(`/w/${id}`, '').replace(/^\//, '')
  const title =
    TITLES[sub] ??
    (sub === 'atualizacao'
      ? 'Atualização do dia'
      : sub.startsWith('openspec/')
        ? 'OpenSpec'
        : sub.startsWith('refinamento/')
          ? 'Refinamento'
          : sub.startsWith('git/pr/')
            ? 'Pull request'
            : sub === 'audit'
              ? 'Regras & auditoria'
              : sub === 'settings'
                ? 'Configurações'
                : 'Visão geral')
  const feature = featureOfPath(sub, FEATURE_IDS)
  const featureOff = Boolean(feature && !isEnabled(prefs, feature))
  const fullBleed = ['flow', 'debug', 'ask', 'code', 'api-client', 'docs', 'board', 'diagrams', 'arquitetura-viva'].includes(sub)

  return (
    <div className="sf-root">
      <aside className="sf-rail">
        <Link to="/" className="sf-rail-logo" title="Agentic Toolkit">
          <LogoMark size={28} color="var(--sf-text)" />
        </Link>
        {workspaces
          .filter((w) => w.status === 'analyzed')
          .map((w) => (
            <Link key={w.id} to={`/w/${w.id}`} className={`sf-ws-avatar ${w.id === id ? 'active' : ''}`} title={`${w.name} · ${w.version ?? ''}`}>
              {initials(w.name)}
            </Link>
          ))}
        <Link to="/connect" className="sf-ws-add" title="Conectar outra instalação">
          +
        </Link>
        <Link to={`/w/${id}/atualizacao`} className="sf-ws-add sf-rail-foot" title="Atualização do dia" aria-label="Atualização do dia">
          ◷
        </Link>
      </aside>

      <nav className={`sf-sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sf-side-head">
          <div className="sf-side-title">
            <strong>{ws?.name ?? '…'}</strong>
            <span>
              {ws?.edition} {ws?.version}
            </span>
          </div>
          <button className="sf-collapse" onClick={toggleCollapsed} title={collapsed ? 'Expandir menu' : 'Recolher menu (só ícones)'} aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}>
            {collapsed ? '»' : '«'}
          </button>
        </div>
        <div className="sf-side-scroll">
          {arrangedMenu(ws?.tech, prefs).map((section) => {
            return (
              <div key={section.title || 'inicio'} data-section={section.title}>
                {section.title && <div className="sf-side-section">{section.title}</div>}
                {section.items.map(({ item, id: featureId, label }) => {
                  const count = overview && item.count?.(overview)
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to ? `/w/${id}/${item.to}` : `/w/${id}`}
                      end={!item.to}
                      data-feature={featureId}
                      title={collapsed ? `${label}${count && count.value > 0 ? ` (${count.value})` : ''}` : undefined}
                      className={({ isActive }) => `sf-nav ${isActive ? 'active' : ''}`}
                    >
                      <span className="sf-nav-icon">{item.icon}</span>
                      <span className="sf-nav-label">{label}</span>
                      {count && count.value > 0 && <span className={`sf-nav-count ${count.tone ?? ''}`}>{count.value}</span>}
                    </NavLink>
                  )
                })}
              </div>
            )
          })}
        </div>
        <div className="sf-side-foot">
          <NavLink to={`/w/${id}/audit`} title={collapsed ? 'Regras & auditoria' : undefined} className={({ isActive }) => `sf-nav ${isActive ? 'active' : ''}`}>
            <span className="sf-nav-icon">⛬</span>
            <span className="sf-nav-label">Regras & auditoria</span>
          </NavLink>
          <NavLink to={`/w/${id}/settings`} title={collapsed ? 'Configurações' : undefined} className={({ isActive }) => `sf-nav ${isActive ? 'active' : ''}`}>
            <span className="sf-nav-icon">⚙</span>
            <span className="sf-nav-label">Configurações</span>
          </NavLink>
          <NavLink to={`/w/${id}/audit`} className="sf-readonly-pill" title="Toda ação é declarada e auditada. Escrita no código só no Git e no desenvolvimento das tarefas, com confirmação.">
            <span className="dot" /> <span className="sf-nav-label">Ações auditadas</span>
          </NavLink>
        </div>
      </nav>

      <main className="sf-main">
        <div className="sf-topbar">
          <span>{ws?.name}</span>
          <span className="sep">›</span>
          <b>{(feature && prefs.labels[feature] && TITLES[sub] !== undefined ? prefs.labels[feature] : undefined) ?? title}</b>
        </div>
        {ws?.status === 'analyzed' && FEATURE_NEEDS[featureOf(sub)] && (
          <div className="sf-prereq-strip">
            <PrereqNotice workspaceId={id} feature={featureOf(sub)} />
          </div>
        )}
        <div className="sf-content" data-feature={feature ?? sub} style={fullBleed ? { overflow: 'hidden' } : undefined}>
          {ws?.status === 'analyzed' &&
            (featureOff ? (
              <div className="sf-page">
                <div className="sf-callout orange" style={{ maxWidth: 640 }}>
                  <strong>{TITLES[sub] ?? 'Esta funcionalidade'} está desativada.</strong> Ela saiu do menu em Configurações → Interface (ou pelo assistente). Os dados dela continuam guardados.
                  <div style={{ marginTop: 10 }}>
                    <button className="sf-btn primary" onClick={() => void applyUi([{ type: 'feature', feature: feature!, enabled: true }])}>
                      Reativar
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <Outlet />
            ))}
        </div>
      </main>
      {/* PhpStorm navigation (Shift Shift, Alt+N, Alt+Shift+N, Ctrl+Shift+F) on every page */}
      {ws?.status === 'analyzed' && <IdeLayer workspaceId={id} />}
      {ws?.status === 'analyzed' && <InterfaceAssistant workspaceId={id} />}
      {ws?.status === 'analyzed' && <DevToolbar workspaceId={id} />}
      {/* every page's sections and cards become blocks that can be moved and hidden (not the full-screen tools) */}
      {ws?.status === 'analyzed' && <AutoBlocks feature={feature} enabled={!fullBleed && !featureOff} />}
      {uiNotice && (
        <div className="sf-ui-toast" onClick={clearUiNotice}>
          {uiNotice}
        </div>
      )}
    </div>
  )
}
