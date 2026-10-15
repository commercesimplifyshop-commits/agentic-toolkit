import { Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { AiController } from './ai/ai.controller'
import { AiService } from './ai/ai.service'
import { AnalysisController } from './analysis/analysis.controller'
import { ApiClientController } from './apiclient/apiclient.controller'
import { ApiClientService } from './apiclient/apiclient.service'
import { BoardsController } from './boards/boards.controller'
import { BoardsService } from './boards/boards.service'
import { DiagramGenerationController } from './diagrams/diagram-generation.controller'
import { DiagramGeneratorService } from './diagrams/diagram-generator.service'
import { DiagramsController } from './diagrams/diagrams.controller'
import { DiagramsService } from './diagrams/diagrams.service'
import { OpenSpecController } from './openspec/openspec.controller'
import { OpenSpecService } from './openspec/openspec.service'
import { OpenSpecExploreController } from './openspec/openspec-explore.controller'
import { OpenSpecExploreService } from './openspec/openspec-explore.service'
import { OpenSpecAuthoringController } from './openspec/openspec-authoring.controller'
import { OpenSpecAuthoringService } from './openspec/openspec-authoring.service'
import { SfccController } from './techs/sfcc/sfcc.controller'
import { SfccService } from './techs/sfcc/sfcc.service'
import { SfccUploadService } from './techs/sfcc/upload.service'
import { SkillsController } from './skills/skills.controller'
import { SkillsService } from './skills/skills.service'
import { TaskContextService } from './refine/task-context.service'
import { TechsController } from './techs/techs.controller'
import { GitOpsController } from './gitops/gitops.controller'
import { GitOpsService } from './gitops/gitops.service'
import { GitHubController } from './gitops/github.controller'
import { GitHubService } from './gitops/github.service'
import { LiveArchitectureController } from './diagrams/live-architecture.controller'
import { LiveArchitectureService } from './diagrams/live-architecture.service'
import { RefineController } from './refine/refine.controller'
import { WorkspaceEnvService } from './settings/workspace-env.service'
import { WorkspaceSettingsController } from './settings/workspace-settings.controller'
import { WorkspaceSettingsService } from './settings/workspace-settings.service'
import { RefineService } from './refine/refine.service'
import { NewsController } from './news/news.controller'
import { NewsService } from './news/news.service'
import { SecurityBulletinTopic } from './news/security-bulletin.topic'
import { LinksController } from './links/links.controller'
import { LinksService } from './links/links.service'
import { LinksAssistService } from './links/links-assist.service'
import { RepoWriter } from './readonly/repo-writer.service'
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
  controllers: [WorkspacesController, AnalysisController, FilesController, SystemController, AiController, ApiClientController, DocsController, BoardsController, DiagramsController, DiagramGenerationController, OpenSpecController, OpenSpecAuthoringController, OpenSpecExploreController, LinksController, SfccController, TechsController, NewsController, GitOpsController, GitHubController, LiveArchitectureController, RefineController, WorkspaceSettingsController, SkillsController],
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
    DiagramsService,
    DiagramGeneratorService,
    OpenSpecService,
    OpenSpecAuthoringService,
    OpenSpecExploreService,
    RepoWriter,
    LinksService,
    LinksAssistService,
    SfccService,
    SfccUploadService,
    SkillsService,
    TaskContextService,
    NewsService,
    SecurityBulletinTopic,
    GitOpsService,
    GitHubService,
    LiveArchitectureService,
    RefineService,
    WorkspaceEnvService,
    WorkspaceSettingsService,
  ],
})
export class AppModule {}
