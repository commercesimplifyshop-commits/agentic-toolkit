import { BadRequestException, Body, Controller, Get, Post, Put, Query } from '@nestjs/common'
import { Action } from '../readonly/actions'
import { NewsService } from './news.service'
import type { TopicSettings } from './topic'

/** The daily update: app-level, not tied to an installation */
@Controller('news')
export class NewsController {
  constructor(private readonly news: NewsService) {}

  @Get('status')
  @Action('news.status')
  status() {
    return this.news.status()
  }

  /** The bulletins published on a day (yyyy-mm-dd), default today (Monday: the weekend) */
  @Get('today')
  @Action('news.today')
  today(@Query('date') date?: string) {
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('Data inválida: use yyyy-mm-dd')
    return this.news.today(date)
  }

  @Post('refresh')
  @Action('news.refresh')
  refresh() {
    void this.news.run(true)
    return { started: true }
  }

  @Get('settings')
  @Action('news.settings.read')
  settings() {
    return this.news.settings()
  }

  @Put('settings')
  @Action('news.settings.save')
  save(@Body() body: { routine?: unknown; popup?: unknown; topics?: unknown }) {
    const flag = (v: unknown, name: string) => {
      if (v !== undefined && typeof v !== 'boolean') throw new BadRequestException(`Configuração inválida: ${name}`)
      return v as boolean | undefined
    }
    const topics: Record<string, Partial<TopicSettings>> = {}
    if (body.topics !== undefined) {
      if (typeof body.topics !== 'object' || body.topics === null || Array.isArray(body.topics)) throw new BadRequestException('Configuração inválida: topics')
      for (const [id, value] of Object.entries(body.topics as Record<string, unknown>)) {
        if (!/^[a-z0-9-]{3,60}$/.test(id) || typeof value !== 'object' || value === null) throw new BadRequestException('Configuração inválida de tema')
        const v = value as Record<string, unknown>
        topics[id] = { enabled: flag(v.enabled, `${id}.enabled`), popup: flag(v.popup, `${id}.popup`) }
      }
    }
    return this.news.saveSettings({ routine: flag(body.routine, 'routine'), popup: flag(body.popup, 'popup'), topics })
  }
}
