import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { InstallModal, NewSpecModal } from './OpenSpecWrite'
import { OpenSpecExplore } from './OpenSpecExplore'
import { OpenSpecTour } from './OpenSpecTour'
import { ChangeStages, OpenSpecTree, SpecCards, changeHref, specHref } from './OpenSpecExplorer'
import { NewChangeStart, ProposalReview, type Attached, type ProposalPackage } from './OpenSpecPropose'
import { CHANGE_LABEL, type Overview } from './openspec-model'

interface ExploreMeta {
  id: string
  title: string
  updatedAt: string
  turns: number
  linkedChange: string | null
}

/**
 * The OpenSpec home: the folder structure on the left, the progress of every change and spec on the right.
 * A new change starts as a conversation (the task is refined with Claude), then becomes a complete
 * proposal the engineer reviews before it is created.
 */
export function OpenSpecPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState<Overview | null>(null)
  const [explores, setExplores] = useState<ExploreMeta[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [prompt, setPrompt] = useState<{ title: string; text: string } | null>(null)
  const [installing, setInstalling] = useState(false)
  const [starting, setStarting] = useState(false)
  const [creatingSpec, setCreatingSpec] = useState(false)
  /** The explore drawer: a conversation, a new one, or a new one that starts with the task text */
  const [chat, setChat] = useState<{ sid: string | null; startWith?: { message: string; attachments: Attached[] } } | null>(null)
  /** The complete change Claude wrote, waiting for review, and the conversation it came from */
  const [review, setReview] = useState<{ pkg: ProposalPackage; sid: string } | null>(null)
  const [proposing, setProposing] = useState(false)
  const [panel, setPanel] = useState<'config' | 'tour' | null>(null)

  const load = useCallback(() => {
    api
      .get<Overview>(`/workspaces/${id}/openspec`)
      .then(setData)
      .catch((e) => setError(e.message))
    api
      .get<ExploreMeta[]>(`/workspaces/${id}/openspec/explore/sessions`)
      .then(setExplores)
      .catch(() => undefined)
  }, [id])

  useEffect(load, [load])

  /** Claude reads the whole conversation and writes the complete change; it opens for review, nothing is created yet */
  const proposeFrom = async (sid: string) => {
    setProposing(true)
    setError('')
    try {
      const pkg = await api.post<ProposalPackage>(`/workspaces/${id}/openspec/explore/propose`, { sessionId: sid })
      setReview({ pkg, sid })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setProposing(false)
    }
  }

  const askPrompt = async (kind: string, change?: string) => {
    try {
      const q = `kind=${kind}${change ? `&change=${encodeURIComponent(change)}` : ''}`
      setPrompt(await api.get<{ title: string; text: string }>(`/workspaces/${id}/openspec/prompt?${q}`))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (error && !data) return <div className="sf-page"><div className="sf-callout red">{error}</div></div>
  if (!data) return <div className="sf-page"><span className="sf-spinner" /></div>

  const withErrors = data.changes.filter((c) => c.validation && !c.validation.valid)
  const open = explores.filter((e) => !e.linkedChange)

  return (
    <div className="sf-page sf-openspec">
      <div className="sf-page-head">
        <div className="sf-page-icon">◎</div>
        <div className="sf-page-title">
          <h1>OpenSpec</h1>
          <p>
            {data.installed ? (
              <>
                Pasta <span className="sf-mono">{data.dir}</span> · {data.mapped ? 'mapeada manualmente' : 'detectada automaticamente'}
              </>
            ) : (
              'Desenvolvimento guiado por especificações: proposta, specs, tarefas e arquivamento.'
            )}
          </p>
        </div>
        {data.installed && (
          <div className="sf-row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button className="sf-btn small accent" onClick={() => setStarting(true)} disabled={proposing}>
              + Nova mudança
            </button>
            <button className="sf-btn small" onClick={() => setChat({ sid: null })} disabled={proposing}>
              ✦ Explorar
            </button>
            <button className="sf-btn small" onClick={() => setCreatingSpec(true)}>
              + Nova spec
            </button>
            <button className="sf-btn small" onClick={() => setPanel('tour')}>
              Como funciona
            </button>
            <button className="sf-btn small" onClick={() => setPanel('config')}>
              Configurar
            </button>
          </div>
        )}
      </div>

      {error && <div className="sf-callout red" style={{ marginBottom: 12 }}>{error}</div>}
      <Notice text={notice} onClose={() => setNotice('')} />
      {proposing && (
        <div className="sf-callout orange" style={{ marginBottom: 12 }} role="status">
          <span className="sf-spinner" /> O Claude está escrevendo a mudança completa (proposta, tarefas e specs) a partir da conversa. Isso leva de 1 a 4 minutos; a revisão abre quando terminar.
        </div>
      )}

      {!data.installed ? (
        <NotInstalled id={id} onInstall={() => setInstalling(true)} onPrompt={() => askPrompt('install')} onMapped={() => (load(), setNotice('Pasta mapeada. O painel já lê o OpenSpec dela.'))} onError={setError} />
      ) : (
        <div className="sf-ospage">
          <aside className="sf-ostree">
            <OpenSpecTree id={id} data={data} />
          </aside>
          <div className="sf-ospage-main">
            {withErrors.length > 0 && (
              <div className="sf-callout red" style={{ marginBottom: 14 }}>
                <b>Validação com erros:</b>{' '}
                {withErrors.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && ', '}
                    <a href={changeHref(id, c.id)} onClick={(e) => (e.preventDefault(), navigate(changeHref(id, c.id)))}>
                      {c.id}
                    </a>
                  </span>
                ))}
              </div>
            )}

            {open.length > 0 && (
              <section className="sf-stages" aria-label="Refinamentos em andamento">
                <div className="sf-stages-head">
                  <span className="sf-stages-bar orange" />
                  <strong>Refinando com o Claude</strong>
                  <span className="sf-stages-count">{open.length}</span>
                </div>
                <div className="sf-stages-grid">
                  {open.slice(0, 6).map((e) => (
                    <article key={e.id} className="sf-stage-card">
                      <div className="sf-stage-top">
                        <button className="sf-stage-name" onClick={() => setChat({ sid: e.id })}>
                          {e.title}
                        </button>
                      </div>
                      <div className="sf-faint" style={{ fontSize: 12, marginBottom: 10 }}>
                        {(e.turns / 2) | 0} trocas · {new Date(e.updatedAt).toLocaleDateString('pt-BR')}
                      </div>
                      <div className="sf-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                        <button className="sf-btn small" onClick={() => setChat({ sid: e.id })} disabled={proposing}>
                          Continuar conversa
                        </button>
                        <button className="sf-btn small accent" onClick={() => proposeFrom(e.id)} disabled={proposing || e.turns < 2}>
                          ✦ Transformar em proposta
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <ChangeStages id={id} data={data} />
            <SpecCards id={id} data={data} />
            {data.changes.length === 0 && data.specs.length === 0 && open.length === 0 && (
              <div className="sf-card sf-faint" style={{ padding: 18 }}>
                Ainda não há mudanças nem specs. Use <b>+ Nova mudança</b>: cole a tarefa como ela chegou e o Claude ajuda a refinar e a montar a proposta.
              </div>
            )}
            {data.changes.some((c) => c.status === 'pronta') && (
              <div className="sf-callout green" style={{ marginTop: 14 }}>
                Prontas para arquivar:{' '}
                {data.changes
                  .filter((c) => c.status === 'pronta')
                  .map((c) => (
                    <a key={c.id} href={changeHref(id, c.id)} onClick={(e) => (e.preventDefault(), navigate(changeHref(id, c.id)))} style={{ marginLeft: 8 }}>
                      {c.id} ({CHANGE_LABEL[c.status]})
                    </a>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {prompt && <PromptModal prompt={prompt} onClose={() => setPrompt(null)} />}

      {panel === 'config' && data.installed && (
        <Drawer title="Configurar" subtitle="OpenSpec" onClose={() => setPanel(null)}>
          <Config data={data} id={id} onPrompt={() => askPrompt('install')} onChanged={load} onError={setError} />
        </Drawer>
      )}
      {panel === 'tour' && (
        <Drawer title="Como o fluxo funciona" subtitle="OpenSpec" onClose={() => setPanel(null)}>
          <OpenSpecTour />
        </Drawer>
      )}
      {chat && (
        <Drawer
          title={chat.startWith ? 'Refinar a nova mudança' : chat.sid ? 'Exploração' : 'Explorar'}
          subtitle="Conversa com o Claude"
          onClose={() => {
            setChat(null)
            load()
          }}
        >
          <OpenSpecExplore
            id={id}
            initialSession={chat.sid}
            startWith={chat.startWith ?? null}
            onChanged={load}
            onCapture={(_text, sid) => {
              if (!sid) return
              setChat(null)
              void proposeFrom(sid)
            }}
          />
        </Drawer>
      )}
      {starting && data.installed && (
        <NewChangeStart
          workspaceId={id}
          onClose={() => setStarting(false)}
          onStart={(startWith) => {
            setStarting(false)
            setChat({ sid: null, startWith })
          }}
        />
      )}
      {review && (
        <ProposalReview
          workspaceId={id}
          pkg={review.pkg}
          onClose={() => setReview(null)}
          onCreated={(name) => {
            api.put(`/workspaces/${id}/openspec/explore/session`, { id: review.sid, linkedChange: name }).catch(() => undefined)
            setReview(null)
            navigate(changeHref(id, name))
          }}
        />
      )}
      {installing && (
        <InstallModal
          id={id}
          onClose={() => setInstalling(false)}
          onDone={() => {
            setInstalling(false)
            load()
            setNotice('OpenSpec instalado: openspec/ e os comandos do Claude foram criados.')
          }}
        />
      )}
      {creatingSpec && data.installed && (
        <NewSpecModal
          id={id}
          onClose={() => setCreatingSpec(false)}
          onCreated={(capability) => {
            setCreatingSpec(false)
            navigate(specHref(id, capability))
          }}
        />
      )}
    </div>
  )
}

function NotInstalled({ id, onInstall, onPrompt, onMapped, onError }: { id: string; onInstall: () => void; onPrompt: () => void; onMapped: () => void; onError: (m: string) => void }) {
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const map = async () => {
    setBusy(true)
    try {
      await api.put(`/workspaces/${id}/openspec/mapping`, { path })
      onMapped()
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="sf-openspec-setup">
      <div className="sf-card">
        <h2 style={{ fontSize: 15, marginBottom: 6 }}>Este projeto ainda não tem OpenSpec</h2>
        <p className="sf-muted" style={{ fontSize: 13, lineHeight: 1.6, marginTop: 0 }}>
          Instale com o seu Claude Code no terminal: o painel gera o passo a passo, você cola no Claude e ele faz a instalação na pasta do projeto.
        </p>
        <div className="sf-row" style={{ gap: 8 }}>
          <button className="sf-btn accent" onClick={onInstall}>
            ✦ Instalar OpenSpec agora
          </button>
          <button className="sf-btn" onClick={onPrompt}>
            Copiar prompt para o Claude
          </button>
        </div>
        <p className="sf-faint" style={{ fontSize: 12, marginBottom: 0 }}>
          A instalação mostra antes os arquivos que serão criados e só grava depois da sua confirmação.
        </p>
      </div>

      <div className="sf-card" style={{ marginTop: 14 }}>
        <h2 style={{ fontSize: 15, marginBottom: 6 }}>Já tenho OpenSpec em outra pasta</h2>
        <p className="sf-muted" style={{ fontSize: 13, lineHeight: 1.6, marginTop: 0 }}>
          Informe a pasta, relativa à raiz da instalação, que contém o <span className="sf-mono">openspec/</span> (deixe vazio se for a raiz).
        </p>
        <div className="sf-row">
          <input className="sf-input sf-mono" placeholder="ex.: docs/ ou app/code/Vendor/Modulo" value={path} onChange={(e) => setPath(e.target.value)} />
          <button className="sf-btn" onClick={map} disabled={busy}>
            Mapear pasta
          </button>
        </div>
      </div>
    </div>
  )
}

function Config({ data, id, onPrompt, onChanged, onError }: { data: Overview; id: string; onPrompt: () => void; onChanged: () => void; onError: (m: string) => void }) {
  const [path, setPath] = useState(data.mapped ? data.dir.replace(/\/openspec$/, '') : '')
  const save = async () => {
    try {
      await api.put(`/workspaces/${id}/openspec/mapping`, { path })
      onChanged()
    } catch (e) {
      onError((e as Error).message)
    }
  }
  return (
    <div className="sf-openspec-setup">
      <div className="sf-card">
        <h2 style={{ fontSize: 15, marginBottom: 8 }}>Instalação</h2>
        <dl className="sf-dl">
          <dt>Pasta do OpenSpec</dt>
          <dd className="sf-mono">{data.dir}</dd>
          <dt>Raiz da instalação</dt>
          <dd className="sf-mono" style={{ overflowWrap: 'anywhere' }}>
            {data.root}
          </dd>
          <dt>CLI</dt>
          <dd>{data.cli.available ? `openspec ${data.cli.version}` : 'Não encontrado. A estrutura é lida mesmo assim, mas a validação fica indisponível.'}</dd>
        </dl>
        {!data.cli.available && (
          <button className="sf-btn" onClick={onPrompt}>
            ✦ Copiar prompt para instalar o CLI
          </button>
        )}
      </div>

      <div className="sf-card" style={{ marginTop: 14 }}>
        <h2 style={{ fontSize: 15, marginBottom: 6 }}>Pasta mapeada</h2>
        <p className="sf-muted" style={{ fontSize: 13, marginTop: 0 }}>
          Se o OpenSpec não estiver na raiz, informe a pasta que o contém (relativa à raiz da instalação). Deixe vazio para voltar à raiz.
        </p>
        <div className="sf-row">
          <input className="sf-input sf-mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder="raiz" />
          <button className="sf-btn" onClick={save}>
            Salvar mapeamento
          </button>
        </div>
      </div>

      <div className="sf-callout" style={{ marginTop: 14, fontSize: 13 }}>
        Este painel <b>não altera o repositório</b>. Instalar, criar mudanças, implementar e arquivar acontecem no seu Claude Code, no terminal, com os prompts que o painel gera. Os status manuais (em revisão, aprovada, etc.) ficam só no Agentic Toolkit.
      </div>
    </div>
  )
}

// ---- drawers ----

function Drawer({ title, subtitle, children, onClose }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="sf-drawer-back">
      <aside className="sf-drawer">
        <div className="sf-drawer-head">
          <div>
            <div className="sf-faint" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {subtitle}
            </div>
            <h2 style={{ margin: '2px 0 0', fontSize: 17 }}>{title}</h2>
          </div>
          <button className="sf-link" onClick={onClose} style={{ fontSize: 18 }}>
            ✕
          </button>
        </div>
        <div className="sf-drawer-body">{children}</div>
      </aside>
    </div>
  )
}

export function PromptModal({ prompt, onClose }: { prompt: { title: string; text: string }; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard?.writeText(prompt.text)
    setCopied(true)
  }
  return (
    <div className="sf-drawer-back" onClick={onClose} style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="sf-prompt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sf-drawer-head">
          <h2 style={{ margin: 0, fontSize: 16 }}>{prompt.title}</h2>
          <button className="sf-link" onClick={onClose} style={{ fontSize: 18 }}>
            ✕
          </button>
        </div>
        <p className="sf-muted" style={{ fontSize: 13, margin: '10px 0' }}>
          Cole no Claude Code, no terminal do projeto. O painel não executa nada no repositório.
        </p>
        <pre className="sf-prompt-text">{prompt.text}</pre>
        <div className="sf-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="sf-btn accent" onClick={copy}>
            {copied ? '✓ Copiado' : 'Copiar prompt'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Short status message: has a close button and closes itself after a few seconds */
const NOTICE_MS = 6000

function Notice({ text, onClose }: { text: string; onClose: () => void }) {
  useEffect(() => {
    if (!text) return
    const t = setTimeout(onClose, NOTICE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])
  if (!text) return null
  return (
    <div className="sf-callout green sf-notice" style={{ marginBottom: 12 }} role="status">
      <span style={{ flex: 1 }}>{text}</span>
      <button className="sf-link" onClick={onClose} aria-label="Fechar" style={{ fontSize: 16, lineHeight: 1 }}>
        ✕
      </button>
    </div>
  )
}
