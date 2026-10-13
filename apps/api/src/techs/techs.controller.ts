import { Controller, Get } from '@nestjs/common'
import { Action } from '../readonly/actions'
import { TECHS } from './registry'

@Controller('techs')
export class TechsController {
  /** The technologies this installation of Agentic Toolkit supports, for the setup screen */
  @Get()
  @Action('techs.list')
  list() {
    return TECHS
  }
}
