import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { CORE_DIR, DEFAULT_TECH, techDirs, type TechId } from '../config/paths'
import { JobsService } from '../jobs/jobs.service'
import { assertDataDirOutside, assertWritableTarget, isInside, ReadOnlyViolation } from '../readonly/path-guard'
import { ReadOnlyFs } from '../readonly/readonly-fs.service'
import { detectTech } from '../techs/detect'
import { techInfo } from '../techs/registry'
import type { Detection } from '../techs/types'
import { GitService, sanitizeUrl, type GitAuth } from './git.service'
import { readVersion, vendorsOf } from './magento-detector'
import { ZipService } from './zip.service'

export type WorkspaceSource =
  | { type: 'local'; path: string }
  | { type: 'git'; url: string; branch?: string; authMethod: GitAuth['method'] }
  | { type: 'zip'; fileName: string }

export interface Workspace {
  id: string
  name: string
  /** Which technology this installation is: decides its detector, overview, sidebar and data folder */
  tech: TechId
  source: WorkspaceSource
  /** Where the code lives: the local folder itself, or Agentic Toolkit's clone/extraction */
  checkoutDir: string
  /** Project root inside checkoutDir (the Magento root, or the folder with cartridges/ for Salesforce) */
  root?: string
  edition?: string
  version?: string
  ownVendors: string[]
  /** Git repository used by Git and by the development of tasks, when it is not the folder that holds the project */
  repoPath?: string
  status: 'connecting' | 'needs-root' | 'ready' | 'analyzing' | 'analyzed' | 'error'
  error?: string
  jobId?: string
  createdAt: string
  analyzedAt?: string
}

const STORE = path.join(CORE_DIR, 'workspaces.json')

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^\w]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'projeto'

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
      const list = JSON.parse(fs.readFileSync(STORE, 'utf8')) as Workspace[]
      // installations created before technologies existed are Adobe Commerce
      this.workspaces = list.map((w) => ({ ...w, tech: w.tech ?? DEFAULT_TECH }))
    } catch {
      this.workspaces = []
    }
  }

  private save() {
    fs.mkdirSync(CORE_DIR, { recursive: true })
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

  /** Project root of a ready workspace. Used by every validator that reads code. */
  rootOf(id: string) {
    const ws = this.get(id)
    if (!ws.root) throw new ReadOnlyViolation('Instalação ainda sem raiz definida', 'workspace.no-root')
    return ws.root
  }

  dataDirOf(id: string) {
    const ws = this.get(id)
    const dir = path.join(techDirs(ws.tech).workspaces, id)
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
  inspect(dir: string, tech: TechId = DEFAULT_TECH): Detection {
    return detectTech(tech, this.rofs, dir)
  }

  private applyDetection(ws: Workspace, detection: Detection) {
    if (detection.match) {
      this.setRoot(ws, detection.path)
    } else if (detection.candidates.length === 1) {
      this.setRoot(ws, detection.candidates[0].path)
    } else {
      const label = techInfo(ws.tech).name
      this.update(ws, {
        status: detection.candidates.length ? 'needs-root' : 'error',
        error: detection.candidates.length ? undefined : `Nenhuma instalação de ${label} encontrada nesta origem`,
      })
    }
  }

  private setRoot(ws: Workspace, root: string) {
    if (!isInside(ws.checkoutDir, root)) throw new BadRequestException('A raiz precisa estar dentro da origem conectada')
    assertDataDirOutside(root)
    const detection = detectTech(ws.tech, this.rofs, root)
    if (!detection.match) {
      throw new BadRequestException(`A pasta escolhida não parece ser ${techInfo(ws.tech).name} (${detection.confidence}% de confiança)`)
    }
    if (ws.tech === 'adobe-commerce') {
      const { edition, version } = readVersion(this.rofs, root)
      const ownVendors = ws.ownVendors.length ? ws.ownVendors : vendorsOf(this.rofs, root).map((v) => v.name)
      this.update(ws, { root, edition, version, ownVendors, status: 'ready', error: undefined })
    } else {
      this.update(ws, { root, edition: detection.edition, version: detection.version, status: 'ready', error: undefined })
    }
  }

  createLocal(dir: string, name?: string, tech: TechId = DEFAULT_TECH) {
    const root = path.resolve(dir)
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new BadRequestException(`Pasta não encontrada: ${root}`)
    assertDataDirOutside(root)
    const ws: Workspace = {
      id: this.newId(name ?? path.basename(root)),
      name: name ?? path.basename(root),
      tech,
      source: { type: 'local', path: root },
      checkoutDir: root,
      ownVendors: [],
      status: 'connecting',
      createdAt: new Date().toISOString(),
    }
    this.workspaces.push(ws)
    this.applyDetection(ws, detectTech(tech, this.rofs, root))
    this.save()
    return { workspace: ws, detection: detectTech(tech, this.rofs, root) }
  }

  createGit(input: { url: string; branch?: string; name?: string; auth: GitAuth; tech?: TechId }) {
    const tech = input.tech ?? DEFAULT_TECH
    const url = sanitizeUrl(input.url.trim())
    const name = input.name ?? url.split('/').pop()?.replace(/\.git$/, '') ?? 'projeto'
    const id = this.newId(name)
    const dest = path.join(techDirs(tech).repos, id)
    assertWritableTarget(dest)
    const job = this.jobs.create('clone', id, [
      { id: 'access', label: 'Verificando acesso ao repositório' },
      { id: 'clone', label: 'Clonando (somente leitura, depth 1)' },
      { id: 'detect', label: `Validando a instalação de ${techInfo(tech).name}` },
    ])
    const ws: Workspace = {
      id,
      name,
      tech,
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
        this.applyDetection(ws, detectTech(tech, this.rofs, dest))
        this.jobs.step(job, 'detect', ws.status === 'error' ? 'error' : 'done', ws.status === 'needs-root' ? 'Escolha a pasta da instalação' : ws.version)
        if (ws.status === 'error') throw new Error(ws.error)
      } catch (err) {
        this.update(ws, { status: 'error', error: (err as Error).message })
        throw err
      }
    })
    return { workspace: ws, jobId: job.id }
  }

  createZip(uploadedFile: string, originalName: string, tech: TechId = DEFAULT_TECH) {
    const name = originalName.replace(/\.zip$/i, '')
    const id = this.newId(name)
    const dest = path.join(techDirs(tech).uploads, id)
    const job = this.jobs.create('unzip', id, [
      { id: 'extract', label: 'Extraindo o .zip no diretório de dados' },
      { id: 'detect', label: `Validando a instalação de ${techInfo(tech).name}` },
    ])
    const ws: Workspace = {
      id,
      name,
      tech,
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
        this.applyDetection(ws, detectTech(tech, this.rofs, dest))
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

  configure(id: string, input: { root?: string; ownVendors?: string[]; name?: string }) {
    const ws = this.get(id)
    if (input.root) this.setRoot(ws, path.resolve(input.root))
    if (input.ownVendors) this.update(ws, { ownVendors: input.ownVendors.filter((v) => /^\w+$/.test(v)) })
    if (input.name) this.update(ws, { name: input.name.slice(0, 80) })
    return ws
  }

  /**
   * Points the workspace at a local folder (the engineer's own clone, for example), instead of the
   * copy it was made from. The copy the Agentic Toolkit made (clone or .zip) is deleted; the
   * project root is detected again in the new folder.
   */
  linkLocal(id: string, dir: string) {
    const ws = this.get(id)
    const folder = path.resolve(dir)
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new BadRequestException(`Pasta não encontrada: ${folder}`)
    assertDataDirOutside(folder)
    const previous = ws.source.type === 'local' ? null : ws.checkoutDir
    this.update(ws, { source: { type: 'local', path: folder }, checkoutDir: folder, root: undefined, status: 'connecting', error: undefined, jobId: undefined })
    this.applyDetection(ws, detectTech(ws.tech, this.rofs, folder))
    if (previous && previous !== folder) {
      try {
        assertWritableTarget(previous)
        fs.rmSync(previous, { recursive: true, force: true })
      } catch {
        // a leftover copy in the data dir is harmless
      }
    }
    return ws
  }

  /** The git repository for Git and development; empty means "the one that contains the project" */
  setRepoPath(id: string, dir: string | undefined) {
    const ws = this.get(id)
    if (!dir) return this.update(ws, { repoPath: undefined })
    const folder = path.resolve(dir)
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new BadRequestException(`Pasta não encontrada: ${folder}`)
    assertDataDirOutside(folder)
    return this.update(ws, { repoPath: folder })
  }

  detection(id: string) {
    const ws = this.get(id)
    return detectTech(ws.tech, this.rofs, ws.checkoutDir)
  }

  async sync(id: string, auth: GitAuth) {
    const ws = this.get(id)
    if (ws.source.type !== 'git') throw new BadRequestException('Só instalações via Git podem ser sincronizadas')
    await this.git.fetch(ws.checkoutDir, ws.source.url, auth, ws.source.branch)
    return ws
  }

  /** Removes Agentic Toolkit's own copies. A local source folder is never touched. */
  remove(id: string) {
    const ws = this.get(id)
    const own = [path.join(techDirs(ws.tech).workspaces, id)]
    if (ws.source.type !== 'local') own.push(ws.checkoutDir)
    for (const dir of own) {
      assertWritableTarget(dir, ws.source.type === 'local' ? [ws.checkoutDir] : [])
      fs.rmSync(dir, { recursive: true, force: true })
    }
    this.workspaces = this.workspaces.filter((w) => w.id !== id)
    this.save()
  }
}
