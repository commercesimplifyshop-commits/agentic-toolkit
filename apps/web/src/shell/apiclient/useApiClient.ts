import { create } from 'zustand'
import { api } from '../api'

export type AuthType = 'none' | 'bearer' | 'admin' | 'customer' | 'basic'

export interface Environment {
  baseUrl: string
  store: string
  insecure: boolean
}

export interface Auth {
  type: AuthType
  token: string
  username: string
  password: string
  /** When the token was generated from admin/customer credentials */
  generatedAt?: string
}

export interface KV {
  key: string
  value: string
  enabled: boolean
}

export interface RequestState {
  routeId?: string
  kind: 'rest' | 'graphql'
  method: string
  path: string
  pathParams: { name: string; value: string; type: string }[]
  query: KV[]
  headers: KV[]
  body: string
  graphqlQuery: string
  graphqlVariables: string
  notes: string[]
  acl: string[]
  service?: string
  summary?: string
}

export interface ResponseState {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  truncated: boolean
  size: number
  timeMs: number
}

export interface Template {
  routeId: string
  kind: 'rest' | 'graphql'
  method: string
  path: string
  pathParams: { name: string; type: string }[]
  query: { key: string; value: string }[]
  body: unknown
  auth: 'none' | 'customer' | 'admin'
  acl: string[]
  service?: string
  summary?: string
  notes: string[]
}

const EMPTY_REQUEST: RequestState = {
  kind: 'rest',
  method: 'GET',
  path: '/V1/',
  pathParams: [],
  query: [],
  headers: [],
  body: '',
  graphqlQuery: '',
  graphqlVariables: '{}',
  notes: [],
  acl: [],
}

const envKey = (id: string) => `agentic-toolkit.apiEnv.${id}`

/** Base URL / store are harmless conveniences kept per browser; credentials never are. */
function loadEnv(id: string): Environment {
  try {
    const raw = localStorage.getItem(envKey(id))
    if (raw) return { baseUrl: '', store: 'default', insecure: true, ...JSON.parse(raw) }
  } catch {
    // storage unavailable
  }
  return { baseUrl: '', store: 'default', insecure: true }
}

interface ApiClientState {
  workspaceId: string | null
  env: Environment
  auth: Auth
  request: RequestState
  response: ResponseState | null
  error: string
  sending: boolean
  init: (id: string) => void
  setEnv: (patch: Partial<Environment>) => void
  setAuth: (patch: Partial<Auth>) => void
  setRequest: (patch: Partial<RequestState>) => void
  applyTemplate: (t: Template) => void
  setResult: (r: ResponseState | null, error?: string) => void
  setSending: (v: boolean) => void
}

export const useApiClient = create<ApiClientState>((set, get) => ({
  workspaceId: null,
  env: { baseUrl: '', store: 'default', insecure: true },
  auth: { type: 'none', token: '', username: '', password: '' },
  request: EMPTY_REQUEST,
  response: null,
  error: '',
  sending: false,

  init: (id) => {
    if (get().workspaceId === id) return
    set({ workspaceId: id, env: loadEnv(id), request: EMPTY_REQUEST, response: null, error: '' })
  },

  setEnv: (patch) => {
    const env = { ...get().env, ...patch }
    set({ env })
    try {
      const id = get().workspaceId
      if (id) localStorage.setItem(envKey(id), JSON.stringify(env))
    } catch {
      // preference just won't persist
    }
  },

  setAuth: (patch) => set((s) => ({ auth: { ...s.auth, ...patch } })),
  setRequest: (patch) => set((s) => ({ request: { ...s.request, ...patch } })),

  applyTemplate: (t) =>
    set((s) => ({
      request: {
        routeId: t.routeId,
        kind: t.kind,
        method: t.method,
        path: t.path,
        pathParams: t.pathParams.map((p) => ({ ...p, value: '' })),
        query: t.query.map((q) => ({ ...q, enabled: true })),
        headers: s.request.headers,
        body: t.kind === 'rest' && t.body !== undefined ? JSON.stringify(t.body, null, 2) : '',
        graphqlQuery: t.kind === 'graphql' ? String((t.body as { query?: string })?.query ?? '') : '',
        graphqlVariables: '{}',
        notes: t.notes,
        acl: t.acl,
        service: t.service,
        summary: t.summary,
      },
      // Suggest the auth the route's ACL needs, keeping a token the user already has
      auth: { ...s.auth, type: s.auth.token && t.auth !== 'none' && s.auth.type !== 'none' ? s.auth.type : t.auth },
      response: null,
      error: '',
    })),

  setResult: (response, error = '') => set({ response, error, sending: false }),
  setSending: (sending) => set({ sending }),
}))

// ---- URL & request building -------------------------------------------------------

export function buildUrl(env: Environment, req: RequestState) {
  const base = env.baseUrl.replace(/\/+$/, '')
  let path = req.path
  for (const p of req.pathParams) path = path.replace(`:${p.name}`, encodeURIComponent(p.value || `:${p.name}`))
  const prefix = req.kind === 'rest' ? `/rest/${env.store || 'default'}` : ''
  const qs = req.query
    .filter((q) => q.enabled && q.key)
    .map((q) => `${encodeURIComponent(q.key).replace(/%5B/g, '[').replace(/%5D/g, ']')}=${encodeURIComponent(q.value)}`)
    .join('&')
  return `${base}${prefix}${path}${qs ? `?${qs}` : ''}`
}

export function authHeader(auth: Auth): string | null {
  if ((auth.type === 'bearer' || auth.type === 'admin' || auth.type === 'customer') && auth.token) return `Bearer ${auth.token}`
  if (auth.type === 'basic' && (auth.username || auth.password)) return `Basic ${btoa(`${auth.username}:${auth.password}`)}`
  return null
}

/** Headers actually sent: automatic ones (like Postman's hidden headers) + the user's. */
export function finalHeaders(env: Environment, req: RequestState, auth: Auth) {
  const h: Record<string, string> = { Accept: 'application/json' }
  const hasBody = req.kind === 'graphql' || (!['GET', 'HEAD', 'DELETE'].includes(req.method) && req.body.trim() !== '')
  if (hasBody) h['Content-Type'] = 'application/json'
  if (req.kind === 'graphql' && env.store) h.Store = env.store
  const a = authHeader(auth)
  if (a) h.Authorization = a
  for (const x of req.headers) if (x.enabled && x.key) h[x.key] = x.value
  return h
}

export function finalBody(req: RequestState): string | undefined {
  if (req.kind === 'graphql') {
    let variables: unknown = {}
    try {
      variables = req.graphqlVariables.trim() ? JSON.parse(req.graphqlVariables) : {}
    } catch {
      throw new Error('As variáveis GraphQL não são um JSON válido')
    }
    return JSON.stringify({ query: req.graphqlQuery, variables })
  }
  if (['GET', 'HEAD'].includes(req.method) || !req.body.trim()) return undefined
  return req.body
}

/** Hosts that look like a developer's machine or an internal network. */
export function isLocalHost(url: string) {
  try {
    const h = new URL(url).hostname
    return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(h) || /\.(test|local|localhost|lan|internal|docker|ddev\.site|lndo\.site)$/.test(h) || !h.includes('.')
  } catch {
    return false
  }
}

export interface SendResult {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  truncated: boolean
  size: number
  timeMs: number
}

export function send(workspaceId: string, method: string, url: string, headers: Record<string, string>, body: string | undefined, insecure: boolean) {
  return api.post<SendResult>(`/workspaces/${workspaceId}/api-client/send`, { method, url, headers, body, insecure })
}

/** cURL equivalent, with the Authorization header masked unless asked otherwise. */
export function toCurl(method: string, url: string, headers: Record<string, string>, body: string | undefined, revealAuth: boolean) {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  const lines = [`curl -X ${method} ${q(url)}`]
  for (const [k, v] of Object.entries(headers)) lines.push(`  -H ${q(`${k}: ${k.toLowerCase() === 'authorization' && !revealAuth ? v.replace(/^(\w+)\s.+$/, '$1 ***') : v}`)}`)
  if (body !== undefined) lines.push(`  --data-raw ${q(body)}`)
  return lines.join(' \\\n')
}
