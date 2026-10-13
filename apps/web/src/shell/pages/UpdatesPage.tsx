import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { getStatus, getToday, itemsOf, localDay, NewsStatus, saveNewsSettings, TodayUpdate, TopicCards, TopicSettings, TrafficLight } from '../news/UpdateContent'

/** "Atualização do dia": the topics, the day chosen, the routine's state, and each topic's switches. */
export function UpdatesPage() {
  const [status, setStatus] = useState<NewsStatus | null>(null)
  const [today, setToday] = useState<TodayUpdate | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  /** The day chosen: null is the automatic choice (today, or the weekend on a Monday) */
  const [day, setDay] = useState<string | null>(null)

  const load = useCallback(() => {
    getStatus()
      .then(setStatus)
      .catch((e) => setError((e as Error).message))
    getToday(day ?? undefined)
      .then(setToday)
      .catch(() => undefined)
  }, [day])

  useEffect(() => {
    load()
  }, [load])

  // while the routine is searching, follow it until it finishes
  useEffect(() => {
    if (status?.state !== 'running') return
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [status?.state, load])

  const refreshNow = async () => {
    setBusy(true)
    setError('')
    try {
      await api.post('/news/refresh')
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const saveRoutine = async (patch: { routine?: boolean; popup?: boolean }) => {
    setError('')
    try {
      await saveNewsSettings(patch)
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const saveTopic = async (id: string, patch: Partial<TopicSettings>) => {
    setError('')
    try {
      await saveNewsSettings({ topics: { [id]: patch } })
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const stateText: Record<NewsStatus['state'], string> = {
    idle: 'Aguardando',
    running: 'Buscando as informações…',
    ready: 'Pronta',
    error: 'Falhou',
  }
  const dates = today?.dates ?? [localDay()]
  const label = dates.map((d) => new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })).join(' e ')

  return (
    <div className="sf-page sf-upd-page">
      <div className="sf-page-head">
        <div className="sf-page-title">
          <h1>Atualização do dia</h1>
          <p>Novidades das fontes que você ativou. A busca roda em segundo plano, sem bloquear o uso da aplicação.</p>
        </div>
      </div>

      {error && <div className="sf-callout red" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="sf-card" style={{ padding: 16, marginBottom: 14 }}>
        <div className="sf-row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="sf-kv">
              <span>Situação</span>
              <strong>{status ? stateText[status.state] : '…'}</strong>
            </div>
            <div className="sf-kv" style={{ marginTop: 6 }}>
              <span>Última atualização</span>
              <strong>{status?.fetchedAt ? new Date(status.fetchedAt).toLocaleString('pt-BR') : 'nunca'}</strong>
            </div>
            {status?.lastError && <div className="sf-callout red" style={{ marginTop: 8, fontSize: 12.5 }}>{status.lastError}</div>}
          </div>
          <button className="sf-btn accent" onClick={refreshNow} disabled={busy || status?.state === 'running'}>
            {status?.state === 'running' ? 'Buscando…' : 'Buscar agora'}
          </button>
        </div>
      </div>

      {today && (
        <div className="sf-card" style={{ padding: 16, marginBottom: 14 }}>
          <TrafficLight items={itemsOf(today)} dates={dates} />
        </div>
      )}

      <div className="sf-row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '18px 0 10px' }}>
        <div className="sf-section-title" style={{ margin: 0, flex: 1 }}>
          Publicados em {label}
        </div>
        <input type="date" className="sf-input" style={{ width: 'auto' }} value={day ?? localDay()} max={localDay()} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Data da busca" />
        <button className="sf-btn small" onClick={() => setDay(null)} disabled={day === null}>
          Hoje
        </button>
      </div>
      {today && !today.ready && day === null && <div className="sf-callout orange" style={{ marginBottom: 12 }}>As informações de hoje ainda não foram buscadas. O conteúdo mostrado é da última atualização.</div>}

      {today?.topics.map((t) => (
        <section key={t.id} className="sf-upd-section sf-card" style={{ padding: 16, marginBottom: 14 }}>
          <div className="sf-upd-section-head">
            <span>
              <strong>{t.title}</strong>
              <span className="sf-faint" style={{ display: 'block', fontSize: 12.5 }}>
                {t.description}
              </span>
            </span>
            <span className="sf-row" style={{ gap: 14, flexWrap: 'wrap' }}>
              <Switch label="Ativo" checked={t.enabled} onChange={(v) => saveTopic(t.id, { enabled: v })} />
              <Switch label="Notificar no popup" checked={t.popup} onChange={(v) => saveTopic(t.id, { popup: v })} disabled={!t.enabled} />
            </span>
          </div>
          {t.enabled ? (
            <TopicCards topic={t} dates={dates} />
          ) : (
            <div className="sf-faint" style={{ fontSize: 13 }}>
              Desativado: este tema não é buscado nem aparece na atualização.
            </div>
          )}
        </section>
      ))}

      {status && (
        <>
          <div className="sf-section-title" style={{ marginTop: 22 }}>
            Configurações da rotina
          </div>
          <div className="sf-card" style={{ padding: 16 }}>
            <Toggle
              label="Buscar automaticamente"
              help="Ao iniciar a aplicação e de novo quando um novo dia começar, enquanto ela estiver aberta."
              checked={status.settings.routine}
              onChange={(v) => saveRoutine({ routine: v })}
            />
            <Toggle
              label="Mostrar o popup"
              help="Abre o resumo quando a informação do dia estiver pronta, uma vez a cada início da aplicação. Cada tema decide se entra nele."
              checked={status.settings.popup}
              onChange={(v) => saveRoutine({ popup: v })}
            />
          </div>
        </>
      )}
    </div>
  )
}

function Switch({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="sf-upd-switch" style={{ opacity: disabled ? 0.5 : 1 }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function Toggle({ label, help, checked, onChange }: { label: string; help: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="sf-upd-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <strong>{label}</strong>
        <span className="sf-faint" style={{ display: 'block', fontSize: 12.5 }}>
          {help}
        </span>
      </span>
    </label>
  )
}
