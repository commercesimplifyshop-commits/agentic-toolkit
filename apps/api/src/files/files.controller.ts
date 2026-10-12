import { Controller, Get, Param, Query } from '@nestjs/common'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Action } from '../readonly/actions'
import { ReadOnlyFs } from '../readonly/readonly-fs.service'
import { WorkspacesService } from '../workspaces/workspaces.service'

@Controller()
export class FilesController {
  constructor(
    private readonly rofs: ReadOnlyFs,
    private readonly workspaces: WorkspacesService,
  ) {}

  @Get('workspaces/:id/files')
  @Action('files.tree')
  tree(@Param('id') id: string, @Query('path') rel = '') {
    return { path: rel, entries: this.rofs.list(this.workspaces.rootOf(id), rel) }
  }

  @Get('workspaces/:id/file')
  @Action('files.read')
  file(@Param('id') id: string, @Query('path') rel: string) {
    return { path: rel, ...this.rofs.read(this.workspaces.rootOf(id), rel) }
  }

  @Get('workspaces/:id/search')
  @Action('files.search')
  search(@Param('id') id: string, @Query('q') q: string, @Query('under') under = '') {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return { query: q, matches: this.rofs.grep(this.workspaces.rootOf(id), escaped, { under, maxMatches: 300 }) }
  }

  /** Folder picker for the onboarding screen: directories only, nothing is read inside them. */
  @Get('host/browse')
  @Action('host.browse')
  browse(@Query('path') dir?: string) {
    if (!dir) {
      const roots =
        process.platform === 'win32'
          ? 'CDEFGHIJ'
              .split('')
              .map((d) => `${d}:\\`)
              .filter((d) => fs.existsSync(d))
          : ['/']
      return { path: '', parent: null, home: os.homedir(), entries: roots.map((r) => ({ name: r, path: r })) }
    }
    const resolved = path.resolve(dir)
    const entries = fs
      .readdirSync(resolved, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('$'))
      .map((e) => ({ name: e.name, path: path.join(resolved, e.name), magento: fs.existsSync(path.join(resolved, e.name, 'app', 'etc', 'config.php')) || fs.existsSync(path.join(resolved, e.name, 'bin', 'magento')) }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const parent = path.dirname(resolved)
    return { path: resolved, parent: parent === resolved ? '' : parent, home: os.homedir(), entries }
  }
}
