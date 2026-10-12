import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, DIRS } from '../config/paths'
import { JobsService } from '../jobs/jobs.service'
import { assertDataDirOutside, assertWritableTarget, isInside, ReadOnlyViolation } from '../readonly/path-guard'
import { ReadOnlyFs } from '../readonly/readonly-fs.service'
import { GitService, sanitizeUrl, type GitAuth } from './git.service'
import { detectMagento, readVersion, vendorsOf, type Detection } from './magento-detector'
import { ZipService } from './zip.service'

export type WorkspaceSource =
  | { type: 'local'; path: string }
  | { type: 'git'; url: string; branch?: string; authMethod: GitAuth['method'] }
  | { type: 'zip'; fileName: string }

export interface Workspace {
  id: string
  name: string
  source: WorkspaceSource
  /** Where the code lives: the local folder itself, or StoreFlow's clone/extraction */
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

const STORE = path.join(DATA_DIR, 'workspaces.json')

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^\w]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'magento'

@Injectable()
export class WorkspacesService {
  private workspaces: Workspace[] = []

  constructor(
    private readonly rofs: ReadOnlyFs,
    private readonly git: GitService,
    private readonly zip: ZipService,
    private readonly jobs: JobsService,
  ) {
    try {
      this.workspaces = JSON.parse(fs.readFileSync(STORE, 'utf8'))
    } catch {
      this.workspaces = []
    }
  }

  private save() {
    fs.writeFileSync(STORE, JSON.stringify(this.workspaces, null, 2))
  }

  list() {
    return this.workspaces
  }

  get(id: string) {
    const ws = this.workspaces.find((w) => w.id === id)
    if (!ws) throw new NotFoundException(`Instalação ${id} não encontrada`)
    return ws
  }

  /** Magento root of a ready workspace. Used by every validator that reads code. */
  rootOf(id: string) {
    const ws = this.get(id)
    if (!ws.magentoRoot) throw new ReadOnlyViolation('Instalação ainda sem raiz Magento definida', 'workspace.no-root')
    return ws.magentoRoot
  }

  dataDirOf(id: string) {
    const dir = path.join(DIRS.workspaces, id)
    assertWritableTarget(dir)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  private newId(name: string) {
    return `${slug(name)}-${randomBytes(3).toString('hex')}`
  }

  update(ws: Workspace, patch: Partial<Workspace>) {
    Object.assign(ws, patch)
    this.save()
    return ws
  }

  /** Detection only: nothing is copied or written. */
  inspect(dir: string): Detection {
    return detectMagento(this.rofs, dir)
  }

  private applyDetection(ws: Workspace, detection: Detection) {
    if (detection.isMagento) {
      this.setRoot(ws, detection.path)
    } else if (detection.candidates.length === 1) {
      this.setRoot(ws, detection.candidates[0].path)
    } else {
      this.update(ws, { status: detection.candidates.length ? 'needs-root' : 'error', error: detection.candidates.length ? undefined : 'Nenhuma instalação Magento encontrada nesta origem' })
    }
  }

  private setRoot(ws: Workspace, root: string) {
    if (!isInside(ws.checkoutDir, root)) throw new BadRequestException('A raiz Magento precisa estar dentro da origem conectada')
    assertDataDirOutside(root)
    const detection = detectMagento(this.rofs, root)
    if (!detection.isMagento) throw new BadRequestException(`A pasta escolhida não parece ser uma instalação Magento (${detection.confidence}% de confiança)`)
    const { edition, version } = readVersion(this.rofs, root)
    const ownVendors = ws.ownVendors.length ? ws.ownVendors : vendorsOf(this.rofs, root).map((v) => v.name)
    this.update(ws, { magentoRoot: root, edition, version, ownVendors, status: 'ready', error: undefined })
  }

  createLocal(dir: string, name?: string) {
    const root = path.resolve(dir)
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new BadRequestException(`Pasta não encontrada: ${root}`)
    assertDataDirOutside(root)
    const ws: Workspace = {
      id: this.newId(name ?? path.basename(root)),
      name: name ?? path.basename(root),
      source: { type: 'local', path: root },
      checkoutDir: root,
      ownVendors: [],
      status: 'connecting',
      createdAt: new Date().toISOString(),
    }
    this.workspaces.push(ws)
    this.applyDetection(ws, detectMagento(this.rofs, root))
    return { workspace: ws, detection: detectMagento(this.rofs, root) }
  }

  createGit(input: { url: string; branch?: string; name?: string; auth: GitAuth }) {
    const url = sanitizeUrl(input.url.trim())
    const name = input.name ?? url.split('/').pop()?.replace(/\.git$/, '') ?? 'magento'
    const id = this.newId(name)
    const dest = path.join(DIRS.repos, id)
    assertWritableTarget(dest)
    const job = this.jobs.create('clone', id, [
      { id: 'access', label: 'Verificando acesso ao repositório' },
      { id: 'clone', label: 'Clonando (somente leitura, depth 1)' },
      { id: 'detect', label: 'Validando instalação Magento' },
    ])
    const ws: Workspace = {
      id,
      name,
      source: { type: 'git', url, branch: input.branch, authMethod: input.auth.method },
      checkoutDir: dest,
      ownVendors: [],
      status: 'connecting',
      jobId: job.id,
      createdAt: new Date().toISOString(),
    }
    this.workspaces.push(ws)
    this.save()

    this.jobs.run(job, async () => {
      try {
        this.jobs.step(job, 'access', 'running')
        const branches = await this.git.checkAccess(url, input.auth)
        this.jobs.step(job, 'access', 'done', `${branches.length} branches visíveis`)
        this.jobs.step(job, 'clone', 'running')
        await this.git.clone(url, dest, { branch: input.branch, auth: input.auth, onLine: (l) => this.jobs.log(job, l) })
        this.jobs.step(job, 'clone', 'done')
        this.jobs.step(job, 'detect', 'running')
        this.applyDetection(ws, detectMagento(this.rofs, dest))
        this.jobs.step(job, 'detect', ws.status === 'error' ? 'error' : 'done', ws.status === 'needs-root' ? 'Escolha a pasta da instalação' : ws.version)
        if (ws.status === 'error') throw new Error(ws.error)
      } catch (err) {
        this.update(ws, { status: 'error', error: (err as Error).message })
        throw err
      }
    })
    return { workspace: ws, jobId: job.id }
  }

  createZip(uploadedFile: string, originalName: string) {
    const name = originalName.replace(/\.zip$/i, '')
    const id = this.newId(name)
    const dest = path.join(DIRS.uploads, id)
    const job = this.jobs.create('unzip', id, [
      { id: 'extract', label: 'Extraindo o .zip no diretório de dados' },
      { id: 'detect', label: 'Validando instalação Magento' },
    ])
    const ws: Workspace = {
      id,
      name,
      source: { type: 'zip', fileName: originalName },
      checkoutDir: dest,
      ownVendors: [],
      status: 'connecting',
      jobId: job.id,
      createdAt: new Date().toISOString(),
    }
    this.workspaces.push(ws)
    this.save()
    this.jobs.run(job, async () => {
      try {
        this.jobs.step(job, 'extract', 'running')
        const files = await this.zip.extract(uploadedFile, dest, (n) => this.jobs.step(job, 'extract', 'running', `${n} arquivos`))
        this.jobs.step(job, 'extract', 'done', `${files} arquivos`)
        this.jobs.step(job, 'detect', 'running')
        this.applyDetection(ws, detectMagento(this.rofs, dest))
        this.jobs.step(job, 'detect', ws.status === 'error' ? 'error' : 'done', ws.version)
        if (ws.status === 'error') throw new Error(ws.error)
      } catch (err) {
        this.update(ws, { status: 'error', error: (err as Error).message })
        throw err
      } finally {
        fs.rmSync(uploadedFile, { force: true })
      }
    })
    return { workspace: ws, jobId: job.id }
  }

  configure(id: string, input: { magentoRoot?: string; ownVendors?: string[]; name?: string }) {
    const ws = this.get(id)
    if (input.magentoRoot) this.setRoot(ws, path.resolve(input.magentoRoot))
    if (input.ownVendors) this.update(ws, { ownVendors: input.ownVendors.filter((v) => /^\w+$/.test(v)) })
    if (input.name) this.update(ws, { name: input.name.slice(0, 80) })
    return ws
  }

  detection(id: string) {
    return detectMagento(this.rofs, this.get(id).checkoutDir)
  }

  async sync(id: string, auth: GitAuth) {
    const ws = this.get(id)
    if (ws.source.type !== 'git') throw new BadRequestException('Só instalações via Git podem ser sincronizadas')
    await this.git.fetch(ws.checkoutDir, ws.source.url, auth, ws.source.branch)
    return ws
  }

  /** Removes StoreFlow's own copies. A local source folder is never touched. */
  remove(id: string) {
    const ws = this.get(id)
    const own = [path.join(DIRS.workspaces, id)]
    if (ws.source.type !== 'local') own.push(ws.checkoutDir)
    for (const dir of own) {
      assertWritableTarget(dir, ws.source.type === 'local' ? [ws.checkoutDir] : [])
      fs.rmSync(dir, { recursive: true, force: true })
    }
    this.workspaces = this.workspaces.filter((w) => w.id !== id)
    this.save()
  }
}
