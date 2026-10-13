import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common'
import { Action } from '../readonly/actions'
import { BoardsService } from '../boards/boards.service'
import { DiagramsService } from '../diagrams/diagrams.service'
import { LinksAssistService } from './links-assist.service'
import { LinksService } from './links.service'
import type { ToolKind } from './tool-catalog'

/** Current titles come from the tools themselves, so a renamed diagram shows its new name here. */
@Controller('workspaces/:id/links')
export class LinksController {
  constructor(
    private readonly links: LinksService,
    private readonly assist: LinksAssistService,
    private readonly diagrams: DiagramsService,
    private readonly boards: BoardsService,
  ) {}

  @Get()
  @Action('links.read')
  list(@Param('id') id: string, @Query() q: { change?: string; kind?: ToolKind; refId?: string }) {
    const current = new Map<string, string>()
    for (const d of this.diagrams.list(id)) current.set(`diagram:${d!.id}`, d!.name)
    for (const b of this.boards.list(id)) current.set(`board:${b!.id}`, b!.name)
    return this.links.list(id, q).map((l) => {
      const title = current.get(`${l.kind}:${l.refId}`)
      return { ...l, title: title ?? l.title, missing: title === undefined }
    })
  }

  /** Links an existing diagram or board to a change */
  @Post()
  @Action('links.add')
  add(@Param('id') id: string, @Body() body: { change: string; kind: ToolKind; refId: string }) {
    const title = body.kind === 'diagram' ? this.diagrams.get(id, body.refId).name : this.boards.get(id, body.refId).name
    return this.links.add(id, { change: body.change, kind: body.kind, refId: body.refId, title, createdBy: 'usuário' })
  }

  @Delete(':linkId')
  @Action('links.remove')
  remove(@Param('id') id: string, @Param('linkId') linkId: string) {
    return this.links.remove(id, linkId)
  }

  /** Claude decides which tools the change needs and they are created and linked */
  @Post('assist')
  @Action('links.assist')
  run(@Param('id') id: string, @Body() body: { change: string }) {
    return this.assist.assist(id, body.change)
  }

  /** Creates the tools Claude proposed in a revision, after the engineer applied it */
  @Post('create')
  @Action('links.create')
  createPlanned(@Param('id') id: string, @Body() body: { change: string; tools: unknown }) {
    return this.assist.create(id, body.change, body.tools)
  }
}
