import { Fragment, useEffect, useState } from 'react'

export interface FlowStep {
  icon: string
  title: string
  /** Where this happens: a Business Manager menu or a folder of the project */
  where?: string
  detail: string
}

/** Time each step stays on screen, and how long the last one is held before the loop restarts */
const STEP_MS = 3200
const HOLD_MS = 3800

/**
 * n8n-style flow: a row of nodes joined by edges. The active node lights up, its edge carries a
 * moving pulse, and the explanation below follows. Plays on loop; a click on a node pauses on it.
 */
export function FlowStory({ steps, label }: { steps: FlowStep[]; label: string }) {
  const [active, setActive] = useState(0)
  const [playing, setPlaying] = useState(true)

  useEffect(() => {
    if (!playing) return
    const last = active === steps.length - 1
    const t = setTimeout(() => setActive((a) => (a + 1) % steps.length), last ? HOLD_MS : STEP_MS)
    return () => clearTimeout(t)
  }, [active, playing, steps.length])

  const step = steps[active]
  const go = (i: number) => {
    setActive(i)
    setPlaying(false)
  }

  return (
    <div className="sf-tut-flow" aria-label={label}>
      <div className="sf-tut-track" role="list">
        {steps.map((s, i) => (
          <Fragment key={i}>
            <button
              type="button"
              role="listitem"
              className={`sf-tut-node ${i === active ? 'on' : i < active ? 'done' : ''}`}
              aria-current={i === active ? 'step' : undefined}
              onClick={() => go(i)}
            >
              <span className="sf-tut-num">{i + 1}</span>
              <span className="sf-tut-icon" aria-hidden>
                {s.icon}
              </span>
              <strong>{s.title}</strong>
            </button>
            {i < steps.length - 1 && (
              <span className={`sf-tut-edge ${i < active ? 'done' : i === active ? 'live' : ''}`} aria-hidden>
                <i />
              </span>
            )}
          </Fragment>
        ))}
      </div>

      <div className="sf-tut-detail">
        <div className="sf-tut-controls">
          <button type="button" className="sf-btn small" onClick={() => go(Math.max(0, active - 1))} disabled={active === 0}>
            ← Anterior
          </button>
          <button type="button" className="sf-btn small" onClick={() => setPlaying((p) => !p)}>
            {playing ? 'Pausar' : 'Reproduzir'}
          </button>
          <button type="button" className="sf-btn small" onClick={() => go((active + 1) % steps.length)}>
            Próximo →
          </button>
          <span className="sf-faint" style={{ marginLeft: 'auto', fontSize: 12 }}>
            Passo {active + 1} de {steps.length}
          </span>
        </div>
        <h3 className="sf-tut-title">
          {step.icon} {step.title}
        </h3>
        {step.where && <div className="sf-tut-where">Onde: {step.where}</div>}
        <p>{step.detail}</p>
      </div>
    </div>
  )
}
