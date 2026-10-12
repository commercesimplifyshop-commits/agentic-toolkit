import { Body, Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common'
import type { Response } from 'express'
import { Action } from '../readonly/actions'
import { DocsService, type DocInput } from './docs.service'

@Controller('workspaces/:id/docs')
export class DocsController {
  constructor(private readonly docs: DocsService) {}

  @Get()
  @Action('docs.list')
  list(@Param('id') id: string) {
    return this.docs.list(id)
  }

  @Post()
  @Action('docs.generate')
  generate(@Param('id') id: string, @Body() body: DocInput & { regenerate?: string }) {
    return this.docs.generate(id, body, body.regenerate)
  }

  @Get(':docId')
  @Action('docs.get')
  get(@Param('id') id: string, @Param('docId') docId: string) {
    return this.docs.get(id, docId)
  }

  @Post(':docId/publish')
  @Action('docs.publish')
  publish(@Param('id') id: string, @Param('docId') docId: string) {
    return this.docs.publish(id, docId)
  }

  @Post(':docId/cancel')
  @Action('docs.cancel')
  cancel(@Param('id') id: string, @Param('docId') docId: string) {
    return this.docs.cancel(id, docId)
  }

  @Get(':docId/export')
  @Action('docs.export')
  async export(@Param('id') id: string, @Param('docId') docId: string, @Query('format') format: 'docx' | 'pdf', @Res() res: Response) {
    const { body, fileName } = await this.docs.export(id, docId, format)
    res.setHeader('Content-Type', format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
    res.send(body)
  }

  @Delete(':docId')
  @Action('docs.delete')
  remove(@Param('id') id: string, @Param('docId') docId: string) {
    return this.docs.delete(id, docId)
  }
}
