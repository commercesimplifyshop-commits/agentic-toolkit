import { lazy, Suspense, useEffect } from 'react'
import { createBrowserRouter, Navigate, RouterProvider, useNavigate } from 'react-router-dom'
import { Layout } from './Layout'
import { AskPage } from './pages/AskPage'
import { AuditPage } from './pages/AuditPage'
import { ConnectPage } from './pages/ConnectPage'
import { IntegrationsPage } from './pages/IntegrationsPage'
import { ModulesPage } from './pages/ModulesPage'
import { OverviewPage } from './pages/OverviewPage'
import { RisksPage } from './pages/RisksPage'
import { SecurityPage } from './pages/SecurityPage'
import { SettingsPage } from './pages/SettingsPage'
import { useShell } from './store'
import { useParams } from 'react-router-dom'
import './shell.css'

// Three.js is heavy: the 3D feature loads only when opened
const FlowPage = lazy(() => import('./pages/FlowPage').then((m) => ({ default: m.FlowPage })))
const ApiClientPage = lazy(() => import('./pages/ApiClientPage').then((m) => ({ default: m.ApiClientPage })))
const DocsPage = lazy(() => import('./pages/DocsPage').then((m) => ({ default: m.DocsPage })))
const BoardPage = lazy(() => import('./pages/BoardPage').then((m) => ({ default: m.BoardPage })))
const DiagramsPage = lazy(() => import('./pages/DiagramsPage').then((m) => ({ default: m.DiagramsPage })))
const OpenSpecPage = lazy(() => import('./pages/OpenSpecPage').then((m) => ({ default: m.OpenSpecPage })))
const OpenSpecChangePage = lazy(() => import('./pages/OpenSpecChangePage').then((m) => ({ default: m.OpenSpecChangePage })))
const CodePage = lazy(() => import('./pages/CodePage').then((m) => ({ default: m.CodePage })))
const SfccPage = lazy(() => import('./pages/SfccPages').then((m) => ({ default: m.SfccPage })))
const loading = <div className="sf-page"><span className="sf-spinner" /></div>

/** Sends the user to their first analyzed installation, or to the connect screen. */
function Home() {
  const navigate = useNavigate()
  const refresh = useShell((s) => s.refreshWorkspaces)
  useEffect(() => {
    refresh()
      .then((list) => {
        const ready = list.find((w) => w.status === 'analyzed') ?? list.find((w) => w.root)
        navigate(ready ? `/w/${ready.id}` : '/connect', { replace: true })
      })
      .catch(() => navigate('/connect', { replace: true }))
  }, [navigate, refresh])
  return (
    <div className="sf-root" style={{ display: 'grid', placeItems: 'center' }}>
      <span className="sf-spinner" />
    </div>
  )
}

/** The first page of an installation depends on its technology */
function HomeForTech() {
  const { id = '' } = useParams()
  const tech = useShell((s) => s.workspaces.find((w) => w.id === id)?.tech)
  if (tech === 'salesforce-b2c') return <Suspense fallback={loading}><SfccPage section="overview" /></Suspense>
  return <OverviewPage />
}

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/connect', element: <ConnectPage /> },
  { path: '/connect/:id', element: <ConnectPage /> },
  {
    path: '/w/:id',
    element: <Layout />,
    children: [
      { index: true, element: <HomeForTech /> },
      { path: 'ask', element: <AskPage /> },
      { path: 'modules', element: <ModulesPage /> },
      { path: 'integrations', element: <IntegrationsPage /> },
      { path: 'integrations/:kind', element: <IntegrationsPage /> },
      { path: 'api-client', element: <Suspense fallback={loading}><ApiClientPage /></Suspense> },
      { path: 'docs', element: <Suspense fallback={loading}><DocsPage /></Suspense> },
      { path: 'board', element: <Suspense fallback={loading}><BoardPage /></Suspense> },
      { path: 'diagrams', element: <Suspense fallback={loading}><DiagramsPage /></Suspense> },
      { path: 'openspec', element: <Suspense fallback={loading}><OpenSpecPage /></Suspense> },
      { path: 'sfcc/:section', element: <Suspense fallback={loading}><SfccPage /></Suspense> },
      { path: 'openspec/change/:name', element: <Suspense fallback={loading}><OpenSpecChangePage /></Suspense> },
      { path: 'flow', element: <Suspense fallback={loading}><FlowPage mode="flow" /></Suspense> },
      { path: 'debug', element: <Suspense fallback={loading}><FlowPage mode="debug" /></Suspense> },
      { path: 'risks', element: <RisksPage /> },
      { path: 'security', element: <SecurityPage /> },
      { path: 'code', element: <Suspense fallback={loading}><CodePage /></Suspense> },
      { path: 'audit', element: <AuditPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])

export function Root() {
  return <RouterProvider router={router} />
}
