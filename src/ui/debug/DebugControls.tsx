import { useEffect } from 'react'
import { useDebug } from '../../debug/useDebug'

const SPEEDS = [0.5, 1, 2, 4]

/** Bottom bar: start/pause, single-step, speed and progress of the debug session. */
export function DebugControls() {
  const { traces, stepIndex, executed, phase, playing, speed, play, pause, stepFrame, nextStep, restart, setSpeed, close } = useDebug()
  const trace = traces[stepIndex]
  const total = traces.reduce((n, t) => n + t.frames.length, 0)
  const done = traces.slice(0, stepIndex).reduce((n, t) => n + t.frames.length, 0) + executed
  const current = trace?.frames[executed - 1]

  // Keyboard: space = play/pause, → = next frame, shift+→ = next step
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Typing in a text field (e.g. the search) must not drive the debugger; checkboxes are fine
      const target = e.target as HTMLInputElement
      if ((target.tagName === 'INPUT' && target.type !== 'checkbox') || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return
      if (e.code === 'Space') {
        e.preventDefault()
        if (useDebug.getState().playing) pause()
        else play()
      }
      if (e.code === 'ArrowRight') {
        e.preventDefault()
        if (e.shiftKey) nextStep()
        else stepFrame()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [play, pause, stepFrame, nextStep])

  const label = phase === 'idle' ? 'Iniciar' : phase === 'done' ? 'Repetir' : 'Continuar'

  return (
    <section className="tracker card debug-controls">
      <div className="debug-buttons">
        {playing ? (
          <button className="primary-btn" onClick={pause}>
            ❚❚ Pausar
          </button>
        ) : (
          <button className="primary-btn" onClick={play}>
            ▶ {label}
          </button>
        )}
        <button className="icon-btn" onClick={stepFrame} title="Próxima chamada (→)">
          ⏵
        </button>
        <button className="icon-btn" onClick={nextStep} title="Próxima etapa (Shift+→)">
          ⏭
        </button>
        <button className="icon-btn" onClick={restart} title="Reiniciar do começo">
          ↺
        </button>
        <div className="segmented">
          {SPEEDS.map((v) => (
            <button key={v} className={speed === v ? 'on' : ''} onClick={() => setSpeed(v)}>
              {v}×
            </button>
          ))}
        </div>
      </div>

      <div className="debug-now">
        <span className="eyebrow">
          {phase === 'walking' ? 'Indo para a próxima etapa…' : phase === 'done' ? 'Fluxo concluído' : `Chamada ${executed} de ${trace?.frames.length ?? 0}`}
        </span>
        <strong className="mono">{phase === 'walking' ? trace?.step.request : (current?.label ?? 'Pronto para iniciar')}</strong>
        <div className="debug-progress">
          <span style={{ width: `${(done / Math.max(1, total)) * 100}%` }} />
        </div>
      </div>

      <button className="link-btn" onClick={close}>
        Sair do debug
      </button>
    </section>
  )
}
