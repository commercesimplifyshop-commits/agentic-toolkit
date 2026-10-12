import { SetMetadata } from '@nestjs/common'
import type { Request } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { isSensitive, ReadOnlyViolation } from './path-guard'

/**
 * CRITICAL RULE: StoreFlow is read-only with respect to Magento code.
 *
 * - `read`: only reads (Magento code, StoreFlow data).
 * - `data-write`: writes exclusively inside StoreFlow's data directory
 *   (its own clones, uploads, maps, annotations, settings). Never in a Magento repo.
 *
 * Every API route must be tagged with one of these actions and each action runs
 * its validator before the handler. Untagged routes are rejected (fail closed).
 */
export type ActionKind = 'read' | 'data-write'

export interface ActionContext {
  req: Request
  /** Resolves the Magento root of a workspace id (throws if unknown) */
  workspaceRoot: (id: string) => string
}

export interface ActionDef {
  kind: ActionKind
  description: string
  /** HTTP methods accepted for this action */
  methods: ('GET' | 'POST' | 'PUT' | 'DELETE')[]
  validate?: (ctx: ActionContext) => void
}

const fail = (message: string, rule: string): never => {
  throw new ReadOnlyViolation(message, rule)
}

const requireWorkspace = (ctx: ActionContext) => {
  const id = ctx.req.params.id
  if (!id || !/^[a-z0-9-]{3,64}$/.test(id)) fail('Workspace inválido', 'input.workspace-id')
  ctx.workspaceRoot(id)
}

const requireRelPath = (ctx: ActionContext, { allowSensitive }: { allowSensitive: boolean }) => {
  const rel = String(ctx.req.query.path ?? '')
  if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) fail('Use caminhos relativos à instalação, sem ..', 'path.traversal')
  if (!allowSensitive && isSensitive(rel)) fail(`Arquivo sensível não é lido: ${rel}`, 'read.sensitive-file')
}

export const ACTIONS = {
  'system.health': { kind: 'read', methods: ['GET'], description: 'Status do servidor e das regras' },
  'system.selftest': { kind: 'read', methods: ['GET'], description: 'Autoteste das proteções de somente leitura' },
  'audit.list': { kind: 'read', methods: ['GET'], description: 'Log de auditoria das ações' },

  'host.browse': {
    kind: 'read',
    methods: ['GET'],
    description: 'Lista pastas do computador para escolher a instalação (só diretórios)',
    validate: (ctx) => {
      const p = String(ctx.req.query.path ?? '')
      if (p && !path.isAbsolute(p)) fail('Informe um caminho absoluto', 'input.absolute-path')
    },
  },

  'workspaces.list': { kind: 'read', methods: ['GET'], description: 'Lista instalações conectadas' },
  'workspaces.get': { kind: 'read', methods: ['GET'], description: 'Detalhes de uma instalação', validate: requireWorkspace },
  'workspaces.inspect': {
    kind: 'read',
    methods: ['POST'],
    description: 'Valida se uma pasta local é uma instalação Magento (sem copiar nada)',
    validate: (ctx) => {
      const p = String(ctx.req.body?.path ?? '')
      if (!path.isAbsolute(p)) fail('Informe um caminho absoluto', 'input.absolute-path')
      if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) fail(`Pasta não encontrada: ${p}`, 'input.path-not-found')
    },
  },
  'workspaces.create': {
    kind: 'data-write',
    methods: ['POST'],
    description: 'Conecta uma instalação (pasta local é lida no lugar; Git é clonado no diretório de dados)',
    validate: (ctx) => {
      const body = ctx.req.body ?? {}
      if (body.source === 'local') {
        if (!path.isAbsolute(String(body.path ?? ''))) fail('Informe um caminho absoluto', 'input.absolute-path')
      } else if (body.source === 'git') {
        if (!/^(https:\/\/|ssh:\/\/|git@[\w.-]+:)/.test(String(body.url ?? ''))) fail('Use uma URL https:// ou SSH (git@host:org/repo.git)', 'input.git-url')
        if (String(body.url).includes(' ') || String(body.url).startsWith('-')) fail('URL inválida', 'input.git-url')
        if (body.auth?.method && !['system', 'token', 'ssh-key'].includes(body.auth.method)) fail('Método de autenticação inválido', 'input.git-auth')
      } else fail('Origem inválida (local ou git)', 'input.source')
    },
  },
  'workspaces.upload': { kind: 'data-write', methods: ['POST'], description: 'Recebe um .zip e extrai no diretório de dados' },
  'workspaces.configure': { kind: 'data-write', methods: ['PUT'], description: 'Escolhe a raiz Magento e os vendors próprios (metadados do StoreFlow)', validate: requireWorkspace },
  'workspaces.sync': { kind: 'data-write', methods: ['POST'], description: 'git fetch no clone do StoreFlow (nunca push)', validate: requireWorkspace },
  'workspaces.delete': {
    kind: 'data-write',
    methods: ['DELETE'],
    description: 'Remove a instalação do StoreFlow (apaga só clones/uploads/mapas do StoreFlow, nunca a pasta local)',
    validate: requireWorkspace,
  },

  'analysis.run': { kind: 'data-write', methods: ['POST'], description: 'Roda o extrator e grava o mapa no diretório de dados', validate: requireWorkspace },
  'jobs.get': { kind: 'read', methods: ['GET'], description: 'Progresso de uma tarefa' },
  'overview.get': { kind: 'read', methods: ['GET'], description: 'Visão geral da instalação', validate: requireWorkspace },
  'map.get': { kind: 'read', methods: ['GET'], description: 'Mapa de integrações e anotações', validate: requireWorkspace },
  'annotations.save': {
    kind: 'data-write',
    methods: ['PUT'],
    description: 'Grava anotações de análise no diretório de dados do StoreFlow',
    validate: (ctx) => {
      requireWorkspace(ctx)
      const items = ctx.req.body?.items
      if (items && typeof items !== 'object') fail('Formato de anotações inválido', 'input.annotations')
    },
  },
  'files.tree': { kind: 'read', methods: ['GET'], description: 'Lista uma pasta da instalação', validate: (ctx) => (requireWorkspace(ctx), requireRelPath(ctx, { allowSensitive: true })) },
  'files.read': { kind: 'read', methods: ['GET'], description: 'Lê um arquivo da instalação (sensíveis bloqueados)', validate: (ctx) => (requireWorkspace(ctx), requireRelPath(ctx, { allowSensitive: false })) },
  'files.search': {
    kind: 'read',
    methods: ['GET'],
    description: 'Busca texto no código da instalação',
    validate: (ctx) => {
      requireWorkspace(ctx)
      const q = String(ctx.req.query.q ?? '')
      if (q.length < 3 || q.length > 200) fail('A busca precisa ter entre 3 e 200 caracteres', 'input.search')
    },
  },

  'ai.providers': { kind: 'read', methods: ['GET'], description: 'Provedores de IA disponíveis' },
  'ai.settings': { kind: 'data-write', methods: ['PUT'], description: 'Configura o provedor de IA (gravado no diretório de dados)' },
  'ai.ask': {
    kind: 'read',
    methods: ['POST'],
    description: 'Pergunta à IA sobre a instalação; a IA só recebe ferramentas de leitura',
    validate: (ctx) => {
      requireWorkspace(ctx)
      const q = String(ctx.req.body?.question ?? '')
      if (!q.trim() || q.length > 8000) fail('Pergunta vazia ou longa demais', 'input.question')
    },
  },
} satisfies Record<string, ActionDef>

export type ActionId = keyof typeof ACTIONS

export const ACTION_KEY = 'storeflow:action'
export const Action = (id: ActionId) => SetMetadata(ACTION_KEY, id)
