import { MODEL_TYPES, type ModelType } from '../diagrams/diagram-generator.service'
import type { ToolKind } from './tool-catalog'

/** One tool Claude says a change needs. Created only through LinksAssistService. */
export interface ToolPlan {
  kind: ToolKind
  /** diagram: the diagram type to draw */
  type?: ModelType
  /** diagram: what it must show, in a sentence or two */
  request?: string
  /** board: title */
  name?: string
  /** Why the change needs it, shown to the engineer */
  reason: string
}

/** Claude may suggest at most this many tools at once */
export const MAX_PLANS = 3

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Keeps only well-formed suggestions: unknown kinds and types are dropped, never created. */
export function sanitizePlans(raw: unknown): ToolPlan[] {
  if (!Array.isArray(raw)) return []
  const out: ToolPlan[] = []
  for (const item of raw.slice(0, MAX_PLANS)) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const reason = clip(o.reason, 240)
    if (o.kind === 'diagram' && MODEL_TYPES.includes(o.type as ModelType)) {
      const request = clip(o.request, 400)
      if (request.length >= 5) out.push({ kind: 'diagram', type: o.type as ModelType, request, reason })
    } else if (o.kind === 'board') {
      out.push({ kind: 'board', name: clip(o.name, 80) || 'Quadro da mudança', reason })
    }
  }
  return out
}

/** Claude answers in JSON, sometimes inside a code fence: take the outermost object */
export function parseJsonReply(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    const parsed = JSON.parse(text.slice(start, end + 1))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}
