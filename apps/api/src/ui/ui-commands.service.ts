import { BadRequestException, Injectable } from '@nestjs/common'
import { Subject } from 'rxjs'
import { UI_FEATURES } from './ui-catalog'

/**
 * Something the open screens do when the assistant or an AI through the MCP asks: open a page, or fill
 * the API simulator. They never send anything by themselves: sending stays with the person.
 */
export type UiCommand =
  | { type: 'navigate'; workspace: string; path: string }
  | {
      type: 'api-client-fill'
      workspace: string
      routeId: string
      request: { pathParams?: Record<string, string>; query?: Record<string, string>; headers?: Record<string, string>; body?: string; graphqlQuery?: string; graphqlVariables?: string; note?: string }
    }

const WS = /^[a-z0-9-]{3,64}$/
const PATH = /^[A-Za-z0-9\-/?=&._%:]{0,300}$/
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined)
const record = (v: unknown) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>)
      .slice(0, 40)
      .map(([k, x]) => [k.slice(0, 120), typeof x === 'string' ? x.slice(0, 2000) : JSON.stringify(x).slice(0, 2000)]),
  )
}

@Injectable()
export class UiCommandsService {
  readonly commands = new Subject<UiCommand>()

  send(raw: unknown): { ok: true; command: UiCommand } {
    const c = (raw ?? {}) as Record<string, unknown>
    const workspace = String(c.workspace ?? '')
    if (!WS.test(workspace)) throw new BadRequestException('Workspace inválido')
    let command: UiCommand
    if (c.type === 'navigate') {
      const path = String(c.path ?? '').replace(/^\/+/, '')
      if (!PATH.test(path)) throw new BadRequestException('Caminho inválido')
      const base = path.split('?')[0]
      const known = base === '' || ['settings', 'audit', 'atualizacao'].includes(base) || UI_FEATURES.some((f) => base === f.id || base.startsWith(`${f.id}/`) || (f.id === 'overview' && base === ''))
      if (!known) throw new BadRequestException(`Tela desconhecida: ${base}. Use o id de uma funcionalidade (veja guia).`)
      command = { type: 'navigate', workspace, path }
    } else if (c.type === 'api-client-fill') {
      const r = (c.request ?? {}) as Record<string, unknown>
      const body = typeof r.body === 'string' ? r.body : r.body !== undefined ? JSON.stringify(r.body, null, 2) : undefined
      const vars = typeof r.graphqlVariables === 'string' ? r.graphqlVariables : r.graphqlVariables !== undefined ? JSON.stringify(r.graphqlVariables, null, 2) : undefined
      command = {
        type: 'api-client-fill',
        workspace,
        routeId: String(c.routeId ?? '').slice(0, 300),
        request: { pathParams: record(r.pathParams), query: record(r.query), headers: record(r.headers), body: body?.slice(0, 100_000), graphqlQuery: text(r.graphqlQuery, 50_000), graphqlVariables: vars?.slice(0, 50_000), note: text(r.note, 1000) },
      }
      if (!command.routeId) throw new BadRequestException('Informe a rota do mapa')
    } else throw new BadRequestException('Comando desconhecido')
    this.commands.next(command)
    return { ok: true, command }
  }
}
