import { useEffect, useState } from 'react'
import { api } from '../api'

interface Rules {
  principle: string
  dataDir: string
  actions: { id: string; kind: string; methods: string[]; description: string; validated: boolean }[]
  claude: { allowedTools: string[]; deniedTools: string[] }
}
interface SelfTest {
  ok: boolean
  checks: { id: string; label: string; ok: boolean; detail?: string }[]
}
interface AuditEntry {
  at: string
  action: string
  kind: string
  method: string
  url: string
  verdict: 'allowed' | 'blocked'
  rule?: string
  detail?: string
}

/** The read-only rule, made visible: what is allowed, proof that it holds, and every action taken. */
export function AuditPage() {
  const [rules, setRules] = useState<Rules | null>(null)
  const [test, setTest] = useState<SelfTest | null>(null)
  const [log, setLog] = useState<AuditEntry[]>([])

  useEffect(() => {
    api.get<Rules>('/system/rules').then(setRules)
    api.get<SelfTest>('/system/selftest').then(setTest)
    const load = () => api.get<AuditEntry[]>('/system/audit').then(setLog).catch(() => undefined)
    load()
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="sf-page">
      <div className="sf-page-head">
        <div className="sf-page-icon">⛬</div>
        <div className="sf-page-title">
          <h1>Regras & auditoria</h1>
          <p>{rules?.principle}</p>
        </div>
        {test && <span className={`sf-badge ${test.ok ? 'green' : 'red'}`}>{test.ok ? '✓ autoteste ok' : '✕ autoteste falhou'}</span>}
      </div>

      <div className="sf-grid two">
        <div className="sf-card">
          <h2>Autoteste das proteções</h2>
          <span className="sub">Cada proteção é exercitada agora e precisa bloquear o que deveria</span>
          {test?.checks.map((c) => (
            <div key={c.id} className="sf-check">
              <span className={`ic ${c.ok ? 'ok' : 'no'}`}>{c.ok ? '✓' : '✕'}</span>
              <span>{c.label}</span>
            </div>
          ))}
        </div>
        <div className="sf-card">
          <h2>Como a regra é aplicada</h2>
          <span className="sub">Diretório de dados: {rules?.dataDir}</span>
          <ul className="sf-muted" style={{ paddingLeft: 18, lineHeight: 1.7, fontSize: 12.5, margin: 0 }}>
            <li>Toda rota da API declara uma ação; rota sem ação é bloqueada (fail closed).</li>
            <li>Cada ação tem método HTTP permitido e validador próprio, executado antes do handler.</li>
            <li>O acesso ao código passa por uma camada que só lê, bloqueia ../, links simbólicos para fora e arquivos de credenciais.</li>
            <li>Escrita só no diretório de dados do Agentic Toolkit, nunca dentro de uma instalação Magento.</li>
            <li>Comandos externos têm allowlist: git só leitura/clone (push desativado), scripts do analyzer e Claude Code com {rules?.claude.allowedTools.join(', ')}.</li>
            <li>Tudo é registrado abaixo, inclusive as tentativas bloqueadas.</li>
          </ul>
        </div>
      </div>

      <div className="sf-section-title">Ações da API</div>
      <div className="sf-card" style={{ padding: 0 }}>
        <table className="sf-table">
          <thead>
            <tr>
              <th>Ação</th>
              <th style={{ width: 110 }}>Tipo</th>
              <th style={{ width: 110 }}>Métodos</th>
              <th style={{ width: 110 }}>Validador</th>
              <th>Descrição</th>
            </tr>
          </thead>
          <tbody>
            {rules?.actions.map((a) => (
              <tr key={a.id}>
                <td className="sf-mono">{a.id}</td>
                <td>{a.kind === 'read' ? <span className="sf-badge green">leitura</span> : a.kind === 'external' ? <span className="sf-badge orange">requisição externa</span> : a.kind === 'repo-exception' ? <span className="sf-badge red">exceção de escrita</span> : a.kind === 'repo-write' ? <span className="sf-badge red">escrita no repositório</span> : <span className="sf-badge blue">dados Agentic Toolkit</span>}</td>
                <td className="sf-mono sf-muted">{a.methods.join(', ')}</td>
                <td>{a.validated ? '✓ próprio' : <span className="sf-faint">guarda global</span>}</td>
                <td className="sf-muted" style={{ fontSize: 12.5 }}>
                  {a.description}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sf-section-title">Log de auditoria</div>
      <div className="sf-card" style={{ padding: 0 }}>
        <table className="sf-table">
          <thead>
            <tr>
              <th style={{ width: 90 }}>Hora</th>
              <th style={{ width: 100 }}>Resultado</th>
              <th style={{ width: 180 }}>Ação</th>
              <th>Requisição</th>
            </tr>
          </thead>
          <tbody>
            {log.slice(0, 150).map((e, i) => (
              <tr key={i}>
                <td className="sf-mono sf-muted">{new Date(e.at).toLocaleTimeString('pt-BR')}</td>
                <td>{e.verdict === 'allowed' ? <span className="sf-badge green">permitido</span> : <span className="sf-badge red">bloqueado</span>}</td>
                <td className="sf-mono">{e.action}</td>
                <td className="sf-mono" style={{ overflowWrap: 'anywhere' }}>
                  {e.method} {decodeURIComponent(e.url)}
                  {e.rule && <div style={{ color: '#f87171' }}>{e.rule}: {e.detail}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
