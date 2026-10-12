// Turns the native flow script into the ordered list of everything that runs
// in a given installation, following Magento's own rules:
//  - plugins: Interceptor chain (PluginList::_inheritPlugins + Interceptor::___callPlugins):
//    sorted by sortOrder (none = first), befores → around (nests the rest) → original → afters
//  - observers: config merge order = global scope then area scope, modules in app/etc/config.php order;
//    a later declaration with the same name overrides (or disables) the earlier one
//  - preferences: the replacing class runs instead of the native one

import type { InstallMap, MapItem, Origin } from '../map/useMap'
import type { Area, FlowNode, FlowStep } from './scenario'

export type FrameKind =
  | 'request'
  | 'call'
  | 'preference'
  | 'plugin-before'
  | 'plugin-around'
  | 'plugin-around-end'
  | 'plugin-after'
  | 'original'
  | 'event'
  | 'observer'
  | 'note'

export interface Frame {
  /** Execution order within the step, 1-based */
  n: number
  depth: number
  kind: FrameKind
  label: string
  detail?: string
  itemId?: string
  origin: Origin
  warn?: string
}

export interface StepTrace {
  step: FlowStep
  frames: Frame[]
  counts: { custom: number; thirdparty: number; native: number }
  /** Same-zone entry points whose order can't be derived statically */
  extras: MapItem[]
}

const norm = (cls: string) => cls.replace(/^\\/, '')
const short = (cls: string) => norm(cls).split('\\').slice(-2).join('\\')
/** Vendor + last two segments: Vendor\…\Model\Sequence */
const vendorShort = (cls: string) => {
  const parts = norm(cls).split('\\')
  return parts.length > 3 ? `${parts[0]}\\…\\${parts.slice(-2).join('\\')}` : parts.join('\\')
}

interface MergedPlugin {
  name: string
  type?: string
  sortOrder?: number
  disabled: boolean
  methods: string[]
  aroundWithoutProceed: string[]
  item: MapItem // declaration that provided the active type
  disabledBy?: MapItem
  declIndex: number
}

interface Context {
  map: InstallMap
  area: Area
  moduleIndex: Map<string, number>
  plugins: Map<string, MapItem[]>
  observers: Map<string, MapItem[]>
  preferences: Map<string, MapItem[]>
  rest: Map<string, MapItem>
  frames: Frame[]
  seenItems: Set<string>
}

function scopes(area: Area) {
  return area === 'global' ? ['global'] : ['global', area]
}

function byDeclarationOrder(ctx: Context) {
  const scopeRank = (a: string) => (a === 'global' ? 0 : 1)
  return (a: MapItem, b: MapItem) =>
    scopeRank(String(a.details.area)) - scopeRank(String(b.details.area)) ||
    (ctx.moduleIndex.get(a.module) ?? 9999) - (ctx.moduleIndex.get(b.module) ?? 9999) ||
    a.line - b.line
}

function push(ctx: Context, f: Omit<Frame, 'n'>) {
  ctx.frames.push({ ...f, n: ctx.frames.length + 1 })
  if (f.itemId) ctx.seenItems.add(f.itemId)
}

// ---- plugins ---------------------------------------------------------------------

function mergedPlugins(ctx: Context, types: string[]): MergedPlugin[] {
  const decls = types
    .flatMap((t) => ctx.plugins.get(norm(t)) ?? [])
    .filter((p) => scopes(ctx.area).includes(String(p.details.area)))
    .sort(byDeclarationOrder(ctx))
  const merged = new Map<string, MergedPlugin>()
  decls.forEach((d, declIndex) => {
    const name = String(d.details.name)
    const prev = merged.get(name)
    const det = d.details as { type?: string; sortOrder?: number; disabled?: boolean; methods?: string[]; aroundWithoutProceed?: string[] }
    const next: MergedPlugin = prev
      ? { ...prev }
      : { name, disabled: false, methods: [], aroundWithoutProceed: [], item: d, declIndex }
    if (det.type) {
      next.type = det.type
      next.item = d
      next.methods = det.methods ?? []
      next.aroundWithoutProceed = det.aroundWithoutProceed ?? []
    }
    if (det.sortOrder !== undefined) next.sortOrder = det.sortOrder
    if (det.disabled) {
      next.disabled = true
      next.disabledBy = d
    }
    merged.set(name, next)
  })
  return [...merged.values()]
}

function emitCall(ctx: Context, node: Extract<FlowNode, { kind: 'call' }>, depth: number) {
  let types = node.types.map(norm)
  const method = node.method

  push(ctx, { depth, kind: 'call', label: `${short(types[0])}::${method}()`, detail: node.note, origin: 'native' })

  // Preferences: the replacing class runs, and plugins declared on it apply too
  for (const t of [...types]) {
    const prefs = (ctx.preferences.get(t) ?? []).filter((p) => scopes(ctx.area).includes(String(p.details.area))).sort(byDeclarationOrder(ctx))
    const active = prefs[prefs.length - 1]
    if (active) {
      push(ctx, {
        depth: depth + 1,
        kind: 'preference',
        label: `${vendorShort(t)} substituída por ${vendorShort(String(active.details.type))}`,
        detail: prefs.length > 1 ? `${prefs.length} preferences para a mesma classe; vale a do último módulo carregado (${active.module})` : undefined,
        itemId: active.id,
        origin: active.origin,
      })
      types = [...types, norm(String(active.details.type))]
    }
  }

  const all = mergedPlugins(ctx, types)
  const lc = method.toLowerCase()
  const intercepts = (p: MergedPlugin, kind: string) => p.methods.some((m) => m.toLowerCase() === `${kind}:${lc}`)

  for (const p of all.filter((p) => p.disabled && p.disabledBy && p.disabledBy.origin !== 'native')) {
    if (['before', 'around', 'after'].some((k) => intercepts(p, k))) {
      push(ctx, { depth: depth + 1, kind: 'note', label: `plugin "${p.name}" desativado`, detail: `por ${p.disabledBy!.module}`, itemId: p.disabledBy!.id, origin: p.disabledBy!.origin })
    }
  }

  const active = all
    .filter((p) => !p.disabled && ['before', 'around', 'after'].some((k) => intercepts(p, k)))
    .sort((a, b) => (a.sortOrder ?? -Infinity) - (b.sortOrder ?? -Infinity) || a.declIndex - b.declIndex)

  // Ties on sortOrder: PHP 7.x uasort is not stable, so the real order is not guaranteed
  const tie = (p: MergedPlugin) =>
    active.some((o) => o !== p && (o.sortOrder ?? null) === (p.sortOrder ?? null) && (o.item.origin !== 'native' || p.item.origin !== 'native'))

  // PluginList::_inheritPlugins: before/after stay on the current level, an around opens a new one
  interface Level { before: MergedPlugin[]; around?: MergedPlugin; after: MergedPlugin[] }
  const levels = new Map<string, Level>()
  const level = (key: string) => levels.get(key) ?? (levels.set(key, { before: [], after: [] }), levels.get(key)!)
  let current = '__self'
  for (const p of active) {
    const l = level(current)
    if (intercepts(p, 'around')) l.around = p
    if (intercepts(p, 'before')) l.before.push(p)
    if (intercepts(p, 'after')) l.after.push(p)
    if (intercepts(p, 'around')) current = p.name
  }

  const pluginFrame = (p: MergedPlugin, kind: FrameKind, d: number, label: string, warn?: string) =>
    push(ctx, {
      depth: d,
      kind,
      label,
      detail: `${short(p.type ?? '')} · ${p.item.module}${p.sortOrder !== undefined ? ` · sortOrder ${p.sortOrder}` : ' · sem sortOrder'}`,
      itemId: p.item.id,
      origin: p.item.origin,
      warn: warn ?? (tie(p) ? 'empate de sortOrder com outro plugin: no PHP 7.x a ordem entre eles não é garantida' : undefined),
    })

  const run = (key: string, d: number) => {
    const l = level(key)
    for (const p of l.before) pluginFrame(p, 'plugin-before', d, `before${cap(method)} · ${p.name}`)
    if (l.around) {
      const p = l.around
      const cuts = p.aroundWithoutProceed.some((m) => m.toLowerCase() === lc)
      pluginFrame(p, 'plugin-around', d, `around${cap(method)} · ${p.name}`, cuts ? 'não chama $proceed: o método original e os plugins internos NÃO executam' : undefined)
      if (!cuts) {
        run(p.name, d + 1)
        pluginFrame(p, 'plugin-around-end', d, `around${cap(method)} · ${p.name} (depois do $proceed)`)
      }
    } else {
      const replaced = types.length > node.types.length
      const runs = replaced ? types[types.length - 1] : (types.find((t) => !/Interface$/.test(t)) ?? types[0])
      push(ctx, { depth: d, kind: 'original', label: `${vendorShort(runs)}::${method}() executa`, origin: replaced ? 'custom' : 'native' })
      for (const child of node.children ?? []) emit(ctx, child, d + 1)
    }
    for (const p of l.after) pluginFrame(p, 'plugin-after', d, `after${cap(method)} · ${p.name}`)
  }
  run('__self', depth + 1)
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

// ---- observers -------------------------------------------------------------------

function emitEvent(ctx: Context, node: Extract<FlowNode, { kind: 'event' }>, depth: number) {
  const decls = (ctx.observers.get(node.name) ?? []).filter((o) => scopes(ctx.area).includes(String(o.details.area))).sort(byDeclarationOrder(ctx))

  // Config merge: first declaration fixes the position, later ones override instance/disabled
  const merged = new Map<string, { item: MapItem; disabledBy?: MapItem }>()
  for (const d of decls) {
    const name = String(d.details.name)
    const prev = merged.get(name)
    if (!prev) merged.set(name, { item: d, disabledBy: d.details.disabled ? d : undefined })
    else merged.set(name, { item: d.details.instance ? d : prev.item, disabledBy: d.details.disabled ? d : prev.disabledBy })
  }
  const list = [...merged.values()]
  const running = list.filter((o) => !o.disabledBy)

  push(ctx, {
    depth,
    kind: 'event',
    label: `dispatch('${node.name}')`,
    detail: [node.note, running.length ? `${running.length} observer(s)` : 'nenhum observer'].filter(Boolean).join(' · '),
    origin: 'native',
  })
  for (const o of list) {
    if (o.disabledBy) {
      if (o.disabledBy.origin !== 'native') {
        push(ctx, { depth: depth + 1, kind: 'note', label: `observer "${o.item.details.name}" desativado`, detail: `por ${o.disabledBy.module}`, itemId: o.disabledBy.id, origin: o.disabledBy.origin })
      }
      continue
    }
    push(ctx, {
      depth: depth + 1,
      kind: 'observer',
      label: String(o.item.details.name),
      detail: `em ${node.name} → ${short(String(o.item.details.instance ?? ''))} · ${o.item.module}${o.item.details.area !== 'global' ? ` · ${o.item.details.area}` : ''}`,
      itemId: o.item.id,
      origin: o.item.origin,
    })
  }
}

// ---- dispatch --------------------------------------------------------------------

function emit(ctx: Context, node: FlowNode, depth: number) {
  switch (node.kind) {
    case 'call':
      return emitCall(ctx, node, depth)
    case 'event':
      return emitEvent(ctx, node, depth)
    case 'note':
      return push(ctx, { depth, kind: 'note', label: node.text, origin: 'native' })
    case 'rest': {
      const route = ctx.rest.get(node.route)
      const overrides = route?.details.overridesNative as string | undefined
      const service = route?.details.serviceClass ? norm(String(route.details.serviceClass)) : node.types[0]
      const method = route?.details.serviceMethod ? String(route.details.serviceMethod) : node.method
      if (route && route.origin !== 'native') {
        push(ctx, {
          depth,
          kind: 'preference',
          label: `rota ${route.title} declarada por ${route.module}`,
          detail: overrides ? `sobrescreve a rota nativa (${short(overrides)})` : undefined,
          itemId: route.id,
          origin: route.origin,
          warn: route.details.acl && (route.details.acl as string[]).includes('anonymous') ? 'ACL anonymous' : undefined,
        })
      }
      // Overridden routes run a different service: the native children no longer apply
      const sameService = service === norm(node.types[0])
      const types = sameService ? node.types : [service]
      return emitCall(ctx, { kind: 'call', types, method, children: sameService ? node.children : [], note: route ? `ACL: ${(route.details.acl as string[] | undefined)?.join(', ') ?? '—'}` : undefined }, depth)
    }
  }
}

export function buildTrace(map: InstallMap, steps: FlowStep[]): StepTrace[] {
  const disabledModules = new Set(map.project.disabledModules ?? [])
  const enabled = map.items.filter((i) => !disabledModules.has(i.module))
  const group = (kind: string, key: (i: MapItem) => string) => {
    const m = new Map<string, MapItem[]>()
    for (const i of enabled.filter((i) => i.kind === kind)) {
      const k = norm(key(i))
      m.set(k, [...(m.get(k) ?? []), i])
    }
    return m
  }
  const moduleOrder = map.project.moduleOrder ?? []
  const base = {
    map,
    moduleIndex: new Map(moduleOrder.map((m, i) => [m, i])),
    plugins: group('plugin', (i) => String(i.details.target)),
    observers: group('observer', (i) => String(i.details.event)),
    preferences: group('preference', (i) => String(i.details.for)),
    rest: new Map(enabled.filter((i) => i.kind === 'rest').map((i) => [i.id, i])),
  }

  const usedZones = new Set<string>()
  const traces = steps.map((step) => {
    const ctx: Context = { ...base, area: step.area, frames: [], seenItems: new Set() }
    push(ctx, { depth: 0, kind: 'request', label: step.request, detail: `área ${step.area}`, origin: 'native' })
    for (const node of step.nodes) emit(ctx, node, 1)
    const counts = { custom: 0, thirdparty: 0, native: 0 }
    for (const f of ctx.frames) if (f.itemId) counts[f.origin]++
    return { step, frames: ctx.frames, counts, seenItems: ctx.seenItems }
  })

  const allSeen = new Set(traces.flatMap((t) => [...t.seenItems]))
  return traces.map(({ step, frames, counts }) => {
    let extras: MapItem[] = []
    if (step.zoneExtras && !usedZones.has(step.zone)) {
      usedZones.add(step.zone)
      extras = enabled.filter(
        (i) => i.zone === step.zone && i.origin !== 'native' && !allSeen.has(i.id) && ['cron', 'rest', 'route', 'queue', 'graphql'].includes(i.kind),
      )
    }
    return { step, frames, counts, extras }
  })
}
