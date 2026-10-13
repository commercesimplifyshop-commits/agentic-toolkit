import { BadRequestException, Injectable } from '@nestjs/common'
import { ReadOnlyFs } from '../../readonly/readonly-fs.service'
import { WorkspacesService } from '../../workspaces/workspaces.service'
import { sfccOverview } from './overview'

/** Salesforce B2C tools: architecture is read from the project, never from the live instance. */
@Injectable()
export class SfccService {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly rofs: ReadOnlyFs,
  ) {}

  overview(id: string) {
    const ws = this.workspaces.get(id)
    if (ws.tech !== 'salesforce-b2c') throw new BadRequestException('Esta instalação não é Salesforce B2C Commerce')
    if (!ws.root) throw new BadRequestException('Escolha a pasta do projeto antes de consultar a visão geral')
    return sfccOverview(this.rofs, ws.root, ws.name)
  }
}
