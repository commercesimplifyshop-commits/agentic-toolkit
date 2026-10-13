import { OpenSpecFlowDemo } from './OpenSpecFlowDemo'

/** Presentation tab: what OpenSpec is, the flow animated, and the official site. */
export function OpenSpecTour() {
  return (
    <div className="sf-tour">
      <div className="sf-card" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>OpenSpec: especificação antes do código</h2>
        <p className="sf-muted" style={{ fontSize: 13.5, lineHeight: 1.7, margin: '8px 0 12px' }}>
          O OpenSpec é um fluxo de desenvolvimento guiado por especificações, feito para trabalhar com assistentes de IA como o Claude Code.
          Cada mudança nasce como uma conversa de exploração, vira uma proposta com specs e tarefas, é implementada, validada e arquivada,
          e ao arquivar as specs do sistema são atualizadas. O histórico de cada decisão fica no repositório.
        </p>
        <a className="sf-btn" href="https://openspec.dev" target="_blank" rel="noopener noreferrer">
          Site oficial do OpenSpec ↗
        </a>
      </div>

      <div className="sf-card" style={{ padding: 18 }}>
        <OpenSpecFlowDemo />
      </div>
    </div>
  )
}
