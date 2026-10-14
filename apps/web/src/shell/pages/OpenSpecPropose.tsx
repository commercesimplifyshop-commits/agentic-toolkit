import { Marked } from 'marked'
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react'
import { api } from '../api'
import { TextEditor } from '../editor/TextEditor'

// Escapes raw HTML: the proposal is Claude's text, and nothing in it may run as markup
const md = new Marked({ gfm: true, renderer: { html: ({ text }: { text: string }) => text.replace(/</g, '&lt;').replace(/>/g, '&gt;') } })

const MAX_IMAGES = 6
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const IMAGE_TYPE = /^image\/(png|jpeg|gif|webp)$/

export interface Attached {
  id: string
  name: string
}

/** Where an attached image is served from */
export const attachmentUrl = (workspaceId: string, file: string) => `/api/workspaces/${workspaceId}/openspec/explore/attachment?file=${encodeURIComponent(file)}`

/** Images for a message: picked, pasted (Ctrl+V) or dropped. Each one is uploaded as soon as it is added. */
export function useAttachments(workspaceId: string) {
  const [items, setItems] = useState<Attached[]>([])
  const [uploading, setUploading] = useState(0)
  const [error, setError] = useState('')
  const count = useRef(0)
  count.current = items.length

  const add = async (files: File[]) => {
    setError('')
    const images = files.filter((f) => IMAGE_TYPE.test(f.type))
    if (images.length < files.length) setError('Só imagens PNG, JPG, GIF ou WEBP podem ser anexadas.')
    for (const f of images) {
      if (count.current + uploading >= MAX_IMAGES) {
        setError(`Até ${MAX_IMAGES} imagens por mensagem.`)
        break
      }
      if (f.size > MAX_IMAGE_BYTES) {
        setError(`${f.name || 'Imagem'} tem mais de 5 MB.`)
        continue
      }
      setUploading((n) => n + 1)
      try {
        const form = new FormData()
        form.append('file', f, f.name || 'imagem.png')
        const a = await api.post<Attached>(`/workspaces/${workspaceId}/openspec/explore/attachments`, form)
        setItems((list) => [...list, { id: a.id, name: a.name }])
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }

  return {
    items,
    uploading,
    error,
    add,
    remove: (id: string) => setItems((list) => list.filter((a) => a.id !== id)),
    clear: () => setItems([]),
    /** Pasting an image (a print) attaches it; pasting text keeps working as usual */
    onPaste: (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData.files)
      if (files.length) {
        e.preventDefault()
        void add(files)
      }
    },
    onDrop: (e: DragEvent) => {
      if (!e.dataTransfer.files.length) return
      e.preventDefault()
      void add(Array.from(e.dataTransfer.files))
    },
  }
}

export type Attachments = ReturnType<typeof useAttachments>

/** The attach button and the thumbnails of the images added so far */
export function AttachmentStrip({ workspaceId, att, disabled = false }: { workspaceId: string; att: Attachments; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="sf-attach">
      <button type="button" className="sf-btn small" onClick={() => input.current?.click()} disabled={disabled || att.items.length >= MAX_IMAGES}>
        📎 Anexar imagem
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(e) => {
          void att.add(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      {att.items.map((a) => (
        <span key={a.id} className="sf-attach-thumb" title={a.name}>
          <img src={attachmentUrl(workspaceId, a.id)} alt={a.name} />
          <button type="button" aria-label={`Remover ${a.name}`} onClick={() => att.remove(a.id)} disabled={disabled}>
            ✕
          </button>
        </span>
      ))}
      {att.uploading > 0 && <span className="sf-faint" style={{ fontSize: 12 }}>enviando {att.uploading}…</span>}
      <span className="sf-faint" style={{ fontSize: 11.5 }}>ou cole (Ctrl+V) e arraste prints aqui</span>
      {att.error && <span style={{ color: 'var(--sf-red)', fontSize: 12 }}>{att.error}</span>}
    </div>
  )
}

/** A modal that only closes on its own buttons: a click outside never throws work away */
function Dialog({ title, wide = false, onClose, children }: { title: string; wide?: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sf-drawer-back" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="sf-prompt-modal" role="dialog" aria-label={title} style={{ width: wide ? 'min(1180px, calc(100vw - 32px))' : 'min(720px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 48px)' }}>
        <div className="sf-drawer-head">
          <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
          <button className="sf-link" onClick={onClose} aria-label="Fechar" style={{ fontSize: 18 }}>
            ✕
          </button>
        </div>
        <div style={{ overflowY: 'auto', paddingTop: 8, minHeight: 0 }}>{children}</div>
      </div>
    </div>
  )
}

const DRAFT_KEY = (workspaceId: string) => `agentic-toolkit.newChange.${workspaceId}`

/**
 * Nova mudança: a single field in plain language plus images. It does not create anything: it
 * starts a conversation where Claude reads the code and refines the task with the engineer.
 * The text is kept in this browser until it is sent, so closing the window loses nothing.
 */
export function NewChangeStart({ workspaceId, onStart, onClose }: { workspaceId: string; onStart: (start: { message: string; attachments: Attached[] }) => void; onClose: () => void }) {
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(DRAFT_KEY(workspaceId)) ?? ''
    } catch {
      return ''
    }
  })
  const att = useAttachments(workspaceId)

  useEffect(() => {
    try {
      if (text) localStorage.setItem(DRAFT_KEY(workspaceId), text)
      else localStorage.removeItem(DRAFT_KEY(workspaceId))
    } catch {
      // the draft just won't survive a reload
    }
  }, [text, workspaceId])

  const close = () => {
    if ((text.trim() || att.items.length) && !window.confirm('Fechar? O texto continua guardado para a próxima vez, mas as imagens anexadas serão descartadas.')) return
    onClose()
  }

  const start = () => {
    try {
      localStorage.removeItem(DRAFT_KEY(workspaceId))
    } catch {
      // nothing to clean
    }
    onStart({ message: text.trim(), attachments: att.items })
  }

  const ready = (text.trim().length >= 10 || att.items.length > 0) && att.uploading === 0

  return (
    <Dialog title="Nova mudança" onClose={close}>
      <p className="sf-muted" style={{ fontSize: 13, lineHeight: 1.6, margin: '0 0 10px' }}>
        Descreva a tarefa como ela chegou para você: o texto do ticket, critérios, links e prints. O Claude lê o código, refina a tarefa com você e, quando estiver claro, monta a proposta completa para você revisar.
      </p>
      <div onDragOver={(e) => e.preventDefault()} onDrop={att.onDrop}>
        <textarea
          className="sf-input"
          style={{ width: '100%', minHeight: 220, resize: 'vertical', fontSize: 13.5, lineHeight: 1.55 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={att.onPaste}
          placeholder={'ex.: "Na página de produto, o cliente quer calcular o frete pelo CEP antes de adicionar ao carrinho. Hoje só aparece no checkout."'}
          maxLength={20000}
          autoFocus
        />
        <AttachmentStrip workspaceId={workspaceId} att={att} />
      </div>
      <div className="sf-row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button className="sf-btn" onClick={close}>
          Cancelar
        </button>
        <button className="sf-btn accent" onClick={start} disabled={!ready}>
          ✦ Refinar com o Claude
        </button>
      </div>
    </Dialog>
  )
}

/** Mirrors apps/api/src/openspec/openspec-explore.service.ts */
export interface ProposalPackage {
  name: string
  summary: string
  files: Record<string, string>
  notes: string[]
}

const FILE_ORDER = (k: string) => (k === 'proposal.md' ? 0 : k === 'design.md' ? 1 : k === 'tasks.md' ? 2 : 3)

/**
 * The complete change Claude wrote, file by file, before anything is created: rename it, read
 * each file rendered, edit what needs editing, then create it. Closing asks first.
 */
export function ProposalReview({ workspaceId, pkg, onCreated, onClose }: { workspaceId: string; pkg: ProposalPackage; onCreated: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(pkg.name)
  const [files, setFiles] = useState<Record<string, string>>(pkg.files)
  const keys = useMemo(() => Object.keys(files).sort((a, b) => FILE_ORDER(a) - FILE_ORDER(b) || a.localeCompare(b)), [files])
  const [active, setActive] = useState(keys[0] ?? 'proposal.md')
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const subtasks = (files['tasks.md']?.match(/^- \[ \] /gm) ?? []).length
  const scenarios = keys.filter((k) => k.startsWith('specs/')).reduce((n, k) => n + (files[k].match(/^#### Scenario:/gm) ?? []).length, 0)
  const html = useMemo(() => md.parse(files[active] ?? '') as string, [files, active])

  const close = () => {
    if (!window.confirm('Descartar esta proposta? Ela ainda não foi criada.')) return
    onClose()
  }

  const create = async () => {
    setBusy(true)
    setError('')
    try {
      await api.post(`/workspaces/${workspaceId}/openspec/change/files`, { name, files })
      onCreated(name)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="Revisar a proposta antes de criar" wide onClose={close}>
      <div className="sf-row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <label className="sf-faint" style={{ fontSize: 12.5 }} htmlFor="change-name">
          Nome da mudança
        </label>
        <input id="change-name" className="sf-input sf-mono" style={{ width: 'auto', minWidth: 320 }} value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))} />
        <span className="sf-faint" style={{ fontSize: 12.5 }}>
          {keys.length} arquivos · {subtasks} tarefas · {scenarios} cenários
        </span>
      </div>
      {pkg.summary && <p className="sf-muted" style={{ fontSize: 13, margin: '0 0 10px' }}>{pkg.summary}</p>}
      {pkg.notes.length > 0 && (
        <div className="sf-callout orange" style={{ fontSize: 12.5, marginBottom: 10 }}>
          {pkg.notes.map((n, i) => (
            <div key={i}>• {n}</div>
          ))}
        </div>
      )}

      <div className="sf-review">
        <nav className="sf-review-files" aria-label="Arquivos da proposta">
          {keys.map((k) => (
            <button key={k} className={`sf-ostree-row sf-ostree-spec ${k === active ? 'on' : ''}`} onClick={() => setActive(k)}>
              <span className="sf-ostree-ico">▤</span>
              <span className="sf-ostree-path">{k}</span>
            </button>
          ))}
        </nav>
        <section className="sf-review-main">
          <div className="sf-tabs" style={{ marginBottom: 8 }}>
            <button className={`sf-tab ${mode === 'preview' ? 'on' : ''}`} onClick={() => setMode('preview')}>
              Prévia
            </button>
            <button className={`sf-tab ${mode === 'edit' ? 'on' : ''}`} onClick={() => setMode('edit')}>
              Editar
            </button>
          </div>
          {mode === 'preview' ? (
            <article className="sf-doc sf-review-preview" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <div className="sf-openspec-editor sf-review-editor">
              <TextEditor language="text" value={files[active] ?? ''} onChange={(v) => setFiles((f) => ({ ...f, [active]: v }))} />
            </div>
          )}
        </section>
      </div>

      {error && <div className="sf-callout red" style={{ marginTop: 10 }}>{error}</div>}
      <div className="sf-row" style={{ justifyContent: 'space-between', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <span className="sf-faint" style={{ fontSize: 12 }}>
          Os arquivos são gravados em openspec/changes/{name || '…'}/ (exceção de escrita do OpenSpec, com auditoria).
        </span>
        <span className="sf-row" style={{ gap: 8 }}>
          <button className="sf-btn" onClick={close} disabled={busy}>
            Descartar
          </button>
          <button className="sf-btn accent" onClick={create} disabled={busy || !/^[a-z0-9][a-z0-9-]{1,80}$/.test(name)}>
            {busy ? 'Criando…' : 'Criar mudança'}
          </button>
        </span>
      </div>
    </Dialog>
  )
}
