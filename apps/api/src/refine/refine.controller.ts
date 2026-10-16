import { Body, Controller, Delete, Get, Headers, Param, Post, Put, Query } from '@nestjs/common'
import { Action } from '../readonly/actions'
import { RefineService, type Refinement, type Split } from './refine.service'

type Attachments = { id: string; name?: string }[]

/** Refinement cards: demand → refined card → branch and worktree → development by Claude */
@Controller('workspaces/:id/refine')
export class RefineController {
  constructor(private readonly refine: RefineService) {}

  @Get('cards')
  @Action('refine.read')
  list(@Param('id') id: string) {
    return this.refine.list(id)
  }

  @Get('cards/:cardId')
  @Action('refine.read')
  get(@Param('id') id: string, @Param('cardId') cardId: string) {
    return this.refine.get(id, cardId)
  }

  /** Attaches a diagram of the toolkit to the task (from the screen, the assistant or the MCP) */
  @Post('cards/:cardId/attached')
  @Action('refine.write')
  attach(@Param('id') id: string, @Param('cardId') cardId: string, @Body() body: { kind?: string; refId?: string }, @Headers('x-agentic-client') client?: string) {
    return this.refine.attach(id, cardId, body, client === 'mcp' ? 'IA via MCP' : client === 'assistente' ? 'assistente' : 'usuário')
  }

  @Delete('cards/:cardId/attached/:refId')
  @Action('refine.write')
  detach(@Param('id') id: string, @Param('cardId') cardId: string, @Param('refId') refId: string) {
    return this.refine.detach(id, cardId, refId)
  }

  @Post('cards')
  @Action('refine.write')
  create(@Param('id') id: string, @Body() body: { message?: string; attachments?: Attachments }, @Query('async') background?: string) {
    // ?async=1: the card comes back at once and Claude answers in the background (the assistant and the MCP use it)
    return this.refine.create(id, body, background === '1')
  }

  @Post('cards/:cardId/messages')
  @Action('refine.write')
  message(@Param('id') id: string, @Param('cardId') cardId: string, @Body() body: { message?: string; attachments?: Attachments }, @Query('async') background?: string) {
    return this.refine.message(id, cardId, body, background === '1')
  }

  @Post('cards/:cardId/refine')
  @Action('refine.write')
  generate(@Param('id') id: string, @Param('cardId') cardId: string, @Query('async') background?: string) {
    return this.refine.refine(id, cardId, background === '1')
  }

  @Put('cards/:cardId')
  @Action('refine.write')
  update(@Param('id') id: string, @Param('cardId') cardId: string, @Body() body: Partial<Pick<Refinement, 'business' | 'technical' | 'plan' | 'acceptance' | 'observations'>> & { title?: string }) {
    return this.refine.update(id, cardId, body)
  }

  @Post('cards/:cardId/split')
  @Action('refine.write')
  split(@Param('id') id: string, @Param('cardId') cardId: string, @Body() body: { splits: Split[] }) {
    return this.refine.split(id, cardId, body.splits)
  }

  @Delete('cards/:cardId')
  @Action('refine.write')
  remove(@Param('id') id: string, @Param('cardId') cardId: string) {
    return this.refine.remove(id, cardId)
  }

  @Post('cards/:cardId/git')
  @Action('refine.git')
  prepareGit(@Param('id') id: string, @Param('cardId') cardId: string, @Body() body: { mode: 'new' | 'existing'; branch: string; base?: string; updateBase?: boolean }) {
    return this.refine.prepareGit(id, cardId, body)
  }

  @Post('cards/:cardId/develop')
  @Action('refine.develop')
  develop(@Param('id') id: string, @Param('cardId') cardId: string) {
    return this.refine.develop(id, cardId)
  }

  @Post('cards/:cardId/cancel')
  @Action('refine.develop')
  cancel(@Param('id') id: string, @Param('cardId') cardId: string) {
    return this.refine.cancel(id, cardId)
  }
}
