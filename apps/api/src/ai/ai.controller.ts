import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common'
import { Action } from '../readonly/actions'
import { AiService, type AiSettings, type AskTurn } from './ai.service'
import { HarnessService } from './harness.service'

@Controller()
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly harness: HarnessService,
  ) {}

  /** The harness of the configured AI: the runtime, what it loads and how each feature calls it */
  @Get('workspaces/:id/ai/harness')
  @Action('ai.harness')
  harnessView(@Param('id') id: string, @Query('refresh') refresh?: string) {
    return this.harness.view(id, refresh === '1')
  }

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
  ask(@Param('id') id: string, @Body() body: { question: string; cards?: string[]; history?: AskTurn[] }) {
    return this.ai.ask(id, body.question, { cards: body.cards, history: body.history })
  }
}
