import { useEffect, useState } from 'react'

/**
 * Illustrative, node-based walkthrough of the OpenSpec flow (in the spirit of workflow editors):
 * a sample change, "nova-mudanca", travels from exploring to archive. The packet moves along
 * the connections and each node lights up when it is reached. It does not read the installation.
 */

// Node centres in a 900 x 340 canvas (px)
const W = 900
const H = 340
const NODE_W = 124
const NODE_H = 74
const MAIN_Y = 120

const MAIN = {
  explorar: { x: 80, label: 'Explorar', cmd: '/opsx:explore' },
  propor: { x: 230, label: 'Propor', cmd: '/opsx:propose' },
  implementar: { x: 380, label: 'Implementar', cmd: '/opsx:apply' },
  validar: { x: 530, label: 'Verificar', cmd: '/opsx:verify' },
  arquivar: { x: 680, label: 'Arquivar', cmd: '/opsx:archive' },
  arquivada: { x: 830, label: 'Arquivada', cmd: 'histórico' },
} as const

const ART_Y = 262 // secondary row: artifacts created by propose, and what archive writes

type MainKey = keyof typeof MAIN

/** Edge: straight horizontal between two main nodes, or a vertical drop to a secondary node */
interface Edge {
  id: string
  d: string
}

const edge = (id: string, x1: number, y1: number, x2: number, y2: number): Edge => {
  const mx = (x1 + x2) / 2
  return { id, d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}` }
}

const EDGES: Record<string, Edge> = {
  e1: edge('e1', MAIN.explorar.x + NODE_W / 2, MAIN_Y, MAIN.propor.x - NODE_W / 2, MAIN_Y),
  e2: edge('e2', MAIN.propor.x, MAIN_Y + NODE_H / 2, MAIN.propor.x, ART_Y - 26),
  e3: edge('e3', MAIN.propor.x + NODE_W / 2, MAIN_Y, MAIN.implementar.x - NODE_W / 2, MAIN_Y),
  e4: edge('e4', MAIN.implementar.x + NODE_W / 2, MAIN_Y, MAIN.validar.x - NODE_W / 2, MAIN_Y),
  e5: edge('e5', MAIN.validar.x + NODE_W / 2, MAIN_Y, MAIN.arquivar.x - NODE_W / 2, MAIN_Y),
  e6: edge('e6', MAIN.arquivar.x + NODE_W / 2, MAIN_Y, MAIN.arquivada.x - NODE_W / 2, MAIN_Y),
  e7: edge('e7', MAIN.arquivar.x, MAIN_Y + NODE_H / 2, MAIN.arquivar.x, ART_Y - 26),
}

/** Which edges carry the packet at each step, and the nodes/artifacts that are active */
const STEPS: {
  label: string
  what: string
  packets: string[]
  active: MainKey
  done: MainKey[]
  artifacts: boolean
  tasks: number
  archive: boolean
}[] = [
  { label: 'Explorar', what: 'Você conversa com o Claude sobre a ideia. Ele lê o código e não escreve nada.', packets: ['e1'], active: 'explorar', done: [], artifacts: false, tasks: 0, archive: false },
  { label: 'Propor', what: 'O /opsx:propose cria a proposta, as specs em delta e as tarefas da mudança.', packets: ['e2'], active: 'propor', done: ['explorar'], artifacts: true, tasks: 0, archive: false },
  { label: 'Propor → Implementar', what: 'A mudança segue para a implementação, com as tarefas em tasks.md.', packets: ['e3'], active: 'implementar', done: ['explorar', 'propor'], artifacts: true, tasks: 0, archive: false },
  { label: 'Implementar', what: '/opsx:apply implementa as tarefas, marcando cada uma ao concluir.', packets: [], active: 'implementar', done: ['explorar', 'propor'], artifacts: true, tasks: 3, archive: false },
  { label: 'Verificar', what: '/opsx:verify confere se a implementação bate com os artefatos antes de arquivar.', packets: ['e4'], active: 'validar', done: ['explorar', 'propor', 'implementar'], artifacts: true, tasks: 3, archive: false },
  { label: 'Arquivar', what: '/opsx:archive move a mudança para archive/ e incorpora os deltas nas specs principais.', packets: ['e5', 'e7'], active: 'arquivar', done: ['explorar', 'propor', 'implementar', 'validar'], artifacts: true, tasks: 3, archive: true },
  { label: 'Arquivada', what: 'Pronto: as specs do sistema estão atualizadas e o histórico fica registrado.', packets: ['e6'], active: 'arquivada', done: ['explorar', 'propor', 'implementar', 'validar', 'arquivar'], artifacts: true, tasks: 3, archive: true },
]

const STEP_MS = 2400
const END_HOLD_MS = 3500

export function OpenSpecFlowDemo() {
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(true)
  const last = STEPS.length - 1

  // Loop: after the last step the flow rests briefly on "Arquivada", then starts again
  useEffect(() => {
    if (!playing) return
    const t = setTimeout(() => setStep((s) => (s >= last ? 0 : s + 1)), step >= last ? END_HOLD_MS : STEP_MS)
    return () => clearTimeout(t)
  }, [playing, step, last])

  const reset = () => {
    setStep(0)
    setPlaying(true)
  }

  const cur = STEPS[step]
  const isDone = (k: MainKey) => cur.done.includes(k)
  const isActive = (k: MainKey) => cur.active === k

  return (
    <div className="sf-card sf-flowdemo" style={{ marginBottom: 14 }}>
      <div className="sf-card-head">
        <h2>Como o fluxo funciona</h2>
        <span className="sub" style={{ margin: 0 }}>
          Exemplo ilustrativo: a mudança <span className="sf-mono">nova-mudanca</span> percorre o fluxo
        </span>
      </div>

      <div className="sf-flowdemo-scroll">
        <div className="sf-flowdemo-canvas" style={{ width: W, height: H }}>
          <svg width={W} height={H} className="sf-flowdemo-svg" aria-hidden="true">
            {Object.entries(EDGES).map(([id, e]) => {
              const carries = cur.packets.includes(id)
              const passed = isEdgePassed(id, step)
              return (
                <g key={id}>
                  <path id={id} d={e.d} className={`edge ${passed ? 'passed' : ''} ${carries ? 'live' : ''}`} />
                </g>
              )
            })}
            {/* The packet: restarts whenever the step changes */}
            {cur.packets.map((pid) => (
              <circle key={`${step}-${pid}`} r="7" className="packet">
                <animateMotion dur={`${STEP_MS / 1000 - 0.4}s`} begin="0s" fill="freeze" calcMode="spline" keySplines="0.4 0 0.2 1" keyTimes="0;1">
                  <mpath href={`#${pid}`} />
                </animateMotion>
              </circle>
            ))}
          </svg>

          {(Object.keys(MAIN) as MainKey[]).map((k) => (
            <div
              key={k}
              className={`sf-flownode ${isActive(k) ? 'active' : ''} ${isDone(k) ? 'done' : ''}`}
              style={{ left: MAIN[k].x - NODE_W / 2, top: MAIN_Y - NODE_H / 2, width: NODE_W, height: NODE_H }}
            >
              <span className="name">{MAIN[k].label}</span>
              <code>{MAIN[k].cmd}</code>
              {k === 'implementar' && cur.tasks > 0 && (
                <span className="tasks">
                  {cur.tasks}/3 tarefas
                </span>
              )}
            </div>
          ))}

          <div
            className={`sf-flownode art ${cur.artifacts ? 'show' : ''}`}
            style={{ left: MAIN.propor.x - 110, top: ART_Y - 26, width: 220, height: 52 }}
          >
            <span className="name">Artefatos da mudança</span>
            <code>proposal.md · specs/ · tasks.md</code>
          </div>

          <div
            className={`sf-flownode art ${cur.archive ? 'show' : ''}`}
            style={{ left: MAIN.arquivar.x - 110, top: ART_Y - 26, width: 220, height: 52 }}
          >
            <span className="name">Arquivo e specs</span>
            <code>changes/archive/nova-mudanca · specs atualizadas</code>
          </div>

          <div className="sf-flowdemo-badge" style={{ left: MAIN.explorar.x - 60, top: 20 }}>
            {step === 0 ? 'ideia' : cur.label}
          </div>
        </div>
      </div>

      <div className="sf-flowdemo-detail">
        <span className="sf-faint" style={{ fontSize: 12 }}>
          Passo {step + 1} de {STEPS.length} · {cur.label}
        </span>
        <p>{cur.what}</p>
      </div>

      <div className="sf-row" style={{ gap: 8, marginTop: 6 }}>
        <button className="sf-btn small" onClick={() => setPlaying((p) => !p)}>
          {playing ? '❚❚ Pausar' : '▶ Continuar'}
        </button>
        <button className="sf-btn small" onClick={() => setStep((s) => (s >= last ? 0 : s + 1))}>
          Próximo passo
        </button>
        <button className="sf-btn small" onClick={reset}>
          Recomeçar
        </button>
      </div>
    </div>
  )
}

/** An edge counts as passed once the packet has already gone over it in an earlier step */
function isEdgePassed(id: string, step: number) {
  const order = STEPS.slice(0, step).flatMap((s) => s.packets)
  return order.includes(id)
}
