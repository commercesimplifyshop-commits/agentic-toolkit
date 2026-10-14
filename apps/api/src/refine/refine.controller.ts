import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common'
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

  @Post('cards')
  @Action('refine.write')
  create(@Param('id') id: string, @Body() body: { message?: string; attachments?: Attachments }) {
    return this.refine.create(id, body)
  }

  @Post('cards/:cardId/messages')
  @Action('refine.write')
  message(@Param('id') id: string, @Param('cardId') cardId: string, @Body() body: { message?: string; attachments?: Attachments }) {
    return this.refine.message(id, cardId, body)
  }

  @Post('cards/:cardId/refine')
  @Action('refine.write')
  generate(@Param('id') id: string, @Param('cardId') cardId: string) {
    return this.refine.refine(id, cardId)
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
