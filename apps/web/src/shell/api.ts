/** Thin client for the Agentic Toolkit API (proxied at /api by Vite in dev). */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly rule?: string,
  ) {
    super(message)
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${url}`, {
      method,
      headers: body instanceof FormData || body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    // The browser only says "Failed to fetch": the Agentic Toolkit server is down or restarting
    throw new ApiError('Sem conexão com o servidor do Agentic Toolkit. Ele foi encerrado ou está reiniciando; tente de novo em alguns segundos.', 0)
  }
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    // Nest exceptions carry the readable text in `message` (`error` is just "Bad Request"); the guard uses `error`
    const msg = (data?.statusCode ? data.message : data?.error ?? data?.message) ?? `Erro ${res.status}`
    throw new ApiError(Array.isArray(msg) ? msg.join(', ') : String(msg), res.status, data?.rule)
  }
  return data as T
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
}

// ---- types mirrored from the API ------------------------------------------------

export type GitAuth = { method: 'system' } | { method: 'token'; token: string; username?: string } | { method: 'ssh-key'; keyPath: string }

export interface Workspace {
  id: string
  name: string
  source: { type: 'local'; path: string } | { type: 'git'; url: string; branch?: string; authMethod: string } | { type: 'zip'; fileName: string }
  checkoutDir: string
  magentoRoot?: string
  edition?: string
  version?: string
  ownVendors: string[]
  status: 'connecting' | 'needs-root' | 'ready' | 'analyzing' | 'analyzed' | 'error'
  error?: string
  jobId?: string
  createdAt: string
  analyzedAt?: string
}

export interface DetectionCheck {
  id: string
  label: string
  ok: boolean
  weight: 'required' | 'strong' | 'hint'
  detail?: string
}

export interface Detection {
  path: string
  isMagento: boolean
  confidence: number
  edition?: string
  version?: string
  checks: DetectionCheck[]
  candidates: { path: string; relative: string; version?: string; edition?: string }[]
  vendors: { name: string; modules: number }[]
}

export interface Job {
  id: string
  kind: string
  status: 'running' | 'done' | 'error'
  steps: { id: string; label: string; status: 'pending' | 'running' | 'done' | 'error' | 'skipped'; detail?: string }[]
  log: string[]
  error?: string
  /** Output when finished (e.g. the id of the created document or diagram) */
  result?: Record<string, unknown>
}

export interface Highlight {
  level: 'critical' | 'warning' | 'info'
  title: string
  detail: string
  link?: string
}

export interface Overview {
  computedAt: string
  project: {
    id: string
    name: string
    source: Workspace['source']
    root: string
    git: { branch?: string; commit?: string; date?: string; subject?: string; author?: string; contributors?: number; remote?: string } | null
    commits: { hash: string; date: string; author: string; subject: string }[]
  }
  magento: { edition?: string; version?: string; framework?: string; php?: string; composerLock: boolean; cloud: boolean }
  support: { line: string; current: string; latestInLine?: string; latestOverall?: string; patchesBehind?: number; endOfSupport?: string; supported?: boolean; source: string } | null
  modules: {
    total: number
    enabled: number
    disabled: string[]
    byOrigin: Record<'core' | 'composer-thirdparty' | 'custom' | 'appcode-thirdparty', number>
    appCode: { name: string; vendor: string; own: boolean; enabled: boolean | null }[]
    appCodeVendors: { vendor: string; own: boolean; modules: number }[]
  }
  extensions: { total: number; list: { name: string; version: string; type?: string; vendor: string; description?: string }[]; vendors: { vendor: string; count: number }[] }
  patches: { qualityPatches: string | null; cloudPatches: string | null; files: { file: string; id?: string; kind: 'adobe' | 'custom' }[]; composerPatches: { package: string; description: string }[] }
  security: {
    securityPackage: string | null
    modules: { name: string; enabled: boolean | null }[]
    reCaptcha: { total: number; enabled: number }
    sensitiveFiles: { file: string; tracked: boolean | null }[]
  }
  frontend: { themes: { area: string; code: string; parent?: string }[]; hyva: boolean; breeze: boolean; pageBuilder: boolean; graphql: boolean }
  infrastructure: { docker: { file: string; services: string[] } | null; ci: string[]; cloud: boolean; searchEngine?: string; rabbitmq: boolean }
  code: { files: number; php: number; phpLines: number; xml: number; templates: number; js: number; tests: number }
  integration: {
    analyzed: boolean
    total: number
    byKind: Record<string, number>
    byZone: Record<string, number>
    anonymousWrites: number
    coreRewrites: number
    cutChains: number
    risks: Record<string, number>
  }
  highlights: Highlight[]
}

export interface AskResult {
  answer: string
  provider: string
  model?: string
  toolCalls: { name: string; input: unknown }[]
  stopReason?: string
}

export interface Providers {
  active: string
  settings: {
    provider: string
    anthropic: { model: string; effort: string }
    openai: { baseUrl: string; model: string }
    claudeCode: { bin?: string; model?: string }
  }
  providers: { id: string; name: string; available: boolean; detail: string }[]
}

/** Polls a background job until it finishes. */
export async function waitJob(jobId: string, onUpdate: (job: Job) => void): Promise<Job> {
  let offline = 0
  for (;;) {
    let job: Job
    try {
      job = await api.get<Job>(`/jobs/${jobId}`)
      offline = 0
    } catch (err) {
      // A short server restart shouldn't break the screen: keep polling for ~30 s
      if (!(err instanceof ApiError) || err.status !== 0 || ++offline > 25) throw err
      await new Promise((r) => setTimeout(r, 1200))
      continue
    }
    onUpdate(job)
    if (job.status !== 'running') return job
    await new Promise((r) => setTimeout(r, 1200))
  }
}
