import { BadRequestException, Injectable } from '@nestjs/common'
import fs from 'node:fs'
import path from 'node:path'
import { ANALYZER_DIR, techDirs } from '../config/paths'
import { ReadOnlyFs } from '../readonly/readonly-fs.service'
import { sfccOverview } from '../techs/sfcc/overview'
import { CodeIndexService } from '../files/code-index.service'
import { JobsService } from '../jobs/jobs.service'
import { CommandRunner } from '../readonly/command-runner.service'
import { assertWritableTarget } from '../readonly/path-guard'
import { WorkspacesService, type Workspace } from '../workspaces/workspaces.service'
import { MapStore } from './map-store.service'
import { OverviewService } from './overview.service'

@Injectable()
export class AnalysisService {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly jobs: JobsService,
    private readonly runner: CommandRunner,
    private readonly overview: OverviewService,
    private readonly maps: MapStore,
    private readonly codeIndex: CodeIndexService,
    private readonly rofs: ReadOnlyFs,
  ) {}

  /** Sparse checkout of the public core at the installation's tag (shared across workspaces). */
  private async ensureReference(version: string | undefined, log: (l: string) => void): Promise<string | null> {
    const m = version?.match(/^\d+\.\d+\.\d+(-p\d+)?/)
    if (!m) return null
    for (const tag of [m[0], m[0].replace(/-p\d+$/, '')]) {
      const dir = path.join(techDirs('adobe-commerce').reference, `magento2-${tag}`)
      if (fs.existsSync(path.join(dir, 'app', 'code', 'Magento'))) return dir
      const res = await this.runner.run('node', [path.join(ANALYZER_DIR, 'native-reference.mjs'), tag, '--dir', dir], { onLine: log, timeoutMs: 20 * 60_000 })
      if (res.code === 0) return dir
      log(`tag ${tag} indisponível, tentando a próxima…`)
      fs.rmSync(dir, { recursive: true, force: true })
    }
    return null
  }

  /** Salesforce B2C has no extractor to run: the overview is read from the project on demand, so this only confirms it can be read. */
  private runSalesforce(ws: Workspace) {
    const job = this.jobs.create('analysis', ws.id, [
      { id: 'scan', label: 'Lendo cartuchos, controllers, templates, jobs e integrações' },
      { id: 'save', label: 'Conferindo a visão geral' },
    ])
    this.workspaces.update(ws, { status: 'analyzing', jobId: job.id })
    this.jobs.run(job, async () => {
      try {
        this.jobs.step(job, 'scan', 'running')
        const overview = sfccOverview(this.rofs, ws.root!, ws.name)
        this.jobs.step(job, 'scan', 'done', `${overview.counts.cartridges} cartucho(s), ${overview.counts.controllers} controller(s)`)
        this.jobs.step(job, 'save', 'done')
        this.workspaces.update(ws, { status: 'analyzed', analyzedAt: new Date().toISOString(), error: undefined })
      } catch (err) {
        this.workspaces.update(ws, { status: 'error', error: (err as Error).message })
        throw err
      }
    })
    return { jobId: job.id }
  }

  run(id: string) {
    const ws = this.workspaces.get(id)
    if (!ws.root) throw new BadRequestException('Escolha a raiz do projeto antes de analisar')
    if (ws.status === 'analyzing' && ws.jobId && this.jobs.get(ws.jobId)?.status === 'running') return { jobId: ws.jobId }
    if (ws.tech === 'salesforce-b2c') return this.runSalesforce(ws)

    const job = this.jobs.create('analysis', id, [
      { id: 'reference', label: `Referência pública do core ${ws.version ?? ''}` },
      { id: 'extract', label: 'Mapeando APIs, plugins, observers, rotas, crons e filas' },
      { id: 'overview', label: 'Calculando a visão geral' },
    ])
    this.workspaces.update(ws, { status: 'analyzing', jobId: job.id })
    const root = ws.root
    // the code may have changed (sync, local edits): rebuild the search index lazily
    this.codeIndex.invalidate(root)
    const out = this.maps.dir(id)
    assertWritableTarget(out, [root])

    this.jobs.run(job, async () => {
      try {
        const log = (l: string) => this.jobs.log(job, l)
        this.jobs.step(job, 'reference', 'running')
        const reference = await this.ensureReference(ws.version, log)
        this.jobs.step(job, 'reference', reference ? 'done' : 'skipped', reference ? path.basename(reference) : 'sem referência: só customizações serão mapeadas')

        this.jobs.step(job, 'extract', 'running')
        const args = [path.join(ANALYZER_DIR, 'extract.mjs'), root, '--name', id, '--out', out]
        if (reference) args.push('--native', reference)
        if (ws.ownVendors.length) args.push('--own', ws.ownVendors.join(','))
        const res = await this.runner.run('node', args, { onLine: log, protectedRoots: [root], timeoutMs: 20 * 60_000 })
        if (res.code !== 0) throw new Error(res.stderr.trim().split('\n').slice(-2).join(' ') || 'Falha no extrator')
        this.jobs.step(job, 'extract', 'done', res.stdout.split('\n').find((l) => l.includes('pontos de integração')))

        this.jobs.step(job, 'overview', 'running')
        await this.overview.compute(id, { refresh: true })
        this.jobs.step(job, 'overview', 'done')
        this.workspaces.update(ws, { status: 'analyzed', analyzedAt: new Date().toISOString(), error: undefined })
      } catch (err) {
        this.workspaces.update(ws, { status: 'error', error: (err as Error).message })
        throw err
      }
    })
    return { jobId: job.id }
  }
}
