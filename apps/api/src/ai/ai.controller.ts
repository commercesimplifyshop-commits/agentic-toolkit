import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common'
import { Action } from '../readonly/actions'
import { AiService, type AiSettings } from './ai.service'

@Controller()
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('ai/providers')
  @Action('ai.providers')
  providers() {
    return this.ai.providers()
  }

  @Put('ai/settings')
  @Action('ai.settings')
  settings(@Body() body: Partial<AiSettings> & { anthropicApiKey?: string; openaiApiKey?: string }) {
    return this.ai.saveSettings(body)
  }

  @Post('workspaces/:id/ask')
  @Action('ai.ask')
  ask(@Param('id') id: string, @Body() body: { question: string }) {
    return this.ai.ask(id, body.question)
  }
}
