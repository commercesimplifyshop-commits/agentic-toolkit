import { api } from '../api'

/** Mirrors apps/api/src/news: every topic of the daily update has the same shape */
export type Tone = 'red' | 'yellow' | 'green' | 'neutral'

export interface TopicItem {
  id: string
  title: string
  url: string
  date?: string
  priority?: number
  tone: Tone
  tags: string[]
  lines: string[]
  /** Official pages to act on, shown as buttons */
  actions: { label: string; url: string }[]
}

export interface TopicView {
  id: string
  title: string
  description: string
  enabled: boolean
  popup: boolean
  fetchedAt?: string
  latestPublished?: string
  items: TopicItem[]
}

export interface TodayUpdate {
  /** Today (yyyy-mm-dd) */
  date: string
  /** The days searched: today, or Saturday and Sunday on a Monday */
  dates: string[]
  ready: boolean
  latestPublished?: string
  topics: TopicView[]
}

export interface TopicSettings {
  enabled: boolean
  popup: boolean
}

export interface NewsSettings {
  routine: boolean
  popup: boolean
  topics: Record<string, TopicSettings>
}

export interface NewsStatus {
  /** Changes on every start of the server */
  bootId: string
  state: 'idle' | 'running' | 'ready' | 'error'
  date: string
  todayReady: boolean
  startedAt?: string
  finishedAt?: string
  lastError?: string
  fetchedAt?: string
  settings: NewsSettings
}

export const getStatus = () => api.get<NewsStatus>('/news/status')
/** The update of one day (yyyy-mm-dd); without a day, today (Monday: the weekend) */
export const getToday = (day?: string) => api.get<TodayUpdate>(`/news/today${day ? `?date=${encodeURIComponent(day)}` : ''}`)
export const saveNewsSettings = (patch: Partial<NewsSettings> | { topics: Record<string, Partial<TopicSettings>> }) => api.put<NewsSettings>('/news/settings', patch)

/** Local date as yyyy-mm-dd */
export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const fmtDate = (iso?: string) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '')
const fmtDates = (dates: string[]) => dates.map((d) => fmtDate(d)).join(' e ')

/** Items of the enabled topics (optionally only those listed in the popup) */
export function itemsOf(data: TodayUpdate, popupOnly = false): TopicItem[] {
  return data.topics.filter((t) => t.enabled && (!popupOnly || t.popup)).flatMap((t) => t.items)
}

/** The traffic light: green when nothing was published, red for a priority 1, yellow otherwise */
export function trafficLight(items: TopicItem[], dates: string[]): { tone: 'green' | 'yellow' | 'red'; title: string; text: string } {
  if (!items.length) return { tone: 'green', title: 'Sem atualizações', text: `Nenhum boletim publicado em ${fmtDates(dates)}. Tudo certo.` }
  const top = Math.min(...items.map((i) => i.priority ?? 2))
  const n = `${items.length} ${items.length === 1 ? 'atualização' : 'atualizações'}`
  if (top <= 1) return { tone: 'red', title: 'Atualização de prioridade 1', text: `${n} com prioridade 1: aplique o quanto antes.` }
  return { tone: 'yellow', title: 'Atualizações de prioridade 2 ou mais', text: `${n} para revisar.` }
}

/** The traffic light, as a dot with the summary next to it */
export function TrafficLight({ items, dates }: { items: TopicItem[]; dates: string[] }) {
  const l = trafficLight(items, dates)
  return (
    <div className={`sf-light ${l.tone}`} role="status">
      <span className="sf-light-dot" aria-hidden />
      <div>
        <strong>{l.title}</strong>
        <span>{l.text}</span>
      </div>
    </div>
  )
}

/** The cards of one topic. A topic with nothing for the days searched says so. */
export function TopicCards({ topic, dates, compact = false, inPopup = false }: { topic: TopicView; dates: string[]; compact?: boolean; inPopup?: boolean }) {
  if (!topic.items.length) {
    return (
      <div className="sf-faint" style={{ fontSize: 13 }}>
        Nenhum item publicado em {fmtDates(dates)}.{' '}
        {topic.latestPublished && !dates.includes(topic.latestPublished) &&
          (inPopup ? (
            <a href="/atualizacao">Ver outros dias na página de atualização</a>
          ) : (
            <>O mais recente é de {fmtDate(topic.latestPublished)}: escolha essa data acima.</>
          ))}
      </div>
    )
  }
  return (
    <>
      {topic.items.slice(0, compact ? 6 : 60).map((b) => (
        <article key={b.id} className={`sf-upd-item tone-${b.tone}`}>
          <div className="sf-upd-item-top">
            <a href={b.url} target="_blank" rel="noreferrer" className="sf-upd-title">
              {b.id} · {b.title}
            </a>
            <span className="sf-faint" style={{ fontSize: 12 }}>
              {fmtDate(b.date)}
              {b.priority !== undefined && ` · prioridade ${b.priority}`}
            </span>
          </div>
          {b.tags.length > 0 && (
            <div className="sf-chips" style={{ marginTop: 6 }}>
              {b.tags.map((t) => (
                <span key={t} className="sf-badge">
                  {t}
                </span>
              ))}
            </div>
          )}
          {b.actions.length > 0 && (
            <div className="sf-row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              {b.actions.map((a) => (
                <a key={a.url} className="sf-btn small accent" href={a.url} target="_blank" rel="noreferrer">
                  {a.label} ↗
                </a>
              ))}
            </div>
          )}
          {b.lines.length > 0 && (
            <ul className="sf-upd-installs">
              {b.lines.map((l, i) => (
                <li key={i} className="sf-faint" style={{ fontSize: 12.5 }}>
                  {l}
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </>
  )
}
