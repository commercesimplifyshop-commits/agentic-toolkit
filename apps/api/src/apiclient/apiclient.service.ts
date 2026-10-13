import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { MapStore } from '../analysis/map-store.service'
import { techDirs } from '../config/paths'
import { AuditService } from '../readonly/audit.service'
import { assertWritableTarget } from '../readonly/path-guard'
import { ReadOnlyFs } from '../readonly/readonly-fs.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { dataGetters, findMethod, type PhpParam } from './php-signature'

export type AuthSuggestion = 'none' | 'customer' | 'admin'

export interface RequestTemplate {
  routeId: string
  kind: 'rest' | 'graphql'
  method: string
  /** Path after /rest/<store> (REST) or /graphql */
  path: string
  pathParams: { name: string; type: string }[]
  query: { key: string; value: string }[]
  body: unknown
  auth: AuthSuggestion
  acl: string[]
  service?: string
  summary?: string
  notes: string[]
}

export interface SendInput {
  method: string
  url: string
  headers?: Record<string, string>
  body?: string
  insecure?: boolean
}

const MAX_DEPTH = 3
const MAX_RESPONSE = 5 * 1024 * 1024

@Injectable()
export class ApiClientService {
  /** PHP sources fetched from the public core, per tag+class (memory cache over the disk cache) */
  private readonly sources = new Map<string, string | null>()

  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly maps: MapStore,
    private readonly rofs: ReadOnlyFs,
    private readonly audit: AuditService,
  ) {}

  // ---- PHP source resolution --------------------------------------------------------

  /**
   * Source of a class: installation app/code, installation vendor/, the sparse
   * core reference, then the public magento/magento2 tag on GitHub (cached in the data dir).
   */
  private async classSource(id: string, fqcn: string): Promise<string | null> {
    const ws = this.workspaces.get(id)
    const root = this.workspaces.rootOf(id)
    const parts = fqcn.split('\\')
    const tryRead = (base: string, rel: string) => {
      try {
        return this.rofs.read(base, rel).content
      } catch {
        return null
      }
    }

    const local = tryRead(root, `app/code/${parts.join('/')}.php`)
    if (local) return local

    if (parts[0] !== 'Magento') return null
    const isFramework = parts[1] === 'Framework'
    const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
    const vendorRel = isFramework ? `vendor/magento/framework/${parts.slice(2).join('/')}.php` : `vendor/magento/module-${kebab(parts[1])}/${parts.slice(2).join('/')}.php`
    const fromVendor = tryRead(root, vendorRel)
    if (fromVendor) return fromVendor

    const tag = ws.version?.match(/^\d+\.\d+\.\d+(-p\d+)?/)?.[0]
    if (!tag) return null
    const repoRel = isFramework ? `lib/internal/${parts.join('/')}.php` : `app/code/${parts.join('/')}.php`
    const refDir = path.join(techDirs('adobe-commerce').reference, `magento2-${tag}`)
    if (fs.existsSync(path.join(refDir, repoRel))) return tryRead(refDir, repoRel)

    const key = `${tag}:${repoRel}`
    if (this.sources.has(key)) return this.sources.get(key) ?? null
    const cacheFile = path.join(techDirs('adobe-commerce').cache, 'core-src', tag, repoRel)
    assertWritableTarget(cacheFile, [root])
    if (fs.existsSync(cacheFile)) {
      const src = fs.readFileSync(cacheFile, 'utf8')
      this.sources.set(key, src)
      return src
    }
    try {
      const res = await fetch(`https://raw.githubusercontent.com/magento/magento2/${tag}/${repoRel}`, { signal: AbortSignal.timeout(8000) })
      const src = res.ok ? await res.text() : null
      if (src) {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
        fs.writeFileSync(cacheFile, src)
      }
      this.sources.set(key, src)
      return src
    } catch {
      return null
    }
  }

  /** Example JSON value for a PHP type, expanding Data interfaces through their getters. */
  private async example(id: string, type: string, depth: number, seen: Set<string>): Promise<unknown> {
    const t = type.replace(/^\\/, '')
    if (t.endsWith('[]')) {
      const item = await this.example(id, t.slice(0, -2), depth, seen)
      return item === undefined ? [] : [item]
    }
    switch (t.toLowerCase()) {
      case 'string':
        return ''
      case 'int':
      case 'integer':
        return 0
      case 'float':
      case 'double':
        return 0
      case 'bool':
      case 'boolean':
        return false
      case 'array':
        return []
      case 'mixed':
      case 'object':
        return null
    }
    if (depth >= MAX_DEPTH || seen.has(t)) return {}
    const src = await this.classSource(id, t)
    if (!src) return {}
    const getters = dataGetters(src)
    if (!getters.length) return {}
    const next = new Set(seen).add(t)
    const obj: Record<string, unknown> = {}
    for (const g of getters) obj[g.field] = await this.example(id, g.type, depth + 1, next)
    return obj
  }

  // ---- request template -----------------------------------------------------------------

  async template(id: string, routeId: string): Promise<RequestTemplate> {
    const map = this.maps.readMap(id) as { items: { id: string; kind: string; title: string; details: Record<string, unknown> }[] } | null
    const item = map?.items.find((i) => i.id === routeId)
    if (!item) throw new NotFoundException('Rota não encontrada no mapa')
    const d = item.details
    const notes: string[] = []

    if (item.kind === 'graphql') {
      const op = String(d.operation)
      return {
        routeId,
        kind: 'graphql',
        method: 'POST',
        path: '/graphql',
        pathParams: [],
        query: [],
        body: {
          query: `${op} {\n  ${d.name} {\n    # escolha os campos de retorno\n    __typename\n  }\n}`,
          variables: {},
        },
        auth: 'none',
        acl: [],
        service: d.resolver as string | undefined,
        summary: d.description as string | undefined,
        notes: ['Preencha os argumentos e os campos de retorno conforme o schema.graphqls do módulo.', 'Para operações do cliente logado, use Autorização → Cliente.'],
      }
    }

    const method = String(d.method).toUpperCase()
    const url = String(d.url)
    const acl = (d.acl as string[] | undefined) ?? []
    const pathNames = [...url.matchAll(/:(\w+)/g)].map((m) => m[1])
    const auth: AuthSuggestion = acl.includes('anonymous') ? 'none' : acl.includes('self') ? 'customer' : 'admin'

    let params: PhpParam[] = []
    let summary: string | undefined
    const service = d.serviceClass ? String(d.serviceClass).replace(/^\\/, '') : undefined
    if (service) {
      const src = await this.classSource(id, service)
      const sig = src ? findMethod(src, String(d.serviceMethod)) : null
      if (sig) {
        params = sig.params
        summary = sig.summary
      } else notes.push(`Não foi possível ler ${service}::${d.serviceMethod}; o body ficou vazio.`)
    }

    const pathParams = pathNames.map((name) => ({ name, type: params.find((p) => p.name === name)?.type ?? 'string' }))
    // Parameters webapi.xml forces from the session/token (e.g. cartId on /mine) are not sent by the client
    const forced = (d.forcedParams as string[] | undefined) ?? []
    const rest = params.filter((p) => !pathNames.includes(p.name) && !forced.includes(p.name))
    if (forced.length) notes.push(`Preenchido pelo Magento a partir do token: ${forced.join(', ')}.`)
    const query: RequestTemplate['query'] = []
    let body: unknown = undefined

    if (method === 'GET' || method === 'DELETE') {
      for (const p of rest) {
        if (/SearchCriteria(Interface)?$/.test(p.type)) {
          query.push({ key: 'searchCriteria[pageSize]', value: '20' }, { key: 'searchCriteria[currentPage]', value: '1' })
          query.push({ key: 'searchCriteria[filterGroups][0][filters][0][field]', value: '' }, { key: 'searchCriteria[filterGroups][0][filters][0][value]', value: '' })
        } else query.push({ key: p.name, value: '' })
      }
    } else {
      const obj: Record<string, unknown> = {}
      for (const p of rest) obj[p.name] = await this.example(id, p.type, 0, new Set())
      body = obj
    }

    if (url.includes('/mine')) notes.push('Rota "mine": usa o cliente do token (Autorização → Cliente).')
    if (d.overridesNative) notes.push(`Esta rota nativa foi sobrescrita por ${d.overridesNative}.`)
    if (auth === 'admin') notes.push(`ACL: ${acl.join(', ')}. Use um token de admin ou de integração com esse recurso.`)

    return { routeId, kind: 'rest', method, path: url, pathParams, query, body, auth, acl, service: service ? `${service}::${d.serviceMethod}` : undefined, summary, notes }
  }

  // ---- send (HTTP proxy) ---------------------------------------------------------------------

  send(input: SendInput): Promise<{ status: number; statusText: string; headers: Record<string, string>; body: string; truncated: boolean; size: number; timeMs: number }> {
    const target = new URL(input.url)
    const lib = target.protocol === 'https:' ? https : http
    const started = Date.now()
    // Audit the target, never headers or body (they may carry tokens or passwords)
    this.audit.record({ action: 'apiclient.send', kind: 'external', method: input.method, url: `${target.origin}${target.pathname}`, verdict: 'allowed', detail: 'requisição do simulador de API' })

    return new Promise((resolve, reject) => {
      const req = lib.request(
        target,
        {
          method: input.method,
          headers: { 'User-Agent': 'Agentic-Toolkit-API-Simulator', ...input.headers },
          timeout: 60_000,
          ...(target.protocol === 'https:' && input.insecure ? { agent: new https.Agent({ rejectUnauthorized: false }) } : {}),
        },
        (res) => {
          const chunks: Buffer[] = []
          let size = 0
          let truncated = false
          res.on('data', (c: Buffer) => {
            size += c.length
            if (size <= MAX_RESPONSE) chunks.push(c)
            else truncated = true
          })
          res.on('end', () => {
            const headers: Record<string, string> = {}
            for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(', ') : v
            resolve({ status: res.statusCode ?? 0, statusText: res.statusMessage ?? '', headers, body: Buffer.concat(chunks).toString('utf8'), truncated, size, timeMs: Date.now() - started })
          })
        },
      )
      req.on('timeout', () => req.destroy(new Error('Tempo esgotado (60 s) esperando a resposta')))
      req.on('error', (err: NodeJS.ErrnoException) => {
        const why =
          err.code === 'ECONNREFUSED'
            ? `Conexão recusada em ${target.host}: o ambiente está de pé?`
            : err.code === 'ENOTFOUND'
              ? `Host ${target.hostname} não encontrado (DNS/hosts).`
              : /certificate|self.signed|UNABLE_TO_VERIFY/i.test(err.message)
                ? 'Certificado HTTPS inválido. Para ambiente local, marque "Ignorar certificado".'
                : err.message
        reject(new BadRequestException(why))
      })
      if (input.body !== undefined && !['GET', 'HEAD'].includes(input.method)) req.write(input.body)
      req.end()
    })
  }
}
