import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, waitJob, type Detection, type GitAuth, type Job, type TechId, type TechInfo, type Workspace } from '../api'
import { DetectionView } from '../components/DetectionView'
import { FolderBrowser } from '../components/FolderBrowser'
import { JobProgress } from '../components/JobProgress'
import { useShell } from '../store'

type Source = 'local' | 'git' | 'zip'

/** Onboarding: pick a technology and a source → validate it → choose the project root → analyze. */
export function ConnectPage() {
  const { id } = useParams()
  return (
    <div className="sf-root" style={{ display: 'block' }}>
      <div className="sf-connect">
        <div className="sf-connect-inner">
          <div className="sf-brand">
            <div className="sf-brand-logo">
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
                <path d="M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 2.3 6.6 3.7L12 11.7 5.4 8 12 4.3ZM5 9.7l6 3.4v6.6l-6-3.4V9.7Zm8 10v-6.6l6-3.4v6.6l-6 3.4Z" fill="currentColor" />
              </svg>
            </div>
            <div>
              <strong>Agentic Toolkit</strong>
              <span>Entenda a sua instalação lendo o código</span>
            </div>
          </div>
          {id ? <ConfigureStep id={id} /> : <SourceStep />}
        </div>
      </div>
    </div>
  )
}

function Steps({ current }: { current: 0 | 1 | 2 }) {
  const labels = ['1 · Origem do código', '2 · Validação', '3 · Análise']
  return (
    <div className="sf-steps">
      {labels.map((l, i) => (
        <div key={l} className={`sf-step ${i === current ? 'on' : i < current ? 'done' : ''}`}>
          {l}
        </div>
      ))}
    </div>
  )
}

function ReadOnlyNote() {
  return (
    <div className="sf-callout green" style={{ marginBottom: 20 }}>
      <strong>Você decide o que muda.</strong> As telas de análise só leem o código. Uma pasta local é usada no lugar: o Git e o desenvolvimento por tarefa
      escrevem nela, sempre a partir de um botão com confirmação. Repositórios e .zip são copiados para o diretório de dados do Agentic Toolkit e o push fica desativado. Arquivos de credenciais (<code>env.php</code>, <code>auth.json</code>, <code>.env</code>) são
      listados, mas nunca lidos.
    </div>
  )
}

// ---- step 1: source -------------------------------------------------------------------

function SourceStep() {
  const navigate = useNavigate()
  const workspaces = useShell((s) => s.workspaces)
  const refresh = useShell((s) => s.refreshWorkspaces)
  const [source, setSource] = useState<Source>('local')
  const [tech, setTech] = useState<TechId>('adobe-commerce')
  const [techs, setTechs] = useState<TechInfo[]>([])

  useEffect(() => {
    refresh().catch(() => undefined)
    api.get<TechInfo[]>('/techs').then(setTechs).catch(() => undefined)
  }, [refresh])

  const connected = (ws: Workspace) => navigate(`/connect/${ws.id}`)

  return (
    <>
      <h1>Conectar uma instalação</h1>
      <p className="lead">Escolha a tecnologia e a origem do código. O Agentic Toolkit valida a instalação, lê o que foi customizado e monta a visão da solução.</p>
      <Steps current={0} />
      <ReadOnlyNote />
      <div className="sf-tech-picker" role="radiogroup" aria-label="Tecnologia">
        {techs.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={tech === t.id} className={`sf-tech-card ${tech === t.id ? 'on' : ''}`} onClick={() => setTech(t.id)}>
            <strong>{t.name}</strong>
            <span>{t.summary}</span>
          </button>
        ))}
      </div>
      <div className="sf-card">
        <div className="sf-tabs">
          {(
            [
              ['local', 'Pasta no computador'],
              ['git', 'Repositório Git'],
              ['zip', 'Arquivo .zip'],
            ] as [Source, string][]
          ).map(([k, label]) => (
            <button key={k} className={`sf-tab ${source === k ? 'on' : ''}`} onClick={() => setSource(k)}>
              {label}
            </button>
          ))}
        </div>
        {source === 'local' && <LocalSource tech={tech} onConnected={connected} />}
        {source === 'git' && <GitSource tech={tech} onConnected={connected} />}
        {source === 'zip' && <ZipSource tech={tech} onConnected={connected} />}
      </div>

      {workspaces.length > 0 && (
        <>
          <div className="sf-section-title">Instalações já conectadas</div>
          <div className="sf-card">
            <div className="sf-list">
              {workspaces.map((w) => (
                <div key={w.id} className="sf-list-row">
                  <div className="main">
                    <strong>{w.name}</strong>
                    <span>
                      {w.edition} {w.version} · {w.source.type === 'local' ? w.source.path : w.source.type === 'git' ? w.source.url : w.source.fileName}
                    </span>
                  </div>
                  <span className={`sf-badge ${w.status === 'analyzed' ? 'green' : w.status === 'error' ? 'red' : 'yellow'}`}>{w.status}</span>
                  <Link className="sf-btn small" to={w.status === 'analyzed' ? `/w/${w.id}` : `/connect/${w.id}`}>
                    Abrir
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  )
}

function LocalSource({ tech, onConnected }: { tech: TechId; onConnected: (ws: Workspace) => void }) {
  const [path, setPath] = useState('')
  const [browsing, setBrowsing] = useState(false)
  const [detection, setDetection] = useState<Detection | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const validate = async (p = path) => {
    setError('')
    setDetection(null)
    setBusy(true)
    try {
      setDetection(await api.post<Detection>('/workspaces/inspect', { path: p, tech }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const connect = async (p: string) => {
    setBusy(true)
    try {
      const r = await api.post<{ workspace: Workspace }>('/workspaces', { source: 'local', path: p, tech })
      onConnected(r.workspace)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <>
      <div className="sf-field">
        <label>Caminho da instalação</label>
        <div className="sf-row">
          <input className="sf-input sf-mono" placeholder="C:\projetos\minha-loja ou /home/eu/projetos/minha-loja" value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && validate()} />
          <button className="sf-btn" onClick={() => setBrowsing(true)}>
            Procurar…
          </button>
          <button className="sf-btn primary" disabled={!path || busy} onClick={() => validate()}>
            Validar
          </button>
        </div>
        <small>Pode ser a raiz do repositório: se a instalação estiver numa subpasta (ex.: magento2/ ou storefront/), ela é encontrada.</small>
      </div>
      {busy && !detection && <span className="sf-spinner" />}
      {detection && (
        <>
          <DetectionView detection={detection} onPickCandidate={(p) => connect(p)} />
          {detection.match && (
            <div className="sf-row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="sf-btn accent" disabled={busy} onClick={() => connect(detection.path)}>
                Conectar esta instalação →
              </button>
            </div>
          )}
        </>
      )}
      {error && <div className="sf-error">{error}</div>}
      {browsing && (
        <FolderBrowser
          initial={path || undefined}
          onClose={() => setBrowsing(false)}
          onPick={(p) => {
            setBrowsing(false)
            setPath(p)
            validate(p)
          }}
        />
      )}
    </>
  )
}

function GitSource({ tech, onConnected }: { tech: TechId; onConnected: (ws: Workspace) => void }) {
  const [url, setUrl] = useState('')
  const [branch, setBranch] = useState('')
  const [method, setMethod] = useState<GitAuth['method']>('system')
  const [token, setToken] = useState('')
  const [username, setUsername] = useState('')
  const [keyPath, setKeyPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const host = /gitlab/i.test(url) ? 'gitlab' : /bitbucket/i.test(url) ? 'bitbucket' : /dev\.azure|visualstudio/i.test(url) ? 'azure' : 'github'

  const connect = async () => {
    setBusy(true)
    setError('')
    const auth: GitAuth = method === 'token' ? { method, token, username: username || undefined } : method === 'ssh-key' ? { method, keyPath } : { method: 'system' }
    try {
      const r = await api.post<{ workspace: Workspace }>('/workspaces', { source: 'git', url, branch, auth, tech })
      setToken('') // the token only lived for this request
      onConnected(r.workspace)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <>
      <div className="sf-field">
        <label>URL do repositório</label>
        <input className="sf-input sf-mono" placeholder="https://github.com/empresa/loja-magento.git ou git@github.com:empresa/loja.git" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <div className="sf-field">
        <label>Branch (opcional)</label>
        <input className="sf-input sf-mono" placeholder="branch padrão do repositório" value={branch} onChange={(e) => setBranch(e.target.value)} style={{ maxWidth: 320 }} />
      </div>

      <div className="sf-field">
        <label>Como acessar um repositório privado</label>
        <div className={`sf-radio ${method === 'system' ? 'on' : ''}`} onClick={() => setMethod('system')}>
          <input type="radio" readOnly checked={method === 'system'} />
          <div>
            <strong>Usar o git já configurado nesta máquina (recomendado)</strong>
            <span>
              Se você consegue rodar <code>git clone</code> desse repositório no terminal (chave SSH ou Git Credential Manager), o Agentic Toolkit usa o mesmo acesso. Nenhum segredo passa pelo app.
            </span>
          </div>
        </div>
        <div className={`sf-radio ${method === 'token' ? 'on' : ''}`} onClick={() => setMethod('token')}>
          <input type="radio" readOnly checked={method === 'token'} />
          <div>
            <strong>Token de acesso somente leitura</strong>
            <span>Usado só para este clone, em memória. Nunca vai para a URL, para o .git/config ou para o disco.</span>
          </div>
        </div>
        <div className={`sf-radio ${method === 'ssh-key' ? 'on' : ''}`} onClick={() => setMethod('ssh-key')}>
          <input type="radio" readOnly checked={method === 'ssh-key'} />
          <div>
            <strong>Deploy key SSH (somente leitura)</strong>
            <span>Uma chave dedicada, cadastrada no repositório só com permissão de leitura.</span>
          </div>
        </div>
      </div>

      {method === 'token' && (
        <>
          <div className="sf-row">
            <div className="sf-field" style={{ flex: 2 }}>
              <label>Token</label>
              <input className="sf-input sf-mono" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
            </div>
            <div className="sf-field" style={{ flex: 1 }}>
              <label>Usuário (opcional)</label>
              <input className="sf-input sf-mono" placeholder="automático" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
          </div>
          <TokenHelp host={host} />
        </>
      )}
      {method === 'ssh-key' && (
        <div className="sf-field">
          <label>Caminho da chave privada</label>
          <input className="sf-input sf-mono" placeholder="C:\Users\eu\.ssh\storeflow_deploy_key" value={keyPath} onChange={(e) => setKeyPath(e.target.value)} />
          <small>Gere com <code>ssh-keygen -t ed25519 -f storeflow_deploy_key</code> e cadastre a .pub como deploy key sem permissão de escrita.</small>
        </div>
      )}

      <div className="sf-row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <button className="sf-btn accent" disabled={!url || busy || (method === 'token' && !token) || (method === 'ssh-key' && !keyPath)} onClick={connect}>
          {busy ? <span className="sf-spinner" /> : null} Clonar e validar →
        </button>
      </div>
      {error && <div className="sf-error">{error}</div>}
    </>
  )
}

const TOKEN_HELP: Record<string, { title: string; steps: string[] }> = {
  github: {
    title: 'Como criar um token somente leitura no GitHub',
    steps: [
      'Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.',
      'Resource owner: a organização da empresa. Repository access: Only select repositories → o repositório Magento.',
      'Permissions → Repository permissions → Contents: Read-only (Metadata: Read-only é marcado junto). Nada além disso.',
      'Defina uma expiração curta. Se a organização exigir, peça aprovação ao admin.',
    ],
  },
  gitlab: {
    title: 'Como criar um token somente leitura no GitLab',
    steps: ['No projeto: Settings → Access Tokens → Add new token.', 'Role: Reporter. Scopes: read_repository apenas.', 'Defina uma expiração curta.'],
  },
  bitbucket: {
    title: 'Como criar um token somente leitura no Bitbucket',
    steps: ['No repositório: Repository settings → Access tokens → Create.', 'Permissions: Repositories → Read.', 'O usuário é preenchido automaticamente (x-token-auth).'],
  },
  azure: {
    title: 'Como criar um token somente leitura no Azure DevOps',
    steps: ['User settings → Personal access tokens → New token.', 'Scopes: Code → Read.', 'Usuário: qualquer valor (ex.: pat).'],
  },
}

function TokenHelp({ host }: { host: string }) {
  const help = TOKEN_HELP[host]
  return (
    <details className="sf-help" open>
      <summary>{help.title}</summary>
      <ol>
        {help.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </details>
  )
}

function ZipSource({ tech, onConnected }: { tech: TechId; onConnected: (ws: Workspace) => void }) {
  const [over, setOver] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const upload = (file: File) => {
    if (!/\.zip$/i.test(file.name)) return setError('Envie um arquivo .zip')
    setError('')
    const form = new FormData()
    form.append('file', file)
    form.append('tech', tech)
    // XHR for upload progress (fetch has no upload progress)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/workspaces/upload')
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => {
      const data = JSON.parse(xhr.responseText || '{}')
      if (xhr.status >= 400) {
        setProgress(null)
        return setError(data.error ?? data.message ?? 'Falha no upload')
      }
      onConnected(data.workspace)
    }
    xhr.onerror = () => setError('Falha no upload')
    xhr.send(form)
  }

  return (
    <>
      <div
        className={`sf-drop ${over ? 'over' : ''}`}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0])
        }}
      >
        {progress === null ? (
          <>
            <div style={{ fontSize: 28, marginBottom: 8 }}>⇪</div>
            Arraste o .zip do projeto aqui ou{' '}
            <button className="sf-link" style={{ textDecoration: 'underline' }} onClick={() => input.current?.click()}>
              escolha o arquivo
            </button>
            <div className="sf-faint" style={{ marginTop: 6, fontSize: 12 }}>
              Extraído no diretório de dados do Agentic Toolkit, com proteção contra zip-slip e links simbólicos.
            </div>
          </>
        ) : (
          <>Enviando… {progress}%</>
        )}
        <input ref={input} type="file" accept=".zip" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </div>
      {error && <div className="sf-error">{error}</div>}
    </>
  )
}

// ---- steps 2-3: validation, configuration, analysis --------------------------------------

function ConfigureStep({ id }: { id: string }) {
  const navigate = useNavigate()
  const refresh = useShell((s) => s.refreshWorkspaces)
  const loadOverview = useShell((s) => s.loadOverview)
  const [ws, setWs] = useState<Workspace | null>(null)
  const [detection, setDetection] = useState<Detection | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [own, setOwn] = useState<string[]>([])
  const [error, setError] = useState('')
  const [repo, setRepo] = useState<{ effective: string | null; branch?: string; message?: string } | null>(null)
  const [params] = useSearchParams()
  // a change made in Configurações comes here to follow the analysis, then goes back
  const back = params.get('retorno') === 'settings' ? `/w/${id}/settings` : `/w/${id}`

  useEffect(() => {
    api
      .get<{ repo: { effective: string | null; branch?: string; message?: string } }>(`/workspaces/${id}/settings`)
      .then((s) => setRepo(s.repo))
      .catch(() => setRepo(null))
  }, [id])

  const load = useCallback(async () => {
    const r = await api.get<{ workspace: Workspace; detection: Detection }>(`/workspaces/${id}`)
    setWs(r.workspace)
    setDetection(r.detection)
    setOwn(r.workspace.ownVendors)
    return r.workspace
  }, [id])

  const follow = useCallback(
    async (jobId: string) => {
      const final = await waitJob(jobId, setJob)
      const w = await load()
      if (final.status === 'done' && w.status === 'analyzed') {
        await refresh()
        await loadOverview(id, true)
        navigate(back)
      }
    },
    [id, load, navigate, refresh, loadOverview, back],
  )

  useEffect(() => {
    load()
      .then((w) => {
        if (w.status === 'analyzed') navigate(back)
        else if ((w.status === 'connecting' || w.status === 'analyzing') && w.jobId) follow(w.jobId)
      })
      .catch((e) => setError(e.message))
  }, [id, load, follow, navigate])

  const pickRoot = async (root: string) => {
    setError('')
    try {
      await api.put(`/workspaces/${id}/settings`, { root })
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const analyze = async () => {
    setError('')
    try {
      await api.put(`/workspaces/${id}/settings`, { ownVendors: own })
      const r = await api.post<{ jobId: string }>(`/workspaces/${id}/analysis`)
      setWs((w) => (w ? { ...w, status: 'analyzing' } : w))
      follow(r.jobId)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const remove = async () => {
    await api.del(`/workspaces/${id}`)
    await refresh()
    navigate('/connect')
  }

  if (!ws) return error ? <div className="sf-error">{error}</div> : <span className="sf-spinner" />
  const vendors = detection?.vendors ?? []
  const analyzing = ws.status === 'analyzing'

  return (
    <>
      <h1>{ws.name}</h1>
      <p className="lead sf-mono" style={{ fontSize: 12.5 }}>
        {ws.root ?? ws.checkoutDir}
      </p>
      <Steps current={ws.status === 'connecting' || ws.status === 'needs-root' ? 1 : 2} />

      {ws.status === 'connecting' && job && (
        <div className="sf-card">
          <h2>Preparando o código</h2>
          <span className="sub">{ws.source.type === 'git' ? 'Clone superficial (depth 1) no diretório de dados, push desativado' : 'Extraindo o arquivo no diretório de dados'}</span>
          <JobProgress job={job} />
        </div>
      )}

      {ws.status === 'needs-root' && detection && (
        <div className="sf-card">
          <h2>Onde está o projeto?</h2>
          <span className="sub">A raiz da origem não é a instalação escolhida, mas encontramos candidatas.</span>
          <DetectionView detection={detection} onPickCandidate={pickRoot} />
        </div>
      )}

      {(ws.status === 'ready' || analyzing) && (
        <>
          <div className="sf-card" style={{ marginBottom: 14 }}>
            <h2>Instalação validada</h2>
            <span className="sub">
              {ws.edition} {ws.version}
            </span>
            {detection && <DetectionView detection={{ ...detection, candidates: [] }} />}
          </div>
          <div className="sf-card">
            <h2>Quais vendors de app/code são do seu time?</h2>
            <span className="sub">Os marcados contam como “customizados”; os demais como “terceiros” (módulos comprados ou de outras agências).</span>
            <div className="sf-chips" style={{ marginBottom: 16 }}>
              {vendors.map((v) => (
                <button key={v.name} disabled={analyzing} className={`sf-chip ${own.includes(v.name) ? 'on' : ''}`} onClick={() => setOwn((o) => (o.includes(v.name) ? o.filter((x) => x !== v.name) : [...o, v.name]))}>
                  {own.includes(v.name) ? '✓ ' : ''}
                  {v.name}
                  <b>{v.modules}</b>
                </button>
              ))}
              {vendors.length === 0 && <span className="sf-muted">Nenhum módulo em app/code.</span>}
            </div>
            <div className="sf-callout" style={{ marginBottom: 14 }}>
              <div>
                <strong>Repositório git:</strong>{' '}
                {repo === null ? '…' : repo.effective ? <span className="sf-mono">{repo.effective}{repo.branch ? ` (${repo.branch})` : ''}</span> : 'não encontrado. O Git e o desenvolvimento por tarefa ficam indisponíveis até você informar o caminho do repositório.'}
              </div>
              <div style={{ marginTop: 4 }}>
                Estas escolhas ficam em <strong>Configurações → Workspace</strong>, junto com o caminho do repositório git e as variáveis de ambiente, e podem ser editadas
                depois. Mudar a pasta, o projeto ou os vendors lá inicia uma nova análise.
              </div>
            </div>
            {analyzing && job ? (
              <JobProgress job={job} />
            ) : (
              <div className="sf-row" style={{ justifyContent: 'flex-end' }}>
                <button className="sf-btn accent" onClick={analyze}>
                  Analisar instalação →
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {ws.status === 'error' && (
        <div className="sf-card">
          <h2>Não foi possível conectar</h2>
          <div className="sf-error">{ws.error}</div>
          {job && <JobProgress job={job} />}
        </div>
      )}

      {error && <div className="sf-error">{error}</div>}
      <div className="sf-row" style={{ marginTop: 18 }}>
        <Link className="sf-link" to="/connect">
          ← Outra origem
        </Link>
        <span style={{ flex: 1 }} />
        <button className="sf-btn small danger" onClick={remove} disabled={analyzing}>
          Remover do Agentic Toolkit
        </button>
      </div>
    </>
  )
}
