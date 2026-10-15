import { Body, Controller, Get, Param, Put } from '@nestjs/common'
import { Action } from '../readonly/actions'
import { SkillsService } from './skills.service'

/** Configurações → IA → Skills */
@Controller('skills')
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Get()
  @Action('skills.read')
  list() {
    return this.skills.view()
  }

  @Get(':skillId')
  @Action('skills.read')
  content(@Param('skillId') skillId: string) {
    return { id: skillId, content: this.skills.content(skillId) }
  }

  @Put('settings')
  @Action('skills.write')
  update(@Body() body: { enabled?: boolean; skills?: Record<string, boolean> }) {
    return this.skills.update(body ?? {})
  }
}
