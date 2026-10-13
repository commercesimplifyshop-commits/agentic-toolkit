import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common'
import { Action } from '../readonly/actions'
import { OpenSpecAuthoringService } from './openspec-authoring.service'

/** Authoring endpoints: each write is one of the exceptions listed in repo-exceptions.ts. */
@Controller('workspaces/:id/openspec')
export class OpenSpecAuthoringController {
  constructor(private readonly authoring: OpenSpecAuthoringService) {}

  @Get('file')
  @Action('openspec.read')
  file(@Param('id') id: string, @Query('path') path: string) {
    return this.authoring.read(id, path)
  }

  @Put('file')
  @Action('openspec.save')
  save(@Param('id') id: string, @Body() body: { path: string; content: string; expectedSha?: string; create?: boolean }) {
    return this.authoring.save(id, body)
  }

  @Post('change')
  @Action('openspec.save')
  createChange(
    @Param('id') id: string,
    @Body() body: { name: string; why: string; whatChanges: string[]; newCapabilities: string[]; modifiedCapabilities: string[]; purposes?: Record<string, string> },
  ) {
    return this.authoring.createChange(id, body)
  }

  @Post('change/skip')
  @Action('openspec.save')
  skipSpecs(@Param('id') id: string, @Body() body: { name: string; skip: boolean }) {
    return this.authoring.setSkipSpecs(id, body.name, Boolean(body.skip))
  }

  @Post('spec')
  @Action('openspec.save')
  createSpec(@Param('id') id: string, @Body() body: { capability: string; purpose: string }) {
    return this.authoring.createSpec(id, body)
  }

  @Delete('change')
  @Action('openspec.delete')
  deleteChange(@Param('id') id: string, @Query('name') name: string, @Query('confirm') confirm: string) {
    return this.authoring.deleteChange(id, name, confirm)
  }

  @Post('install/preview')
  @Action('openspec.install.preview')
  installPreview(@Param('id') id: string) {
    return this.authoring.installPreview(id)
  }

  @Post('install/apply')
  @Action('openspec.install')
  installApply(@Param('id') id: string, @Body() body: { planId: string }) {
    return this.authoring.installApply(id, body.planId)
  }

  @Post('revise')
  @Action('openspec.revise')
  revise(@Param('id') id: string, @Body() body: { path: string; instruction: string }) {
    return this.authoring.revise(id, body)
  }

  @Post('draft')
  @Action('openspec.draft')
  draft(@Param('id') id: string, @Body() body: { kind: 'proposal' | 'tasks' | 'spec'; request: string; capability?: string }) {
    return this.authoring.draft(id, body)
  }
}
