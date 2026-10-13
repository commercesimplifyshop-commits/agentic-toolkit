import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, waitJob } from '../api'
import { ago, fmtDate, nf, useShell } from '../store'

const ZONE_LABEL: Record<string, string> = {
  entrada: 'Entrada / conta',
  catalogo: 'Catálogo',
  produto: 'Produto',
  carrinho: 'Carrinho',
  checkout: 'Checkout',
  admin: 'Admin / pós-pedido',
  armazem: 'Estoque / CD',
  expedicao: 'Expedição',
  integracoes: 'Integrações',
  outros: 'Não classificados',
}
const KIND_LABEL: Record<string, string> = { rest: 'REST', graphql: 'GraphQL', plugin: 'Plugins', preference: 'Preferences', observer: 'Observers', route: 'Rotas', cron: 'Crons', queue: 'Filas' }

export function Bars({ data, color = 'var(--sf-accent)', max }: { data: [string, number][]; color?: string; max?: number }) {
  const top = max ?? Math.max(1, ...data.map(([, v]) => v))
  return (
    <div className="sf-bars">
      {data.map(([label, value]) => (
        <div key={label} className="sf-bar-row">
          <span title={label}>{label}</span>
          <div className="sf-bar-track">
            <div className="sf-bar-fill" style={{ width: `${(value / top) * 100}%`, background: color }} />
          </div>
          <b>{nf.format(value)}</b>
        </div>
      ))}
    </div>
  )
}

function Kpi({ icon, label, value, hint, tone }: { icon: string; label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="sf-card sf-kpi">
      <div className="sf-kpi-icon" style={tone ? { color: tone } : undefined}>
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="sf-kpi-label">{label}</div>
        <div className="sf-kpi-value">{value}</div>
        {hint && <div className="sf-kpi-hint">{hint}</div>}
      </div>
    </div>
  )
}

export function OverviewPage() {
  const { id = '' } = useParams()
  const o = useShell((s) => s.overviews[id])
  const loadOverview = useShell((s) => s.loadOverview)
  const [busy, setBusy] = useState(false)

  if (!o) return <div className="sf-page"><span className="sf-spinner" /></div>

  const reanalyze = async () => {
    setBusy(true)
    try {
      const r = await api.post<{ jobId: string }>(`/workspaces/${id}/analysis`)
      await waitJob(r.jobId, () => undefined)
      await loadOverview(id, true)
    } finally {
      setBusy(false)
    }
  }

  const s = o.support
  const m = o.modules
  const origins: [string, number, string][] = [
    ['Core Magento', m.byOrigin.core, '#3b82f6'],
    ['Customizados', m.byOrigin.custom, '#f97316'],
    ['Terceiros (composer)', m.byOrigin['composer-thirdparty'], '#a78bfa'],
    ['Terceiros (app/code)', m.byOrigin['appcode-thirdparty'], '#e879f9'],
  ]
  const totalEnabled = Math.max(1, origins.reduce((a, [, v]) => a + v, 0))
  const zones = Object.entries(o.integration.byZone)
    .map(([z, v]) => [ZONE_LABEL[z] ?? z, v] as [string, number])
    .sort((a, b) => b[1] - a[1])
  const kinds = Object.entries(o.integration.byKind)
    .map(([k, v]) => [KIND_LABEL[k] ?? k, v] as [string, number])
    .sort((a, b) => b[1] - a[1])
  const source = o.project.source

  return (
    <div className="sf-page">
      <div className="sf-page-head">
        <div className="sf-page-icon">🛒</div>
        <div className="sf-page-title">
          <h1>{o.project.name}</h1>
          <p>
            {o.magento.edition} {o.magento.version} · {source.type === 'local' ? 'pasta local' : source.type === 'git' ? `git ${source.url}` : `.zip ${source.fileName}`}
            {o.project.git?.branch ? ` · branch ${o.project.git.branch}` : ''}
          </p>
        </div>
        <div className="sf-actions">
          <Link className="sf-btn" to={`/w/${id}/atualizacao`} title="Boletins de segurança e novidades do dia">
            ◷ Atualização do dia
          </Link>
          <Link className="sf-btn" to={`/w/${id}/ask`}>
            ✦ Perguntar à IA
          </Link>
          <Link className="sf-btn" to={`/w/${id}/debug`}>
            ⏵ Debug de fluxo
          </Link>
          <button className="sf-btn" onClick={reanalyze} disabled={busy}>
            {busy ? <span className="sf-spinner" /> : '↻'} Reanalisar
          </button>
          <span className={`sf-badge ${s?.supported === false ? 'red' : 'green'}`}>{s?.supported === false ? 'fora do suporte' : 'suportada'}</span>
        </div>
      </div>

      <div className="sf-grid kpis">
        <Kpi icon="◆" label="Versão" value={o.magento.version ?? '—'} hint={s ? `linha ${s.line} · mais recente ${s.latestOverall ?? '?'}` : o.magento.edition} tone={s?.supported === false ? 'var(--sf-red)' : undefined} />
        <Kpi icon="▦" label="Módulos habilitados" value={nf.format(m.enabled)} hint={`${m.byOrigin.custom} customizados · ${m.disabled.length} desativados`} />
        <Kpi icon="⬡" label="Extensões (composer)" value={nf.format(o.extensions.total)} hint={`${o.extensions.vendors.length} vendors`} />
        <Kpi icon="⇄" label="Pontos de integração próprios" value={nf.format(o.integration.total)} hint={`${o.integration.coreRewrites} reescritas do core`} />
        <Kpi
          icon="⚠"
          label="Pontos de atenção"
          value={nf.format((o.integration.risks.alto ?? 0) + (o.integration.risks.medio ?? 0))}
          hint={`${o.integration.risks.alto ?? 0} altos · ${o.integration.anonymousWrites} endpoints anônimos de escrita`}
          tone={o.integration.risks.alto ? 'var(--sf-red)' : undefined}
        />
      </div>

      <div className="sf-grid two">
        <div className="sf-card">
          <div className="sf-card-head">
            <div>
              <h2>Highlights técnicos</h2>
              <span className="sub" style={{ marginBottom: 0 }}>
                Detectados no código em {fmtDate(o.computedAt)}
              </span>
            </div>
          </div>
          {o.highlights.map((h) => (
            <div key={h.title} className="sf-highlight">
              <span className={`lvl ${h.level}`} />
              <div style={{ flex: 1 }}>
                <strong>{h.title}</strong>
                <p>{h.detail}</p>
              </div>
              {h.link && (
                <Link className="sf-link" to={`/w/${id}/${h.link === 'apis' ? 'integrations/api' : h.link === 'plugins' ? 'integrations/plugins' : h.link === 'patches' ? 'security' : h.link}`}>
                  ver →
                </Link>
              )}
            </div>
          ))}
          {o.highlights.length === 0 && <div className="sf-empty">Nada crítico encontrado.</div>}
        </div>

        <div className="sf-card">
          <h2>Módulos por origem</h2>
          <span className="sub">{nf.format(m.enabled)} módulos habilitados em app/etc/config.php</span>
          <div className="sf-stack">
            {origins.map(([label, v, c]) => (
              <div key={label} title={`${label}: ${v}`} style={{ width: `${(v / totalEnabled) * 100}%`, background: c }} />
            ))}
          </div>
          <div className="sf-legend">
            {origins.map(([label, v, c]) => (
              <span key={label}>
                <i style={{ background: c }} />
                {label} <b style={{ color: 'var(--sf-text)' }}>{v}</b>
              </span>
            ))}
          </div>
          <h2 style={{ marginTop: 22 }}>Customizações por etapa do fluxo</h2>
          <span className="sub">Plugins, observers, preferences, APIs, rotas, crons e filas de módulos customizados e de terceiros</span>
          <Bars data={zones} />
        </div>
      </div>

      <div className="sf-grid three" style={{ marginTop: 14 }}>
        <div className="sf-card">
          <h2>Tipos de customização</h2>
          <span className="sub">Onde o projeto se pluga no Magento</span>
          <Bars data={kinds} color="var(--sf-blue)" />
        </div>
        <div className="sf-card">
          <div className="sf-card-head">
            <h2>Extensões por vendor</h2>
            <Link to={`/w/${id}/modules`}>ver todas →</Link>
          </div>
          <Bars data={o.extensions.vendors.slice(0, 8).map((v) => [v.vendor, v.count])} color="var(--sf-purple)" />
        </div>
        <div className="sf-card">
          <h2>Stack</h2>
          <span className="sub">Lido do composer.lock, config.php e arquivos de infraestrutura</span>
          <StackRow label="PHP suportado" value={o.magento.php ?? '—'} />
          <StackRow label="Framework" value={o.magento.framework ?? '—'} />
          <StackRow label="Busca" value={o.infrastructure.searchEngine?.replace('Magento_', '') ?? '—'} />
          <StackRow label="Filas (RabbitMQ)" value={o.infrastructure.rabbitmq ? 'sim' : 'não'} />
          <StackRow label="Tema" value={o.frontend.hyva ? 'Hyvä' : o.frontend.breeze ? 'Breeze' : o.frontend.themes.find((t) => t.area === 'frontend')?.code ?? 'Luma'} />
          <StackRow label="Page Builder / GraphQL" value={`${o.frontend.pageBuilder ? 'sim' : 'não'} / ${o.frontend.graphql ? 'sim' : 'não'}`} />
          <StackRow label="Cloud" value={o.infrastructure.cloud ? 'Adobe Commerce Cloud' : 'não'} />
          <StackRow label="Docker" value={o.infrastructure.docker?.services.join(', ') ?? '—'} />
          <StackRow label="CI/CD" value={o.infrastructure.ci.join(', ') || '—'} />
        </div>
      </div>

      <div className="sf-grid three" style={{ marginTop: 14 }}>
        <div className="sf-card">
          <h2>Código próprio (app/code)</h2>
          <span className="sub">{m.appCodeVendors.length} vendors</span>
          <StackRow label="Arquivos PHP" value={`${nf.format(o.code.php)} · ${nf.format(o.code.phpLines)} linhas`} />
          <StackRow label="XML de configuração" value={nf.format(o.code.xml)} />
          <StackRow label="Templates .phtml" value={nf.format(o.code.templates)} />
          <StackRow label="JavaScript" value={nf.format(o.code.js)} />
          <StackRow label="Testes" value={nf.format(o.code.tests)} />
        </div>
        <div className="sf-card">
          <div className="sf-card-head">
            <h2>Patches & segurança</h2>
            <Link to={`/w/${id}/security`}>detalhes →</Link>
          </div>
          <StackRow label="Quality Patches Tool" value={o.patches.qualityPatches ?? 'não instalado'} />
          <StackRow label="Security package" value={o.security.securityPackage ?? '—'} />
          <StackRow label="Patches aplicados" value={`${o.patches.files.length} arquivos`} />
          <StackRow label="2FA do admin" value={o.security.modules.find((x) => x.name === 'Magento_TwoFactorAuth')?.enabled ? 'ativo' : 'desativado'} />
          <StackRow label="reCAPTCHA" value={`${o.security.reCaptcha.enabled}/${o.security.reCaptcha.total} módulos ativos`} />
          <StackRow label="Fim do suporte" value={s?.endOfSupport ? fmtDate(s.endOfSupport) : '—'} />
        </div>
        <div className="sf-card">
          <h2>Atividade recente</h2>
          <span className="sub">{o.project.git ? `${o.project.git.contributors ?? '?'} contribuidores` : 'Origem sem histórico git'}</span>
          <div className="sf-list">
            {o.project.commits.slice(0, 6).map((c) => (
              <div key={c.hash} className="sf-list-row">
                <span className="sf-code-id">{c.hash}</span>
                <div className="main">
                  <strong>{c.subject}</strong>
                  <span>
                    {c.author} · {ago(c.date)}
                  </span>
                </div>
              </div>
            ))}
            {o.project.commits.length === 0 && <div className="sf-empty">Sem commits para mostrar.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

function StackRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="sf-list-row" style={{ padding: '7px 0' }}>
      <span className="sf-muted" style={{ width: 150, flex: 'none', fontSize: 12.5 }}>
        {label}
      </span>
      <span style={{ fontSize: 12.5, minWidth: 0, overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  )
}
