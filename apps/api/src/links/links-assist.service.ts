import { BadRequestException, Injectable } from '@nestjs/common'
import { AiService } from '../ai/ai.service'
import { BoardsService } from '../boards/boards.service'
import { DiagramGeneratorService } from '../diagrams/diagram-generator.service'
import { CommandRunner } from '../readonly/command-runner.service'
import { OpenSpecAuthoringService } from '../openspec/openspec-authoring.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { askClaudeReadonly } from './claude-call'
import { LinksService } from './links.service'
import { TOOL_CATALOG } from './tool-catalog'
import { MAX_PLANS, parseJsonReply, sanitizePlans, type ToolPlan } from './tool-plan'

export interface ToolResult {
  kind: ToolPlan['kind']
  ok: boolean
  title: string
  reason: string
  /** diagram: background job that draws it; it is linked to the change when it finishes */
  jobId?: string
  /** board: created at once and linked */
  refId?: string
  error?: string
}

/**
 * Asks Claude which Agentic Toolkit tools a change needs, then creates them and links them to the
 * change. "Automático": the creation runs without a second confirmation, and each result shows
 * what was made so it can be unlinked from the change.
 */
@Injectable()
export class LinksAssistService {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly ai: AiService,
    private readonly runner: CommandRunner,
    private readonly openspec: OpenSpecAuthoringService,
    private readonly links: LinksService,
    private readonly boards: BoardsService,
    private readonly generator: DiagramGeneratorService,
  ) {}

  /** Reads the change and returns what it needs; creates nothing */
  async suggest(id: string, change: string): Promise<ToolPlan[]> {
    const bin = this.ai.claudeBinary()
    if (!bin) throw new BadRequestException('Claude Code não encontrado nesta máquina. Instale-o ou informe o caminho em Configurações.')
    const root = this.workspaces.rootOf(id)
    const dir = this.openspec.changeDir(id, change)
    const proposal = this.openspec.read(id, `${dir}/proposal.md`).content
    let tasks = ''
    try {
      tasks = this.openspec.read(id, `${dir}/tasks.md`).content
    } catch {
      tasks = ''
    }
    const system = [
      'Você decide quais ferramentas do Agentic Toolkit uma mudança do OpenSpec precisa.',
      'Leia o código (Read, Grep, Glob) quando precisar de nomes reais de módulos, rotas ou integrações.',
      `Responda SOMENTE com JSON no formato {"tools": [...]}, com no máximo ${MAX_PLANS} itens, sem texto antes ou depois.`,
      'Cada item é {"kind": "diagram", "type": "...", "request": "...", "reason": "..."} ou {"kind": "board", "name": "...", "reason": "..."}.',
      'Se a mudança não precisa de nenhuma ferramenta, responda {"tools": []}.',
      TOOL_CATALOG,
    ].join('\n')
    const prompt = `Proposta:\n${proposal}\n\nTarefas:\n${tasks || '(sem tarefas)'}`
    const reply = await askClaudeReadonly(this.runner, bin, root, system, prompt)
    const parsed = parseJsonReply(reply)
    if (!parsed || !Array.isArray(parsed.tools)) throw new BadRequestException('O Claude não devolveu as ferramentas no formato esperado. Tente de novo.')
    return sanitizePlans(parsed.tools)
  }

  /** Creates the tools and links each one to the change. Failures are reported per item. */
  create(id: string, change: string, plans: unknown): ToolResult[] {
    return sanitizePlans(plans).map((p): ToolResult => {
      try {
        if (p.kind === 'board') {
          const board = this.boards.create(id, p.name ?? 'Quadro da mudança')
          this.links.add(id, { change, kind: 'board', refId: board.id, title: board.name, createdBy: 'claude' })
          return { kind: 'board', ok: true, title: board.name, reason: p.reason, refId: board.id }
        }
        const { jobId } = this.generator.start(id, { request: p.request ?? '', scenario: 'custom', type: p.type! }, (diagram) =>
          this.links.add(id, { change, kind: 'diagram', refId: diagram.id, title: diagram.name, createdBy: 'claude' }),
        )
        return { kind: 'diagram', ok: true, title: p.request ?? '', reason: p.reason, jobId }
      } catch (e) {
        return { kind: p.kind, ok: false, title: p.request ?? p.name ?? '', reason: p.reason, error: (e as Error).message }
      }
    })
  }

  async assist(id: string, change: string) {
    const plans = await this.suggest(id, change)
    return { plans, results: this.create(id, change, plans) }
  }
}
