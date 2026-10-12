import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { diskStorage } from 'multer'
import { DIRS } from '../config/paths'
import { Action } from '../readonly/actions'
import type { GitAuth } from './git.service'
import { WorkspacesService } from './workspaces.service'

@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  @Action('workspaces.list')
  list() {
    return this.workspaces.list()
  }

  @Get(':id')
  @Action('workspaces.get')
  get(@Param('id') id: string) {
    return { workspace: this.workspaces.get(id), detection: this.workspaces.detection(id) }
  }

  @Post('inspect')
  @Action('workspaces.inspect')
  inspect(@Body() body: { path: string }) {
    return this.workspaces.inspect(body.path)
  }

  @Post()
  @Action('workspaces.create')
  create(@Body() body: { source: 'local' | 'git'; path?: string; url?: string; branch?: string; name?: string; auth?: GitAuth }) {
    if (body.source === 'local') return this.workspaces.createLocal(body.path!, body.name)
    return this.workspaces.createGit({ url: body.url!, branch: body.branch || undefined, name: body.name, auth: body.auth ?? { method: 'system' } })
  }

  @Post('upload')
  @Action('workspaces.upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({ destination: DIRS.uploads, filename: (_req, _file, cb) => cb(null, `${randomUUID()}.zip`) }),
      limits: { fileSize: 3 * 1024 ** 3 },
      fileFilter: (_req, file, cb) => cb(null, /\.zip$/i.test(file.originalname)),
    }),
  )
  upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Envie um arquivo .zip')
    return this.workspaces.createZip(path.resolve(file.path), file.originalname)
  }

  @Put(':id')
  @Action('workspaces.configure')
  configure(@Param('id') id: string, @Body() body: { magentoRoot?: string; ownVendors?: string[]; name?: string }) {
    return this.workspaces.configure(id, body)
  }

  @Post(':id/sync')
  @Action('workspaces.sync')
  sync(@Param('id') id: string, @Body() body: { auth?: GitAuth }) {
    return this.workspaces.sync(id, body.auth ?? { method: 'system' })
  }

  @Delete(':id')
  @Action('workspaces.delete')
  remove(@Param('id') id: string) {
    this.workspaces.remove(id)
    return { ok: true }
  }
}
