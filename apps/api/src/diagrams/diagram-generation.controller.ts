import { Body, Controller, Param, Post } from '@nestjs/common'
import { Action } from '../readonly/actions'
import { DiagramGeneratorService, type ModelType, type Scenario } from './diagram-generator.service'

@Controller('workspaces/:id/diagrams/generate')
export class DiagramGenerationController {
  constructor(private readonly generator: DiagramGeneratorService) {}

  @Post()
  @Action('diagrams.generate')
  start(@Param('id') id: string, @Body() body: { request: string; scenario: Scenario; type: ModelType }) {
    return this.generator.start(id, body)
  }

  @Post(':jobId/cancel')
  @Action('diagrams.cancel')
  cancel(@Param('id') id: string, @Param('jobId') jobId: string) {
    return this.generator.cancel(id, jobId)
  }
}
