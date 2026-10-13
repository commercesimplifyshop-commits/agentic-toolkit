import { Controller, Get, Param } from '@nestjs/common'
import { Action } from '../../readonly/actions'
import { SfccService } from './sfcc.service'

@Controller('workspaces/:id/sfcc')
export class SfccController {
  constructor(private readonly sfcc: SfccService) {}

  @Get('overview')
  @Action('sfcc.overview')
  overview(@Param('id') id: string) {
    return this.sfcc.overview(id)
  }
}
