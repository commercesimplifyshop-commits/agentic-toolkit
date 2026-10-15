import { BadRequestException, Injectable } from '@nestjs/common'
import { ReadOnlyFs } from '../../readonly/readonly-fs.service'
import { WorkspacesService } from '../../workspaces/workspaces.service'
import { sfccOverview, type SfccOverview } from './overview'

/** Salesforce B2C tools: architecture is read from the project, never from the live instance. */
@Injectable()
export class SfccService {
  /** The prompt summary per workspace, kept until the project is analysed again */
  private readonly summaries = new Map<string, { key: string; text: string }>()

  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly rofs: ReadOnlyFs,
  ) {}

  overview(id: string) {
    const ws = this.workspaces.get(id)
    if (ws.tech !== 'salesforce-b2c') throw new BadRequestException('Esta instalação não é Salesforce B2C Commerce')
    if (!ws.root) throw new BadRequestException('Escolha a pasta do projeto antes de consultar a visão geral')
    return sfccOverview(this.rofs, ws.root, ws.name)
  }

  /** The project's structure in a few lines, so Claude starts from it instead of searching blind */
  promptContext(id: string) {
    const ws = this.workspaces.get(id)
    const key = `${ws.root}|${ws.analyzedAt ?? ''}`
    const cached = this.summaries.get(id)
    if (cached?.key === key) return cached.text
    const text = summarize(this.overview(id))
    this.summaries.set(id, { key, text })
    return text
  }
}

const cut = <T>(items: T[], max: number, show: (t: T) => string) => `${items.slice(0, max).map(show).join(', ')}${items.length > max ? `, e mais ${items.length - max}` : ''}`

export function summarize(o: SfccOverview) {
  return [
    'Estrutura do projeto SFCC (lida do código):',
    `- Storefront: ${o.storefront.type}${o.storefront.detail ? ` (${o.storefront.detail})` : ''}`,
    o.cartridges.length ? `- Cartuchos (${o.cartridges.length}): ${cut(o.cartridges, 40, (c) => `${c.name} [${c.controllers} controllers, ${c.templates} templates, ${c.scripts} scripts${c.hooks ? `, ${c.hooks} hooks` : ''}]`)}` : '',
    ...o.cartridgePaths.slice(0, 4).map((cp) => `- Cartridge path do site ${cp.site}: ${cp.path.join(':')}`),
    o.hooks.length ? `- Hooks registrados: ${cut(o.hooks, 30, (h) => `${h.name} (${h.cartridge})`)}` : '',
    o.services.length ? `- Serviços (LocalServiceRegistry): ${cut(o.services, 30, (s) => s)}` : '',
    o.jobs.length ? `- Jobs: ${cut(o.jobs, 30, (j) => j.id)}` : '',
    o.sites.length ? `- Sites: ${cut(o.sites, 20, (s) => s)}` : '',
    o.counts.pipelines ? `- ${o.counts.pipelines} controller(s) em pipeline legado (.ds)` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
