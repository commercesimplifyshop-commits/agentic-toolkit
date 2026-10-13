import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common'
import { Action } from '../readonly/actions'
import { OpenSpecExploreService } from './openspec-explore.service'

/** Explore conversations: think about an idea with the code as context. Never writes to the repository. */
@Controller('workspaces/:id/openspec/explore')
export class OpenSpecExploreController {
  constructor(private readonly explore: OpenSpecExploreService) {}

  @Get('sessions')
  @Action('openspec.explore.read')
  sessions(@Param('id') id: string) {
    return this.explore.sessions(id)
  }

  @Get('connection')
  @Action('openspec.explore.read')
  connection(@Param('id') id: string) {
    return this.explore.connection(id)
  }

  @Get('session')
  @Action('openspec.explore.read')
  session(@Param('id') id: string, @Query('id') sid: string) {
    return this.explore.session(id, sid)
  }

  @Put('session')
  @Action('openspec.explore.link')
  link(@Param('id') id: string, @Body() body: { id: string; linkedChange: string }) {
    return this.explore.link(id, body.id, body.linkedChange)
  }

  @Delete('session')
  @Action('openspec.explore.delete')
  remove(@Param('id') id: string, @Query('id') sid: string) {
    return this.explore.remove(id, sid)
  }

  @Post('propose')
  @Action('openspec.explore.propose')
  propose(@Param('id') id: string, @Body() body: { sessionId: string }) {
    return this.explore.proposeDraft(id, body.sessionId)
  }

  @Post()
  @Action('openspec.explore')
  send(@Param('id') id: string, @Body() body: { sessionId?: string; message: string }) {
    return this.explore.send(id, body)
  }
}
