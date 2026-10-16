import { BadRequestException, Injectable } from '@nestjs/common'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { CORE_DIR } from '../config/paths'

/** What an AI connected through the MCP may do, by group of tools */
export const MCP_GROUPS = ['interface', 'consulta', 'trabalho', 'acoes'] as const
export type McpGroup = (typeof MCP_GROUPS)[number]

export const GROUP_INFO: Record<McpGroup, { title: string; description: string }> = {
  interface: { title: 'Interface do app', description: 'Renomear funcionalidades, trocar qualquer texto, mudar cores, fonte e tamanhos, organizar o menu, ativar e desativar funcionalidades, mover e ocultar blocos, CSS personalizado e desfazer. Grava só as preferências de interface.' },
  consulta: { title: 'Consulta ao projeto', description: 'Listar workspaces e ler a visão geral, o mapa de integrações, arquivos, busca no código, arquitetura viva, cards e a auditoria. Só leitura, com as mesmas travas da tela.' },
  trabalho: { title: 'Criar e ligar itens', description: 'Criar diagramas (Mermaid), anexar diagramas às tarefas do Refinamento, abrir telas e preencher o Simulador de API (o envio continua com a pessoa). Grava só dados do Agentic Toolkit, sem custo de IA.' },
  acoes: { title: 'Ações com custo ou tarefas', description: 'Gerar diagramas com o Claude lendo o código, criar e refinar tarefas, perguntar ao código, reanalisar o projeto e desenhar a arquitetura. Usam a IA configurada no app (custo) e podem levar alguns minutos.' },
}

export interface McpSettings {
  enabled: boolean
  token: string
  groups: Record<McpGroup, boolean>
  updatedAt?: string
}

const FILE = path.join(CORE_DIR, 'mcp.json')
const newToken = () => `atk_${crypto.randomBytes(24).toString('base64url')}`

/**
 * The MCP connector's settings: off until the person turns it on; a token every client must send;
 * the groups of tools it exposes. Writing to the code is never one of them.
 */
@Injectable()
export class McpSettingsService {
  /** The in-app assistant's own token: lives only in memory, works even with the MCP off, reaches every group */
  readonly internalToken = `atk_int_${crypto.randomBytes(24).toString('base64url')}`

  read(): McpSettings {
    let s: Partial<McpSettings> = {}
    try {
      s = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<McpSettings>
    } catch {
      // first use: created below with a new token
    }
    const full: McpSettings = { enabled: Boolean(s.enabled), token: s.token ?? '', groups: { interface: true, consulta: true, trabalho: true, acoes: false, ...(s.groups ?? {}) }, updatedAt: s.updatedAt }
    // the token is created once and kept, so the clients configured with it keep working
    return full.token ? full : this.write({ ...full, token: newToken() })
  }

  private write(s: McpSettings) {
    const next = { ...s, updatedAt: new Date().toISOString() }
    fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(next, null, 2))
    fs.renameSync(`${FILE}.tmp`, FILE)
    return next
  }

  save(input: { enabled?: unknown; groups?: unknown }) {
    const s = this.read()
    if (input.enabled !== undefined) s.enabled = input.enabled === true
    if (input.groups !== undefined) {
      if (!input.groups || typeof input.groups !== 'object') throw new BadRequestException('Grupos inválidos')
      for (const [g, on] of Object.entries(input.groups as Record<string, unknown>)) {
        if (!(MCP_GROUPS as readonly string[]).includes(g)) throw new BadRequestException(`Grupo desconhecido: ${g}`)
        s.groups[g as McpGroup] = on === true
      }
    }
    return this.write(s)
  }

  rotate() {
    return this.write({ ...this.read(), token: newToken() })
  }

  /** Constant-time check of the token a client sent */
  accepts(header: string | undefined) {
    return this.caller(header) === 'externo'
  }

  /** Who sent the token: an external client, the in-app assistant, or nobody known */
  caller(header: string | undefined): 'externo' | 'assistente' | null {
    const sent = Buffer.from(/^Bearer\s+(.+)$/i.exec(header ?? '')?.[1]?.trim() ?? '')
    const same = (t: string) => {
      const b = Buffer.from(t)
      return sent.length === b.length && crypto.timingSafeEqual(sent, b)
    }
    if (same(this.internalToken)) return 'assistente'
    return same(this.read().token) ? 'externo' : null
  }
}
