import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common'
import { Action } from '../readonly/actions'
import { LinksService } from '../links/links.service'
import { DiagramsService, type DiagramKind } from './diagrams.service'

@Controller('workspaces/:id/diagrams')
export class DiagramsController {
  constructor(
    private readonly diagrams: DiagramsService,
    private readonly links: LinksService,
  ) {}

  @Get()
  @Action('diagrams.list')
  list(@Param('id') id: string) {
    return this.diagrams.list(id)
  }

  @Post()
  @Action('diagrams.create')
  create(@Param('id') id: string, @Body() body: { name?: string; kind?: DiagramKind; source?: string }) {
    return this.diagrams.create(id, body)
  }

  @Get(':diagramId')
  @Action('diagrams.get')
  get(@Param('id') id: string, @Param('diagramId') diagramId: string) {
    return this.diagrams.get(id, diagramId)
  }

  @Put(':diagramId')
  @Action('diagrams.save')
  save(@Param('id') id: string, @Param('diagramId') diagramId: string, @Body() body: { name?: string; kind?: DiagramKind; source?: string }) {
    return this.diagrams.save(id, diagramId, body)
  }

  @Delete(':diagramId')
  @Action('diagrams.delete')
  remove(@Param('id') id: string, @Param('diagramId') diagramId: string) {
    this.links.removeRef(id, 'diagram', diagramId)
    return this.diagrams.delete(id, diagramId)
  }
}
