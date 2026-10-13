import { Marked } from 'marked'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { TextEditor } from '../editor/TextEditor'
import { ToolsPanel, type ToolResult } from '../links/ToolLinks'
import { DeleteChangeModal } from './OpenSpecWrite'
import { ChangeFileTree } from './OpenSpecExplorer'
import { PromptModal } from './OpenSpecPage'
import { CHANGE_LABEL, CHANGE_TONE, SPEC_LABEL, SPEC_TONE, type ChangeDetail, type Overview } from './openspec-model'

/** Markdown from a change rendered without raw HTML (escaped), so nothing in a proposal can run as markup. */
const md = new Marked({ gfm: true, renderer: { html: ({ text }: { text: string }) => text.replace(/</g, '&lt;').replace(/>/g, '&gt;') } })

interface FileState {
  path: string
  content: string
  sha: string
}

interface Revision {
  path: string
  sha: string
  current: string
  text: string
  tools: { kind: 'diagram' | 'board'; type?: string; request?: string; name?: string; reason: string }[]
}

/**
 * The file open in the workspace: loaded at one version (sha) and saved only against that version,
 * so a stale copy cannot overwrite a newer one.
 */
function useOpenSpecFile(id: string, path: string) {
  const [file, setFile] = useState<FileState | null>(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  const reload = useCallback(
    () =>
      !path
        ? Promise.resolve()
        : api
        .get<FileState>(`/workspaces/${id}/openspec/file?path=${encodeURIComponent(path)}`)
        .then((f) => {
          setFile(f)
          setValue(f.content)
          setError('')
        })
        .catch((e) => setError((e as Error).message)),
    [id, path],
  )

  useEffect(() => {
    setFile(null)
    setNotice('')
    reload()
  }, [reload])

  const dirty = file !== null && value !== file.content

  const save = async () => {
    if (!file) return
    setSaving(true)
    setNotice('')
    try {
      const r = await api.put<{ sha: string }>(`/workspaces/${id}/openspec/file`, { path, content: value, expectedSha: file.sha })
      setFile({ path, content: value, sha: r.sha })
      setNotice('Salvo.')
    } catch (e) {
      const text = (e as Error).message
      setError(text.includes('mudou') ? `${text} Use "Recarregar" e refaça a edição.` : text)
    } finally {
      setSaving(false)
    }
  }

  return { file, value, setValue, dirty, error, notice, saving, reload, save }
}

type OpenFile = ReturnType<typeof useOpenSpecFile>

/**
 * The workspace of one change or one spec: the folder of the item on the left, the file being
 * edited with its preview in the middle, and Claude's revision on the right. The item's actions
 * (status, implement, verify, archive, delete) sit in the header.
 */
export function OpenSpecChangePage() {
  const { id = '', name = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [detail, setDetail] = useState<ChangeDetail | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loadError, setLoadError] = useState('')
  const [tab, setTab] = useState<'claude' | 'ferramentas'>('claude')
  const [prompt, setPrompt] = useState<{ title: string; text: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'red' | 'green' | 'orange'; text: string } | null>(null)

  const load = useCallback(() => {
    Promise.all([
      api.get<ChangeDetail>(`/workspaces/${id}/openspec/change?name=${encodeURIComponent(name)}`),
      api.get<Overview>(`/workspaces/${id}/openspec`),
    ])
      .then(([d, o]) => {
        setDetail(d)
        setOverview(o)
        setLoadError('')
      })
      .catch((e) => setLoadError((e as Error).message))
  }, [id, name])

  useEffect(() => {
    load()
  }, [load])

  const card = overview?.changes.find((c) => c.id === name)
  const folder = detail?.dir ?? ''
  const abs = (rel: string) => `${folder}/${rel}`
  const active = params.get('file') ?? (detail ? abs('proposal.md') : '')
  const file = useOpenSpecFile(id, active)

  const open = (path: string) => {
    if (path === active) return
    if (file.dirty && !window.confirm('Descartar as alterações não salvas deste arquivo?')) return
    setParams({ file: path }, { replace: true })
  }

  const askPrompt = async (kind: string) => {
    try {
      setPrompt(await api.get<{ title: string; text: string }>(`/workspaces/${id}/openspec/prompt?kind=${kind}&change=${encodeURIComponent(name)}`))
    } catch (e) {
      setMsg({ tone: 'red', text: (e as Error).message })
    }
  }

  const setStatus = async (status: string | null) => {
    try {
      await api.put(`/workspaces/${id}/openspec/status`, { kind: 'change', item: name, status })
      load()
    } catch (e) {
      setMsg({ tone: 'red', text: (e as Error).message })
    }
  }

  const skipSpecs = async () => {
    try {
      await api.post(`/workspaces/${id}/openspec/change/skip`, { name, skip: true })
      setMsg({ tone: 'green', text: 'Marcada como mudança sem spec.' })
      load()
    } catch (e) {
      setMsg({ tone: 'red', text: (e as Error).message })
    }
  }

  if (loadError) return <div className="sf-page"><div className="sf-callout red">{loadError}</div></div>
  if (!detail || !overview) return <div className="sf-page"><span className="sf-spinner" /></div>

  return (
    <div className="sf-page sf-ws">
      <div className="sf-ws-head">
        <Link to={`/w/${id}/openspec`} className="sf-link">
          ← OpenSpec
        </Link>
        <h2 className="sf-ws-title">{card?.title ?? name}</h2>
        {card && <span className={`sf-badge ${CHANGE_TONE[card.status]}`}>{CHANGE_LABEL[card.status]}</span>}
        <span style={{ flex: 1 }} />
        <select className="sf-input sf-ws-status" value={card?.manualStatus ?? ''} onChange={(e) => setStatus(e.target.value || null)} aria-label="Status da mudança">
          <option value="">Status automático (pelas tarefas)</option>
          <option value="revisao">Em revisão</option>
          <option value="impedida">Impedida</option>
        </select>
        <button className="sf-btn small accent" onClick={() => askPrompt('apply')}>
          ✦ Implementar
        </button>
        <button className="sf-btn small" onClick={() => askPrompt('validate')}>
          Verificar
        </button>
        <button className="sf-btn small" onClick={() => askPrompt('archive')}>
          Arquivar
        </button>
        <button className="sf-btn small danger" onClick={() => setDeleting(true)}>
          Excluir
        </button>
      </div>

      {card?.validation && !card.validation.valid && (
        <div className="sf-callout red">
          <b>Erros de validação</b>
          {card.validation.issues.map((i, k) => (
            <div key={k} style={{ marginTop: 4 }}>
              {i.message}
            </div>
          ))}
          {card.validation.issues.some((i) => /at least one delta/i.test(i.message)) && (
            <div className="sf-row" style={{ marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontSize: 12.5 }}>Sem specs alteradas. Se for documentação, refatoração ou ferramentas, marque-a assim:</span>
              <button className="sf-btn small" onClick={skipSpecs}>
                Marcar como sem mudança de spec
              </button>
            </div>
          )}
        </div>
      )}
      {msg && (
        <div className={`sf-callout ${msg.tone}`} style={{ fontSize: 13 }}>
          {msg.text}
        </div>
      )}

      {detail && (
        <div className="sf-ws-body">
          <aside className="sf-ws-tree">
            <ChangeFileTree dir={folder} name={name} files={detail.files} active={active} onSelect={open} />
          </aside>

          <section className="sf-ws-main">
            {active && <FileEditor path={active} f={file} />}
          </section>

          <aside className="sf-ws-side">
            <div className="sf-tabs">
              <button className={`sf-tab ${tab === 'claude' ? 'on' : ''}`} onClick={() => setTab('claude')}>
                ✦ Editar com Claude
              </button>
              <button className={`sf-tab ${tab === 'ferramentas' ? 'on' : ''}`} onClick={() => setTab('ferramentas')}>
                Ferramentas
              </button>
            </div>
            {tab === 'claude' && <RevisePanel key={active} id={id} change={name} path={active} f={file} onApplied={load} />}
            {tab === 'ferramentas' && <ToolsPanel workspaceId={id} change={name} onChanged={load} />}
          </aside>
        </div>
      )}

      {prompt && <PromptModal prompt={prompt} onClose={() => setPrompt(null)} />}
      {deleting && (
        <DeleteChangeModal
          id={id}
          name={name}
          onClose={() => setDeleting(false)}
          onDone={() => navigate(`/w/${id}/openspec`)}
        />
      )}
    </div>
  )
}

/** A main spec: its file on the left (the same workspace model), the editor and preview, and Claude's revision. */
export function OpenSpecSpecPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const cap = params.get('cap') ?? ''
  const [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState<{ tone: 'red' | 'green' | 'orange'; text: string } | null>(null)

  const load = useCallback(() => {
    api
      .get<Overview>(`/workspaces/${id}/openspec`)
      .then(setOverview)
      .catch((e) => setError((e as Error).message))
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const card = overview?.specs.find((s) => s.id === cap)
  const path = overview && cap ? `${overview.dir}/specs/${cap}/spec.md` : ''
  const file = useOpenSpecFile(id, path)

  const setStatus = async (status: string | null) => {
    try {
      await api.put(`/workspaces/${id}/openspec/status`, { kind: 'spec', item: cap, status })
      load()
    } catch (e) {
      setMsg({ tone: 'red', text: (e as Error).message })
    }
  }

  if (error) return <div className="sf-page"><div className="sf-callout red">{error}</div></div>
  if (!overview) return <div className="sf-page"><span className="sf-spinner" /></div>
  if (!card) {
    // a spec that exists only as a change's delta is reached from that change
    const touched = overview.changes.filter((c) => c.deltas.some((d) => d.capability === cap))
    return (
      <div className="sf-page">
        <div className="sf-callout orange">
          <b>{cap || '(sem nome)'}</b> ainda não está em openspec/specs.{' '}
          {touched.length
            ? touched.map((c) => (
                <Link key={c.id} to={`/w/${id}/openspec/change/${encodeURIComponent(c.id)}`} style={{ marginLeft: 8 }}>
                  ver na mudança {c.id}
                </Link>
              ))
            : 'Nenhuma mudança a alterna.'}
        </div>
        <Link to={`/w/${id}/openspec`} className="sf-link">← voltar ao OpenSpec</Link>
      </div>
    )
  }

  return (
    <div className="sf-page sf-ws">
      <div className="sf-ws-head">
        <Link to={`/w/${id}/openspec`} className="sf-link">
          ← OpenSpec
        </Link>
        <h2 className="sf-ws-title sf-mono">{cap}</h2>
        <span className={`sf-badge ${SPEC_TONE[card.status]}`}>{SPEC_LABEL[card.status]}</span>
        <span className="sf-faint" style={{ fontSize: 12.5 }}>
          {card.requirements} requisitos · {card.scenarios} cenários
          {card.changes.length ? ` · alterada por ${card.changes.join(', ')}` : ''}
        </span>
        <span style={{ flex: 1 }} />
        <select className="sf-input sf-ws-status" value={card.manualStatus ?? ''} onChange={(e) => setStatus(e.target.value || null)} aria-label="Status da spec">
          <option value="">Status automático</option>
          <option value="rascunho">Rascunho</option>
          <option value="aprovada">Aprovada</option>
          <option value="obsoleta">Obsoleta</option>
        </select>
      </div>

      {card.withoutScenario > 0 && <div className="sf-callout orange">{card.withoutScenario} requisito(s) sem cenário.</div>}
      {msg && (
        <div className={`sf-callout ${msg.tone}`} style={{ fontSize: 13 }}>
          {msg.text}
        </div>
      )}

      <div className="sf-ws-body">
        <aside className="sf-ws-tree">
          <ChangeFileTree dir={`${overview.dir}/specs/${cap}`} name={cap} files={['spec.md']} active={path} onSelect={() => undefined} />
        </aside>
        <section className="sf-ws-main">
          <FileEditor path={path} f={file} />
        </section>
        <aside className="sf-ws-side">
          <div className="sf-tabs">
            <button className="sf-tab on">✦ Editar com Claude</button>
          </div>
          <RevisePanel key={path} id={id} change="" path={path} f={file} onApplied={load} />
        </aside>
      </div>
    </div>
  )
}

/** Editor on the left, rendered preview on the right; the preview follows every keystroke. */
function FileEditor({ path, f }: { path: string; f: OpenFile }) {
  const html = useMemo(() => (f.value.trim() ? (md.parse(f.value) as string) : '<p class="sf-faint">Arquivo vazio.</p>'), [f.value])
  const label = path.split('/').slice(-2).join('/')

  return (
    <div className="sf-ws-split">
      <div className="sf-ws-pane">
        <div className="sf-ws-pane-head">
          <span className="sf-mono sf-faint" style={{ fontSize: 11.5, overflowWrap: 'anywhere' }}>
            {label}
          </span>
          <span style={{ flex: 1 }} />
          <span className="sf-faint" style={{ fontSize: 11.5 }}>
            {f.dirty ? 'alterações não salvas' : f.notice}
          </span>
          <button className="sf-btn small" onClick={f.reload} disabled={f.saving}>
            Recarregar
          </button>
          <button className="sf-btn small accent" onClick={f.save} disabled={f.saving || !f.dirty}>
            Salvar
          </button>
        </div>
        {f.error && <div className="sf-callout red" style={{ marginBottom: 8 }}>{f.error}</div>}
        {f.file ? (
          <div className="sf-openspec-editor sf-ws-editor">
            <TextEditor language="text" value={f.value} onChange={f.setValue} />
          </div>
        ) : (
          !f.error && <span className="sf-spinner" />
        )}
      </div>
      <div className="sf-ws-pane">
        <div className="sf-ws-pane-head">
          <span className="sf-faint" style={{ fontSize: 11.5 }}>
            Prévia
          </span>
        </div>
        <article className="sf-doc sf-ws-preview" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  )
}

/**
 * Asks Claude to revise this file from a request in plain language. The revision is only shown as
 * a diff; nothing is saved until "Aplicar". Tools the revision now needs are created on apply.
 */
function RevisePanel({ id, change, path, f, onApplied }: { id: string; change: string; path: string; f: OpenFile; onApplied: () => void }) {
  const [instruction, setInstruction] = useState('')
  const [revision, setRevision] = useState<Revision | null>(null)
  const [busy, setBusy] = useState<'' | 'revisar' | 'aplicar'>('')
  const [msg, setMsg] = useState<{ tone: 'red' | 'green' | 'orange'; text: string } | null>(null)

  const blocked = f.dirty || !f.file

  const revise = async () => {
    setBusy('revisar')
    setMsg({ tone: 'orange', text: 'O Claude está lendo o código e revisando o arquivo… (ele só lê; nada é salvo)' })
    setRevision(null)
    try {
      const r = await api.post<Revision>(`/workspaces/${id}/openspec/revise`, { path, instruction })
      setRevision(r)
      setMsg(r.text === r.current ? { tone: 'orange', text: 'O Claude não encontrou nada a mudar.' } : null)
    } catch (e) {
      setMsg({ tone: 'red', text: (e as Error).message })
    } finally {
      setBusy('')
    }
  }

  const apply = async () => {
    if (!revision) return
    setBusy('aplicar')
    setMsg(null)
    try {
      await api.put(`/workspaces/${id}/openspec/file`, { path, content: revision.text, expectedSha: revision.sha })
      let created: ToolResult[] = []
      if (change && revision.tools.length) {
        const r = await api.post<{ results: ToolResult[] }>(`/workspaces/${id}/links/create`, { change, tools: revision.tools })
        created = r.results
      }
      const extra = created.length
        ? ` Ferramentas: ${created.map((c) => (c.ok ? (c.kind === 'diagram' ? 'diagrama em desenho' : 'quadro criado') : `falhou (${c.error})`)).join(', ')}.`
        : ''
      setMsg({ tone: 'green', text: `Revisão salva.${extra}` })
      setRevision(null)
      setInstruction('')
      f.reload()
      onApplied()
    } catch (e) {
      const text = (e as Error).message
      setMsg({ tone: 'red', text: text.includes('mudou') ? `${text} Recarregue o arquivo e peça a revisão de novo.` : text })
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="sf-ws-claude">
      <p className="sf-faint" style={{ fontSize: 12.5, margin: '0 0 8px' }}>
        Descreva a alteração em linguagem natural. Você verá o que muda antes de salvar.
      </p>
      {f.dirty && (
        <div className="sf-callout orange" style={{ marginBottom: 8, fontSize: 12.5 }}>
          Salve ou recarregue as edições do editor antes de pedir uma revisão, para não misturar duas versões.
        </div>
      )}
      <textarea
        className="sf-input"
        style={{ width: '100%', minHeight: 84, resize: 'vertical' }}
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="ex.: adicione um requisito sobre expiração do QR do Pix em 30 minutos e um cenário de falha"
        maxLength={2000}
        disabled={busy !== '' || blocked}
      />
      <div className="sf-row" style={{ marginTop: 6, justifyContent: 'flex-end' }}>
        <button className="sf-btn accent small" onClick={revise} disabled={busy !== '' || blocked || instruction.trim().length < 3}>
          {busy === 'revisar' ? 'Revisando…' : '✦ Revisar com o Claude'}
        </button>
      </div>

      {msg && (
        <div className={`sf-callout ${msg.tone}`} style={{ marginTop: 10, fontSize: 12.5 }}>
          {msg.text}
        </div>
      )}

      {revision && revision.text !== revision.current && (
        <div style={{ marginTop: 12 }}>
          <div className="sf-ws-section-title">O que muda</div>
          <DiffView before={revision.current} after={revision.text} />
          {revision.tools.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="sf-ws-section-title">Ferramentas que a revisão pede</div>
              {revision.tools.map((t, i) => (
                <div key={i} className="sf-faint" style={{ fontSize: 12.5, marginBottom: 4 }}>
                  <b>{t.kind === 'diagram' ? `Diagrama (${t.type})` : `Quadro: ${t.name}`}</b>: {t.request ?? t.reason}
                </div>
              ))}
            </div>
          )}
          <div className="sf-row" style={{ marginTop: 10, justifyContent: 'flex-end', gap: 6 }}>
            <button className="sf-btn small" onClick={() => setRevision(null)} disabled={busy !== ''}>
              Descartar
            </button>
            <button className="sf-btn small accent" onClick={apply} disabled={busy !== ''}>
              {busy === 'aplicar' ? 'Salvando…' : 'Aplicar e salvar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- line diff -------------------------------------------------------------------------------

type DiffOp = { t: 'same' | 'add' | 'del'; s: string }

/** Longest-common-subsequence diff by line. Very large inputs fall back to showing the whole replacement. */
export function lineDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length
  const m = b.length
  if (n * m > 4_000_000) return [...a.map((s): DiffOp => ({ t: 'del', s })), ...b.map((s): DiffOp => ({ t: 'add', s }))]
  const w = m + 1
  const dp = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
    }
  }
  const out: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ t: 'same', s: a[i] })
      i++
      j++
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      out.push({ t: 'del', s: a[i++] })
    } else {
      out.push({ t: 'add', s: b[j++] })
    }
  }
  while (i < n) out.push({ t: 'del', s: a[i++] })
  while (j < m) out.push({ t: 'add', s: b[j++] })
  return out
}

/** Shows only the changed lines, with two lines of context around them */
function DiffView({ before, after }: { before: string; after: string }) {
  const ops = useMemo(() => lineDiff(before.split('\n'), after.split('\n')), [before, after])
  const keep = ops.map(() => false)
  ops.forEach((op, k) => {
    if (op.t === 'same') return
    for (let d = -2; d <= 2; d++) if (k + d >= 0 && k + d < ops.length) keep[k + d] = true
  })
  const rows: ReactNode[] = []
  let gap = false
  ops.forEach((op, k) => {
    if (!keep[k]) {
      gap = true
      return
    }
    if (gap) rows.push(<div key={`g${k}`} className="sf-diff-gap">…</div>)
    gap = false
    rows.push(
      <div key={k} className={`sf-diff-line sf-diff-${op.t}`}>
        {op.t === 'add' ? '+ ' : op.t === 'del' ? '- ' : '  '}
        {op.s}
      </div>,
    )
  })
  return <div className="sf-diff">{rows}</div>
}
