import { useEffect, useState } from 'react'
import { getStatus, getToday, itemsOf, TodayUpdate, TopicCards, TrafficLight } from './UpdateContent'

/** Shown once per start of the application, after the update of the day is ready */
const SHOWN_KEY = 'agentic-toolkit.updateShown'
const POLL_MS = 4000
const GIVE_UP_MS = 5 * 60_000

const alreadyShown = (bootId: string) => {
  try {
    return sessionStorage.getItem(SHOWN_KEY) === bootId
  } catch {
    return false
  }
}
const markShown = (bootId: string) => {
  try {
    sessionStorage.setItem(SHOWN_KEY, bootId)
  } catch {
    // private mode: the popup may show again on reload, which is harmless
  }
}

/**
 * Waits in the background for the update of the day and opens the popup only when it is ready.
 * It lists the topics switched on for the popup; with none, it does not open.
 */
export function DailyUpdate() {
  const [data, setData] = useState<TodayUpdate | null>(null)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const started = Date.now()

    const check = async () => {
      try {
        const s = await getStatus()
        if (!alive) return
        if (!s.settings.popup) return
        if (s.todayReady) {
          if (alreadyShown(s.bootId)) return
          const today = await getToday()
          if (!alive || !today.ready) return
          if (!today.topics.some((t) => t.enabled && t.popup)) return
          markShown(s.bootId)
          setData(today)
          return
        }
        // still searching: keep looking for a while, then stop without showing anything
        const searching = s.state === 'running' || (s.settings.routine && s.state !== 'error')
        if (searching && Date.now() - started < GIVE_UP_MS) timer = setTimeout(check, POLL_MS)
      } catch {
        // the server may be restarting: try again later
        if (alive && Date.now() - started < GIVE_UP_MS) timer = setTimeout(check, POLL_MS * 2)
      }
    }
    void check()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [])

  if (!data) return null
  const topics = data.topics.filter((t) => t.enabled && t.popup)
  return (
    <div className="sf-drawer-back" onClick={() => setData(null)} style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="sf-upd-modal" role="dialog" aria-label="Atualização do dia" onClick={(e) => e.stopPropagation()}>
        <div className="sf-upd-head">
          <TrafficLight items={itemsOf(data, true)} dates={data.dates} />
          <button className="sf-link" onClick={() => setData(null)} aria-label="Fechar" style={{ fontSize: 18 }}>
            ✕
          </button>
        </div>
        <div className="sf-upd-body">
          {topics.map((t) => (
            <section key={t.id} className="sf-upd-section">
              <div className="sf-upd-section-head">
                <strong>{t.title}</strong>
              </div>
              <TopicCards topic={t} dates={data.dates} compact inPopup />
            </section>
          ))}
        </div>
        <div className="sf-row" style={{ justifyContent: 'space-between', marginTop: 14, flexWrap: 'wrap', gap: 8 }}>
          <a className="sf-btn small" href="/atualizacao">
            Ver atualização completa e configurações
          </a>
          <button className="sf-btn small accent" onClick={() => setData(null)}>
            Entendi
          </button>
        </div>
      </div>
    </div>
  )
}
