import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common'
import { Action } from '../readonly/actions'
import type { GitAuth } from '../workspaces/git.service'
import { WorkspaceSettingsService, type SettingsPatch } from './workspace-settings.service'

/** Configurações → Workspace, and the prerequisites each feature checks */
@Controller('workspaces/:id')
export class WorkspaceSettingsController {
  constructor(private readonly settings: WorkspaceSettingsService) {}

  @Get('settings')
  @Action('workspace.settings.read')
  view(@Param('id') id: string) {
    return this.settings.view(id)
  }

  @Put('settings')
  @Action('workspace.settings.write')
  update(@Param('id') id: string, @Body() body: SettingsPatch) {
    return this.settings.update(id, body ?? {})
  }

  @Post('settings/sync')
  @Action('workspace.settings.sync')
  sync(@Param('id') id: string, @Body() body: { auth?: GitAuth }) {
    return this.settings.sync(id, body?.auth)
  }

  @Get('prerequisites')
  @Action('workspace.prerequisites')
  prerequisites(@Param('id') id: string) {
    return this.settings.prerequisites(id)
  }
}
