import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common'
import { Action } from '../readonly/actions'
import { GitOpsService } from './gitops.service'

/** The local git of an installation: overview, branches, worktrees, update, push */
@Controller('workspaces/:id/git')
export class GitOpsController {
  constructor(private readonly git: GitOpsService) {}

  @Get()
  @Action('git.read')
  overview(@Param('id') id: string) {
    return this.git.overview(id)
  }

  @Get('worktree-status')
  @Action('git.read')
  worktreeStatus(@Param('id') id: string, @Query('path') wtPath: string) {
    return this.git.worktreeStatus(id, wtPath)
  }

  @Post('fetch')
  @Action('git.write')
  fetch(@Param('id') id: string) {
    return this.git.fetch(id)
  }

  @Post('pull')
  @Action('git.write')
  pull(@Param('id') id: string, @Body() body: { worktreePath?: string }) {
    return this.git.pull(id, body.worktreePath)
  }

  @Post('checkout')
  @Action('git.write')
  checkout(@Param('id') id: string, @Body() body: { branch: string }) {
    return this.git.checkout(id, body.branch)
  }

  /** Fetches the base and says if the local copy is behind (POST: the fetch updates remote refs) */
  @Post('base-status')
  @Action('git.write')
  baseStatus(@Param('id') id: string, @Body() body: { base: string }) {
    return this.git.baseStatus(id, body.base)
  }

  @Post('update-base')
  @Action('git.write')
  updateBase(@Param('id') id: string, @Body() body: { base: string }) {
    return this.git.updateBase(id, body.base)
  }

  @Post('branch')
  @Action('git.write')
  createBranch(@Param('id') id: string, @Body() body: { name: string; base: string }) {
    return this.git.createBranch(id, body.name, body.base)
  }

  @Delete('branch')
  @Action('git.write')
  deleteBranch(@Param('id') id: string, @Query('name') name: string, @Query('force') force?: string) {
    return this.git.deleteBranch(id, name, force === '1')
  }

  @Post('worktree')
  @Action('git.write')
  addWorktree(@Param('id') id: string, @Body() body: { branch: string; base?: string }) {
    return this.git.addWorktree(id, body)
  }

  @Delete('worktree')
  @Action('git.write')
  removeWorktree(@Param('id') id: string, @Query('path') wtPath: string, @Query('force') force?: string) {
    return this.git.removeWorktree(id, wtPath, force === '1')
  }

  @Post('worktree/prune')
  @Action('git.write')
  prune(@Param('id') id: string) {
    return this.git.pruneWorktrees(id)
  }

  @Post('push')
  @Action('git.push')
  push(@Param('id') id: string, @Body() body: { branch: string; remote?: string }) {
    return this.git.push(id, body.branch, body.remote)
  }
}
