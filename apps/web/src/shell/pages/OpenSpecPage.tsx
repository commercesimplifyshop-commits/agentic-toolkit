import { useCallback, useEffect, useState, type DragEvent, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { ChangeDraft, DeleteChangeModal, InstallModal, NewChangeModal, NewSpecModal, OpenSpecEditor } from './OpenSpecWrite'
import { OpenSpecExplore } from './OpenSpecExplore'
import { OpenSpecTour } from './OpenSpecTour'

// ---- model (mirrors apps/api/src/openspec) ------------------------------------------------------

type ChangeStatus = 'planejamento' | 'em-andamento' | 'revisao' | 'impedida' | 'pronta' | 'arquivada'
type SpecStatus = 'estavel' | 'em-alteracao' | 'rascunho' | 'aprovada' | 'obsoleta'
type Validation = { valid: boolean; issues: { level: string; message: string }[] } | null

interface Overview {
  installed: boolean
  mapped: boolean
  dir: string
  root: string
  cli: { available: boolean; version: string }
  summary: null | {
    specs: number
    requirements: number
    scenarios: number
    withoutScenario: number
    activeChanges: number
    archivedChanges: number
    tasksTotal: number
    tasksDone: number
    validationErrors: number | null
  }
  specs: {
    id: string
    purpose: string
    derivedStatus: SpecStatus
    manualStatus: SpecStatus | null
    status: SpecStatus
    requirements: number
    scenarios: number
    withoutScenario: number
    changes: string[]
    validation: Validation
  }[]
  changes: {
    id: string
    title: string
    why: string
    derivedStatus: ChangeStatus
    manualStatus: ChangeStatus | null
    status: ChangeStatus
    tasks: { total: number; done: number }
    deltas: { capability: string; added: string[]; modified: string[]; removed: string[] }[]
    specs: string[]
    validation: Validation
  }[]
  archived: { id: string; title: string }[]
}

interface ChangeDetail {
  id: string
  proposal: string
  tasks: { raw: string; total: number; done: number; groups: { title: string; tasks: { id: string; text: string; done: boolean }[] }[] }
  deltas: { capability: string; content: string }[]
}

interface SpecDetail {
  id: string
  content: string
  parsed: { purpose: string; requirements: { name: string; scenarios: { name: string }[] }[] }
}

const CHANGE_LABEL: Record<ChangeStatus, string> = {
  planejamento: 'Propor',
  'em-andamento': 'Em andamento',
  revisao: 'Em revisão',
  impedida: 'Impedida',
  pronta: 'Pronta p/ arquivar',
  arquivada: 'Arquivada',
}
const CHANGE_TONE: Record<ChangeStatus, string> = {
  planejamento: 'blue',
  'em-andamento': 'orange',
  revisao: 'purple',
  impedida: 'red',
  pronta: 'green',
  arquivada: '',
}
const SPEC_LABEL: Record<SpecStatus, string> = {
  estavel: 'Estável',
  'em-alteracao': 'Em alteração',
  rascunho: 'Rascunho',
  aprovada: 'Aprovada',
  obsoleta: 'Obsoleta',
}
const SPEC_TONE: Record<SpecStatus, string> = { estavel: 'green', 'em-alteracao': 'orange', rascunho: 'blue', aprovada: 'green', obsoleta: 'red' }

/** Columns of the board: the ones with a manual drop target come first in the rules below. */
const COLUMNS: ChangeStatus[] = ['planejamento', 'em-andamento', 'revisao', 'impedida', 'pronta', 'arquivada']
const MANUAL_COLUMNS: ChangeStatus[] = ['revisao', 'impedida']

/** Which OpenSpec step, command and skill each column corresponds to (names as installed by `openspec init`). */
interface ExploreMeta {
  id: string
  title: string
  updatedAt: string
  turns: number
  linkedChange: string | null
}

/** The Explorar column: conversations about ideas. They are not changes, so they never create one by themselves. */
function ExploreColumn({
  explores,
  onOpen,
  onPropose,
  onDelete,
  onNew,
}: {
  explores: ExploreMeta[]
  onOpen: (sid: string) => void
  onPropose: (sid: string) => void
  onDelete: (sid: string) => void
  /** Every change starts here: a new conversation with Claude */
  onNew: () => void
}) {
  const step = COLUMN_STEP.explorar
  return (
    <div className="sf-kanban-col">
      <div className="sf-kanban-head">
        <span className="sf-badge blue">Explorar</span>
        <span className="sf-faint">{explores.length}</span>
      </div>
      <button className="sf-btn small accent" style={{ width: '100%', justifyContent: 'center' }} onClick={onNew}>
        Explorar mudança
      </button>
      <div className="sf-kanban-step">
        <b>{step.step}</b>
        <code>
          {step.main}
          <span className="sf-help" tabIndex={0} data-tip={stepTip(step)} aria-label={stepTip(step)}>
            ?
          </span>
        </code>
      </div>
      {explores.map((e) => (
        <div key={e.id} className="sf-kcard" onClick={() => onOpen(e.id)}>
          <div className="t">{e.title}</div>
          <div className="meta">
            <span>
              {Math.floor(e.turns / 2)} trocas · {new Date(e.updatedAt).toLocaleDateString('pt-BR')}
            </span>
            {e.linkedChange && <span className="sf-badge green">virou mudança</span>}
          </div>
          {e.linkedChange && <div className="sf-mono sf-faint" style={{ fontSize: 11 }}>{e.linkedChange}</div>}
          <div className="actions" onClick={(ev) => ev.stopPropagation()}>
            <button className="sf-link" onClick={() => onOpen(e.id)}>
              Abrir
            </button>
            {!e.linkedChange && (
              <button className="sf-link" onClick={() => onPropose(e.id)}>
                Propor
              </button>
            )}
            <button className="sf-link" style={{ color: '#f87171' }} onClick={() => onDelete(e.id)}>
              Excluir
            </button>
          </div>
        </div>
      ))}
      {explores.length === 0 && <div className="sf-faint" style={{ fontSize: 12, padding: '4px 2px' }}>Nenhuma conversa ainda. Clique em + Nova mudança para começar a explorar.</div>}
    </div>
  )
}

/** Full explanation for the hover tip: the note plus every command and skill of the step. */
const stepTip = (c: { note: string; commands: string[]; skills: string[] }) =>
  [c.note, c.commands.length ? `Comandos: ${c.commands.join(', ')}` : '', c.skills.length ? `Skills: ${c.skills.join(', ')}` : ''].filter(Boolean).join('\n')

/** Explorar is not a change status: its cards are explore conversations, which create nothing. */
const COLUMN_STEP: Record<'explorar' | ChangeStatus, { step: string; main: string; commands: string[]; skills: string[]; note: string }> = {
  explorar: {
    main: '/opsx:explore',
    step: 'Explorar',
    commands: ['/opsx:explore'],
    skills: ['openspec-explore'],
    note: 'Conversa para entender a ideia e o código antes de propor. Não cria mudança.',
  },
  planejamento: {
    main: '/opsx:propose',
    step: 'Propor',
    commands: ['/opsx:propose'],
    skills: ['openspec-propose'],
    note: 'Cria a mudança com proposta, specs e tarefas. Só é criada depois da sua confirmação.',
  },
  'em-andamento': {
    main: '/opsx:apply',
    step: 'Implementar',
    commands: ['/opsx:apply'],
    skills: ['openspec-apply-change'],
    note: 'Implementa as tarefas em tasks.md, marcando cada uma ao concluir.',
  },
  revisao: {
    main: '/opsx:verify',
    step: 'Revisão (manual)',
    commands: ['/opsx:verify'],
    skills: ['openspec-verify-change'],
    note: 'Marcação do Agentic Toolkit para revisar antes de arquivar. Não é um passo do OpenSpec.',
  },
  impedida: {
    main: 'manual',
    step: 'Impedida (manual)',
    commands: [],
    skills: [],
    note: 'Marcação do Agentic Toolkit para bloqueios. Não é um passo do OpenSpec.',
  },
  pronta: {
    main: '/opsx:verify',
    step: 'Verificar e arquivar',
    commands: ['/opsx:verify', '/opsx:archive'],
    skills: ['openspec-verify-change', 'openspec-archive-change'],
    note: 'Todas as tarefas concluídas. Verifique a implementação e arquive.',
  },
  arquivada: {
    main: '/opsx:archive',
    step: 'Arquivar e sincronizar specs',
    commands: ['/opsx:archive', '/opsx:sync'],
    skills: ['openspec-archive-change', 'openspec-sync-specs'],
    note: 'Movida para openspec/changes/archive, com as specs atualizadas.',
  },
}


const pct = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0)

// ---- page ------------------------------------------------------------------------------------------

type Tab = 'dashboard' | 'tour' | 'board' | 'specs' | 'config'

export function OpenSpecPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'dashboard'
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [openChange, setOpenChange] = useState<string | null>(params.get('change'))
  const [openSpec, setOpenSpec] = useState<string | null>(params.get('spec'))
  const [prompt, setPrompt] = useState<{ title: string; text: string } | null>(null)
  const [installing, setInstalling] = useState(false)
  const [creatingChange, setCreatingChange] = useState(false)
  const [creatingSpec, setCreatingSpec] = useState(false)
  const [capture, setCapture] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [explores, setExplores] = useState<ExploreMeta[]>([])
  /** The explore chat drawer: a conversation, or null for a new one */
  const [chat, setChat] = useState<{ sid: string | null } | null>(null)
  const [captureSid, setCaptureSid] = useState<string | null>(null)
  /** Facilitator draft for the change form, built from the conversation of a card */
  const [draft, setDraft] = useState<ChangeDraft | null>(null)

  const loadExplores = useCallback(() => {
    api
      .get<ExploreMeta[]>(`/workspaces/${id}/openspec/explore/sessions`)
      .then(setExplores)
      .catch(() => undefined)
  }, [id])

  const load = useCallback(() => {
    api
      .get<Overview>(`/workspaces/${id}/openspec`)
      .then(setData)
      .catch((e) => setError(e.message))
    loadExplores()
  }, [id, loadExplores])

  /**
   * Propor: the facilitator reads the whole conversation and drafts the proposal (name, why,
   * what changes, capabilities). The form opens filled; nothing is created until the user confirms.
   */
  const proposeFrom = async (sid: string) => {
    setNotice('Gerando o rascunho da proposta a partir da conversa…')
    try {
      const d = await api.post<ChangeDraft>(`/workspaces/${id}/openspec/explore/propose`, { sessionId: sid })
      setNotice('')
      setDraft(d)
      setCaptureSid(sid)
      setCreatingChange(true)
    } catch (e) {
      setNotice('')
      setError((e as Error).message)
    }
  }

  useEffect(load, [load])

  const go = (t: Tab) => setParams({ tab: t })

  const askPrompt = async (kind: string, change?: string) => {
    try {
      const q = `kind=${kind}${change ? `&change=${encodeURIComponent(change)}` : ''}`
      setPrompt(await api.get<{ title: string; text: string }>(`/workspaces/${id}/openspec/prompt?${q}`))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const setStatus = async (kind: 'change' | 'spec', item: string, status: string | null) => {
    try {
      await api.put(`/workspaces/${id}/openspec/status`, { kind, item, status })
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (error && !data) return <div className="sf-page"><div className="sf-callout red">{error}</div></div>
  if (!data) return <div className="sf-page"><span className="sf-spinner" /></div>

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
          <span className={`sf-badge ${data.cli.available ? 'green' : 'orange'}`} title={data.cli.available ? 'CLI disponível para validar' : 'Sem o CLI: estrutura lida, validação indisponível'}>
            {data.cli.available ? `CLI ${data.cli.version || ''}` : 'CLI não encontrado'}
          </span>
        )}
      </div>

      {error && <div className="sf-callout red" style={{ marginBottom: 12 }}>{error}</div>}
      <Notice text={notice} onClose={() => setNotice('')} />

      {!data.installed ? (
        <NotInstalled id={id} onInstall={() => setInstalling(true)} onPrompt={() => askPrompt('install')} onMapped={() => (load(), setNotice('Pasta mapeada. O painel já lê o OpenSpec dela.'))} onError={setError} />
      ) : (
        <>
          <div className="sf-tabs">
            {(
              [
                ['dashboard', 'Visão geral'],
                ['tour', 'Apresentação'],
                ['board', 'Quadro'],
                ['specs', `Specs${data.summary ? ` (${data.summary.specs})` : ''}`],
                ['config', 'Configurar'],
              ] as [Tab, string][]
            ).map(([t, label]) => (
              <button key={t} className={`sf-tab ${tab === t ? 'on' : ''}`} onClick={() => go(t)}>
                {label}
              </button>
            ))}
          </div>

          {tab === 'dashboard' && (
            <Dashboard data={data} onOpenChange={(c) => setOpenChange(c)} onOpenSpec={(s) => setOpenSpec(s)} onPrompt={askPrompt} onTour={() => go('tour')} />
          )}
          {tab === 'tour' && <OpenSpecTour />}
          {tab === 'board' && (
            <Board
              data={data}
              explores={explores}
              onOpenExplore={(sid) => setChat({ sid })}
              onDeleteExplore={async (sid) => {
                await api.del(`/workspaces/${id}/openspec/explore/session?id=${sid}`).catch((e) => setError((e as Error).message))
                loadExplores()
              }}
              onDelete={setDeleting}
              onPropose={proposeFrom}
              onOpen={(c) => setOpenChange(c)}
              onStatus={setStatus}
              onNotice={setNotice}
              onPrompt={askPrompt}
              onNew={() => setChat({ sid: null })}
              onNewChange={() => {
                setDraft(null)
                setCreatingChange(true)
              }}
            />
          )}
          {tab === 'specs' && <Specs data={data} id={id} onOpen={(s) => setOpenSpec(s)} onStatus={setStatus} onNew={() => setCreatingSpec(true)} />}
          {tab === 'config' && <Config data={data} id={id} onPrompt={() => askPrompt('install')} onChanged={load} onError={setError} />}
        </>
      )}

      {openChange && data.installed && (
        <ChangeDrawer
          onDelete={setDeleting}
          id={id}
          name={openChange}
          overview={data}
          onClose={() => setOpenChange(null)}
          onPrompt={askPrompt}
          onStatus={setStatus}
          onChanged={load}
        />
      )}
      {openSpec && data.installed && <SpecDrawer id={id} name={openSpec} overview={data} onClose={() => setOpenSpec(null)} onStatus={setStatus} onChanged={load} />}
      {prompt && <PromptModal prompt={prompt} onClose={() => setPrompt(null)} />}
      {chat && (
        <Drawer title={chat.sid ? 'Exploração' : 'Nova mudança'} subtitle="Explorar" onClose={() => setChat(null)}>
          <OpenSpecExplore
            id={id}
            hideList
            initialSession={chat.sid}
            onChanged={loadExplores}
            onCapture={(_text, sid) => {
              setChat(null)
              if (sid) proposeFrom(sid)
            }}
          />
        </Drawer>
      )}
      {deleting && (
        <DeleteChangeModal
          id={id}
          name={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => {
            setDeleting(null)
            setOpenChange(null)
            load()
            setNotice(`Mudança ${deleting} excluída. Uma cópia ficou guardada no Agentic Toolkit.`)
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
      {creatingChange && data.installed && (
        <NewChangeModal
          id={id}
          initialWhy={capture}
          draft={draft}
          specs={data.specs.map((sp) => sp.id)}
          onClose={() => {
            setCreatingChange(false)
            setCapture('')
            setCaptureSid(null)
            setDraft(null)
          }}
          onCreated={(name) => {
            if (captureSid) {
              api.put(`/workspaces/${id}/openspec/explore/session`, { id: captureSid, linkedChange: name }).catch(() => undefined)
            }
            setCreatingChange(false)
            setCapture('')
            setCaptureSid(null)
            setDraft(null)
            loadExplores()
            load()
            setOpenChange(name)
          }}
        />
      )}
      {creatingSpec && data.installed && (
        <NewSpecModal
          id={id}
          onClose={() => setCreatingSpec(false)}
          onCreated={(capability) => {
            setCreatingSpec(false)
            load()
            setOpenSpec(capability)
          }}
        />
      )}
    </div>
  )
}

// ---- not installed ---------------------------------------------------------------------------------------

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

// ---- dashboard ------------------------------------------------------------------------------------------

function Dashboard({
  data,
  onOpenChange,
  onOpenSpec,
  onPrompt,
  onTour,
}: {
  data: Overview
  onOpenChange: (c: string) => void
  onOpenSpec: (s: string) => void
  onPrompt: (kind: string, change?: string) => void
  onTour: () => void
}) {
  const s = data.summary!
  const byStatus = COLUMNS.map((c) => ({ c, n: c === 'arquivada' ? data.archived.length : data.changes.filter((x) => x.status === c).length }))
  const withProblems = data.specs.filter((sp) => sp.withoutScenario > 0 || (sp.validation && !sp.validation.valid))
  return (
    <>
      <div className="sf-card sf-tour-teaser" style={{ marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 15 }}>Como o fluxo funciona</h2>
          <p className="sf-muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
            Da exploração ao arquivo, com uma mudança de exemplo andando pelas etapas.
          </p>
        </div>
        <button className="sf-btn accent" onClick={onTour}>
          Ver apresentação →
        </button>
      </div>
      <div className="sf-kpis">
        <Kpi label="Specs" value={s.specs} sub={`${s.requirements} requisitos · ${s.scenarios} cenários`} />
        <Kpi label="Mudanças ativas" value={s.activeChanges} sub={`${s.archivedChanges} arquivadas`} />
        <Kpi label="Tarefas" value={`${pct(s.tasksDone, s.tasksTotal)}%`} sub={`${s.tasksDone} de ${s.tasksTotal} concluídas`} bar={pct(s.tasksDone, s.tasksTotal)} />
        <Kpi
          label="Problemas"
          value={s.validationErrors ?? '—'}
          sub={s.validationErrors === null ? 'instale o CLI para validar' : `${s.withoutScenario} requisitos sem cenário`}
          tone={(s.validationErrors ?? 0) > 0 || s.withoutScenario > 0 ? 'red' : 'green'}
        />
      </div>

      <div className="sf-dash-grid">
        <div className="sf-card">
          <div className="sf-card-head">
            <h2>Fluxo das mudanças</h2>
          </div>
          <div className="sf-flow">
            {byStatus.map((x) => (
              <div key={x.c} className="sf-flow-step">
                <strong>{x.n}</strong>
                <span>{CHANGE_LABEL[x.c]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="sf-card">
          <div className="sf-card-head">
            <h2>Mudanças em andamento</h2>
          </div>
          {data.changes.length === 0 && <div className="sf-faint" style={{ fontSize: 13 }}>Nenhuma mudança ativa. Peça uma nova ao Claude pelo botão "Nova mudança" no Quadro.</div>}
          {data.changes.map((c) => (
            <button key={c.id} className="sf-openspec-row" onClick={() => onOpenChange(c.id)}>
              <span className="t">{c.title}</span>
              <span className="bar">
                <span style={{ width: `${pct(c.tasks.done, c.tasks.total)}%` }} />
              </span>
              <span className="sf-faint" style={{ fontSize: 12, minWidth: 64, textAlign: 'right' }}>
                {c.tasks.done}/{c.tasks.total}
              </span>
              <span className={`sf-badge ${CHANGE_TONE[c.status]}`}>{CHANGE_LABEL[c.status]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="sf-card" style={{ marginTop: 14 }}>
        <div className="sf-card-head">
          <h2>Specs</h2>
          <span className="sub" style={{ margin: 0 }}>
            {withProblems.length ? `${withProblems.length} com pendências` : 'sem pendências'}
          </span>
        </div>
        {data.specs.length === 0 && <div className="sf-faint" style={{ fontSize: 13 }}>Nenhuma spec em openspec/specs ainda.</div>}
        <table className="sf-table">
          <tbody>
            {data.specs.map((sp) => (
              <tr key={sp.id} className="clickable" onClick={() => onOpenSpec(sp.id)}>
                <td>
                  <span className="sf-mono">{sp.id}</span>
                  {sp.purpose && <div className="sf-muted" style={{ fontSize: 12, marginTop: 2 }}>{sp.purpose.slice(0, 140)}</div>}
                </td>
                <td style={{ width: 150 }}>
                  <span className={`sf-badge ${SPEC_TONE[sp.status]}`}>{SPEC_LABEL[sp.status]}</span>
                </td>
                <td style={{ width: 130 }} className="sf-muted">
                  {sp.requirements} requisitos
                </td>
                <td style={{ width: 170 }} className="sf-muted">
                  {sp.withoutScenario > 0 ? <span style={{ color: '#fdba74' }}>{sp.withoutScenario} sem cenário</span> : sp.changes.length ? `${sp.changes.length} mudança(s)` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.archived.length > 0 && (
        <div className="sf-card" style={{ marginTop: 14 }}>
          <div className="sf-card-head">
            <h2>Arquivadas</h2>
          </div>
          <div className="sf-muted" style={{ fontSize: 13, lineHeight: 1.8 }}>
            {data.archived.slice(0, 12).map((a) => (
              <div key={a.id}>
                <span className="sf-mono">{a.id}</span> · {a.title}
              </div>
            ))}
          </div>
        </div>
      )}
      {data.changes.some((c) => c.status === 'pronta') && (
        <div className="sf-callout green" style={{ marginTop: 14 }}>
          Há mudanças prontas para arquivar.{' '}
          {data.changes
            .filter((c) => c.status === 'pronta')
            .map((c) => (
              <button key={c.id} className="sf-link" style={{ marginLeft: 8, color: 'var(--sf-text)' }} onClick={() => onPrompt('archive', c.id)}>
                ✦ arquivar {c.id}
              </button>
            ))}
        </div>
      )}
    </>
  )
}

function Kpi({ label, value, sub, bar, tone }: { label: string; value: string | number; sub: string; bar?: number; tone?: string }) {
  return (
    <div className={`sf-kpi ${tone ?? ''}`}>
      <span className="l">{label}</span>
      <strong>{value}</strong>
      <span className="s">{sub}</span>
      {bar !== undefined && (
        <span className="bar">
          <span style={{ width: `${bar}%` }} />
        </span>
      )}
    </div>
  )
}

// ---- board (kanban) ---------------------------------------------------------------------------------------

function Board({
  data,
  explores,
  onOpenExplore,
  onDeleteExplore,
  onDelete,
  onPropose,
  onOpen,
  onStatus,
  onNotice,
  onPrompt,
  onNew,
  onNewChange,
}: {
  data: Overview
  onOpen: (c: string) => void
  onStatus: (kind: 'change' | 'spec', item: string, status: string | null) => void
  onNotice: (m: string) => void
  onPrompt: (kind: string, change?: string) => void
  onNew: () => void
  onNewChange: () => void
  explores: ExploreMeta[]
  onOpenExplore: (sid: string) => void
  onPropose: (sid: string) => void
  onDeleteExplore: (sid: string) => void
  onDelete: (name: string) => void
}) {
  const [over, setOver] = useState<ChangeStatus | null>(null)

  const drop = (e: DragEvent, col: ChangeStatus) => {
    e.preventDefault()
    setOver(null)
    const id = e.dataTransfer.getData('text/plain')
    const card = data.changes.find((c) => c.id === id)
    if (!card) return
    if (col === 'arquivada') return onNotice('Arquivar atualiza as specs: faça pelo botão "Arquivar" do card, que gera o prompt para o Claude.')
    if (MANUAL_COLUMNS.includes(col)) return onStatus('change', id, col)
    // Derived columns follow the tasks: only a manual mark can be removed here
    if (card.manualStatus) return onStatus('change', id, null)
    onNotice(`"${CHANGE_LABEL[col]}" é calculado pelas tarefas. Para avançar, peça ao Claude para implementar (botão "Implementar" do card).`)
  }

  return (
    <>
      <div className="sf-board-toolbar">
        <span className="sf-faint" style={{ fontSize: 12.5 }}>
          Toda mudança começa em Explorar: converse com o Claude, depois proponha. Arraste para "Em revisão" ou "Impedida" para marcar.
        </span>
      </div>
      <div className="sf-kanban">
        <ExploreColumn explores={explores} onOpen={onOpenExplore} onPropose={onPropose} onDelete={onDeleteExplore} onNew={onNew} />
        {COLUMNS.map((col) => {
          const active = col === 'arquivada' ? [] : data.changes.filter((c) => c.status === col)
          const archived = col === 'arquivada' ? data.archived : []
          const count = active.length + archived.length
          return (
            <div
              key={col}
              className={`sf-kanban-col ${over === col ? 'over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setOver(col)
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => drop(e, col)}
            >
              <div className="sf-kanban-head">
                <span className={`sf-badge ${CHANGE_TONE[col]}`}>{CHANGE_LABEL[col]}</span>
                <span className="sf-faint">{count}</span>
              </div>
              {col === 'planejamento' && (
                <button className="sf-btn small accent" style={{ width: '100%', justifyContent: 'center' }} onClick={onNewChange}>
                  + Nova mudança
                </button>
              )}
              <div className="sf-kanban-step">
                <b>{COLUMN_STEP[col].step}</b>
                <code>
                  {COLUMN_STEP[col].main}
                  <span className="sf-help" tabIndex={0} data-tip={stepTip(COLUMN_STEP[col])} aria-label={stepTip(COLUMN_STEP[col])}>
                    ?
                  </span>
                </code>
              </div>
              {active.map((c) => (
                <div key={c.id} className="sf-kcard" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', c.id)} onClick={() => onOpen(c.id)}>
                  <div className="t">{c.title}</div>
                  <div className="sf-mono sf-faint" style={{ fontSize: 11 }}>
                    {c.id}
                  </div>
                  <span className="bar">
                    <span style={{ width: `${pct(c.tasks.done, c.tasks.total)}%` }} />
                  </span>
                  <div className="meta">
                    <span>
                      {c.tasks.done}/{c.tasks.total} tarefas
                    </span>
                    {c.validation && !c.validation.valid && <span className="sf-badge red">erro de validação</span>}
                    {c.manualStatus && <span className="sf-badge purple">manual</span>}
                  </div>
                  <div className="actions" onClick={(e) => e.stopPropagation()}>
                    {c.status === 'pronta' ? (
                      <button className="sf-link" onClick={() => onPrompt('archive', c.id)}>
                        Arquivar
                      </button>
                    ) : (
                      <button className="sf-link" onClick={() => onPrompt('apply', c.id)}>
                        Implementar
                      </button>
                    )}
                    <button className="sf-link" onClick={() => onPrompt('validate', c.id)}>
                      Verificar
                    </button>
                    <button className="sf-link" style={{ color: '#f87171' }} onClick={() => onDelete(c.id)}>
                      Excluir
                    </button>
                  </div>
                </div>
              ))}
              {archived.map((a) => (
                <div key={a.id} className="sf-kcard arch" onClick={() => onNotice('Mudança arquivada: o histórico fica em openspec/changes/archive.')}>
                  <div className="t">{a.title}</div>
                  <div className="sf-mono sf-faint" style={{ fontSize: 11 }}>
                    {a.id}
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </>
  )
}

// ---- specs --------------------------------------------------------------------------------------------------

function Specs({ data, id, onOpen, onStatus, onNew }: { data: Overview; id: string; onOpen: (s: string) => void; onStatus: (kind: 'change' | 'spec', item: string, status: string | null) => void; onNew: () => void }) {
  void id
  return (
    <>
    <div className="sf-row" style={{ justifyContent: 'flex-end', marginBottom: 10 }}>
      <button className="sf-btn small accent" onClick={onNew}>+ Nova spec</button>
    </div>
    <div className="sf-card" style={{ padding: 0 }}>
      <table className="sf-table">
        <thead>
          <tr>
            <th>Spec</th>
            <th style={{ width: 170 }}>Status</th>
            <th style={{ width: 120 }}>Requisitos</th>
            <th style={{ width: 200 }}>Alterada por</th>
          </tr>
        </thead>
        <tbody>
          {data.specs.map((sp) => (
            <tr key={sp.id} className="clickable" onClick={() => onOpen(sp.id)}>
              <td>
                <span className="sf-mono">{sp.id}</span>
                {sp.purpose && <div className="sf-muted" style={{ fontSize: 12, marginTop: 2 }}>{sp.purpose.slice(0, 160)}</div>}
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <select className="sf-input" style={{ padding: '5px 8px', fontSize: 12.5 }} value={sp.manualStatus ?? ''} onChange={(e) => onStatus('spec', sp.id, e.target.value || null)}>
                  <option value="">{SPEC_LABEL[sp.derivedStatus]} (automático)</option>
                  <option value="rascunho">Rascunho</option>
                  <option value="aprovada">Aprovada</option>
                  <option value="obsoleta">Obsoleta</option>
                </select>
              </td>
              <td className="sf-muted">
                {sp.requirements}
                {sp.withoutScenario > 0 && <span style={{ color: '#fdba74', marginLeft: 6 }}>({sp.withoutScenario} sem cenário)</span>}
              </td>
              <td className="sf-muted sf-mono" style={{ fontSize: 12 }}>
                {sp.changes.join(', ') || '—'}
              </td>
            </tr>
          ))}
          {data.specs.length === 0 && (
            <tr>
              <td colSpan={4} className="sf-empty">
                Nenhuma spec ainda. Crie uma mudança pelo Quadro: o Claude gera as specs.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
    </>
  )
}

// ---- config ----------------------------------------------------------------------------------------------

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

// ---- drawers ----------------------------------------------------------------------------------------------

function ChangeDrawer({
  id,
  name,
  overview,
  onClose,
  onPrompt,
  onStatus,
  onChanged,
  onDelete,
}: {
  id: string
  name: string
  overview: Overview
  onClose: () => void
  onChanged: () => void
  onDelete: (name: string) => void
  onPrompt: (kind: string, change?: string) => void
  onStatus: (kind: 'change' | 'spec', item: string, status: string | null) => void
}) {
  const [detail, setDetail] = useState<ChangeDetail | null>(null)
  const [err, setErr] = useState('')
  const card = overview.changes.find((c) => c.id === name)
  useEffect(() => {
    api
      .get<ChangeDetail>(`/workspaces/${id}/openspec/change?name=${encodeURIComponent(name)}`)
      .then(setDetail)
      .catch((e) => setErr(e.message))
  }, [id, name])
  return (
    <Drawer title={card?.title ?? name} subtitle={name} onClose={onClose}>
      {card && (
        <div className="sf-row" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
          <span className={`sf-badge ${CHANGE_TONE[card.status]}`}>{CHANGE_LABEL[card.status]}</span>
          {card.manualStatus && <span className="sf-badge purple">marcado manualmente</span>}
          <select className="sf-input" style={{ width: 'auto', padding: '5px 8px', fontSize: 12.5 }} value={card.manualStatus ?? ''} onChange={(e) => onStatus('change', name, e.target.value || null)}>
            <option value="">Automático (pelas tarefas)</option>
            <option value="revisao">Em revisão</option>
            <option value="impedida">Impedida</option>
          </select>
        </div>
      )}
      <div className="sf-row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <Link className="sf-btn small accent" to={`/w/${id}/openspec/change/${encodeURIComponent(name)}`}>
          Abrir espaço de trabalho
        </Link>
        <button className="sf-btn small" onClick={() => onPrompt('apply', name)}>
          ✦ Implementar
        </button>
        <button className="sf-btn small" onClick={() => onPrompt('validate', name)}>
          Verificar
        </button>
        <button className="sf-btn small" onClick={() => onPrompt('archive', name)}>
          Arquivar
        </button>
        <button className="sf-btn small danger" onClick={() => onDelete(name)}>
          Excluir mudança
        </button>
      </div>

      {card?.validation && !card.validation.valid && (
        <div className="sf-callout red" style={{ marginBottom: 14 }}>
          <b>Erros de validação</b>
          {card.validation.issues.map((i, k) => (
            <div key={k} style={{ marginTop: 4 }}>
              {i.message}
            </div>
          ))}
          {card.validation.issues.some((i) => /at least one delta/i.test(i.message)) && (
            <div className="sf-row" style={{ marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontSize: 12.5 }}>Esta mudança não tem specs alteradas. Se for de documentação, refatoração ou ferramentas, marque-a assim:</span>
              <button
                className="sf-btn small"
                onClick={async () => {
                  try {
                    await api.post(`/workspaces/${id}/openspec/change/skip`, { name, skip: true })
                    onChanged()
                  } catch (e) {
                    setErr((e as Error).message)
                  }
                }}
              >
                Marcar como sem mudança de spec
              </button>
            </div>
          )}
        </div>
      )}
      {err && <div className="sf-callout red">{err}</div>}
      {!detail && !err && <span className="sf-spinner" />}
      {detail && (
        <>
          <Section title={`Tarefas · ${detail.tasks.done}/${detail.tasks.total}`}>
            <span className="bar" style={{ display: 'block', marginBottom: 10 }}>
              <span style={{ width: `${pct(detail.tasks.done, detail.tasks.total)}%` }} />
            </span>
            {detail.tasks.groups.map((g) => (
              <div key={g.title} style={{ marginBottom: 10 }}>
                <div className="sf-faint" style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  {g.title}
                </div>
                {g.tasks.map((t) => (
                  <div key={t.id} className="sf-check">
                    <span className={`ic ${t.done ? 'ok' : 'hint'}`}>{t.done ? '✓' : ''}</span>
                    <span style={{ color: t.done ? 'var(--sf-muted)' : undefined, textDecoration: t.done ? 'line-through' : undefined }}>
                      <span className="sf-faint sf-mono">{t.id}</span> {t.text}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </Section>

          <Section title="Proposta">
            <OpenSpecEditor id={id} path={`${overview.dir}/changes/${name}/proposal.md`} draft={{ kind: 'proposal', label: 'proposta' }} onSaved={onChanged} />
          </Section>

          <Section title="Tarefas (arquivo)">
            <OpenSpecEditor id={id} path={`${overview.dir}/changes/${name}/tasks.md`} draft={{ kind: 'tasks', label: 'tarefas' }} onSaved={onChanged} />
          </Section>

          <Section title={`Specs alteradas (${detail.deltas.length})`}>
            {detail.deltas.length === 0 && <div className="sf-faint" style={{ fontSize: 13 }}>Nenhuma spec alterada.</div>}
            {detail.deltas.map((d) => (
              <details key={d.capability} style={{ marginBottom: 10 }}>
                <summary className="sf-mono" style={{ cursor: 'pointer', fontSize: 13 }}>
                  {d.capability}
                </summary>
                <div style={{ marginTop: 8 }}>
                  <OpenSpecEditor id={id} path={`${overview.dir}/changes/${name}/specs/${d.capability}/spec.md`} draft={{ kind: 'spec', capability: d.capability, label: 'delta de spec' }} onSaved={onChanged} />
                </div>
              </details>
            ))}
          </Section>
        </>
      )}
    </Drawer>
  )
}

function SpecDrawer({ id, name, overview, onClose, onStatus, onChanged }: { id: string; name: string; overview: Overview; onClose: () => void; onStatus: (kind: 'change' | 'spec', item: string, status: string | null) => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<SpecDetail | null>(null)
  const [err, setErr] = useState('')
  const card = overview.specs.find((s) => s.id === name)
  useEffect(() => {
    api
      .get<SpecDetail>(`/workspaces/${id}/openspec/spec?id=${encodeURIComponent(name)}`)
      .then(setDetail)
      .catch((e) => setErr(e.message))
  }, [id, name])
  return (
    <Drawer title={name} subtitle="spec" onClose={onClose}>
      {card && (
        <div className="sf-row" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
          <span className={`sf-badge ${SPEC_TONE[card.status]}`}>{SPEC_LABEL[card.status]}</span>
          <select className="sf-input" style={{ width: 'auto', padding: '5px 8px', fontSize: 12.5 }} value={card.manualStatus ?? ''} onChange={(e) => onStatus('spec', name, e.target.value || null)}>
            <option value="">Automático</option>
            <option value="rascunho">Rascunho</option>
            <option value="aprovada">Aprovada</option>
            <option value="obsoleta">Obsoleta</option>
          </select>
        </div>
      )}
      {card && card.changes.length > 0 && <div className="sf-muted" style={{ fontSize: 13, marginBottom: 12 }}>Alterada pelas mudanças: <span className="sf-mono">{card.changes.join(', ')}</span></div>}
      {err && <div className="sf-callout red">{err}</div>}
      {!detail && !err && <span className="sf-spinner" />}
      {detail && (
        <>
          <Section title={`Requisitos (${detail.parsed.requirements.length})`}>
            <OpenSpecEditor id={id} path={`${overview.dir}/specs/${name}/spec.md`} draft={{ kind: 'spec', capability: name, label: 'spec' }} onSaved={onChanged} />
          </Section>
        </>
      )}
    </Drawer>
  )
}

function Drawer({ title, subtitle, children, onClose }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="sf-drawer-back" onClick={onClose}>
      <aside className="sf-drawer" onClick={(e) => e.stopPropagation()}>
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 20 }}>
      <div className="sf-apic-section">{title}</div>
      {children}
    </section>
  )
}

function PromptModal({ prompt, onClose }: { prompt: { title: string; text: string }; onClose: () => void }) {
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
