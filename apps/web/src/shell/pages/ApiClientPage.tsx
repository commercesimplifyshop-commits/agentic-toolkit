import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useMap, type MapItem } from '../../map/useMap'
import { api } from '../api'
import {
  buildUrl,
  finalBody,
  finalHeaders,
  isLocalHost,
  send,
  toCurl,
  useApiClient,
  type AuthType,
  type KV,
  type Template,
} from '../apiclient/useApiClient'
import { TextEditor } from '../editor/TextEditor'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const METHOD_TONE: Record<string, string> = { GET: 'green', POST: 'yellow', PUT: 'blue', PATCH: 'purple', DELETE: 'red' }
const AUTH_LABEL: Record<AuthType, string> = {
  none: 'Sem autenticação',
  bearer: 'Bearer token',
  admin: 'Admin (usuário e senha)',
  customer: 'Cliente (e-mail e senha)',
  basic: 'Basic Auth',
}

type Tab = 'params' | 'auth' | 'headers' | 'body'

/** Postman-like API simulator, pre-filled from the installation's REST/GraphQL routes. */
export function ApiClientPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const routeId = params.get('route')
  const { map, loadWorkspace } = useMap()
  const s = useApiClient()
  const { env, auth, request: req, response } = s
  const [tab, setTab] = useState<Tab>('body')
  const [loadingTpl, setLoadingTpl] = useState(false)
  const [respTab, setRespTab] = useState<'body' | 'headers'>('body')
  const [curl, setCurl] = useState(false)

  useEffect(() => {
    s.init(id)
    loadWorkspace(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Load the template of the route in the URL
  useEffect(() => {
    if (!routeId) return
    setLoadingTpl(true)
    api
      .get<Template>(`/workspaces/${id}/api-client/template?route=${encodeURIComponent(routeId)}`)
      .then((t) => {
        s.applyTemplate(t)
        setTab(t.kind === 'graphql' || (t.method !== 'GET' && t.method !== 'DELETE') ? 'body' : t.pathParams.length || t.query.length ? 'params' : 'auth')
      })
      .catch((e) => s.setResult(null, e.message))
      .finally(() => setLoadingTpl(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, routeId])

  const url = buildUrl(env, req)
  let headers: Record<string, string> = {}
  let body: string | undefined
  let bodyError = ''
  try {
    headers = finalHeaders(env, req, auth)
    body = finalBody(req)
    if (req.kind === 'rest' && body) JSON.parse(body)
  } catch (e) {
    bodyError = e instanceof SyntaxError ? 'O body não é um JSON válido' : (e as Error).message
  }

  const doSend = async () => {
    if (!env.baseUrl) return s.setResult(null, 'Informe a URL base do ambiente (ex.: https://minha-loja.test)')
    if (bodyError) return s.setResult(null, bodyError)
    // Safety net: writing to something that doesn't look local needs an explicit OK
    if (req.method !== 'GET' && !isLocalHost(url) && !confirm(`${new URL(url).host} não parece um ambiente local.\n\nEnviar ${req.method} pode alterar dados desse ambiente. Continuar?`)) return
    s.setSending(true)
    try {
      s.setResult(await send(id, req.method, url, headers, body, env.insecure))
    } catch (e) {
      s.setResult(null, (e as Error).message)
    }
  }

  return (
    <div className="sf-apic">
      <EndpointList map={map?.items ?? []} active={routeId} onPick={(rid) => setParams({ route: rid })} />

      <div className="sf-apic-main">
        <div className="sf-apic-env">
          <label>
            URL base
            <input className="sf-input sf-mono" placeholder="https://minha-loja.test" value={env.baseUrl} onChange={(e) => s.setEnv({ baseUrl: e.target.value.trim() })} />
          </label>
          <label style={{ width: 140 }}>
            Store code
            <input className="sf-input sf-mono" value={env.store} onChange={(e) => s.setEnv({ store: e.target.value.trim() })} />
          </label>
          <label className="sf-apic-check">
            <input type="checkbox" checked={env.insecure} onChange={(e) => s.setEnv({ insecure: e.target.checked })} /> Ignorar certificado (local)
          </label>
          {env.baseUrl && !isLocalHost(env.baseUrl) && <span className="sf-badge red">não parece local</span>}
        </div>

        <div className="sf-apic-line">
          <select className={`sf-apic-method m-${req.method}`} value={req.method} onChange={(e) => s.setRequest({ method: e.target.value })} disabled={req.kind === 'graphql'}>
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <span className="sf-apic-prefix sf-mono">{req.kind === 'rest' ? `/rest/${env.store || 'default'}` : ''}</span>
          <input className="sf-input sf-mono" value={req.path} onChange={(e) => s.setRequest({ path: e.target.value })} />
          <button className="sf-btn accent" onClick={doSend} disabled={s.sending}>
            {s.sending ? <span className="sf-spinner" /> : '➤'} Enviar
          </button>
        </div>
        <div className="sf-apic-url sf-mono" title={url}>
          {url || '—'}
        </div>

        {(req.summary || req.service || req.notes.length > 0) && (
          <div className="sf-apic-notes">
            {req.summary && <strong>{req.summary}</strong>}
            {req.service && <span className="sf-mono">{req.service}</span>}
            {req.notes.map((n) => (
              <span key={n}>• {n}</span>
            ))}
          </div>
        )}

        <div className="sf-tabs" style={{ marginBottom: 0 }}>
          {(
            [
              ['params', `Parâmetros${req.pathParams.length + req.query.length ? ` (${req.pathParams.length + req.query.length})` : ''}`],
              ['auth', `Autorização${auth.type !== 'none' ? ' •' : ''}`],
              ['headers', `Headers (${Object.keys(headers).length})`],
              ['body', req.kind === 'graphql' ? 'Query GraphQL' : 'Body'],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button key={k} className={`sf-tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
          {loadingTpl && <span className="sf-spinner" style={{ alignSelf: 'center', marginLeft: 8 }} />}
        </div>

        <div className="sf-apic-pane">
          {tab === 'params' && <ParamsTab />}
          {tab === 'auth' && <AuthTab workspaceId={id} />}
          {tab === 'headers' && <HeadersTab computed={headers} />}
          {tab === 'body' &&
            (req.kind === 'graphql' ? (
              <div className="sf-apic-gql">
                <TextEditor language="text" value={req.graphqlQuery} onChange={(v) => s.setRequest({ graphqlQuery: v })} />
                <div>
                  <div className="sf-faint" style={{ fontSize: 11.5, padding: '4px 8px' }}>
                    Variáveis (JSON)
                  </div>
                  <TextEditor value={req.graphqlVariables} onChange={(v) => s.setRequest({ graphqlVariables: v })} />
                </div>
              </div>
            ) : ['GET', 'HEAD'].includes(req.method) ? (
              <div className="sf-empty">Requisições {req.method} não têm body. Use a aba Parâmetros.</div>
            ) : (
              <div className="sf-apic-body">
                <div className="sf-row" style={{ padding: '6px 8px' }}>
                  <span className="sf-faint" style={{ fontSize: 11.5, flex: 1 }}>
                    JSON gerado pela assinatura do método e pelos getters das Data Interfaces
                  </span>
                  {bodyError && <span className="sf-badge red">{bodyError}</span>}
                  <button
                    className="sf-btn small"
                    onClick={() => {
                      try {
                        s.setRequest({ body: JSON.stringify(JSON.parse(req.body), null, 2) })
                      } catch {
                        // keep as is: badge already shows the error
                      }
                    }}
                  >
                    Formatar
                  </button>
                </div>
                <TextEditor value={req.body} onChange={(v) => s.setRequest({ body: v })} />
              </div>
            ))}
        </div>

        <div className="sf-apic-resp">
          <div className="sf-apic-resp-head">
            <strong>Resposta</strong>
            {response && (
              <>
                <span className={`sf-badge ${response.status < 300 ? 'green' : response.status < 400 ? 'blue' : response.status < 500 ? 'yellow' : 'red'}`}>
                  {response.status} {response.statusText}
                </span>
                <span className="sf-faint">{response.timeMs} ms</span>
                <span className="sf-faint">{(response.size / 1024).toFixed(1)} KB</span>
                <button className={`sf-tab ${respTab === 'body' ? 'on' : ''}`} onClick={() => setRespTab('body')}>
                  Body
                </button>
                <button className={`sf-tab ${respTab === 'headers' ? 'on' : ''}`} onClick={() => setRespTab('headers')}>
                  Headers
                </button>
              </>
            )}
            <span style={{ flex: 1 }} />
            <button className="sf-btn small" onClick={() => setCurl(!curl)}>
              {curl ? 'Fechar cURL' : 'Copiar como cURL'}
            </button>
          </div>
          {curl && <CurlBox method={req.method} url={url} headers={headers} body={body} />}
          {s.error && <div className="sf-callout red" style={{ margin: 12 }}>{s.error}</div>}
          {response ? (
            respTab === 'body' ? (
              <div className="sf-apic-resp-body">
                <TextEditor readOnly value={pretty(response.body)} language={looksJson(response.body) ? 'json' : 'text'} />
              </div>
            ) : (
              <table className="sf-table">
                <tbody>
                  {Object.entries(response.headers).map(([k, v]) => (
                    <tr key={k}>
                      <td className="sf-mono" style={{ width: 240 }}>
                        {k}
                      </td>
                      <td className="sf-mono sf-muted" style={{ overflowWrap: 'anywhere' }}>
                        {v}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            !s.error && (
              <div className="sf-empty">
                Escolha um endpoint à esquerda, ajuste os campos e clique em <b>Enviar</b>. Se o ambiente estiver fora do ar, o erro aparece aqui.
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}

const looksJson = (t: string) => /^\s*[[{"]/.test(t)
function pretty(t: string) {
  try {
    return looksJson(t) ? JSON.stringify(JSON.parse(t), null, 2) : t
  } catch {
    return t
  }
}

// ---- left: endpoints ------------------------------------------------------------------

function EndpointList({ map, active, onPick }: { map: MapItem[]; active: string | null; onPick: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [native, setNative] = useState(false)
  const list = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    return map
      .filter((i) => (i.kind === 'rest' || i.kind === 'graphql') && (native || i.origin !== 'native'))
      .filter((i) => terms.every((t) => `${i.title} ${i.module} ${i.subtitle}`.toLowerCase().includes(t)))
      .sort((a, b) => (a.origin === 'native' ? 1 : 0) - (b.origin === 'native' ? 1 : 0) || a.title.localeCompare(b.title))
      .slice(0, 400)
  }, [map, q, native])

  return (
    <div className="sf-apic-list">
      <input className="sf-input" placeholder="Filtrar endpoints…" value={q} onChange={(e) => setQ(e.target.value)} />
      <label className="sf-apic-check" style={{ padding: '6px 2px' }}>
        <input type="checkbox" checked={native} onChange={(e) => setNative(e.target.checked)} /> incluir nativos do Magento
      </label>
      <div className="sf-apic-items">
        {list.map((i) => {
          const method = i.kind === 'graphql' ? 'GQL' : String(i.details.method)
          const path = i.kind === 'graphql' ? String(i.details.name) : String(i.details.url)
          return (
            <button key={i.id} className={`sf-apic-item ${active === i.id ? 'on' : ''}`} onClick={() => onPick(i.id)} title={`${i.title} · ${i.module}`}>
              <span className={`sf-apic-verb ${i.kind === 'graphql' ? 'gql' : METHOD_TONE[method] ?? ''}`}>{method}</span>
              <span className="sf-mono path">{path}</span>
              {i.origin !== 'native' && <span className={`dot ${i.risk ? 'risk' : ''}`} title={i.risk ? `risco ${i.risk.level}` : 'customizado'} />}
            </button>
          )
        })}
        {list.length === 0 && <div className="sf-empty">Nada encontrado</div>}
      </div>
    </div>
  )
}

// ---- tabs -----------------------------------------------------------------------------------

function KvTable({ rows, onChange, placeholderKey }: { rows: KV[]; onChange: (rows: KV[]) => void; placeholderKey: string }) {
  const update = (i: number, patch: Partial<KV>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  return (
    <table className="sf-table sf-kv">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td style={{ width: 28 }}>
              <input type="checkbox" checked={r.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} />
            </td>
            <td>
              <input className="sf-input sf-mono" value={r.key} placeholder={placeholderKey} onChange={(e) => update(i, { key: e.target.value })} />
            </td>
            <td>
              <input className="sf-input sf-mono" value={r.value} placeholder="valor" onChange={(e) => update(i, { value: e.target.value })} />
            </td>
            <td style={{ width: 30 }}>
              <button className="sf-link" onClick={() => onChange(rows.filter((_, k) => k !== i))}>
                ✕
              </button>
            </td>
          </tr>
        ))}
        <tr>
          <td colSpan={4}>
            <button className="sf-btn small" onClick={() => onChange([...rows, { key: '', value: '', enabled: true }])}>
              + adicionar
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  )
}

function ParamsTab() {
  const { request: req, setRequest } = useApiClient()
  return (
    <div style={{ padding: 12 }}>
      {req.pathParams.length > 0 && (
        <>
          <div className="sf-apic-section">Parâmetros de caminho</div>
          {req.pathParams.map((p, i) => (
            <div key={p.name} className="sf-row" style={{ marginBottom: 6 }}>
              <span className="sf-mono" style={{ width: 180 }}>
                :{p.name} <span className="sf-faint">{p.type}</span>
              </span>
              <input
                className="sf-input sf-mono"
                value={p.value}
                onChange={(e) => setRequest({ pathParams: req.pathParams.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) })}
              />
            </div>
          ))}
        </>
      )}
      <div className="sf-apic-section">Query string</div>
      <KvTable rows={req.query} onChange={(query) => setRequest({ query })} placeholderKey="searchCriteria[pageSize]" />
    </div>
  )
}

function AuthTab({ workspaceId }: { workspaceId: string }) {
  const { auth, setAuth, env, request } = useApiClient()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  /** Exchanges admin/customer credentials for a token on the chosen environment. */
  const generate = async () => {
    if (!env.baseUrl) return setMsg('Informe a URL base do ambiente primeiro')
    setBusy(true)
    setMsg('')
    const kind = auth.type === 'admin' ? 'admin' : 'customer'
    const url = `${env.baseUrl.replace(/\/+$/, '')}/rest/${env.store || 'default'}/V1/integration/${kind}/token`
    try {
      const r = await send(workspaceId, 'POST', url, { 'Content-Type': 'application/json', Accept: 'application/json' }, JSON.stringify({ username: auth.username, password: auth.password }), env.insecure)
      if (r.status !== 200) {
        let m = r.body
        try {
          m = JSON.parse(r.body).message ?? r.body
        } catch {
          // plain text error
        }
        setMsg(`HTTP ${r.status}: ${String(m).slice(0, 240)}${/two.?factor|2fa|tfa/i.test(String(m)) ? ' (com 2FA ativo use um token de integração em Bearer)' : ''}`)
      } else {
        setAuth({ token: JSON.parse(r.body), generatedAt: new Date().toLocaleTimeString('pt-BR') })
        setMsg('Token gerado e aplicado nas próximas requisições.')
      }
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ padding: 12, maxWidth: 720 }}>
      <div className="sf-field">
        <label>Tipo</label>
        <select className="sf-input" value={auth.type} onChange={(e) => setAuth({ type: e.target.value as AuthType, token: '', generatedAt: undefined })}>
          {(Object.keys(AUTH_LABEL) as AuthType[]).map((k) => (
            <option key={k} value={k}>
              {AUTH_LABEL[k]}
            </option>
          ))}
        </select>
        {request.acl.length > 0 && <small>ACL da rota: {request.acl.join(', ')}</small>}
      </div>

      {auth.type === 'bearer' && (
        <div className="sf-field">
          <label>Token</label>
          <input className="sf-input sf-mono" type="password" autoComplete="off" placeholder="token de integração, admin ou cliente" value={auth.token} onChange={(e) => setAuth({ token: e.target.value })} />
          <small>Integração: Sistema → Extensões → Integrações → Access Token.</small>
        </div>
      )}

      {(auth.type === 'admin' || auth.type === 'customer' || auth.type === 'basic') && (
        <div className="sf-row" style={{ alignItems: 'flex-end' }}>
          <div className="sf-field" style={{ flex: 1 }}>
            <label>{auth.type === 'customer' ? 'E-mail do cliente' : 'Usuário'}</label>
            <input className="sf-input sf-mono" autoComplete="off" value={auth.username} onChange={(e) => setAuth({ username: e.target.value })} />
          </div>
          <div className="sf-field" style={{ flex: 1 }}>
            <label>Senha</label>
            <input className="sf-input sf-mono" type="password" autoComplete="off" value={auth.password} onChange={(e) => setAuth({ password: e.target.value })} />
          </div>
          {auth.type !== 'basic' && (
            <div className="sf-field">
              <button className="sf-btn primary" onClick={generate} disabled={busy || !auth.username || !auth.password}>
                {busy ? <span className="sf-spinner" /> : null} Gerar token
              </button>
            </div>
          )}
        </div>
      )}

      {(auth.type === 'admin' || auth.type === 'customer') && (
        <div className="sf-callout" style={{ fontSize: 12.5 }}>
          {auth.token ? (
            <>
              Token ativo {auth.generatedAt ? `(gerado às ${auth.generatedAt})` : ''}: <span className="sf-mono">{auth.token.slice(0, 6)}…{auth.token.slice(-4)}</span>{' '}
              <button className="sf-link" onClick={() => setAuth({ token: '', generatedAt: undefined })}>
                descartar
              </button>
            </>
          ) : (
            <>
              Gera um token em <code>/V1/integration/{auth.type}/token</code> e envia como <code>Authorization: Bearer</code>.
            </>
          )}
        </div>
      )}
      {msg && <div className="sf-muted" style={{ marginTop: 10, fontSize: 12.5 }}>{msg}</div>}
      <div className="sf-faint" style={{ marginTop: 14, fontSize: 11.5 }}>
        Senhas e tokens ficam só na memória desta aba: não são salvos nem registrados na auditoria.
      </div>
    </div>
  )
}

function HeadersTab({ computed }: { computed: Record<string, string> }) {
  const { request: req, setRequest } = useApiClient()
  const custom = new Set(req.headers.filter((h) => h.enabled).map((h) => h.key.toLowerCase()))
  return (
    <div style={{ padding: 12 }}>
      <div className="sf-apic-section">Automáticos</div>
      <table className="sf-table">
        <tbody>
          {Object.entries(computed)
            .filter(([k]) => !custom.has(k.toLowerCase()))
            .map(([k, v]) => (
              <tr key={k}>
                <td className="sf-mono" style={{ width: 200 }}>
                  {k}
                </td>
                <td className="sf-mono sf-muted">{k === 'Authorization' ? v.replace(/^(\w+)\s.+$/, '$1 ••••••') : v}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <div className="sf-apic-section">Personalizados</div>
      <KvTable rows={req.headers} onChange={(headers) => setRequest({ headers })} placeholderKey="X-Header" />
    </div>
  )
}

function CurlBox({ method, url, headers, body }: { method: string; url: string; headers: Record<string, string>; body?: string }) {
  const [reveal, setReveal] = useState(false)
  const text = toCurl(method, url, headers, body, reveal)
  return (
    <div className="sf-apic-curl">
      <div className="sf-row" style={{ marginBottom: 6 }}>
        <label className="sf-apic-check">
          <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} /> incluir token real
        </label>
        <span style={{ flex: 1 }} />
        <button className="sf-btn small" onClick={() => navigator.clipboard?.writeText(text)}>
          Copiar
        </button>
      </div>
      <pre className="sf-mono">{text}</pre>
    </div>
  )
}
