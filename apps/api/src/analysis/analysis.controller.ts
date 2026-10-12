import { Body, Controller, Get, NotFoundException, Param, Post, Put, Query } from '@nestjs/common'
import { JobsService } from '../jobs/jobs.service'
import { Action } from '../readonly/actions'
import { AnalysisService } from './analysis.service'
import { MapStore } from './map-store.service'
import { OverviewService } from './overview.service'

@Controller()
export class AnalysisController {
  constructor(
    private readonly analysis: AnalysisService,
    private readonly overview: OverviewService,
    private readonly maps: MapStore,
    private readonly jobs: JobsService,
  ) {}

  @Post('workspaces/:id/analysis')
  @Action('analysis.run')
  run(@Param('id') id: string) {
    return this.analysis.run(id)
  }

  @Get('jobs/:jobId')
  @Action('jobs.get')
  job(@Param('jobId') jobId: string) {
    const job = this.jobs.get(jobId)
    if (!job) throw new NotFoundException('Tarefa não encontrada')
    return job
  }

  @Get('workspaces/:id/overview')
  @Action('overview.get')
  getOverview(@Param('id') id: string, @Query('refresh') refresh?: string) {
    return this.overview.compute(id, { refresh: refresh === '1' })
  }

  @Get('workspaces/:id/map')
  @Action('map.get')
  map(@Param('id') id: string) {
    return { map: this.maps.readMap(id), annotations: this.maps.readAnnotations(id) }
  }

  @Put('workspaces/:id/annotations')
  @Action('annotations.save')
  saveAnnotations(@Param('id') id: string, @Body() body: { zones?: Record<string, string>; items?: Record<string, unknown>; scope?: string }) {
    return this.maps.saveAnnotations(id, body)
  }
}
