import '../board/excalidraw-setup'
import { Excalidraw, getSceneVersion } from '@excalidraw/excalidraw'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/types/element/types'
import type { AppState, BinaryFiles, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'

interface BoardMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  elements: number
}

interface Board {
  id: string
  name: string
  updatedAt: string
  scene: { elements: ExcalidrawElement[]; appState?: Partial<AppState>; files?: BinaryFiles }
}

type SaveState = { kind: 'saved'; at: string } | { kind: 'dirty' } | { kind: 'saving' } | { kind: 'error'; message: string }

const AUTOSAVE_MS = 1200
/** Board look kept with the drawing; scroll, zoom and selection are per session */
const PERSISTED_APPSTATE = ['viewBackgroundColor', 'gridSize'] as const

export function BoardPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const boardId = params.get('board')
  const [boards, setBoards] = useState<BoardMeta[] | null>(null)
  const [error, setError] = useState('')

  const refresh = useCallback(
    () =>
      api
        .get<BoardMeta[]>(`/workspaces/${id}/boards`)
        .then((list) => (setBoards(list), list))
        .catch((e) => (setError(e.message), [] as BoardMeta[])),
    [id],
  )

  // Opens the most recent board, or creates the first one
  useEffect(() => {
    refresh().then((list) => {
      if (boardId) return
      if (list.length) setParams({ board: list[0].id }, { replace: true })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh])

  const create = async () => {
    try {
      const b = await api.post<BoardMeta>(`/workspaces/${id}/boards`, { name: `Quadro ${new Date().toLocaleDateString('pt-BR')}` })
      await refresh()
      setParams({ board: b.id })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="sf-board">
      <aside className="sf-board-list">
        <button className="sf-btn accent" style={{ width: '100%', justifyContent: 'center' }} onClick={create}>
          + Novo quadro
        </button>
        <div className="sf-docs-items">
          {boards?.map((b) => (
            <button key={b.id} className={`sf-docs-item ${b.id === boardId ? 'on' : ''}`} onClick={() => setParams({ board: b.id })}>
              <span className="t">{b.name}</span>
              <span className="m">
                <span className="sf-faint">
                  {b.elements} {b.elements === 1 ? 'elemento' : 'elementos'} · {new Date(b.updatedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              </span>
            </button>
          ))}
          {boards?.length === 0 && <div className="sf-faint" style={{ fontSize: 12.5, padding: '14px 4px' }}>Nenhum quadro ainda. Crie um para rascunhar fluxos, arquiteturas e ideias.</div>}
        </div>
        <p className="sf-faint" style={{ fontSize: 11.5, margin: 0 }}>
          Os quadros ficam salvos no StoreFlow (por instalação), nunca no repositório.
        </p>
      </aside>
      <section className="sf-board-main">
        {error && <div className="sf-callout red" style={{ margin: 12 }}>{error}</div>}
        {boardId ? (
          <BoardEditor key={boardId} workspaceId={id} boardId={boardId} onSaved={refresh} onDeleted={() => (setParams({}), refresh())} />
        ) : (
          boards?.length === 0 && (
            <div className="sf-empty" style={{ marginTop: 80 }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>✎</div>
              Quadro branco para rascunhos, desenhos e diagramas.
              <div style={{ marginTop: 16 }}>
                <button className="sf-btn accent" onClick={create}>
                  + Criar o primeiro quadro
                </button>
              </div>
            </div>
          )
        )}
      </section>
    </div>
  )
}

function BoardEditor({ workspaceId, boardId, onSaved, onDeleted }: { workspaceId: string; boardId: string; onSaved: () => void; onDeleted: () => void }) {
  const [board, setBoard] = useState<Board | null>(null)
  const [name, setName] = useState('')
  const [save, setSave] = useState<SaveState>({ kind: 'saved', at: '' })
  const [error, setError] = useState('')
  const url = `/workspaces/${workspaceId}/boards/${boardId}`

  // Latest scene and what was last persisted, kept outside React state (onChange fires on every pointer move)
  const latest = useRef<Board['scene'] | null>(null)
  const savedVersion = useRef('')
  const timer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    api
      .get<Board>(url)
      .then((b) => {
        setBoard(b)
        setName(b.name)
        savedVersion.current = versionOf(b.scene.elements, b.scene.files)
        setSave({ kind: 'saved', at: b.updatedAt })
      })
      .catch((e) => setError(e.message))
  }, [url])

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const scene = latest.current
    if (!scene) return
    const version = versionOf(scene.elements, scene.files)
    if (version === savedVersion.current) return
    setSave({ kind: 'saving' })
    try {
      const r = await api.put<{ updatedAt: string }>(url, { scene })
      savedVersion.current = version
      setSave({ kind: 'saved', at: r.updatedAt })
      onSaved()
    } catch (e) {
      setSave({ kind: 'error', message: (e as Error).message })
    }
  }, [url, onSaved])

  // Save what is pending when leaving the board or closing the tab
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (latest.current && versionOf(latest.current.elements, latest.current.files) !== savedVersion.current) {
        flush()
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('beforeunload', warn)
      flush()
    }
  }, [flush])

  const onChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      const kept = Object.fromEntries(PERSISTED_APPSTATE.map((k) => [k, appState[k]])) as Partial<AppState>
      latest.current = { elements: elements as ExcalidrawElement[], appState: kept, files }
      if (versionOf(elements, files) === savedVersion.current) return
      setSave((s) => (s.kind === 'dirty' ? s : { kind: 'dirty' }))
      clearTimeout(timer.current)
      timer.current = setTimeout(flush, AUTOSAVE_MS)
    },
    [flush],
  )

  const initialData = useMemo<ExcalidrawInitialDataState | null>(
    () => (board ? { elements: board.scene.elements, appState: { ...board.scene.appState, theme: 'dark' }, files: board.scene.files, scrollToContent: true } : null),
    [board],
  )

  const rename = async () => {
    const clean = name.trim()
    if (!board || !clean || clean === board.name) return setName(board?.name ?? '')
    try {
      await api.put(url, { name: clean })
      setBoard({ ...board, name: clean })
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const remove = async () => {
    if (!board || !confirm(`Excluir o quadro "${board.name}"? Não dá para desfazer.`)) return
    clearTimeout(timer.current)
    latest.current = null
    try {
      await api.del(url)
      onDeleted()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (error) return <div className="sf-callout red" style={{ margin: 12 }}>{error}</div>
  if (!board || !initialData) return <span className="sf-spinner" style={{ margin: 16 }} />

  return (
    <div className="sf-board-editor">
      <div className="sf-board-bar">
        <input className="sf-board-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} maxLength={120} title="Renomear quadro" />
        <span className={`sf-board-status ${save.kind}`}>
          {save.kind === 'saving' && 'Salvando…'}
          {save.kind === 'dirty' && 'Alterações não salvas'}
          {save.kind === 'saved' && (save.at ? `Salvo às ${new Date(save.at).toLocaleTimeString('pt-BR', { timeStyle: 'short' })}` : 'Salvo')}
          {save.kind === 'error' && `Falha ao salvar: ${save.message}`}
        </span>
        <span style={{ flex: 1 }} />
        {save.kind === 'error' && (
          <button className="sf-btn small" onClick={flush}>
            Tentar de novo
          </button>
        )}
        <button className="sf-btn small danger" onClick={remove}>
          Excluir
        </button>
      </div>
      <div className="sf-board-canvas">
        <Excalidraw
          initialData={initialData}
          onChange={onChange}
          theme="dark"
          langCode="pt-BR"
          name={board.name}
          UIOptions={{ canvasActions: { saveToActiveFile: false, loadScene: true, export: { saveFileToDisk: true } } }}
        />
      </div>
    </div>
  )
}

/** Cheap change detection: Excalidraw bumps element versions on every edit. */
function versionOf(elements: readonly ExcalidrawElement[], files?: BinaryFiles) {
  return `${getSceneVersion(elements)}:${Object.keys(files ?? {}).length}`
}
