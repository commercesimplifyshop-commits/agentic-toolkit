import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import { Action } from '../readonly/actions'
import { OpenSpecExploreService } from './openspec-explore.service'

/** Explore conversations: refine a task with the code as context. Never writes to the repository. */
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

  /** An image for the conversation (a print of the ticket, of a screen): kept in Agentic Toolkit's data dir */
  @Post('attachments')
  @Action('openspec.explore.attach')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  attach(@Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    return this.explore.saveAttachment(id, file)
  }

  /** Shows an attached image back in the conversation */
  @Get('attachment')
  @Action('openspec.explore.attachment')
  attachment(@Param('id') id: string, @Query('file') file: string, @Res() res: Response) {
    res.sendFile(this.explore.attachmentFile(id, file), { headers: { 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } })
  }

  /** The whole change, written by Claude from the conversation, for the engineer to review */
  @Post('propose')
  @Action('openspec.explore.propose')
  propose(@Param('id') id: string, @Body() body: { sessionId: string }) {
    return this.explore.proposePackage(id, body.sessionId)
  }

  @Post()
  @Action('openspec.explore')
  send(@Param('id') id: string, @Body() body: { sessionId?: string; message?: string; attachments?: { id: string; name?: string }[] }) {
    return this.explore.send(id, body)
  }
}
