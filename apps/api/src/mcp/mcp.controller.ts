import { Body, Controller, Get, Post, Put, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import path from 'node:path'
import { HOST, PORT } from '../config/paths'
import { Action } from '../readonly/actions'
import { GROUP_INFO, MCP_GROUPS, McpSettingsService } from './mcp-settings.service'
import { McpService } from './mcp.service'
import { MCP_TOOLS } from './mcp-tools'

/** Only pages served by this machine may call the MCP from a browser (protects against DNS rebinding) */
const localOrigin = (origin: string | undefined) => {
  if (!origin) return true
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)
  } catch {
    return false
  }
}

@Controller('mcp')
export class McpController {
  constructor(
    private readonly mcp: McpService,
    private readonly settings: McpSettingsService,
  ) {}

  /** The MCP endpoint (Streamable HTTP): one JSON-RPC message, or a batch, per POST */
  @Post()
  @Action('mcp.rpc')
  async rpc(@Req() req: Request, @Res() res: Response) {
    if (!localOrigin(req.headers.origin)) return res.status(403).json({ error: 'Origem não permitida' })
    const caller = this.settings.caller(req.headers.authorization)
    // the in-app assistant always works; external clients only with the MCP on
    if (caller !== 'assistente' && !this.settings.read().enabled) return res.status(503).json({ error: 'O MCP está desligado. Ligue em Configurações → MCP.' })
    if (!caller) return res.status(401).setHeader('WWW-Authenticate', 'Bearer').json({ error: 'Token inválido ou ausente (Authorization: Bearer <token>)' })
    const body = req.body as unknown
    const messages = Array.isArray(body) ? body : [body]
    const client = caller === 'assistente' ? 'assistente' : 'mcp'
    const answers = (await Promise.all(messages.map((m) => this.mcp.handle(m as never, { client })))).filter(Boolean)
    if (!answers.length) return res.status(202).end()
    return res.status(200).json(Array.isArray(body) ? answers : answers[0])
  }

  /** No server-initiated stream: this server only answers */
  @Get()
  @Action('mcp.rpc')
  stream(@Res() res: Response) {
    return res.status(405).setHeader('Allow', 'POST').json({ error: 'Use POST' })
  }

  /** Settings screen: the state, the token, the tools and how to connect each client */
  @Get('settings')
  @Action('mcp.settings.get')
  view() {
    const s = this.settings.read()
    const host = HOST === '0.0.0.0' || HOST === '::' ? '127.0.0.1' : HOST
    return {
      ...s,
      url: `http://${host}:${PORT}/api/mcp`,
      // the stdio bridge, for clients that only start local programs (Claude Desktop, Codex CLI)
      bridge: path.resolve(__dirname, '..', '..', 'bin', 'mcp-stdio.mjs'),
      node: process.execPath,
      groups: MCP_GROUPS.map((g) => ({ id: g, ...GROUP_INFO[g], enabled: s.groups[g] })),
      tools: MCP_TOOLS.map((t) => ({ name: t.name, title: t.title, group: t.group, description: t.description, writes: Boolean(t.writes) })),
    }
  }

  @Put('settings')
  @Action('mcp.settings')
  save(@Body() body: { enabled?: unknown; groups?: unknown }) {
    this.settings.save(body)
    return this.view()
  }

  /** A new token: the clients configured with the old one stop working */
  @Post('token')
  @Action('mcp.token')
  rotate() {
    this.settings.rotate()
    return this.view()
  }
}
