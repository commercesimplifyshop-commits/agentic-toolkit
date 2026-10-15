import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common'
import { Action } from '../readonly/actions'
import { GitHubService } from './github.service'

/** Pull requests of the project's GitHub repository, and their code review */
@Controller('workspaces/:id/git')
export class GitHubController {
  constructor(private readonly github: GitHubService) {}

  @Get('github')
  @Action('git.read')
  status(@Param('id') id: string) {
    return this.github.status(id)
  }

  @Post('github/connect')
  @Action('git.github.connect')
  connect(@Param('id') id: string, @Body() body: { source?: string; token?: string }) {
    return this.github.connect(id, body ?? {})
  }

  @Delete('github')
  @Action('git.github.connect')
  disconnect(@Param('id') id: string) {
    return this.github.disconnect(id)
  }

  @Get('prs')
  @Action('git.prs.read')
  list(@Param('id') id: string, @Query('state') state?: string) {
    return this.github.list(id, state === 'closed' ? 'closed' : 'open')
  }

  @Get('prs/:number')
  @Action('git.prs.read')
  pull(@Param('id') id: string, @Param('number') n: string) {
    return this.github.pull(id, n)
  }

  @Post('prs/:number/review')
  @Action('git.prs.review')
  review(@Param('id') id: string, @Param('number') n: string, @Body() body: { event?: string; body?: string; comments?: unknown[]; commitId?: string }) {
    return this.github.review(id, n, body ?? {})
  }

  @Post('prs/:number/comments/:commentId/replies')
  @Action('git.prs.review')
  reply(@Param('id') id: string, @Param('number') n: string, @Param('commentId') commentId: string, @Body() body: { body?: string }) {
    return this.github.reply(id, n, commentId, body ?? {})
  }
}
