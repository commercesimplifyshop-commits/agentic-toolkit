import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useShell } from '../store'

type Tab = 'custom' | 'appcode-third' | 'composer' | 'disabled'

export function ModulesPage() {
  const { id = '' } = useParams()
  const o = useShell((s) => s.overviews[id])
  const [tab, setTab] = useState<Tab>('custom')
  const [query, setQuery] = useState('')
  const q = query.toLowerCase()

  const lists = useMemo(() => {
    if (!o) return null
    return {
      custom: o.modules.appCode.filter((m) => m.own),
      'appcode-third': o.modules.appCode.filter((m) => !m.own),
      composer: o.extensions.list,
      disabled: o.modules.disabled,
    }
  }, [o])

  if (!o || !lists) return <div className="sf-page"><span className="sf-spinner" /></div>

  const tabs: [Tab, string, number][] = [
    ['custom', 'Customizados (app/code)', lists.custom.length],
    ['appcode-third', 'Terceiros em app/code', lists['appcode-third'].length],
    ['composer', 'Extensões via Composer', lists.composer.length],
    ['disabled', 'Desativados', lists.disabled.length],
  ]

  return (
    <div className="sf-page">
      <div className="sf-page-head">
        <div className="sf-page-icon">▦</div>
        <div className="sf-page-title">
          <h1>Módulos & extensões</h1>
          <p>
            {o.modules.total} módulos em app/etc/config.php · {o.modules.enabled} habilitados
          </p>
        </div>
        <input className="sf-input" style={{ maxWidth: 280 }} placeholder="Filtrar…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="sf-tabs">
        {tabs.map(([k, label, n]) => (
          <button key={k} className={`sf-tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
            {label} <span className="sf-faint">{n}</span>
          </button>
        ))}
      </div>

      {(tab === 'custom' || tab === 'appcode-third') && (
        <div className="sf-grid three">
          {Object.entries(
            lists[tab]
              .filter((m) => m.name.toLowerCase().includes(q))
              .reduce<Record<string, typeof lists.custom>>((acc, m) => ((acc[m.vendor] ??= []).push(m), acc), {}),
          ).map(([vendor, mods]) => (
            <div key={vendor} className="sf-card">
              <div className="sf-card-head">
                <h2>{vendor}</h2>
                <span className="sf-faint">{mods.length} módulos</span>
              </div>
              <div className="sf-chips">
                {mods.map((m) => (
                  <span key={m.name} className={`sf-badge ${m.enabled === false ? 'red' : ''}`} title={m.enabled === false ? 'desativado' : ''}>
                    {m.name.split('_')[1]}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'composer' && (
        <div className="sf-card" style={{ padding: 0 }}>
          <table className="sf-table">
            <thead>
              <tr>
                <th>Pacote</th>
                <th style={{ width: 130 }}>Versão</th>
                <th>Descrição</th>
              </tr>
            </thead>
            <tbody>
              {lists.composer
                .filter((e) => e.name.toLowerCase().includes(q) || e.description?.toLowerCase().includes(q))
                .map((e) => (
                  <tr key={e.name}>
                    <td className="sf-mono">{e.name}</td>
                    <td className="sf-mono sf-muted">{e.version}</td>
                    <td className="sf-muted" style={{ fontSize: 12.5 }}>
                      {e.description}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'disabled' && (
        <div className="sf-card">
          <span className="sub">Módulos com valor 0 em app/etc/config.php: o código existe, mas não roda.</span>
          <div className="sf-chips">
            {lists.disabled
              .filter((n) => n.toLowerCase().includes(q))
              .map((n) => (
                <span key={n} className="sf-badge">
                  {n}
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
