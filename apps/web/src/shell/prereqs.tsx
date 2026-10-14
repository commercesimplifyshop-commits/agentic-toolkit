import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from './api'

/** Mirrors apps/api/src/settings/workspace-settings.service.ts */
export type SettingsSection = 'origem' | 'projeto' | 'repositorio' | 'variaveis' | 'ia'
export type PrerequisiteId = 'analysis' | 'git' | 'git-remote' | 'claude-code' | 'ai'
export interface Prerequisite {
  id: PrerequisiteId
  label: string
  ok: boolean
  detail: string
  fix: { section: SettingsSection; label: string }
}

/** Link to one section of Configurações */
export const settingsLink = (workspaceId: string, section: SettingsSection) => `/w/${workspaceId}/settings?secao=${section}`

/** Sent after settings are saved, so every open notice checks again */
export const SETTINGS_CHANGED = 'agentic-toolkit:settings-changed'
export const notifySettingsChanged = () => window.dispatchEvent(new Event(SETTINGS_CHANGED))

interface Need {
  id: PrerequisiteId
  /** What stops working without it */
  why: string
  /** The feature still opens without it; only part of it is unavailable */
  partial?: boolean
}

/**
 * What each feature needs from the workspace, by the route segment under /w/:id. Analysis is not
 * listed: without it the workspace opens the setup instead of the features.
 */
export const FEATURE_NEEDS: Record<string, { name: string; needs: Need[] }> = {
  git: {
    name: 'Git',
    needs: [
      { id: 'git', why: 'O Git mostra e gerencia o repositório do projeto.' },
      { id: 'git-remote', why: 'Sem remoto não há fetch, atualização da branch base nem push.', partial: true },
    ],
  },
  refinamento: {
    name: 'Refinamento',
    needs: [
      { id: 'claude-code', why: 'O refinamento e o desenvolvimento das tarefas são feitos pelo Claude Code.' },
      { id: 'git', why: '"Preparar git" e "Iniciar desenvolvimento" precisam do repositório; o refinamento funciona sem ele.', partial: true },
      { id: 'git-remote', why: 'Sem remoto, a branch base não pode ser atualizada antes de criar a branch da tarefa.', partial: true },
    ],
  },
  openspec: {
    name: 'OpenSpec',
    needs: [{ id: 'claude-code', why: 'Refinar e propor mudanças com o Claude usa o Claude Code; ler as specs funciona sem ele.', partial: true }],
  },
  ask: { name: 'Pergunte ao código', needs: [{ id: 'ai', why: 'As respostas vêm do provedor de IA configurado.' }] },
  diagrams: { name: 'Diagramas', needs: [{ id: 'claude-code', why: '"Criar com o Claude" usa o Claude Code; desenhar à mão funciona sem ele.', partial: true }] },
  docs: { name: 'Documentação', needs: [{ id: 'claude-code', why: 'A documentação é escrita pelo Claude Code.' }] },
}

/** The workspace's prerequisites, checked again when settings change or the window gets focus */
export function usePrerequisites(workspaceId: string) {
  const [list, setList] = useState<Prerequisite[] | null>(null)
  const load = useCallback(() => {
    if (!workspaceId) return
    api
      .get<Prerequisite[]>(`/workspaces/${workspaceId}/prerequisites`)
      .then(setList)
      .catch(() => setList(null))
  }, [workspaceId])
  useEffect(() => {
    setList(null)
    load()
    window.addEventListener(SETTINGS_CHANGED, load)
    window.addEventListener('focus', load)
    return () => {
      window.removeEventListener(SETTINGS_CHANGED, load)
      window.removeEventListener('focus', load)
    }
  }, [load])
  return { list, reload: load, get: (id: PrerequisiteId) => list?.find((p) => p.id === id) }
}

/** What is missing for the feature open now, each with a link to where it is configured */
export function PrereqNotice({ workspaceId, feature }: { workspaceId: string; feature: string }) {
  const { list, reload } = usePrerequisites(workspaceId)
  const spec = FEATURE_NEEDS[feature]
  if (!spec || !list) return null
  const missing = spec.needs.map((n) => ({ need: n, p: list.find((p) => p.id === n.id) })).filter((m) => m.p && !m.p.ok)
  // a remote is only worth mentioning once there is a repository
  const shown = missing.filter((m) => !(m.need.id === 'git-remote' && missing.some((x) => x.need.id === 'git')))
  if (!shown.length) return null
  const blocking = shown.some((m) => !m.need.partial)
  return (
    <div className={`sf-callout ${blocking ? 'orange' : ''} sf-prereq`} role="status">
      <div className="sf-row" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <strong>{blocking ? `${spec.name} precisa de configuração` : `Parte de ${spec.name} está indisponível`}</strong>
        <button className="sf-link" onClick={reload}>
          Verificar de novo
        </button>
      </div>
      {shown.map(({ need, p }) => (
        <div key={need.id} className="sf-prereq-item">
          <div>
            <strong>{p!.label}:</strong> {need.why}
            <div className="sf-faint" style={{ fontSize: 12 }}>
              {p!.detail}
            </div>
          </div>
          <Link className="sf-btn small" to={settingsLink(workspaceId, p!.fix.section)}>
            {p!.fix.label} →
          </Link>
        </div>
      ))}
    </div>
  )
}

/** Inline version for a single prerequisite inside a page (a disabled action, an empty state) */
export function PrereqLink({ workspaceId, section, children }: { workspaceId: string; section: SettingsSection; children?: string }) {
  return (
    <Link className="sf-btn small" to={settingsLink(workspaceId, section)}>
      {children ?? 'Abrir configurações'} →
    </Link>
  )
}
