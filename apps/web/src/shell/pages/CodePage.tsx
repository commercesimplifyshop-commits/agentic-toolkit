import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import { CodeViewer } from '../editor/CodeViewer'
import { ProjectTree } from '../ide/ProjectTree'
import { coreClassUrl, resolveClass, useIde } from '../ide/useIde'
import { useShell } from '../store'

/** Read-only code explorer: project tree with speed search, editor tabs, Darcula highlighting and PhpStorm navigation. */
export function CodePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const filePath = params.get('path') ?? ''
  const line = Number(params.get('line') ?? 0) || undefined
  const version = useShell((s) => s.workspaces.find((w) => w.id === id)?.version)
  const { open, classes, tabs, openTab, closeTab } = useIde()
  const openTabs = tabs[id] ?? []
  const [file, setFile] = useState<{ path: string; content: string; truncated: boolean } | null>(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  const go = useCallback(
    (path: string, ln?: number) => {
      openTab(id, path)
      navigate(`/w/${id}/code?path=${encodeURIComponent(path)}${ln ? `&line=${ln}` : ''}`)
    },
    [id, navigate, openTab],
  )

  useEffect(() => {
    if (!filePath) return
    setError('')
    openTab(id, filePath)
    api
      .get<{ path: string; content: string; truncated: boolean }>(`/workspaces/${id}/file?path=${encodeURIComponent(filePath)}`)
      .then(setFile)
      .catch((e: ApiError) => {
        setFile(null)
        setError(e.rule === 'read.sensitive-file' ? 'Arquivo sensível: o Agentic Toolkit não exibe o conteúdo de arquivos de credenciais.' : e.message)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, filePath])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 4000)
    return () => clearTimeout(t)
  }, [toast])

  /** Ctrl+click: jump to the class declaration (project) or to the core source on GitHub. */
  const declaration = (word: string, doc: string) => {
    const { fqcn, entry } = resolveClass(word, doc, classes)
    if (entry) return go(entry.path)
    const url = coreClassUrl(fqcn, version)
    if (url) {
      window.open(url, '_blank', 'noopener')
      return setToast(`${fqcn} é do core: abrindo no GitHub (vendor/ não faz parte da análise)`)
    }
    setToast(`Declaração de ${fqcn} não encontrada no projeto`)
  }

  return (
    <div className="sf-code">
      <div className="sf-tree-col">
        <div className="sf-ide-shortcuts">
          <button onClick={() => open({ kind: 'find' })}>
            Buscar em arquivos <kbd>Ctrl+Shift+F</kbd>
          </button>
          <button onClick={() => open({ kind: 'goto', mode: 'file' })}>
            Ir para arquivo <kbd>Alt+Shift+N</kbd>
          </button>
          <button onClick={() => open({ kind: 'goto', mode: 'class' })}>
            Ir para classe <kbd>Alt+N</kbd>
          </button>
          <button onClick={() => open({ kind: 'goto', mode: 'all' })}>
            Buscar em tudo <kbd>Shift Shift</kbd>
          </button>
          <div className="sf-tree-hint">Árvore: digite para buscar · ↑↓ navega · → entra · ← sai · Enter abre</div>
        </div>
        <ProjectTree workspaceId={id} activeFile={filePath} onOpenFile={(p) => go(p)} onError={setError} />
      </div>
      <div className="sf-editor">
        {openTabs.length > 0 && (
          <div className="sf-editor-tabs">
            {openTabs.map((p) => (
              <div key={p} className={`sf-editor-tab ${p === filePath ? 'on' : ''}`} title={p} onClick={() => go(p)} onAuxClick={(e) => e.button === 1 && closeTab(id, p)}>
                {p.split('/').pop()}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    const next = closeTab(id, p)
                    if (p === filePath) navigate(next ? `/w/${id}/code?path=${encodeURIComponent(next)}` : `/w/${id}/code`)
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {file ? (
          <>
            <div className="sf-editor-crumbs">
              <span className="sf-mono">{file.path.split('/').join(' › ')}</span>
              <span className="sf-faint" style={{ marginLeft: 'auto', fontSize: 11.5 }}>
                Ctrl+F buscar · Ctrl+G linha · Ctrl+clique declaração
              </span>
              <span className="sf-badge green">somente leitura</span>
              {file.truncated && <span className="sf-badge yellow">truncado</span>}
            </div>
            <div className="sf-editor-body">
              <CodeViewer path={file.path} content={file.content} line={line} onDeclaration={declaration} />
            </div>
          </>
        ) : (
          <div className="sf-empty" style={{ marginTop: 60 }}>
            {error || (
              <>
                Digite na árvore para buscar uma pasta ou arquivo pelo nome, ou use <kbd>Alt+Shift+N</kbd> (arquivo), <kbd>Alt+N</kbd> (classe), <kbd>Ctrl+Shift+F</kbd> (buscar em
                arquivos) ou <kbd>Shift</kbd> <kbd>Shift</kbd>.
              </>
            )}
          </div>
        )}
        {toast && <div className="sf-toast">{toast}</div>}
      </div>
    </div>
  )
}
