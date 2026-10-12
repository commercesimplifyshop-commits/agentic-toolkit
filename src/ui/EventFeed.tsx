import { useStore } from '../store/useStore'
import { clockLabel } from './format'

export function EventFeed() {
  const events = useStore((s) => s.events)
  const select = useStore((s) => s.select)
  return (
    <section className="feed card">
      <div className="panel-title">
        <span className="dot" /> Eventos em tempo real
      </div>
      <ul>
        {events.slice(0, 30).map((e) => (
          <li key={e.id}>
            <button disabled={!e.ref} onClick={() => e.ref && select(e.ref.kind === 'order' ? { kind: 'order', id: e.ref.id } : { kind: 'customer', id: e.ref.id })}>
              <time>{clockLabel(e.at)}</time>
              <span className="feed-text">{e.text}</span>
              <code>{e.magento}</code>
            </button>
          </li>
        ))}
        {events.length === 0 && <li className="empty">A loja está abrindo…</li>}
      </ul>
    </section>
  )
}
