import type { AffectedRow, Bulletin } from './bulletin-parser'

/**
 * Adobe Commerce versions come in two forms: a release line with a dated patch ("2.4.9-2026-jul"),
 * and an older form with a patch number ("2.4.1-p1"). Only dated versions can be ordered against
 * the bulletins; anything else is reported as "verificar" instead of guessed.
 */
interface Parsed {
  base: string
  /** "2026-jul" for dated releases, "p1" for patch releases, undefined for the plain release */
  suffix?: string
}

const MONTH_INDEX: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

export function parseVersion(raw: string): Parsed | null {
  const m = raw.trim().match(/^(\d+\.\d+\.\d+)(?:-(\d{4}-[a-z]{3}|p\d+))?(?:\s+and earlier)?$/i)
  if (!m) return null
  return { base: m[1], suffix: m[2]?.toLowerCase() }
}

/** Orders two dated suffixes: 2026-jul < 2026-aug. Undefined when either is not dated. */
function dateKey(suffix?: string): number | undefined {
  const m = suffix?.match(/^(\d{4})-([a-z]{3})$/)
  if (!m || !MONTH_INDEX[m[2]]) return undefined
  return Number(m[1]) * 12 + MONTH_INDEX[m[2]]
}

export type Verdict = 'affected' | 'not-affected' | 'verify'

export interface Impact {
  status: Verdict
  /** Short reason shown next to the verdict */
  note: string
  /** The first updated version of the same release line, when Adobe lists one */
  fixedIn?: string
}

/** Decides whether an installed version is in a bulletin's affected list. */
export function impactOf(installed: string, bulletin: Bulletin): Impact {
  const ip = parseVersion(installed)
  if (!ip) return { status: 'verify', note: `versão "${installed}" não reconhecida` }

  const rows = bulletin.affected.flatMap((r: AffectedRow) => r.versions.map((v) => parseVersion(v)).filter((p): p is Parsed => !!p))
  const fixedIn = bulletin.fixed.flatMap((r) => r.versions).find((raw) => parseVersion(raw)?.base === ip.base)

  if (!rows.length) return { status: 'verify', note: 'o boletim não listou versões afetadas', fixedIn }

  const sameLine = rows.filter((r) => r.base === ip.base)
  if (!sameLine.length) {
    const bases = rows.map((r) => r.base).sort(compareBase)
    if (compareBase(ip.base, bases[0]) < 0) {
      return { status: 'verify', note: `linha ${ip.base} não consta no boletim: confirme se ainda tem suporte`, fixedIn }
    }
    if (compareBase(ip.base, bases[bases.length - 1]) > 0) {
      return { status: 'not-affected', note: `linha ${ip.base} é posterior às listadas`, fixedIn }
    }
    return { status: 'verify', note: `linha ${ip.base} não listada entre as afetadas`, fixedIn }
  }

  // a plain release is earlier than every dated patch of its line
  if (!ip.suffix) return { status: 'affected', note: `versão base da linha ${ip.base}, anterior aos patches datados`, fixedIn }

  const installedKey = dateKey(ip.suffix)
  if (installedKey === undefined) {
    return { status: 'verify', note: `patch ${ip.suffix} não é comparável com os releases datados: confira manualmente`, fixedIn }
  }
  const affectedBy = sameLine.some((r) => {
    const k = dateKey(r.suffix)
    return k !== undefined && installedKey <= k
  })
  if (affectedBy) return { status: 'affected', note: `anterior ou igual ao release corrigido de ${ip.base}`, fixedIn }
  return { status: 'not-affected', note: `posterior aos releases afetados de ${ip.base}`, fixedIn }
}

function compareBase(a: string, b: string) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  }
  return 0
}
