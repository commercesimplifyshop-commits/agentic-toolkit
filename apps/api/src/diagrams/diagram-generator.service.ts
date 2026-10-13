import { BadRequestException, Injectable } from '@nestjs/common'
import type { TechId } from '../config/paths'
import { AiService } from '../ai/ai.service'
import { MapStore } from '../analysis/map-store.service'
import { JobsService, type Job } from '../jobs/jobs.service'
import { AuditService } from '../readonly/audit.service'
import { CLAUDE_DENIED_TOOLS, CLAUDE_READONLY_TOOLS, CommandRunner } from '../readonly/command-runner.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { DiagramKind, DiagramsService } from './diagrams.service'
import { parseGraph } from './graph'

export const SCENARIOS = ['b2c', 'b2b', 'd2c', 'marketplace', 'custom'] as const
export type Scenario = (typeof SCENARIOS)[number]

export const MODEL_TYPES = ['c4-context', 'c4-container', 'c4-component', 'uml-class', 'uml-sequence', 'uml-state', 'flow', 'er'] as const
export type ModelType = (typeof MODEL_TYPES)[number]

const ARCHITECT: Record<TechId, string> = {
  'adobe-commerce': 'Você é arquiteto de soluções Magento 2 / Adobe Commerce e desenha modelos de arquitetura.',
  'salesforce-b2c': 'Você é arquiteto de soluções Salesforce B2C Commerce (SFCC) e desenha modelos de arquitetura.',
}

/** Salesforce B2C has its own scenario guide: the Magento marketplace/B2B scenarios do not apply */
const SFCC_GUIDE =
  'Projeto Salesforce B2C Commerce: considere a storefront (SFRA ou PWA Kit), os cartuchos e a ordem de precedência entre eles, controllers e pipelines, templates ISML, jobs, integrações (OCAPI, SCAPI e serviços), sites e a instância. Use só o que o código mostrar.'

const SCENARIO_LABEL: Record<Scenario, string> = { b2c: 'B2C', b2b: 'B2B', d2c: 'D2C', marketplace: 'Marketplace', custom: '' }

const SCENARIO_GUIDE: Record<Scenario, string> = {
  b2c: 'Cenário B2C: o consumidor final compra na vitrine Magento. Considere vitrine, busca (OpenSearch/Elasticsearch), checkout, meios de pagamento, pedidos, ERP, cache (Varnish/Redis), CDN e e-mail/WhatsApp transacional, somente quando fizerem sentido para o pedido.',
  b2b: 'Cenário B2B: empresas compram com contas de cliente. Considere contas de empresa com usuários e permissões, catálogo compartilhado, listas de preço por cliente, cotação e negociação, aprovação de pedido, representantes de vendas e integração com ERP/CRM.',
  d2c: 'Cenário D2C: a marca vende direto ao consumidor pelo próprio site e outros canais. Considere vitrine de marca, assinaturas, programa de fidelidade, CDP/CRM, automação de marketing, PIM, atendimento e frontend headless (PWA ou storefront).',
  marketplace: 'Cenário Marketplace: vários vendedores no mesmo catálogo. Considere portal do vendedor, cadastro e aprovação de vendedores, catálogo por vendedor, pedido dividido por vendedor, split de pagamento, comissão, repasse e frete por vendedor.',
  custom: 'Use exatamente o escopo que o pedido descreve, sem acrescentar componentes que ele não pediu.',
}

const TYPE_GUIDE: Record<ModelType, { kind: DiagramKind; first: string; hint: string }> = {
  'c4-context': { kind: 'c4', first: 'C4Context', hint: 'Modelo C4 de nível 1 (contexto): o sistema, as pessoas que o usam e os sistemas externos. Use Person, System, System_Ext e Rel.' },
  'c4-container': { kind: 'c4', first: 'C4Container', hint: 'Modelo C4 de nível 2 (contêineres): aplicações, serviços, filas e bancos dentro do sistema. Use System_Boundary, Container, ContainerDb, ContainerQueue, System_Ext e Rel.' },
  'c4-component': { kind: 'c4', first: 'C4Component', hint: 'Modelo C4 de nível 3 (componentes): módulos e classes principais dentro de um contêiner. Use Container_Boundary, Component e Rel.' },
  'uml-class': { kind: 'uml', first: 'classDiagram', hint: 'Diagrama de classes UML: classes com atributos e métodos, interfaces e relacionamentos (associação, herança, implementação).' },
  'uml-sequence': { kind: 'uml', first: 'sequenceDiagram', hint: 'Diagrama de sequência UML: atores e participantes, mensagens na ordem em que acontecem, com alt/else quando houver decisão.' },
  'uml-state': { kind: 'uml', first: 'stateDiagram-v2', hint: 'Diagrama de estados UML: estados e transições de um objeto, a partir de [*].' },
  flow: { kind: 'flow', first: 'flowchart', hint: 'Fluxograma: passos, decisões e ordem de execução.' },
  er: { kind: 'other', first: 'erDiagram', hint: 'Diagrama entidade-relacionamento: tabelas, colunas principais e cardinalidade.' },
}

/** Types drawn as an editable canvas (C4 and flow); the others stay Mermaid code. */
const CANVAS_TYPES: ModelType[] = ['c4-context', 'c4-container', 'c4-component', 'flow']

export class GenerationCancelled extends Error {
  constructor() {
    super('Geração cancelada por quem pediu')
  }
}

/**
 * Asks the user's Claude Code (read-only: Read, Grep, Glob, no MCP) to draw an
 * architecture model in Mermaid from the installation's code, then saves it as a
 * diagram in Agentic Toolkit's data dir. Runs as a background job, cancellable.
 */
@Injectable()
export class DiagramGeneratorService {
  private readonly controllers = new Map<string, { workspaceId: string; abort: AbortController }>()

  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly maps: MapStore,
    private readonly jobs: JobsService,
    private readonly runner: CommandRunner,
    private readonly ai: AiService,
    private readonly diagrams: DiagramsService,
    private readonly audit: AuditService,
  ) {}

  /** `saved` runs once the diagram exists, e.g. to link it to a change */
  start(id: string, input: { request: string; scenario: Scenario; type: ModelType }, saved?: (diagram: { id: string; name: string }) => void) {
    const bin = this.ai.claudeBinary()
    if (!bin) throw new BadRequestException('Claude Code não encontrado nesta máquina. Instale-o ou informe o caminho em Configurações.')
    const root = this.workspaces.rootOf(id)
    const job = this.jobs.create('diagram-generate', id, [
      { id: 'write', label: 'Claude Code lendo o código e desenhando o modelo' },
      { id: 'save', label: 'Salvando o diagrama' },
    ])
    const abort = new AbortController()
    this.controllers.set(job.id, { workspaceId: id, abort })
    this.jobs.run(job, async () => {
      try {
        this.jobs.step(job, 'write', 'running')
        const out = await this.write(id, root, bin, input, job, abort.signal)
        this.jobs.step(job, 'write', 'done')
        this.jobs.step(job, 'save', 'running')
        const label = SCENARIO_LABEL[input.scenario]
        const name = `${label ? `${label}: ` : ''}${input.request.trim().replace(/\s+/g, ' ').slice(0, 60)}`
        const diagram = this.diagrams.create(id, { name, kind: TYPE_GUIDE[input.type].kind, mode: out.mode, source: out.source })
        job.result = { diagramId: diagram.id }
        saved?.(diagram)
        this.jobs.step(job, 'save', 'done', diagram.name)
        this.audit.record({ action: 'diagrams.generate', kind: 'data-write', method: 'CLAUDE', url: `diagrama ${diagram.id}`, verdict: 'allowed', detail: `modelo ${input.type} (${input.scenario})` })
      } finally {
        this.controllers.delete(job.id)
      }
    })
    return { jobId: job.id }
  }

  cancel(id: string, jobId: string) {
    const c = this.controllers.get(jobId)
    if (!c || c.workspaceId !== id) return { cancelled: false }
    c.abort.abort()
    return { cancelled: true }
  }

  private async write(id: string, root: string, bin: string, input: { request: string; scenario: Scenario; type: ModelType }, job: Job, signal: AbortSignal): Promise<{ source: string; mode: 'code' | 'canvas' }> {
    const mapsDir = this.maps.dir(id)
    const tech = this.workspaces.get(id).tech
    const guide = TYPE_GUIDE[input.type]
    const canvas = CANVAS_TYPES.includes(input.type)
    const common = [
      ARCHITECT[tech],
      tech === 'salesforce-b2c' ? SFCC_GUIDE : SCENARIO_GUIDE[input.scenario],
      guide.hint,
      'Regras:',
      '- Use o código (Read, Grep, Glob) para nomes reais de módulos, rotas e integrações da instalação. Quando o código não mostrar algo, use um rótulo genérico: não invente integrações.',
      '- Nunca escreva senhas, tokens ou valores de app/etc/env.php.',
      '- Rótulos curtos em português.',
    ]
    const canvasRules = [
      '- Responda SOMENTE com um bloco ```json contendo o objeto {"family": "c4" ou "flow", "nodes": [...], "edges": [...]}. Nada antes nem depois. Não envie posições (x, y).',
      `- family: "${guide.kind === 'flow' ? 'flow' : 'c4'}".`,
      '- Cada nó: {"id", "type", "title", "tech"?, "description"?, "parent"?}. id usa só letras, números, _ ou -. parent é o id de um nó do tipo boundary que o contém.',
      '- Tipos c4: person, system, external, container, db, queue, boundary. Tipos flow: start, process, decision, end, database, external.',
      '- Cada conexão: {"id", "source", "target", "label"?, "tech"?, "dashed"?}. source e target são ids de nós.',
    ]
    const mermaidRules = [
      '- Responda SOMENTE com um bloco ```mermaid contendo o diagrama. Nada antes nem depois.',
      `- A primeira linha do bloco deve ser exatamente "${guide.first}".`,
      '- Sem HTML, sem click, sem links e sem diretivas %%{init}.',
      '- Identificadores sem espaço, acento ou hífen.',
    ]
    const system = [...common, ...(canvas ? canvasRules : mermaidRules)].join('\n')

    const args = [
      '-p',
      '--output-format',
      'json',
      '--tools',
      CLAUDE_READONLY_TOOLS.join(','),
      '--allowedTools',
      CLAUDE_READONLY_TOOLS.join(','),
      '--disallowedTools',
      CLAUDE_DENIED_TOOLS.join(','),
      '--setting-sources',
      'user',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--add-dir',
      mapsDir,
      '--append-system-prompt',
      system,
    ]
    const model = this.ai.settings().claudeCode.model
    if (model) args.push('--model', model)

    const ws = this.workspaces.get(id)
    const ask = `Instalação: ${ws.name} · ${ws.edition ?? 'Magento'} ${ws.version ?? ''} · vendors próprios: ${ws.ownVendors.join(', ') || '—'}\n\nPedido: ${input.request.trim()}`

    this.jobs.log(job, `Modelo: ${guide.first} · cenário ${input.scenario}`)
    const res = await this.runner.run('claude', args, { executable: bin, cwd: root, stdin: ask, timeoutMs: 10 * 60_000, protectedRoots: [root], signal })
    if (signal.aborted) throw new GenerationCancelled()

    let parsed: { result?: string; is_error?: boolean; subtype?: string } = {}
    try {
      parsed = JSON.parse(res.stdout)
    } catch {
      throw new BadRequestException(`Claude Code falhou: ${(res.stderr || res.stdout).slice(0, 300)}`)
    }
    if (parsed.is_error) throw new BadRequestException(`Claude Code: ${(parsed.result ?? parsed.subtype ?? 'erro').slice(0, 300)}`)
    const text = parsed.result ?? ''
    if (canvas) {
      // Canvas: the JSON graph is validated and normalized before it is saved
      const block = text.match(/```json\s*\n([\s\S]*?)```/)
      if (!block) throw new BadRequestException(`O Claude não devolveu o desenho em JSON. Resposta: ${text.slice(0, 200)}`)
      let graph
      try {
        graph = parseGraph(block[1])
      } catch (err) {
        throw new BadRequestException(`O desenho gerado não é válido: ${(err as Error).message}`)
      }
      return { source: JSON.stringify(graph), mode: 'canvas' }
    }
    const block = text.match(/```mermaid\s*\n([\s\S]*?)```/)
    const source = (block ? block[1] : text).trim()
    const firstLine = source.split('\n')[0]?.trim() ?? ''
    if (!firstLine.startsWith(guide.first) && !(guide.first === 'flowchart' && /^graph\b/.test(firstLine))) {
      throw new BadRequestException(`O Claude não devolveu um diagrama ${guide.first}. Resposta: ${text.slice(0, 200)}`)
    }
    if (source.length > 200_000) throw new BadRequestException('Diagrama gerado grande demais')
    return { source, mode: 'code' }
  }
}
