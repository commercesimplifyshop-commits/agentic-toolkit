import { Body, Controller, Get, Headers, MessageEvent, Post, Sse } from '@nestjs/common'
import { interval, map, merge, type Observable } from 'rxjs'
import { Action } from '../readonly/actions'
import { UiAssistantService } from './ui-assistant.service'
import { UiCommandsService } from './ui-commands.service'
import { UiPrefsService, type UiAction } from './ui-prefs.service'

/** Interface preferences: features on and off, blocks of the pages moved or hidden */
@Controller('ui')
export class UiController {
  constructor(
    private readonly prefs: UiPrefsService,
    private readonly assistant: UiAssistantService,
    private readonly commands: UiCommandsService,
  ) {}

  @Get()
  @Action('ui.get')
  view() {
    return this.prefs.view()
  }

  /** The style guide of the current theme: tokens, where they show, rules and measured contrast */
  @Get('style-guide')
  @Action('ui.get')
  guide() {
    return this.prefs.styleGuide()
  }

  /** The blocks a screen found on a page, so the assistant and the MCP can move and hide them too */
  @Post('blocks')
  @Action('ui.blocks')
  blocks(@Body() body: { page?: string; blocks?: unknown }) {
    return this.prefs.registerBlocks(body.page, body.blocks)
  }

  /** Changes made on the settings screen */
  @Post('actions')
  @Action('ui.change')
  change(@Body() body: { actions?: UiAction[] }, @Headers('x-agentic-client') client?: string) {
    return this.prefs.apply(body.actions ?? [], client === 'mcp' ? 'mcp' : client === 'assistente' ? 'assistente' : 'tela')
  }

  /** The global assistant: the configured AI does what the person asks with the toolkit's tools (a job: follow it in /jobs/:id) */
  @Post('assistant')
  @Action('ui.assistant')
  ask(@Body() body: { message?: string; history?: unknown; context?: unknown }) {
    return this.assistant.start(body.message, body.history, body.context)
  }

  /** Asks the open screens to open a page or fill the API simulator (never to send anything) */
  @Post('commands')
  @Action('ui.command')
  command(@Body() body: unknown) {
    return this.commands.send(body)
  }

  /** Each change, as it happens, for the screens that are open (whoever made it: screen, assistant or MCP) */
  @Sse('events')
  @Action('ui.events')
  events(): Observable<MessageEvent> {
    return merge(
      this.prefs.changes.pipe(map((prefs) => ({ type: 'prefs', data: prefs }) as MessageEvent)),
      this.commands.commands.pipe(map((c) => ({ type: 'command', data: c }) as MessageEvent)),
      // keeps the connection open through proxies
      interval(25_000).pipe(map(() => ({ type: 'ping', data: '' }) as MessageEvent)),
    )
  }
}
