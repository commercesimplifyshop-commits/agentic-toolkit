import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common'
import { Action } from '../readonly/actions'
import { BoardsService, type BoardScene } from './boards.service'

@Controller('workspaces/:id/boards')
export class BoardsController {
  constructor(private readonly boards: BoardsService) {}

  @Get()
  @Action('boards.list')
  list(@Param('id') id: string) {
    return this.boards.list(id)
  }

  @Post()
  @Action('boards.create')
  create(@Param('id') id: string, @Body() body: { name?: string }) {
    return this.boards.create(id, body.name ?? '')
  }

  @Get(':boardId')
  @Action('boards.get')
  get(@Param('id') id: string, @Param('boardId') boardId: string) {
    return this.boards.get(id, boardId)
  }

  @Put(':boardId')
  @Action('boards.save')
  save(@Param('id') id: string, @Param('boardId') boardId: string, @Body() body: { name?: string; scene?: BoardScene }) {
    return this.boards.save(id, boardId, body)
  }

  @Delete(':boardId')
  @Action('boards.delete')
  remove(@Param('id') id: string, @Param('boardId') boardId: string) {
    return this.boards.delete(id, boardId)
  }
}
