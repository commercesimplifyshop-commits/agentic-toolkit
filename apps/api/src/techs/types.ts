import type { TechId } from '../config/paths'

export interface DetectionCheck {
  id: string
  label: string
  ok: boolean
  weight: 'required' | 'strong' | 'hint'
  detail?: string
}

/** What a technology's detector reports about a folder. Same shape for every technology. */
export interface Detection {
  tech: TechId
  path: string
  /** The folder is an installation of this technology */
  match: boolean
  confidence: number
  edition?: string
  version?: string
  checks: DetectionCheck[]
  /** Subfolders that look like an installation (e.g. repo/magento2) */
  candidates: { path: string; relative: string; version?: string; edition?: string }[]
  /** Adobe Commerce only: third-party vendors found in the code */
  vendors: { name: string; modules: number }[]
}
