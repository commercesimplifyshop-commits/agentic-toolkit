import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'

/** Mirrors apps/api/src/techs/sfcc/upload.service.ts */
interface DwJsonView {
  found: boolean
  from?: 'tarefa' | 'projeto'
  hostname?: string
  codeVersion?: string
  hasUsername: boolean
  hasPassword: boolean
  twoFactor: boolean
  cartridges?: string[]
  error?: string
}
interface UploadTool {
  id: string
  name: string
  where: string
  how: string
  commands: string[]
}
interface UploadRun {
  mode: 'upload' | 'watch'
  target: string
  targetLabel: string
  cartridges: string[]
  status: 'executando' | 'concluido' | 'falhou' | 'parado'
  startedAt: string
  finishedAt?: string
  log: { at: string; text: string }[]
  error?: string
}
interface Status {
  target: { dir: string; label: string; cardId: string | null }
  dw: DwJsonView
  dwupload: boolean
  tools: UploadTool[]
  cartridges: { name: string; changed: number; clientChanged: boolean; hasStatic: boolean }[]
  run: UploadRun | null
}
interface CardSummary {
  id: string
  title: string
  git?: { branch: string; path: string }
}

const RUN_LABEL: Record<UploadRun['status'], { label: string; tone: string }> = {
  executando: { label: 'em andamento', tone: 'blue' },
  concluido: { label: 'concluído', tone: 'green' },
  falhou: { label: 'falhou', tone: 'red' },
  parado: { label: 'parado', tone: '' },
}

/** How code reaches a Salesforce B2C instance, for someone who knows the Adobe Commerce deploy */
function HowItWorks() {
  return (
    <details className="sf-card sf-upload-how" open>
      <summary>
        <strong>Como o código chega na instância (para quem vem do Adobe)</strong>
      </summary>
      <div className="sf-upload-how-grid">
        <div>
          <h4>No Adobe Commerce</h4>
          <p>
            O código vai para o servidor (git pull ou pipeline) e o próprio servidor roda <code>setup:upgrade</code>, <code>di:compile</code> e <code>static-content:deploy</code>.
          </p>
        </div>
        <div>
          <h4>No Salesforce B2C</h4>
          <p>
            Não há build nem comandos no servidor. Os <strong>cartuchos</strong> são enviados por WebDAV para uma <strong>code version</strong> (uma pasta de código na instância), e a
            versão ativa é a que roda. Na sandbox você sobe para a code version ativa e vê na hora. O JS e o SCSS do cliente são compilados na sua máquina antes.
          </p>
        </div>
      </div>
      <ol className="sf-upload-steps">
        <li>
          <strong>dw.json</strong> na raiz do projeto diz para onde enviar: <code>hostname</code> da sandbox, <code>username</code>, <code>password</code> (senha de acesso ao WebDAV do
          Business Manager ou access key) e <code>code-version</code>. Ele nunca vai para o git.
        </li>
        <li>
          <strong>dwupload</strong> é a ferramenta que envia: zipa o cartucho, sobe, descompacta na code version. O <code>npm run uploadCartridge</code> e o <code>npm run watch</code> do SFRA
          usam ele por baixo.
        </li>
        <li>
          <strong>Upload automático</strong> (<code>npm run watch</code> ou "Iniciar upload automático" aqui) fica observando os cartuchos e sobe cada arquivo que você salva. É o jeito do dia a
          dia na sandbox.
        </li>
        <li>
          <strong>Cartridge path</strong> do site (Business Manager → Administration → Sites → Manage Sites → Settings) decide quais cartuchos rodam e em que ordem. Cartucho novo só roda depois
          de entrar no path.
        </li>
        <li>
          <strong>Code version ativa</strong> fica em Administration → Site Development → Code Deployment. Se subir para uma versão que não está ativa, ative-a lá para ver a mudança.
        </li>
      </ol>
    </details>
  )
}

export function SfccUploadPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const cardId = params.get('card') ?? ''
  const [status, setStatus] = useState<Status | null>(null)
  const [cards, setCards] = useState<CardSummary[]>([])
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string[] | null>(null)
  const [confirm, setConfirm] = useState<'upload' | 'watch' | null>(null)
  const [busy, setBusy] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  const load = useCallback(
    () =>
      api
        .get<Status>(`/workspaces/${id}/sfcc/upload${cardId ? `?card=${cardId}` : ''}`)
        .then((s) => {
          setStatus(s)
          setError('')
        })
        .catch((e) => setError((e as Error).message)),
    [id, cardId],
  )

  useEffect(() => {
    setStatus(null)
    setSelected(null)
    load()
  }, [load])
  useEffect(() => {
    api
      .get<CardSummary[]>(`/workspaces/${id}/refine/cards`)
      .then((c) => setCards(c.filter((x) => x.git)))
      .catch(() => setCards([]))
  }, [id])

  const running = status?.run?.status === 'executando'
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(load, 2000)
    return () => window.clearInterval(t)
  }, [running, load])
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [status?.run?.log.length])

  // the cartridges changed in the task (or in the project) come checked
  const chosen = selected ?? (status ? status.cartridges.filter((c) => c.changed > 0).map((c) => c.name) : [])
  const toggle = (name: string) => setSelected(chosen.includes(name) ? chosen.filter((c) => c !== name) : [...chosen, name])

  const start = async (mode: 'upload' | 'watch') => {
    setBusy(true)
    setError('')
    try {
      await api.post(`/workspaces/${id}/sfcc/upload`, { cardId: cardId || undefined, cartridges: chosen, mode })
      setConfirm(null)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const stop = async () => {
    setBusy(true)
    try {
      await api.post(`/workspaces/${id}/sfcc/upload/stop`, {})
      window.setTimeout(load, 800)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const dw = status?.dw
  const ready = Boolean(dw?.found && !dw.error && dw.hostname && (dw.hasUsername || dw.twoFactor) && status?.dwupload)
  const missingStatic = status?.cartridges.filter((c) => chosen.includes(c.name) && c.clientChanged) ?? []

  return (
    <div className="sf-page sf-upload">
      <div className="sf-page-head">
        <div className="sf-page-icon">⇪</div>
        <div className="sf-page-title">
          <h1>Upload para a instância</h1>
          <p>Envie os cartuchos para a sandbox com a ferramenta do próprio projeto (dwupload e dw.json), de uma vez ou em upload automático enquanto você trabalha.</p>
        </div>
      </div>

      {error && <div className="sf-callout red">{error}</div>}
      <HowItWorks />

      <div className="sf-card">
        <div className="sf-section-title">De onde enviar</div>
        <div className="sf-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select
            className="sf-input"
            style={{ maxWidth: 520 }}
            value={cardId}
            disabled={running}
            onChange={(e) => setParams(e.target.value ? { card: e.target.value } : {})}
          >
            <option value="">Projeto (pasta principal)</option>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                Tarefa: {c.title} ({c.git!.branch})
              </option>
            ))}
          </select>
          {cardId && (
            <Link className="sf-link" to={`/w/${id}/refinamento/${cardId}`}>
              abrir o card →
            </Link>
          )}
        </div>
        {status && <div className="sf-faint sf-mono" style={{ fontSize: 12, marginTop: 6 }}>{status.target.dir}</div>}
      </div>

      {!status && !error && <span className="sf-spinner" />}
      {status && (
        <>
          <div className="sf-upload-cols">
            <div className="sf-card">
              <div className="sf-section-title">dw.json</div>
              {!dw!.found ? (
                <div className="sf-callout orange" style={{ fontSize: 13 }}>
                  Não encontrei o <code>dw.json</code> na raiz do projeto. Crie um com <code>hostname</code>, <code>username</code>, <code>password</code> e <code>code-version</code> da sua
                  sandbox, e confira que <code>dw.json</code> está no <code>.gitignore</code>.
                </div>
              ) : dw!.error ? (
                <div className="sf-callout red">{dw!.error}</div>
              ) : (
                <dl className="sf-upload-dl">
                  <dt>Instância</dt>
                  <dd className="sf-mono">{dw!.hostname ?? <span className="sf-badge orange">sem hostname</span>}</dd>
                  <dt>Code version</dt>
                  <dd className="sf-mono">{dw!.codeVersion ?? 'version1 (padrão do dwupload)'}</dd>
                  <dt>Credenciais</dt>
                  <dd>
                    {dw!.hasUsername ? <span className="sf-badge green">usuário configurado</span> : <span className="sf-badge orange">sem usuário</span>}{' '}
                    {dw!.hasPassword ? <span className="sf-badge green">senha configurada</span> : <span className="sf-badge orange">sem senha</span>}{' '}
                    {dw!.twoFactor && <span className="sf-badge">certificado p12</span>}
                  </dd>
                  <dt>Lido de</dt>
                  <dd>{dw!.from === 'tarefa' ? 'worktree da tarefa' : 'raiz do projeto'}</dd>
                </dl>
              )}
              <div className="sf-faint" style={{ fontSize: 11.5, marginTop: 6 }}>Usuário e senha nunca são mostrados nem enviados para o Claude.</div>
              {!status.dwupload && (
                <div className="sf-callout orange" style={{ fontSize: 13, marginTop: 8 }}>
                  O dwupload não está instalado. Na pasta do projeto, rode <code>npm install</code> (ele vem com o sgmf-scripts do SFRA).
                </div>
              )}
            </div>

            <div className="sf-card">
              <div className="sf-section-title">Ferramentas de upload deste projeto</div>
              {status.tools.length === 0 && <div className="sf-faint" style={{ fontSize: 13 }}>Nenhuma encontrada no package.json, no node_modules nem no VS Code.</div>}
              {status.tools.map((t) => (
                <div key={t.id} className="sf-upload-tool">
                  <strong>{t.name}</strong>
                  <div className="sf-faint" style={{ fontSize: 11.5 }}>{t.where}</div>
                  <p>{t.how}</p>
                  <div className="sf-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {t.commands.map((c) => (
                      <code key={c} className="sf-upload-cmd">
                        {c}
                      </code>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="sf-card">
            <div className="sf-row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div className="sf-section-title" style={{ margin: 0 }}>
                Cartuchos <span className="sf-faint">({chosen.length} escolhidos)</span>
              </div>
              <div className="sf-row" style={{ gap: 6 }}>
                <button className="sf-link" disabled={running} onClick={() => setSelected(status.cartridges.filter((c) => c.changed > 0).map((c) => c.name))}>
                  só os alterados
                </button>
                <button className="sf-link" disabled={running} onClick={() => setSelected(status.cartridges.map((c) => c.name))}>
                  todos
                </button>
              </div>
            </div>
            {status.cartridges.length === 0 && <div className="sf-faint" style={{ fontSize: 13 }}>Nenhum cartucho em cartridges/.</div>}
            <div className="sf-upload-carts">
              {status.cartridges.map((c) => (
                <label key={c.name} className={`sf-upload-cart ${chosen.includes(c.name) ? 'on' : ''}`}>
                  <input type="checkbox" checked={chosen.includes(c.name)} disabled={running} onChange={() => toggle(c.name)} />
                  <span className="sf-mono">{c.name}</span>
                  {c.changed > 0 && <span className="sf-badge blue">{c.changed} alterado(s)</span>}
                  {/^app_storefront_base$|^(int|plugin|link|bm)_/.test(c.name) && <span className="sf-badge">base/terceiro</span>}
                </label>
              ))}
            </div>
            {missingStatic.length > 0 && (
              <div className="sf-callout orange" style={{ fontSize: 13 }}>
                {missingStatic.map((c) => c.name).join(', ')}: há mudanças em <code>cartridge/client</code> (JS ou SCSS). Compile antes de enviar (<code>npm run compile:js</code> e{' '}
                <code>npm run compile:scss</code> na pasta enviada), senão a instância fica com o static antigo.
              </div>
            )}

            {confirm ? (
              <div className="sf-callout orange" style={{ fontSize: 13 }}>
                <strong>{confirm === 'watch' ? 'Iniciar o upload automático?' : 'Enviar agora?'}</strong>
                <div style={{ margin: '4px 0 8px' }}>
                  {confirm === 'watch'
                    ? `Envia ${chosen.join(', ')} agora e, até você parar, cada arquivo salvo nesses cartuchos`
                    : `Substitui ${chosen.join(', ')}`}{' '}
                  em <span className="sf-mono">{dw?.hostname}</span>, code version <span className="sf-mono">{dw?.codeVersion ?? 'version1'}</span>. Quem estiver usando essa instância vê a
                  mudança.
                </div>
                <div className="sf-row" style={{ gap: 6 }}>
                  <button className="sf-btn small" onClick={() => setConfirm(null)} disabled={busy}>
                    Cancelar
                  </button>
                  <button className="sf-btn small accent" onClick={() => start(confirm)} disabled={busy}>
                    {busy ? 'Iniciando…' : confirm === 'watch' ? 'Iniciar upload automático' : 'Enviar'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="sf-row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {running ? (
                  <button className="sf-btn" onClick={stop} disabled={busy}>
                    ■ Parar {status.run?.mode === 'watch' ? 'upload automático' : 'upload'}
                  </button>
                ) : (
                  <>
                    <button className="sf-btn accent" disabled={!ready || chosen.length === 0} onClick={() => setConfirm('upload')}>
                      Enviar cartuchos
                    </button>
                    <button className="sf-btn" disabled={!ready || chosen.length === 0} onClick={() => setConfirm('watch')}>
                      Iniciar upload automático
                    </button>
                  </>
                )}
                {!ready && <span className="sf-faint" style={{ fontSize: 12 }}>Configure o dw.json e instale o dwupload para enviar.</span>}
              </div>
            )}
          </div>

          {status.run && (
            <div className="sf-card">
              <div className="sf-row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <div className="sf-section-title" style={{ margin: 0 }}>
                  {status.run.mode === 'watch' ? 'Upload automático' : 'Upload'} <span className={`sf-badge ${RUN_LABEL[status.run.status].tone}`}>{RUN_LABEL[status.run.status].label}</span>
                </div>
                <span className="sf-faint" style={{ fontSize: 12 }}>{status.run.targetLabel}</span>
              </div>
              {status.run.mode === 'watch' && running && (
                <div className="sf-faint" style={{ fontSize: 12.5, margin: '4px 0' }}>
                  Observando {status.run.cartridges.join(', ')}. Cada arquivo salvo aparece aqui ao subir. Pode sair desta tela: o upload continua até você parar.
                </div>
              )}
              <div ref={logRef} className="sf-upload-log sf-mono">
                {status.run.log.map((l, i) => (
                  <div key={i}>
                    <span className="sf-faint">{new Date(l.at).toLocaleTimeString()}</span> {l.text}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
