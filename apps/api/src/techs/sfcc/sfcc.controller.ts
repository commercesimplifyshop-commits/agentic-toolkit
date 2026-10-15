import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { Action } from '../../readonly/actions'
import { SfccService } from './sfcc.service'
import { SfccUploadService } from './upload.service'

@Controller('workspaces/:id/sfcc')
export class SfccController {
  constructor(
    private readonly sfcc: SfccService,
    private readonly upload: SfccUploadService,
  ) {}

  @Get('overview')
  @Action('sfcc.overview')
  overview(@Param('id') id: string) {
    return this.sfcc.overview(id)
  }

  @Get('upload')
  @Action('sfcc.upload.read')
  uploadStatus(@Param('id') id: string, @Query('card') card?: string) {
    return this.upload.status(id, card || undefined)
  }

  @Post('upload')
  @Action('sfcc.upload.run')
  startUpload(@Param('id') id: string, @Body() body: { cardId?: string; cartridges?: string[]; mode?: 'upload' | 'watch' }) {
    return this.upload.start(id, body ?? {})
  }

  @Post('upload/stop')
  @Action('sfcc.upload.run')
  stopUpload(@Param('id') id: string) {
    return this.upload.stop(id)
  }
}
