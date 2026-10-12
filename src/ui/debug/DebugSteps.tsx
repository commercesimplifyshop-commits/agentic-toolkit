import { zoneById } from '../../domain/zones'
import { SCENARIO } from '../../debug/scenario'
import { useDebug } from '../../debug/useDebug'

/** Left column: the flow script, one row per request/step. */
export function DebugSteps() {
  const { traces, stepIndex, executed, phase, goToStep } = useDebug()
  return (
    <nav className="flownav card debug-steps">
      <div className="panel-title">Roteiro do fluxo</div>
      <p className="muted small scenario-name">{SCENARIO.name}</p>
      <ol>
        {traces.map((t, i) => {
          const state = i < stepIndex || (i === stepIndex && phase === 'done') ? 'done' : i === stepIndex ? 'current' : 'pending'
          const progress = i === stepIndex ? executed / Math.max(1, t.frames.length) : state === 'done' ? 1 : 0
          return (
            <li key={t.step.id}>
              <button className={`flow-item step-${state}`} onClick={() => goToStep(i)}>
                <span className="num" style={{ background: zoneById(t.step.zone).color }}>
                  {state === 'done' ? '✓' : i + 1}
                </span>
                <span className="flow-name">
                  {t.step.title}
                  <span className="step-progress">
                    <span style={{ width: `${progress * 100}%` }} />
                  </span>
                </span>
                {t.counts.custom + t.counts.thirdparty > 0 && <span className="custom-chip">{t.counts.custom + t.counts.thirdparty}</span>}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
