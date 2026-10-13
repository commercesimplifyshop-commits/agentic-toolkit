// ---- model (mirrors apps/api/src/openspec) and labels shared by the OpenSpec views ----------

export type ChangeStatus = 'planejamento' | 'em-andamento' | 'revisao' | 'impedida' | 'pronta' | 'arquivada'
export type SpecStatus = 'estavel' | 'em-alteracao' | 'rascunho' | 'aprovada' | 'obsoleta'
export type Validation = { valid: boolean; issues: { level: string; message: string }[] } | null

export interface Overview {
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
    /** Every file under the change folder, relative to it (proposal.md, tasks.md, specs/<cap>/spec.md, ...) */
    files: string[]
    /** Whether each step of the change has its artifact: the four stages shown on the cards */
    stages: { proposal: boolean; design: boolean; tasks: boolean }
    /** The change says it has no spec deltas on purpose */
    skipSpecs: boolean
    validation: Validation
  }[]
  archived: { id: string; title: string }[]
}

export interface ChangeDetail {
  id: string
  /** Folder of the change, relative to the installation root */
  dir: string
  /** Files of the change folder, relative to it */
  files: string[]
  proposal: string
  tasks: { raw: string; total: number; done: number; groups: { title: string; tasks: { id: string; text: string; done: boolean }[] }[] }
  deltas: { capability: string; content: string }[]
}

export interface SpecDetail {
  id: string
  content: string
  parsed: { purpose: string; requirements: { name: string; scenarios: { name: string }[] }[] }
}

export const CHANGE_LABEL: Record<ChangeStatus, string> = {
  planejamento: 'Propor',
  'em-andamento': 'Em andamento',
  revisao: 'Em revisão',
  impedida: 'Impedida',
  pronta: 'Pronta p/ arquivar',
  arquivada: 'Arquivada',
}
export const CHANGE_TONE: Record<ChangeStatus, string> = {
  planejamento: 'blue',
  'em-andamento': 'orange',
  revisao: 'purple',
  impedida: 'red',
  pronta: 'green',
  arquivada: '',
}
export const SPEC_LABEL: Record<SpecStatus, string> = {
  estavel: 'Estável',
  'em-alteracao': 'Em alteração',
  rascunho: 'Rascunho',
  aprovada: 'Aprovada',
  obsoleta: 'Obsoleta',
}
export const SPEC_TONE: Record<SpecStatus, string> = { estavel: 'green', 'em-alteracao': 'orange', rascunho: 'blue', aprovada: 'green', obsoleta: 'red' }

/** Columns of the board: the ones with a manual drop target come first in the rules below. */
export const COLUMNS: ChangeStatus[] = ['planejamento', 'em-andamento', 'revisao', 'impedida', 'pronta', 'arquivada']
export const MANUAL_COLUMNS: ChangeStatus[] = ['revisao', 'impedida']
