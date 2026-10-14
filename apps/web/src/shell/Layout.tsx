import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { FEATURE_NEEDS, PrereqNotice } from './prereqs'
import { IdeLayer } from './ide/IdeLayer'
import { initials, useShell } from './store'

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
      { to: 'modules', label: 'Módulos & extensões', icon: '▦', count: (o) => ({ value: o.modules.byOrigin.custom }) },
      { to: 'integrations/api', label: 'APIs REST & GraphQL', icon: '⇄', count: (o) => ({ value: (o.integration.byKind.rest ?? 0) + (o.integration.byKind.graphql ?? 0) }) },
      { to: 'integrations/plugins', label: 'Plugins & preferences', icon: '⟲', count: (o) => ({ value: (o.integration.byKind.plugin ?? 0) + (o.integration.byKind.preference ?? 0) }) },
      { to: 'integrations/events', label: 'Eventos & observers', icon: '⚡', count: (o) => ({ value: o.integration.byKind.observer ?? 0 }) },
      { to: 'integrations/async', label: 'Crons & filas', icon: '◷', count: (o) => ({ value: (o.integration.byKind.cron ?? 0) + (o.integration.byKind.queue ?? 0) }) },
      { to: 'integrations/routes', label: 'Rotas & controllers', icon: '⌁', count: (o) => ({ value: o.integration.byKind.route ?? 0 }) },
    ],
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
      { to: 'sfcc/cartridges', label: 'Cartuchos & dependências', icon: '▦' },
      { to: 'sfcc/controllers', label: 'Controllers & rotas', icon: '⌁' },
      { to: 'sfcc/templates', label: 'Templates ISML', icon: '▤' },
      { to: 'sfcc/jobs', label: 'Jobs & agendamentos', icon: '◷' },
      { to: 'sfcc/services', label: 'Integrações & serviços', icon: '⇄' },
      { to: 'sfcc/sites', label: 'Sites & atributos', icon: '◉' },
    ],
  },
  {
    title: 'Instância',
    items: [{ to: 'sfcc/instance', label: 'Perfil da instância', icon: '☁' }],
  },
]

/** Adobe Commerce keeps its own menu; the shared sections are added to both */
function sectionsOf(tech?: string) {
  return tech === 'salesforce-b2c' ? SFCC_SECTIONS : SECTIONS
}

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
  const title = TITLES[sub] ?? (sub === 'atualizacao' ? 'Atualização do dia' : sub.startsWith('openspec/') ? 'OpenSpec' : sub.startsWith('refinamento/') ? 'Refinamento' : sub === 'audit' ? 'Regras & auditoria' : sub === 'settings' ? 'Configurações' : 'Visão geral')
  const fullBleed = ['flow', 'debug', 'ask', 'code', 'api-client', 'docs', 'board', 'diagrams'].includes(sub)

  return (
    <div className="sf-root">
      <aside className="sf-rail">
        <Link to="/" className="sf-rail-logo" title="Agentic Toolkit">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <path d="M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 2.3 6.6 3.7L12 11.7 5.4 8 12 4.3ZM5 9.7l6 3.4v6.6l-6-3.4V9.7Zm8 10v-6.6l6-3.4v6.6l-6 3.4Z" fill="currentColor" />
          </svg>
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
          {sectionsOf(ws?.tech).map((section, i) => (
            <div key={i}>
              {section.title && <div className="sf-side-section">{section.title}</div>}
              {section.items.map((item) => {
                const count = overview && item.count?.(overview)
                return (
                  <NavLink
                    key={item.to}
                    to={item.to ? `/w/${id}/${item.to}` : `/w/${id}`}
                    end={!item.to}
                    title={collapsed ? `${item.label}${count && count.value > 0 ? ` (${count.value})` : ''}` : undefined}
                    className={({ isActive }) => `sf-nav ${isActive ? 'active' : ''}`}
                  >
                    <span className="sf-nav-icon">{item.icon}</span>
                    <span className="sf-nav-label">{item.label}</span>
                    {count && count.value > 0 && <span className={`sf-nav-count ${count.tone ?? ''}`}>{count.value}</span>}
                  </NavLink>
                )
              })}
            </div>
          ))}
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
          <b>{title}</b>
        </div>
        {ws?.status === 'analyzed' && FEATURE_NEEDS[sub.split('/')[0]] && (
          <div className="sf-prereq-strip">
            <PrereqNotice workspaceId={id} feature={sub.split('/')[0]} />
          </div>
        )}
        <div className="sf-content" style={fullBleed ? { overflow: 'hidden' } : undefined}>
          {ws?.status === 'analyzed' && <Outlet />}
        </div>
      </main>
      {/* PhpStorm navigation (Shift Shift, Alt+N, Alt+Shift+N, Ctrl+Shift+F) on every page */}
      {ws?.status === 'analyzed' && <IdeLayer workspaceId={id} />}
    </div>
  )
}
