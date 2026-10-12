import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { Action } from '../readonly/actions'
import { ApiClientService, type SendInput } from './apiclient.service'

@Controller('workspaces/:id/api-client')
export class ApiClientController {
  constructor(private readonly client: ApiClientService) {}

  /** Pre-filled request for a REST/GraphQL route of the map (path params, query, body, auth suggestion). */
  @Get('template')
  @Action('apiclient.template')
  template(@Param('id') id: string, @Query('route') route: string) {
    return this.client.template(id, route)
  }

  /** Sends the request from the local backend (no CORS), returning status, headers and body. */
  @Post('send')
  @Action('apiclient.send')
  send(@Body() body: SendInput) {
    return this.client.send(body)
  }
}
