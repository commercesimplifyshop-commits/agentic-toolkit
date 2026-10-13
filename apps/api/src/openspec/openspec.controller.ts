import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common'
import { Action } from '../readonly/actions'
import { OpenSpecService } from './openspec.service'

@Controller('workspaces/:id/openspec')
export class OpenSpecController {
  constructor(private readonly openspec: OpenSpecService) {}

  @Get()
  @Action('openspec.read')
  overview(@Param('id') id: string) {
    return this.openspec.overview(id)
  }

  @Get('change')
  @Action('openspec.read')
  change(@Param('id') id: string, @Query('name') name: string) {
    return this.openspec.change(id, name)
  }

  @Get('spec')
  @Action('openspec.read')
  spec(@Param('id') id: string, @Query('id') specId: string) {
    return this.openspec.spec(id, specId)
  }

  @Get('prompt')
  @Action('openspec.read')
  prompt(@Param('id') id: string, @Query('kind') kind: string, @Query('change') change?: string) {
    return this.openspec.prompt(id, kind, change)
  }

  @Put('status')
  @Action('openspec.write')
  status(@Param('id') id: string, @Body() body: { kind: 'change' | 'spec'; item: string; status: string | null }) {
    return this.openspec.setStatus(id, body)
  }

  @Put('mapping')
  @Action('openspec.write')
  mapping(@Param('id') id: string, @Body() body: { path: string }) {
    return this.openspec.setMapping(id, body.path ?? '')
  }
}
