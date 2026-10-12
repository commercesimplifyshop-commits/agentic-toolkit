/**
 * Minimal PHP reading for the API simulator: method signatures with their
 * docblock types, `use` resolution and Data-interface getters. It only needs
 * to be good enough to pre-fill a request, never to execute anything.
 */

export interface PhpParam {
  name: string
  type: string // as written, resolved to FQCN when it's a class
  optional: boolean
}

export interface PhpMethod {
  name: string
  params: PhpParam[]
  returns?: string
  summary?: string
}

const SCALARS = new Set(['string', 'int', 'integer', 'float', 'double', 'bool', 'boolean', 'array', 'mixed', 'null', 'void', 'object', 'callable', 'iterable', 'self', 'static', 'true', 'false'])

export function namespaceOf(src: string) {
  return src.match(/^\s*namespace\s+([\w\\]+)\s*;/m)?.[1] ?? ''
}

/** Resolves a type as written in a file (short name, alias, FQCN) to a FQCN. */
export function resolveType(type: string, src: string): string {
  const t = type.trim().replace(/^\?/, '')
  const arraySuffix = t.endsWith('[]') ? '[]' : ''
  const base = arraySuffix ? t.slice(0, -2) : t
  if (!base || SCALARS.has(base.toLowerCase())) return t.toLowerCase()
  if (base.startsWith('\\')) return base.slice(1) + arraySuffix
  const [head, ...rest] = base.split('\\')
  for (const m of src.matchAll(/^\s*use\s+([\w\\]+)(?:\s+as\s+(\w+))?\s*;/gm)) {
    const alias = m[2] ?? m[1].split('\\').pop()
    if (alias === head) return [m[1], ...rest].join('\\') + arraySuffix
  }
  const ns = namespaceOf(src)
  return (ns ? `${ns}\\${base}` : base) + arraySuffix
}

/** First non-null member of a union like "string|null" or "\Foo[]|null". */
function pickType(raw: string) {
  return raw
    .split('|')
    .map((x) => x.trim())
    .find((x) => x && x.toLowerCase() !== 'null') ?? 'mixed'
}

function docblockBefore(src: string, index: number) {
  const before = src.slice(0, index)
  const end = before.lastIndexOf('*/')
  if (end < 0 || before.slice(end + 2).trim().replace(/^(public|abstract|final|static|\s)+$/, '') !== '') return ''
  const start = before.lastIndexOf('/**', end)
  return start >= 0 ? before.slice(start, end + 2) : ''
}

export function findMethod(src: string, name: string): PhpMethod | null {
  const re = new RegExp(`function\\s+${name}\\s*\\(`, 'i')
  const m = re.exec(src)
  if (!m) return null
  // balanced parentheses for the parameter list
  let i = m.index + m[0].length
  let depth = 1
  const start = i
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === '(') depth++
    if (src[i] === ')') depth--
  }
  const paramList = src.slice(start, i - 1)
  const lineStart = src.lastIndexOf('\n', m.index) + 1
  const doc = docblockBefore(src, lineStart)
  const docTypes = new Map<string, string>()
  for (const d of doc.matchAll(/@param\s+([^\s$]+)\s+\$(\w+)/g)) docTypes.set(d[2], pickType(d[1]))
  const returns = doc.match(/@return\s+([^\s*]+)/)?.[1]
  const summary = doc
    .split('\n')
    .map((l) => l.replace(/^\s*\/?\*+\/?\s?/, '').trim())
    .find((l) => l && !l.startsWith('@'))

  const params: PhpParam[] = []
  for (const p of splitParams(paramList)) {
    const pm = p.match(/^(?:(?:public|private|protected|readonly)\s+)*([?\w\\|[\]]+\s+)?&?(?:\.\.\.)?\$(\w+)(\s*=.*)?$/s)
    if (!pm) continue
    const hinted = pm[1]?.trim()
    const raw = docTypes.get(pm[2]) ?? (hinted ? pickType(hinted) : 'mixed')
    params.push({ name: pm[2], type: resolveType(raw, src), optional: Boolean(pm[3]) || Boolean(hinted?.startsWith('?')) })
  }
  return { name, params, returns: returns ? resolveType(pickType(returns), src) : undefined, summary }
}

function splitParams(list: string) {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth++
    if (ch === ')' || ch === ']') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** Getters of a Data interface → webapi field names, like Magento's FieldNamer. */
export function dataGetters(src: string): { field: string; type: string }[] {
  const out: { field: string; type: string }[] = []
  for (const m of src.matchAll(/public\s+function\s+((?:get|is|has)\w*)\s*\(\s*\)/g)) {
    const method = m[1]
    if (method === 'getExtensionAttributes' || method === 'getCustomAttributes' || method === 'getCustomAttribute') continue
    const doc = docblockBefore(src, src.lastIndexOf('\n', m.index) + 1)
    const ret = doc.match(/@return\s+([^\s*]+)/)?.[1] ?? src.slice(m.index).match(/\)\s*:\s*\??([\w\\[\]]+)/)?.[1] ?? 'string'
    out.push({ field: fieldName(method), type: resolveType(pickType(ret), src) })
  }
  return out
}

function snake(s: string) {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
}

/** Same as Magento's FieldNamer: getFirstname → firstname, getIsActive → is_active, isDefaultShipping → default_shipping */
export function fieldName(method: string) {
  for (const prefix of ['get', 'has', 'is']) if (method.startsWith(prefix) && /[A-Z]/.test(method[prefix.length] ?? '')) return snake(method.slice(prefix.length))
  return snake(method)
}
