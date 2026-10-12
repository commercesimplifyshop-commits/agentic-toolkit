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
 * - `external`: an HTTP request the engineer sends to an environment they chose
 *   (API simulator). It never touches the repository; it may change that
 *   environment's data, so it is validated, confirmed in the UI and audited.
 *
 * Every API route must be tagged with one of these actions and each action runs
 * its validator before the handler. Untagged routes are rejected (fail closed).
 */
export type ActionKind = 'read' | 'data-write' | 'external'

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

const requireBoardId = (ctx: ActionContext) => {
  if (!/^[a-z0-9-]{4,80}$/.test(String(ctx.req.params.boardId ?? ''))) fail('Quadro inválido', 'input.board-id')
}

const requireBoardName = (ctx: ActionContext) => {
  const name = ctx.req.body?.name
  if (name !== undefined && (typeof name !== 'string' || name.length > 120)) fail('Nome do quadro inválido (até 120 caracteres)', 'input.board-name')
}

const requireDocId = (ctx: ActionContext) => {
  if (!/^[a-z0-9-]{4,80}$/.test(String(ctx.req.params.docId ?? ''))) fail('Documento inválido', 'input.doc-id')
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

  'files.index': { kind: 'read', methods: ['GET'], description: 'Lista de arquivos da instalação (Go to File)', validate: requireWorkspace },
  'files.classes': { kind: 'read', methods: ['GET'], description: 'Índice de classes PHP: FQCN → arquivo (Go to Class / Ctrl+clique)', validate: requireWorkspace },
  'files.find': {
    kind: 'read',
    methods: ['GET'],
    description: 'Find in Files: busca com maiúsculas, palavra inteira, regex, escopo e máscara (arquivos sensíveis ignorados)',
    validate: (ctx) => {
      requireWorkspace(ctx)
      const q = String(ctx.req.query.q ?? '')
      if (q.length < 2 || q.length > 300) fail('A busca precisa ter entre 2 e 300 caracteres', 'input.search')
      if (ctx.req.query.regex === '1') {
        try {
          new RegExp(q)
        } catch {
          fail('Expressão regular inválida', 'input.regex')
        }
      }
      const scope = String(ctx.req.query.scope ?? '')
      if (path.isAbsolute(scope) || scope.split(/[\\/]/).includes('..')) fail('Escopo deve ser uma pasta relativa à instalação', 'path.traversal')
      if (!/^[\w*?.,\s/-]*$/.test(String(ctx.req.query.mask ?? ''))) fail('Máscara de arquivo inválida (use algo como *.php,*.xml)', 'input.mask')
    },
  },

  'apiclient.template': {
    kind: 'read',
    methods: ['GET'],
    description: 'Monta a requisição de uma rota do mapa (parâmetros, body pela assinatura PHP, autenticação sugerida)',
    validate: (ctx) => {
      requireWorkspace(ctx)
      if (!/^(rest|graphql):/.test(String(ctx.req.query.route ?? ''))) fail('Rota inválida', 'input.route')
    },
  },
  'apiclient.send': {
    kind: 'external',
    methods: ['POST'],
    description: 'Simulador de API: envia uma requisição HTTP ao ambiente escolhido (não toca no repositório)',
    validate: (ctx) => {
      requireWorkspace(ctx)
      const b = ctx.req.body ?? {}
      let url: URL
      try {
        url = new URL(String(b.url ?? ''))
      } catch {
        return fail('URL inválida', 'input.url')
      }
      if (!['http:', 'https:'].includes(url.protocol)) fail('Use uma URL http:// ou https://', 'input.url')
      if (url.username || url.password) fail('Não coloque credenciais na URL; use a aba Autorização', 'input.url-credentials')
      const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
      if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname) && port === Number(process.env.STOREFLOW_PORT ?? 4310)) {
        fail('O simulador não pode chamar a própria API do StoreFlow', 'input.self-target')
      }
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(String(b.method))) fail('Método HTTP inválido', 'input.method')
      for (const k of Object.keys(b.headers ?? {})) if (!/^[!#$%&'*+.^\w`|~-]+$/.test(k)) fail(`Cabeçalho inválido: ${k}`, 'input.header')
      if (b.body !== undefined && (typeof b.body !== 'string' || b.body.length > 5 * 1024 * 1024)) fail('Body inválido ou maior que 5 MB', 'input.body')
    },
  },

  'docs.list': { kind: 'read', methods: ['GET'], description: 'Lista as documentações geradas (diretório de dados)', validate: requireWorkspace },
  'docs.get': { kind: 'read', methods: ['GET'], description: 'Lê uma documentação gerada', validate: (ctx) => (requireWorkspace(ctx), requireDocId(ctx)) },
  'docs.export': {
    kind: 'read',
    methods: ['GET'],
    description: 'Exporta uma documentação em Word ou PDF (gerado localmente)',
    validate: (ctx) => {
      requireWorkspace(ctx)
      requireDocId(ctx)
      if (!['docx', 'pdf'].includes(String(ctx.req.query.format))) fail('Formato deve ser docx ou pdf', 'input.format')
    },
  },
  'docs.generate': {
    kind: 'data-write',
    methods: ['POST'],
    description: 'Gera uma documentação com o Claude Code (só ferramentas de leitura) e grava no diretório de dados',
    validate: (ctx) => {
      requireWorkspace(ctx)
      const b = ctx.req.body ?? {}
      if (!['tema', 'modulo', 'funcionalidade', 'fluxo'].includes(String(b.kind))) fail('Tipo deve ser tema, módulo, funcionalidade ou fluxo', 'input.doc-kind')
      const subject = String(b.subject ?? '').trim()
      if (subject.length < 2 || subject.length > 200) fail('Assunto precisa ter entre 2 e 200 caracteres', 'input.doc-subject')
      if (b.instructions !== undefined && (typeof b.instructions !== 'string' || b.instructions.length > 4000)) fail('Orientações longas demais', 'input.doc-instructions')
      if (b.regenerate !== undefined && !/^[a-z0-9-]{4,80}$/.test(String(b.regenerate))) fail('Documento inválido', 'input.doc-id')
    },
  },
  'docs.publish': {
    kind: 'external',
    methods: ['POST'],
    description: 'Publica a documentação no Claude Docs da conta do engenheiro (execução sem acesso ao código)',
    validate: (ctx) => (requireWorkspace(ctx), requireDocId(ctx)),
  },
  'docs.cancel': { kind: 'data-write', methods: ['POST'], description: 'Cancela a geração ou publicação em andamento de uma documentação', validate: (ctx) => (requireWorkspace(ctx), requireDocId(ctx)) },
  'docs.delete': { kind: 'data-write', methods: ['DELETE'], description: 'Remove a cópia da documentação no StoreFlow', validate: (ctx) => (requireWorkspace(ctx), requireDocId(ctx)) },

  'boards.list': { kind: 'read', methods: ['GET'], description: 'Lista os quadros (lousa) da instalação', validate: requireWorkspace },
  'boards.get': { kind: 'read', methods: ['GET'], description: 'Abre um quadro', validate: (ctx) => (requireWorkspace(ctx), requireBoardId(ctx)) },
  'boards.create': { kind: 'data-write', methods: ['POST'], description: 'Cria um quadro no diretório de dados do StoreFlow', validate: (ctx) => (requireWorkspace(ctx), requireBoardName(ctx)) },
  'boards.save': {
    kind: 'data-write',
    methods: ['PUT'],
    description: 'Salva desenho e nome de um quadro no diretório de dados do StoreFlow',
    validate: (ctx) => {
      requireWorkspace(ctx)
      requireBoardId(ctx)
      requireBoardName(ctx)
      const scene = ctx.req.body?.scene
      if (scene !== undefined && (typeof scene !== 'object' || !Array.isArray(scene?.elements))) fail('Desenho inválido', 'input.board-scene')
      if (scene?.files !== undefined && (typeof scene.files !== 'object' || Array.isArray(scene.files))) fail('Arquivos do quadro inválidos', 'input.board-scene')
    },
  },
  'boards.delete': { kind: 'data-write', methods: ['DELETE'], description: 'Exclui um quadro do diretório de dados do StoreFlow', validate: (ctx) => (requireWorkspace(ctx), requireBoardId(ctx)) },

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
