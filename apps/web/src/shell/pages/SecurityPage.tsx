import { useParams } from 'react-router-dom'
import { fmtDate, useShell } from '../store'

export function SecurityPage() {
  const { id = '' } = useParams()
  const o = useShell((s) => s.overviews[id])
  if (!o) return <div className="sf-page"><span className="sf-spinner" /></div>
  const s = o.support

  return (
    <div className="sf-page">
      <div className="sf-page-head">
        <div className="sf-page-icon">⛨</div>
        <div className="sf-page-title">
          <h1>Segurança & patches</h1>
          <p>Versão, suporte, pacotes de segurança, módulos de proteção e patches aplicados.</p>
        </div>
      </div>

      <div className="sf-grid three">
        <div className="sf-card">
          <h2>Versão e suporte</h2>
          <span className="sub">Tags públicas do magento/magento2{s?.source === 'offline' ? ' (sem conexão: dados locais)' : ''}</span>
          <Row label="Instalada" value={o.magento.version ?? '—'} />
          <Row label="Última da linha" value={s?.latestInLine ?? '—'} tone={s?.patchesBehind ? 'yellow' : undefined} />
          <Row label="Patches atrás" value={s?.patchesBehind !== undefined ? String(s.patchesBehind) : '—'} />
          <Row label="Versão mais recente" value={s?.latestOverall ?? '—'} />
          <Row label="Fim do suporte" value={s?.endOfSupport ? fmtDate(s.endOfSupport) : '—'} tone={s?.supported === false ? 'red' : 'green'} />
          <Row label="PHP suportado" value={o.magento.php ?? '—'} />
        </div>

        <div className="sf-card">
          <h2>Módulos de segurança</h2>
          <span className="sub">Estado em app/etc/config.php</span>
          <Row label="Security package" value={o.security.securityPackage ?? 'não instalado'} />
          {o.security.modules.map((m) => (
            <Row key={m.name} label={m.name.replace('Magento_', '')} value={m.enabled === null ? 'ausente' : m.enabled ? 'ativo' : 'desativado'} tone={m.enabled === false && m.name === 'Magento_TwoFactorAuth' ? 'red' : m.enabled ? 'green' : undefined} />
          ))}
          <Row label="reCAPTCHA" value={`${o.security.reCaptcha.enabled}/${o.security.reCaptcha.total} módulos ativos`} />
        </div>

        <div className="sf-card">
          <h2>Arquivos sensíveis</h2>
          <span className="sub">Presentes no código; o StoreFlow nunca lê o conteúdo</span>
          {o.security.sensitiveFiles.map((f) => (
            <Row key={f.file} label={f.file} value={f.tracked === true ? 'versionado no git!' : f.tracked === false ? 'fora do git' : 'presente (sem git para checar)'} tone={f.tracked ? 'red' : f.tracked === null ? 'yellow' : 'green'} />
          ))}
          {o.security.sensitiveFiles.length === 0 && <div className="sf-empty">Nenhum encontrado.</div>}
        </div>
      </div>

      <div className="sf-section-title">
        Patches aplicados <span className="sf-faint" style={{ fontWeight: 400 }}>Quality Patches Tool {o.patches.qualityPatches ?? 'não instalado'} · Cloud patches {o.patches.cloudPatches ?? '—'}</span>
      </div>
      <div className="sf-card" style={{ padding: 0 }}>
        <table className="sf-table">
          <thead>
            <tr>
              <th>Arquivo</th>
              <th style={{ width: 150 }}>ID</th>
              <th style={{ width: 120 }}>Origem</th>
            </tr>
          </thead>
          <tbody>
            {o.patches.files.map((p) => (
              <tr key={p.file}>
                <td className="sf-mono">{p.file}</td>
                <td className="sf-mono">{p.id ?? '—'}</td>
                <td>{p.kind === 'adobe' ? <span className="sf-badge blue">Adobe</span> : <span className="sf-badge orange">próprio</span>}</td>
              </tr>
            ))}
            {o.patches.composerPatches.map((p) => (
              <tr key={p.package + p.description}>
                <td>{p.description}</td>
                <td className="sf-mono">{p.package}</td>
                <td>
                  <span className="sf-badge purple">composer-patches</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {o.patches.files.length + o.patches.composerPatches.length === 0 && <div className="sf-empty">Nenhum patch encontrado.</div>}
      </div>
    </div>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'red' | 'yellow' | 'green' }) {
  return (
    <div className="sf-list-row" style={{ padding: '8px 0' }}>
      <span className="sf-muted" style={{ flex: 1, fontSize: 12.5 }}>
        {label}
      </span>
      {tone ? <span className={`sf-badge ${tone}`}>{value}</span> : <span style={{ fontSize: 12.5 }}>{value}</span>}
    </div>
  )
}
