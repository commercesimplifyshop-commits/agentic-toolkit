import { useEffect, useState } from 'react'
import { api } from '../api'
import { TextEditor } from '../editor/TextEditor'

interface FileState {
  path: string
  content: string
  sha: string
}

/** Edits one OpenSpec file. Saves carry the version it was loaded at, so a stale copy cannot overwrite a newer one. */
export function OpenSpecEditor({
  id,
  path,
  draft,
  onSaved,
}: {
  id: string
  path: string
  /** Asks Claude for a draft of this file; the draft is only placed in the editor, never saved */
  draft?: { kind: 'proposal' | 'tasks' | 'spec'; capability?: string; label: string }
  onSaved: () => void
}) {
  const [file, setFile] = useState<FileState | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'red' | 'green' | 'orange'; text: string } | null>(null)
  const [askDraft, setAskDraft] = useState(false)
  const [request, setRequest] = useState('')

  const load = () =>
    api
      .get<FileState>(`/workspaces/${id}/openspec/file?path=${encodeURIComponent(path)}`)
      .then((f) => {
        setFile(f)
        setValue(f.content)
        setMsg(null)
      })
      .catch((e) => setMsg({ tone: 'red', text: (e as Error).message }))

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, path])

  const dirty = file !== null && value !== file.content

  const save = async () => {
    if (!file) return
    setBusy(true)
    try {
      const r = await api.put<{ sha: string }>(`/workspaces/${id}/openspec/file`, { path, content: value, expectedSha: file.sha })
      setFile({ path, content: value, sha: r.sha })
      setMsg({ tone: 'green', text: 'Salvo. A validação foi atualizada.' })
      onSaved()
    } catch (e) {
      const text = (e as Error).message
      setMsg({ tone: 'red', text: text.includes('mudou') ? `${text} Use "Recarregar" e refaça a edição.` : text })
    } finally {
      setBusy(false)
    }
  }

  const runDraft = async () => {
    if (!draft || request.trim().length < 3) return
    setBusy(true)
    setMsg({ tone: 'orange', text: 'O Claude está escrevendo o rascunho… (ele só lê o código)' })
    try {
      const r = await api.post<{ text: string }>(`/workspaces/${id}/openspec/draft`, { kind: draft.kind, request, capability: draft.capability })
      setValue(r.text)
      setAskDraft(false)
      setMsg({ tone: 'orange', text: 'Rascunho no editor. Revise e clique em Salvar para gravar.' })
    } catch (e) {
      setMsg({ tone: 'red', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  if (!file) return msg ? <div className={`sf-callout ${msg.tone}`}>{msg.text}</div> : <span className="sf-spinner" />

  return (
    <div className="sf-openspec-edit">
      <div className="sf-row" style={{ marginBottom: 6, flexWrap: 'wrap' }}>
        <span className="sf-mono sf-faint" style={{ fontSize: 11.5, overflowWrap: 'anywhere' }}>
          {path}
        </span>
        <span style={{ flex: 1 }} />
        {draft && (
          <button className="sf-btn small" onClick={() => setAskDraft((v) => !v)} disabled={busy}>
            ✦ Rascunhar com o Claude
          </button>
        )}
        <button className="sf-btn small" onClick={load} disabled={busy}>
          Recarregar
        </button>
        <button className="sf-btn small accent" onClick={save} disabled={busy || !dirty}>
          Salvar
        </button>
      </div>

      {askDraft && draft && (
        <div className="sf-card" style={{ padding: 12, marginBottom: 8 }}>
          <div className="sf-faint" style={{ fontSize: 12, marginBottom: 6 }}>
            Descreva o que o {draft.label} deve cobrir. O rascunho entra no editor, e nada é salvo sem a sua confirmação.
          </div>
          <div className="sf-row">
            <input className="sf-input" value={request} onChange={(e) => setRequest(e.target.value)} placeholder="ex.: Pix como meio de pagamento, com expiração do QR em 30 minutos" />
            <button className="sf-btn accent" onClick={runDraft} disabled={busy || request.trim().length < 3}>
              Gerar rascunho
            </button>
          </div>
        </div>
      )}

      {msg && <div className={`sf-callout ${msg.tone}`} style={{ marginBottom: 8 }}>{msg.text}</div>}
      <div className="sf-openspec-editor">
        <TextEditor language="text" value={value} onChange={setValue} />
      </div>
    </div>
  )
}

// ---- install ---------------------------------------------------------------------------------------

interface Preview {
  planId: string
  cliVersion: string
  files: { path: string; bytes: number }[]
  ignored: { path: string; reason: string }[]
  expiresInMinutes: number
}

/** Preview first (what would be copied), then confirmation, then the copy. */
export function InstallModal({ id, onDone, onClose }: { id: string; onDone: () => void; onClose: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setBusy(true)
    api
      .post<Preview>(`/workspaces/${id}/openspec/install/preview`)
      .then(setPreview)
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false))
  }, [id])

  const apply = async () => {
    if (!preview) return
    setBusy(true)
    setError('')
    try {
      await api.post(`/workspaces/${id}/openspec/install/apply`, { planId: preview.planId })
      onDone()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal title="Instalar OpenSpec neste projeto" onClose={onClose}>
      {!preview && !error && <span className="sf-spinner" />}
      {error && <div className="sf-callout red" style={{ marginBottom: 12 }}>{error}</div>}
      {preview && (
        <>
          <p className="sf-muted" style={{ fontSize: 13, marginTop: 0 }}>
            O CLI do OpenSpec (versão {preview.cliVersion}) gerou os arquivos abaixo numa pasta de preparação. Só estes serão copiados para a instalação. Nada foi gravado ainda.
          </p>
          <div className="sf-faint" style={{ fontSize: 12, marginBottom: 4 }}>
            Serão criados ({preview.files.length})
          </div>
          <div className="sf-prompt-text" style={{ maxHeight: 260 }}>
            {preview.files.map((f) => `${f.path}  (${f.bytes} bytes)`).join('\n')}
          </div>
          {preview.ignored.length > 0 && (
            <>
              <div className="sf-faint" style={{ fontSize: 12, margin: '10px 0 4px' }}>
                Ignorados por segurança ({preview.ignored.length})
              </div>
              <div className="sf-prompt-text" style={{ maxHeight: 120 }}>
                {preview.ignored.map((f) => `${f.path}: ${f.reason}`).join('\n')}
              </div>
            </>
          )}
          <div className="sf-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="sf-btn" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button className="sf-btn accent" onClick={apply} disabled={busy}>
              Confirmar instalação
            </button>
          </div>
          <div className="sf-faint" style={{ fontSize: 11.5, marginTop: 8 }}>
            A prévia vale por {preview.expiresInMinutes} minutos. Depois disso, gere a instalação de novo.
          </div>
        </>
      )}
    </Modal>
  )
}

// ---- new change and new spec -----------------------------------------------------------------------

const lines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

export interface ChangeDraft {
  name: string
  why: string
  whatChanges: string[]
  newCapabilities: string[]
  modifiedCapabilities: string[]
  purposes: Record<string, string>
  notes: string[]
}

export function NewChangeModal({
  id,
  specs,
  initialWhy,
  draft,
  onCreated,
  onClose,
}: {
  id: string
  specs: string[]
  /** Draft from the explore conversation (facilitator); the user reviews it before creating */
  draft?: ChangeDraft | null
  /** Text captured from an explore conversation, offered as the starting "porquê" */
  initialWhy?: string
  onCreated: (name: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(draft?.name ?? '')
  const [why, setWhy] = useState(draft?.why ?? (initialWhy ?? '').slice(0, 1500))
  const [what, setWhat] = useState((draft?.whatChanges ?? []).join('\n'))
  const [newCaps, setNewCaps] = useState((draft?.newCapabilities ?? []).join('\n'))
  const [modCaps, setModCaps] = useState<string[]>(draft?.modifiedCapabilities ?? [])
  const [noSpecs, setNoSpecs] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const hasCaps = lines(newCaps).length + modCaps.length > 0
  // OpenSpec rejects a change with no deltas unless it says so explicitly
  const canCreate = Boolean(name.trim() && why.trim()) && (hasCaps || noSpecs) && !(hasCaps && noSpecs)

  const create = async () => {
    setBusy(true)
    setError('')
    try {
      await api.post(`/workspaces/${id}/openspec/change`, {
        name: name.trim(),
        why,
        whatChanges: lines(what),
        newCapabilities: lines(newCaps),
        modifiedCapabilities: modCaps,
        purposes: draft?.purposes ?? {},
        skipSpecs: noSpecs,
      })
      onCreated(name.trim())
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal title="Nova mudança" onClose={onClose}>
      <p className="sf-muted" style={{ fontSize: 13, marginTop: 0 }}>
        Cria a proposta, as tarefas e os deltas de spec a partir do modelo do OpenSpec. Depois você edita cada arquivo, ou pede um rascunho ao Claude.
      </p>
      {draft && (
        <div className="sf-callout" style={{ fontSize: 12.5, marginBottom: 12 }}>
          <b>Rascunho do Claude a partir da conversa.</b> Revise os campos antes de criar.
          {draft.notes.map((n, i) => (
            <div key={i} style={{ marginTop: 4 }}>
              {n}
            </div>
          ))}
        </div>
      )}
      <label className="sf-field">
        <span>Nome (kebab-case)</span>
        <input className="sf-input sf-mono" value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="adicionar-pix" />
      </label>
      <label className="sf-field">
        <span>Porquê</span>
        <textarea className="sf-input" rows={3} value={why} onChange={(e) => setWhy(e.target.value)} />
      </label>
      <label className="sf-field">
        <span>O que muda (uma linha por item)</span>
        <textarea className="sf-input" rows={3} value={what} onChange={(e) => setWhat(e.target.value)} />
      </label>
      <label className="sf-field">
        <span>Capacidades novas (caminho, uma por linha)</span>
        <textarea className="sf-input sf-mono" rows={2} value={newCaps} onChange={(e) => setNewCaps(e.target.value)} placeholder="pagamento/pix" />
      </label>
      <div className="sf-field">
        <span style={{ fontSize: 12, fontWeight: 600, color: '#c9c9cf' }}>Capacidades modificadas</span>
        {specs.length === 0 && <small>Nenhuma spec existe ainda: use capacidades novas.</small>}
        <div className="sf-row" style={{ flexWrap: 'wrap', gap: 10 }}>
          {specs.map((s) => (
            <label key={s} className="sf-apic-check">
              <input type="checkbox" checked={modCaps.includes(s)} onChange={(e) => setModCaps(e.target.checked ? [...modCaps, s] : modCaps.filter((x) => x !== s))} /> <span className="sf-mono">{s}</span>
            </label>
          ))}
        </div>
      </div>
      <label className="sf-apic-check" style={{ marginBottom: 10 }}>
        <input type="checkbox" checked={noSpecs} disabled={hasCaps} onChange={(e) => setNoSpecs(e.target.checked)} />{' '}
        Esta mudança não altera specs (documentação, refatoração, ferramentas)
      </label>
      {!hasCaps && !noSpecs && <div className="sf-faint" style={{ fontSize: 12, marginBottom: 8 }}>Escolha ao menos uma capacidade alterada, ou marque a opção acima.</div>}
      {error && <div className="sf-callout red" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="sf-row" style={{ justifyContent: 'flex-end' }}>
        <button className="sf-btn" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button className="sf-btn accent" onClick={create} disabled={busy || !canCreate}>
          Criar mudança
        </button>
      </div>
    </Modal>
  )
}

export function NewSpecModal({ id, onCreated, onClose }: { id: string; onCreated: (capability: string) => void; onClose: () => void }) {
  const [capability, setCapability] = useState('')
  const [purpose, setPurpose] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const create = async () => {
    setBusy(true)
    setError('')
    try {
      await api.post(`/workspaces/${id}/openspec/spec`, { capability: capability.trim(), purpose })
      onCreated(capability.trim())
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  return (
    <Modal title="Nova spec" onClose={onClose}>
      <p className="sf-muted" style={{ fontSize: 13, marginTop: 0 }}>
        Uma capacidade do sistema que tem nome próprio e comportamento observável, como <span className="sf-mono">checkout</span> ou <span className="sf-mono">pagamento/pix</span>.
      </p>
      <label className="sf-field">
        <span>Capacidade (caminho)</span>
        <input className="sf-input sf-mono" value={capability} onChange={(e) => setCapability(e.target.value.toLowerCase())} placeholder="pagamento/pix" />
      </label>
      <label className="sf-field">
        <span>Propósito (uma ou duas frases)</span>
        <textarea className="sf-input" rows={3} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
      </label>
      {error && <div className="sf-callout red" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="sf-row" style={{ justifyContent: 'flex-end' }}>
        <button className="sf-btn" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button className="sf-btn accent" onClick={create} disabled={busy || !capability.trim()}>
          Criar spec
        </button>
      </div>
    </Modal>
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="sf-drawer-back" onClick={onClose} style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="sf-prompt-modal" style={{ width: 'min(620px, calc(100vw - 32px))' }} onClick={(e) => e.stopPropagation()}>
        <div className="sf-drawer-head">
          <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
          <button className="sf-link" onClick={onClose} style={{ fontSize: 18 }}>
            ✕
          </button>
        </div>
        <div style={{ overflowY: 'auto', paddingTop: 8 }}>{children}</div>
      </div>
    </div>
  )
}

// ---- delete a change ---------------------------------------------------------------------------------

/** Removing a change needs the exact name typed. A copy of its files is kept in Agentic Toolkit first. */
export function DeleteChangeModal({ id, name, onDone, onClose }: { id: string; name: string; onDone: () => void; onClose: () => void }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const remove = async () => {
    setBusy(true)
    setError('')
    try {
      await api.del(`/workspaces/${id}/openspec/change?name=${encodeURIComponent(name)}&confirm=${encodeURIComponent(typed)}`)
      onDone()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  return (
    <Modal title={`Excluir a mudança ${name}`} onClose={onClose}>
      <div className="sf-callout red" style={{ marginBottom: 12, fontSize: 12.5 }}>
        Os arquivos da mudança (proposta, tarefas e deltas) são removidos da instalação. Uma cópia fica guardada no Agentic Toolkit, nesta máquina.
        Mudanças arquivadas não podem ser excluídas por aqui.
      </div>
      <label className="sf-field">
        <span>Para confirmar, digite <span className="sf-mono">{name}</span></span>
        <input className="sf-input sf-mono" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
      </label>
      {error && <div className="sf-callout red" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="sf-row" style={{ justifyContent: 'flex-end' }}>
        <button className="sf-btn" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button className="sf-btn danger" onClick={remove} disabled={busy || typed !== name}>
          Excluir mudança
        </button>
      </div>
    </Modal>
  )
}
