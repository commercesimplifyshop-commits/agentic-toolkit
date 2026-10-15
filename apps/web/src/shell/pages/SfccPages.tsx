import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'

/** Mirrors apps/api/src/techs/sfcc/overview.ts */
export interface SfccOverview {
  tech: 'salesforce-b2c'
  name: string
  storefront: { type: 'SFRA' | 'PWA Kit' | 'Personalizado'; detail?: string }
  instance: { hostname?: string; codeVersion?: string; credentialsInRepo: boolean }
  cartridges: { name: string; controllers: number; templates: number; scripts: number; hooks: number }[]
  controllers: { cartridge: string; file: string; kind: 'sfra' | 'pipeline'; routes: { method: string; name: string }[] }[]
  hooks: { cartridge: string; name: string; script?: string }[]
  jobs: { id: string; file: string }[]
  services: string[]
  sites: string[]
  attributes: { type: string; count: number }[]
  counts: { cartridges: number; controllers: number; routes: number; pipelines: number; templates: number; scripts: number; jobs: number; services: number; sites: number; hooks: number }
  highlights: { level: 'critical' | 'warning' | 'info'; title: string; detail: string }[]
}

const TONE: Record<string, string> = { critical: 'red', warning: 'orange', info: 'blue' }

function Kpi({ icon, label, value, hint }: { icon: string; label: string; value: string | number; hint?: string }) {
  return (
    <div className="sf-card sf-kpi">
      <div className="sf-kpi-icon">{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div className="sf-kpi-label">{label}</div>
        <div className="sf-kpi-value">{value}</div>
        {hint && <div className="sf-kpi-hint">{hint}</div>}
      </div>
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="sf-faint" style={{ fontSize: 13, padding: '10px 0' }}>{children}</div>
}

/** One Salesforce B2C page, chosen by the menu: overview, architecture sections, or the instance profile. */
export function SfccPage({ section: forced }: { section?: string }) {
  const { id = '', section: param = 'overview' } = useParams()
  const section = forced ?? param
  const [o, setO] = useState<SfccOverview | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setO(null)
    setError('')
    api
      .get<SfccOverview>(`/workspaces/${id}/sfcc/overview`)
      .then(setO)
      .catch((e) => setError((e as Error).message))
  }, [id])

  if (error) return <div className="sf-page"><div className="sf-callout red">{error}</div></div>
  if (!o) return <div className="sf-page"><span className="sf-spinner" /></div>

  const titles: Record<string, string> = {
    overview: 'Visão geral da solução',
    cartridges: 'Cartuchos & dependências',
    controllers: 'Controllers & rotas',
    templates: 'Templates ISML',
    jobs: 'Jobs & agendamentos',
    services: 'Integrações & serviços',
    sites: 'Sites & atributos',
    instance: 'Perfil da instância',
  }

  return (
    <div className="sf-page">
      <div className="sf-page-head">
        <div className="sf-page-title">
          <h1>{titles[section] ?? titles.overview}</h1>
          <p>Lido do código do projeto. Nada é enviado nem alterado na instância.</p>
        </div>
      </div>

      {section === 'overview' && <Overview o={o} />}
      {section === 'cartridges' && <Cartridges o={o} />}
      {section === 'controllers' && <Controllers o={o} />}
      {section === 'templates' && <Templates o={o} id={id} />}
      {section === 'jobs' && <Jobs o={o} />}
      {section === 'services' && <Services o={o} />}
      {section === 'sites' && <Sites o={o} />}
      {section === 'instance' && <Instance o={o} />}
    </div>
  )
}

function Overview({ o }: { o: SfccOverview }) {
  return (
    <>
      <div className="sf-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Kpi icon="▦" label="Cartuchos" value={o.counts.cartridges} />
        <Kpi icon="⌁" label="Controllers" value={o.counts.controllers} hint={`${o.counts.routes} rotas`} />
        <Kpi icon="▤" label="Templates ISML" value={o.counts.templates} />
        <Kpi icon="◷" label="Jobs" value={o.counts.jobs} />
        <Kpi icon="⇄" label="Integrações" value={o.counts.services} />
        <Kpi icon="◉" label="Sites" value={o.counts.sites} />
      </div>
      <div className="sf-card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="sf-kv">
          <span>Storefront</span>
          <strong>{o.storefront.type}</strong>
          {o.storefront.detail && <span className="sf-faint"> · {o.storefront.detail}</span>}
        </div>
        <div className="sf-kv" style={{ marginTop: 8 }}>
          <span>Instância</span>
          <strong>{o.instance.hostname ?? 'não definida no dw.json'}</strong>
        </div>
      </div>
      {o.highlights.length > 0 && (
        <div className="sf-section-title">Pontos de atenção</div>
      )}
      {o.highlights.map((h, i) => (
        <div key={i} className={`sf-callout ${TONE[h.level]}`} style={{ marginBottom: 8 }}>
          <b>{h.title}</b>
          <div style={{ marginTop: 4 }}>{h.detail}</div>
        </div>
      ))}
    </>
  )
}

function Cartridges({ o }: { o: SfccOverview }) {
  if (!o.cartridges.length) return <Empty>Nenhum cartucho encontrado em cartridges/.</Empty>
  return (
    <div className="sf-card" style={{ padding: 0, overflow: 'hidden' }}>
      <table className="sf-table">
        <thead>
          <tr>
            <th>Cartucho</th>
            <th>Controllers</th>
            <th>Templates</th>
            <th>Scripts</th>
            <th>Hooks</th>
          </tr>
        </thead>
        <tbody>
          {o.cartridges.map((c) => (
            <tr key={c.name}>
              <td className="sf-mono">{c.name}</td>
              <td>{c.controllers}</td>
              <td>{c.templates}</td>
              <td>{c.scripts}</td>
              <td>{c.hooks}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sf-faint" style={{ padding: 12, fontSize: 12.5 }}>
        A ordem de precedência dos cartuchos (cartridge path) é definida na instância e não está no código; ela não é lida aqui.
      </div>
    </div>
  )
}

function Controllers({ o }: { o: SfccOverview }) {
  if (!o.controllers.length) return <Empty>Nenhum controller encontrado.</Empty>
  const byCart = new Map<string, SfccOverview['controllers']>()
  for (const c of o.controllers) byCart.set(c.cartridge, [...(byCart.get(c.cartridge) ?? []), c])
  return (
    <>
      {Array.from(byCart, ([cartridge, list]) => (
        <div key={cartridge} className="sf-card" style={{ padding: 14, marginBottom: 12 }}>
          <div className="sf-mono" style={{ fontWeight: 600, marginBottom: 8 }}>{cartridge}</div>
          {list.map((c) => (
            <div key={c.file} style={{ marginBottom: 10 }}>
              <div className="sf-row" style={{ gap: 8 }}>
                <span className={`sf-badge ${c.kind === 'sfra' ? 'green' : 'orange'}`}>{c.kind === 'sfra' ? 'SFRA' : 'pipeline (.ds)'}</span>
                <span className="sf-mono sf-faint" style={{ fontSize: 11.5, overflowWrap: 'anywhere' }}>{c.file}</span>
              </div>
              <div className="sf-chips" style={{ marginTop: 6 }}>
                {c.routes.map((r, i) => (
                  <span key={i} className="sf-chip sf-mono">
                    {r.method === 'pipeline' ? r.name : `${r.method.toUpperCase()} ${r.name}`}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
      {o.hooks.length > 0 && (
        <>
          <div className="sf-section-title">Hooks</div>
          <div className="sf-card" style={{ padding: 14 }}>
            {o.hooks.map((h, i) => (
              <div key={i} className="sf-mono" style={{ fontSize: 12.5, marginBottom: 4 }}>
                {h.name} <span className="sf-faint">· {h.cartridge}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function Templates({ o, id }: { o: SfccOverview; id: string }) {
  if (!o.cartridges.length) return <Empty>Nenhum cartucho encontrado.</Empty>
  return (
    <>
      <div className="sf-card" style={{ padding: 14, marginBottom: 12 }}>
        <div className="sf-kv">
          <span>Total de templates ISML</span>
          <strong>{o.counts.templates}</strong>
        </div>
      </div>
      <div className="sf-card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="sf-table">
          <thead>
            <tr>
              <th>Cartucho</th>
              <th>Templates</th>
            </tr>
          </thead>
          <tbody>
            {o.cartridges.map((c) => (
              <tr key={c.name}>
                <td className="sf-mono">{c.name}</td>
                <td>{c.templates}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sf-faint" style={{ fontSize: 12.5, marginTop: 10 }}>
        Para abrir um template, use o <Link to={`/w/${id}/code`}>Explorador de código</Link>.
      </p>
    </>
  )
}

function Jobs({ o }: { o: SfccOverview }) {
  if (!o.jobs.length) return <Empty>Nenhum job encontrado em jobs/ ou nos XML de job do projeto.</Empty>
  return (
    <div className="sf-card" style={{ padding: 0, overflow: 'hidden' }}>
      <table className="sf-table">
        <thead>
          <tr>
            <th>Job</th>
            <th>Arquivo</th>
          </tr>
        </thead>
        <tbody>
          {o.jobs.map((j, i) => (
            <tr key={i}>
              <td className="sf-mono">{j.id}</td>
              <td className="sf-mono sf-faint" style={{ fontSize: 12 }}>{j.file}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Services({ o }: { o: SfccOverview }) {
  if (!o.services.length) return <Empty>Nenhum serviço encontrado (LocalServiceRegistry.createService).</Empty>
  return (
    <div className="sf-card" style={{ padding: 14 }}>
      <div className="sf-chips">
        {o.services.map((s) => (
          <span key={s} className="sf-chip sf-mono">{s}</span>
        ))}
      </div>
    </div>
  )
}

function Sites({ o }: { o: SfccOverview }) {
  return (
    <>
      <div className="sf-section-title">Sites</div>
      {o.sites.length ? (
        <div className="sf-chips" style={{ marginBottom: 16 }}>
          {o.sites.map((s) => (
            <span key={s} className="sf-chip sf-mono">{s}</span>
          ))}
        </div>
      ) : (
        <Empty>Nenhum site encontrado em sites/.</Empty>
      )}
      <div className="sf-section-title">Atributos customizados por tipo de objeto</div>
      {o.attributes.length ? (
        <div className="sf-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="sf-table">
            <thead>
              <tr>
                <th>Tipo de objeto</th>
                <th>Atributos</th>
              </tr>
            </thead>
            <tbody>
              {o.attributes.map((a) => (
                <tr key={a.type}>
                  <td className="sf-mono">{a.type}</td>
                  <td>{a.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>Nenhum atributo customizado em meta/.</Empty>
      )}
    </>
  )
}

function Instance({ o }: { o: SfccOverview }) {
  return (
    <>
      <div className="sf-card" style={{ padding: 16, marginBottom: 14 }}>
        <div className="sf-kv">
          <span>Hostname</span>
          <strong className="sf-mono">{o.instance.hostname ?? '—'}</strong>
        </div>
        <div className="sf-kv" style={{ marginTop: 8 }}>
          <span>Código (code-version)</span>
          <strong className="sf-mono">{o.instance.codeVersion ?? '—'}</strong>
        </div>
        <div className="sf-kv" style={{ marginTop: 8 }}>
          <span>Storefront</span>
          <strong>{o.storefront.type}</strong>
        </div>
      </div>
      {o.instance.credentialsInRepo ? (
        <div className="sf-callout red">
          Há credenciais guardadas no dw.json do projeto. Os valores não são mostrados. Retire-as do repositório.
        </div>
      ) : (
        <div className="sf-callout green">Nenhuma credencial guardada no projeto.</div>
      )}
      <p className="sf-faint" style={{ fontSize: 12.5, marginTop: 14 }}>
        Esta tela só lê o projeto. Para enviar código para a sandbox, use{' '}
        <Link className="sf-link" to={`/w/${useParams().id}/sfcc/upload`}>
          Upload para a instância
        </Link>
        . Rodar jobs e consultar OCAPI dependem de um cofre de credenciais e ainda não estão disponíveis.
      </p>
    </>
  )
}
