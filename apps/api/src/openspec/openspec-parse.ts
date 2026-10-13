/**
 * Reads OpenSpec artifacts (specs, changes, deltas, tasks) as text. Pure functions:
 * nothing here touches the disk, so the same code serves the scanner and the tests.
 */

export interface ParsedScenario {
  name: string
}

export interface ParsedRequirement {
  name: string
  scenarios: ParsedScenario[]
}

export interface ParsedSpec {
  purpose: string
  requirements: ParsedRequirement[]
}

export interface ParsedDelta {
  added: string[]
  modified: string[]
  removed: string[]
}

export interface ParsedTask {
  id: string
  text: string
  done: boolean
}

export interface ParsedTaskGroup {
  title: string
  tasks: ParsedTask[]
}

export interface ParsedTasks {
  total: number
  done: number
  groups: ParsedTaskGroup[]
}

/** Spec file: "## Purpose" paragraph and the "### Requirement:" blocks with their "#### Scenario:" entries. */
export function parseSpec(md: string): ParsedSpec {
  const purpose = section(md, 'Purpose')
  const requirements: ParsedRequirement[] = []
  let current: ParsedRequirement | null = null
  for (const line of md.split(/\r?\n/)) {
    const req = line.match(/^###\s+Requirement:\s*(.+?)\s*$/)
    if (req) {
      current = { name: req[1], scenarios: [] }
      requirements.push(current)
      continue
    }
    const sc = line.match(/^####\s+Scenario:\s*(.+?)\s*$/)
    if (sc && current) current.scenarios.push({ name: sc[1] })
    if (/^##\s/.test(line) && !/^###/.test(line)) current = null
  }
  return { purpose, requirements }
}

/** Delta spec of a change: which requirements it adds, modifies or removes. */
export function parseDelta(md: string): ParsedDelta {
  const out: ParsedDelta = { added: [], modified: [], removed: [] }
  let kind: keyof ParsedDelta | null = null
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements/i)
    if (h) {
      kind = h[1].toLowerCase() === 'added' ? 'added' : h[1].toLowerCase() === 'modified' ? 'modified' : 'removed'
      continue
    }
    if (/^##\s/.test(line)) {
      kind = null
      continue
    }
    const req = line.match(/^###\s+Requirement:\s*(.+?)\s*$/)
    if (req && kind) out[kind].push(req[1])
  }
  return out
}

/** Tasks checklist: "- [x] 1.1 text" under "## N. group" headings. */
export function parseTasks(md: string): ParsedTasks {
  const groups: ParsedTaskGroup[] = []
  let group: ParsedTaskGroup = { title: '', tasks: [] }
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+?)\s*$/)
    if (h) {
      if (group.tasks.length || group.title) groups.push(group)
      group = { title: h[1].replace(/<!--.*?-->/g, '').trim(), tasks: [] }
      continue
    }
    const t = line.match(/^\s*-\s+\[( |x|X)\]\s+(\S+)\s+(.*?)\s*$/)
    if (t) group.tasks.push({ id: t[2], text: t[3], done: t[1].toLowerCase() === 'x' })
  }
  if (group.tasks.length || group.title) groups.push(group)
  const all = groups.flatMap((g) => g.tasks)
  return { total: all.length, done: all.filter((t) => t.done).length, groups: groups.filter((g) => g.tasks.length) }
}

/** Text of a "## Heading" section, first paragraph only (what a dashboard can show). */
export function section(md: string, heading: string): string {
  const lines = md.split(/\r?\n/)
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${heading}\\s*$`, 'i').test(l))
  if (start < 0) return ''
  const body: string[] = []
  for (const l of lines.slice(start + 1)) {
    if (/^##\s/.test(l)) break
    if (!l.trim() && body.length) break
    if (l.trim() && !l.trim().startsWith('<!--')) body.push(l.trim())
  }
  return body.join(' ')
}

/** Title of a proposal or spec: the first "# " heading, without the word "Proposal"/"Spec". */
export function titleOf(md: string, fallback: string): string {
  const h = md.match(/^#\s+(.+?)\s*$/m)?.[1]
  return h && !/^(proposal|spec delta)$/i.test(h) ? h : fallback
}
