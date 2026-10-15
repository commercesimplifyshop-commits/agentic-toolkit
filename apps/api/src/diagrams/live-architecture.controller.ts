import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common'
import { Action } from '../readonly/actions'
import { LiveArchitectureService } from './live-architecture.service'

/** Arquitetura → Arquitetura viva: the platform drawn from the mapping, and Claude's richer version */
@Controller('workspaces/:id/architecture')
export class LiveArchitectureController {
  constructor(private readonly live: LiveArchitectureService) {}

  @Get('live')
  @Action('architecture.read')
  view(@Param('id') id: string) {
    return this.live.view(id)
  }

  @Put('live/positions')
  @Action('architecture.write')
  positions(@Param('id') id: string, @Body() body: { positions?: Record<string, { x: number; y: number }> }) {
    return this.live.savePositions(id, body?.positions)
  }

  @Delete('live/positions')
  @Action('architecture.write')
  reset(@Param('id') id: string) {
    return this.live.resetPositions(id)
  }

  @Put('live/settings')
  @Action('architecture.write')
  settings(@Param('id') id: string, @Body() body: { autoClaude?: boolean }) {
    return this.live.setAuto(id, body?.autoClaude)
  }

  @Post('live/diagram')
  @Action('architecture.write')
  toDiagram(@Param('id') id: string, @Body() body: { from?: 'live' | 'claude' }) {
    return this.live.toDiagram(id, body?.from)
  }

  @Post('live/claude')
  @Action('architecture.claude')
  claude(@Param('id') id: string) {
    return this.live.drawWithClaude(id)
  }
}
