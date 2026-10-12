import { Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { AiController } from './ai/ai.controller'
import { AiService } from './ai/ai.service'
import { AnalysisController } from './analysis/analysis.controller'
import { ApiClientController } from './apiclient/apiclient.controller'
import { ApiClientService } from './apiclient/apiclient.service'
import { BoardsController } from './boards/boards.controller'
import { BoardsService } from './boards/boards.service'
import { DocsController } from './docs/docs.controller'
import { DocsService } from './docs/docs.service'
import { AnalysisService } from './analysis/analysis.service'
import { MapStore } from './analysis/map-store.service'
import { OverviewService } from './analysis/overview.service'
import { ReleasesService } from './analysis/releases.service'
import { CodeIndexService } from './files/code-index.service'
import { FilesController } from './files/files.controller'
import { JobsService } from './jobs/jobs.service'
import { AuditService } from './readonly/audit.service'
import { CommandRunner } from './readonly/command-runner.service'
import { ReadOnlyGuard } from './readonly/readonly.guard'
import { ReadOnlyFs } from './readonly/readonly-fs.service'
import { ViolationFilter } from './readonly/violation.filter'
import { SystemController } from './system/system.controller'
import { GitService } from './workspaces/git.service'
import { WorkspacesController } from './workspaces/workspaces.controller'
import { WorkspacesService } from './workspaces/workspaces.service'
import { ZipService } from './workspaces/zip.service'

@Module({
  controllers: [WorkspacesController, AnalysisController, FilesController, SystemController, AiController, ApiClientController, DocsController, BoardsController],
  providers: [
    // read-only enforcement: every request goes through the guard, every violation through the filter
    { provide: APP_GUARD, useClass: ReadOnlyGuard },
    { provide: APP_FILTER, useClass: ViolationFilter },
    AuditService,
    ReadOnlyFs,
    CodeIndexService,
    CommandRunner,
    JobsService,
    GitService,
    ZipService,
    WorkspacesService,
    MapStore,
    ReleasesService,
    OverviewService,
    AnalysisService,
    AiService,
    ApiClientService,
    DocsService,
    BoardsService,
  ],
})
export class AppModule {}
