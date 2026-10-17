import { Body, Controller, Delete, Get, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import path from 'node:path'
import { CORE_DIR, PORT } from '../config/paths'
import { Action } from '../readonly/actions'
import { CommandRunner } from '../readonly/command-runner.service'
import { StudioService } from './studio.service'

/** The script that starts the server again after it exits (accepted by the runner by its exact path) */
export const RESTART_SCRIPT = path.resolve(__dirname, '..', '..', 'bin', 'restart-server.mjs')

/** Estúdio: development conversations on the Agentic Toolkit or on the workspace's project */
@Controller()
export class StudioController {
  constructor(
    private readonly studio: StudioService,
    private readonly runner: CommandRunner,
  ) {}

  @Get('workspaces/:id/studio')
  @Action('studio.read')
  async list(@Param('id') id: string) {
    return { toolkit: Boolean(this.studio.toolkitRoot()), branches: await this.studio.branches(id), sessions: this.studio.list(id) }
  }

  @Post('workspaces/:id/studio')
  @Action('studio.write')
  create(@Param('id') id: string, @Body() body: { target?: string; title?: string }) {
    return this.studio.create(id, body.target, body.title)
  }

  @Get('workspaces/:id/studio/:sid')
  @Action('studio.read')
  get(@Param('sid') sid: string) {
    return this.studio.get(sid)
  }

  @Delete('workspaces/:id/studio/:sid')
  @Action('studio.write')
  remove(@Param('sid') sid: string) {
    return this.studio.remove(sid)
  }

  @Post('workspaces/:id/studio/:sid/files')
  @Action('studio.write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  attach(@Param('sid') sid: string, @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
    return this.studio.attach(sid, file)
  }

  /** A message to the agent, which works on the code (writes files, commits, pushes the branch) */
  @Post('workspaces/:id/studio/:sid/messages')
  @Action('studio.run')
  send(@Param('sid') sid: string, @Body() body: { text?: string; attachments?: string[]; model?: string; mode?: string; effort?: string; web?: boolean }) {
    return this.studio.send(sid, body)
  }

  @Post('workspaces/:id/studio/:sid/cancel')
  @Action('studio.write')
  cancel(@Param('sid') sid: string) {
    return this.studio.cancel(sid)
  }

  @Get('workspaces/:id/studio/:sid/changes')
  @Action('studio.read')
  changes(@Param('sid') sid: string, @Query('file') file?: string) {
    return this.studio.changes(sid, file)
  }

  /** Starts the server again (after a build of the API): this process exits, a detached one comes back up */
  @Post('studio/restart')
  @Action('studio.restart')
  async restart() {
    if (!this.studio.toolkitRoot()) return { ok: false, error: 'Este servidor não roda de um checkout do Agentic Toolkit' }
    await this.runner.run('node', [RESTART_SCRIPT, '--port', String(PORT), '--log', path.join(CORE_DIR, 'server.log')], { timeoutMs: 15_000 })
    setTimeout(() => process.exit(0), 400)
    return { ok: true }
  }
}
