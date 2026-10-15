import { SetMetadata } from '@nestjs/common'
import type { Request } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { isSensitive, ReadOnlyViolation } from './path-guard'

/**
 * CRITICAL RULE: Agentic Toolkit is read-only with respect to Magento code.
 *
 * - `read`: only reads (Magento code, Agentic Toolkit data).
 * - `data-write`: writes exclusively inside Agentic Toolkit's data directory
 *   (its own clones, uploads, maps, annotations, settings). Never in a Magento repo.
 * - `external`: an HTTP request the engineer sends to an environment they chose
 *   (API simulator). It never touches the repository; it may change that
 *   environment's data, so it is validated, confirmed in the UI and audited.
 *
 * Every API route must be tagged with one of these actions and each action runs
 * its validator before the handler. Untagged routes are rejected (fail closed).
 */
export type ActionKind = 'read' | 'data-write' | 'external' | 'repo-exception' | 'repo-write'

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

const requireLinkChange = (ctx: ActionContext) => {
  const change = (ctx.req.body ?? {}).change
  if (typeof change !== 'string' || !/^[a-z0-9][a-z0-9-]{0,80}$/.test(change)) fail('Mudança inválida', 'input.link-change')
}

const requireLinkBody = (ctx: ActionContext) => {
  requireLinkChange(ctx)
  const b = (ctx.req.body ?? {}) as Record<string, unknown>
  if (!['diagram', 'board'].includes(String(b.kind))) fail('Tipo de ferramenta inválido', 'input.link-kind')
  if (!/^[a-z0-9-]{4,80}$/.test(String(b.refId ?? ''))) fail('Ferramenta inválida', 'input.link-ref')
}

const requireCardId = (ctx: ActionContext) => {
  const card = ctx.req.params.cardId
  if (card !== undefined && !/^[a-f0-9]{10}$/.test(String(card))) fail('Card inválido', 'input.card-id')
}

const requireBoardName = (ctx: ActionContext) => {
  const name = ctx.req.body?.name
  if (name !== undefined && (typeof name !== 'string' || name.length > 120)) fail('Nome do quadro inválido (até 120 caracteres)', 'input.board-name')
}

const requireDiagramId = (ctx: ActionContext) => {
  if (!/^[a-z0-9-]{4,80}$/.test(String(ctx.req.params.diagramId ?? ''))) fail('Diagrama inválido', 'input.diagram-id')
}

const requireDiagramBody = (ctx: ActionContext) => {
  const b = ctx.req.body ?? {}
  if (b.name !== undefined && (typeof b.name !== 'string' || b.name.length > 120)) fail('Nome do diagrama inválido (até 120 caracteres)', 'input.diagram-name')
  if (b.kind !== undefined && !['c4', 'uml', 'flow', 'other'].includes(String(b.kind))) fail('Tipo de diagrama inválido', 'input.diagram-kind')
  if (b.mode !== undefined && !['code', 'canvas'].includes(String(b.mode))) fail('Modo do diagrama inválido', 'input.diagram-mode')
  if (b.source !== undefined && (typeof b.source !== 'string' || b.source.length > 200_000)) fail('Código do diagrama inválido ou maior que 200 KB', 'input.diagram-source')
}

const requireGeneration = (ctx: ActionContext) => {
  const b = ctx.req.body ?? {}
  const request = String(b.request ?? '').trim()
  if (request.length < 3 || request.length > 4000) fail('Descreva o modelo em 3 a 4000 caracteres', 'input.generate-request')
  if (!['b2c', 'b2b', 'd2c', 'marketplace', 'custom'].includes(String(b.scenario))) fail('Cenário inválido', 'input.generate-scenario')
  if (!['c4-context', 'c4-container', 'c4-component', 'uml-class', 'uml-sequence', 'uml-state', 'flow', 'er'].includes(String(b.type))) fail('Tipo de modelo inválido', 'input.generate-type')
}

const requireJobId = (ctx: ActionContext) => {
  if (!/^[0-9a-f-]{36}$/.test(String(ctx.req.params.jobId ?? ''))) fail('Tarefa inválida', 'input.job-id')
}

const OPENSPEC_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,160}$/

const requireOpenSpecName = (value: unknown, field: string) => {
  const v = String(value ?? '')
  if (!OPENSPEC_NAME.test(v) || v.includes('..')) fail(`Nome inválido no OpenSpec (${field})`, 'input.openspec-name')
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
  'workspaces.configure': { kind: 'data-write', methods: ['PUT'], description: 'Escolhe a raiz Magento e os vendors próprios (metadados do Agentic Toolkit)', validate: requireWorkspace },
  'workspaces.sync': { kind: 'data-write', methods: ['POST'], description: 'git fetch no clone do Agentic Toolkit (nunca push)', validate: requireWorkspace },
  'workspace.settings.read': { kind: 'read', methods: ['GET'], description: 'Configurações do workspace: pasta, projeto, repositório git e variáveis (valores secretos nunca são enviados)', validate: requireWorkspace },
  'workspace.settings.write': {
    kind: 'data-write',
    methods: ['PUT'],
    description: 'Grava as configurações do workspace no diretório de dados; mudar a pasta, o projeto ou os vendors inicia uma nova análise',
    validate: (ctx) => {
      requireWorkspace(ctx)
      const b = (ctx.req.body ?? {}) as Record<string, unknown>
      for (const k of ['name', 'localPath', 'root', 'repoPath']) {
        if (b[k] !== undefined && (typeof b[k] !== 'string' || (b[k] as string).length > 1000)) fail(`Campo ${k} inválido`, 'input.workspace-settings')
      }
      if (b.ownVendors !== undefined && (!Array.isArray(b.ownVendors) || b.ownVendors.length > 500)) fail('Lista de vendors inválida', 'input.workspace-settings')
      if (b.env !== undefined && (!Array.isArray(b.env) || b.env.length > 40)) fail('Até 40 variáveis de ambiente', 'input.workspace-env')
    },
  },
  'workspace.settings.sync': { kind: 'data-write', methods: ['POST'], description: 'Sincroniza o workspace: git fetch no clone do Agentic Toolkit (nunca push) ou nova leitura da pasta local, seguida de nova análise', validate: requireWorkspace },
  'workspace.prerequisites': { kind: 'read', methods: ['GET'], description: 'O que cada funcionalidade precisa do workspace (análise, repositório git, Claude Code, IA)', validate: requireWorkspace },
  'workspaces.delete': {
    kind: 'data-write',
    methods: ['DELETE'],
    description: 'Remove a instalação do Agentic Toolkit (apaga só clones/uploads/mapas do Agentic Toolkit, nunca a pasta local)',
    validate: requireWorkspace,
  },

  'analysis.run': { kind: 'data-write', methods: ['POST'], description: 'Roda o extrator e grava o mapa no diretório de dados', validate: requireWorkspace },
  'jobs.get': { kind: 'read', methods: ['GET'], description: 'Progresso de uma tarefa' },
  'overview.get': { kind: 'read', methods: ['GET'], description: 'Visão geral da instalação', validate: requireWorkspace },
  'map.get': { kind: 'read', methods: ['GET'], description: 'Mapa de integrações e anotações', validate: requireWorkspace },
  'annotations.save': {
    kind: 'data-write',
    methods: ['PUT'],
    description: 'Grava anotações de análise no diretório de dados do Agentic Toolkit',
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
      if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname) && port === Number(process.env.AGENTIC_TOOLKIT_PORT ?? 4310)) {
        fail('O simulador não pode chamar a própria API do Agentic Toolkit', 'input.self-target')
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
  'docs.delete': { kind: 'data-write', methods: ['DELETE'], description: 'Remove a cópia da documentação no Agentic Toolkit', validate: (ctx) => (requireWorkspace(ctx), requireDocId(ctx)) },

  'news.status': { kind: 'read', methods: ['GET'], description: 'Estado da atualização do dia (segundo plano)' },
  'news.today': {
    kind: 'read',
    methods: ['GET'],
    description: 'Conteúdo da atualização do dia (um dia, padrão hoje): boletins de segurança do Adobe Commerce e o impacto em cada instalação',
    validate: (ctx) => {
      const d = (ctx.req.query as Record<string, unknown>).date
      if (d !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(d))) fail('Data inválida: use yyyy-mm-dd', 'input.news-date')
    },
  },
  'news.refresh': {
    kind: 'data-write',
    methods: ['POST'],
    description: 'Busca agora os boletins de segurança do Adobe (leitura de uma página permitida; grava só o cache do Agentic Toolkit)',
  },
  'news.settings.read': { kind: 'read', methods: ['GET'], description: 'Configurações da atualização do dia' },
  'news.settings.save': { kind: 'data-write', methods: ['PUT'], description: 'Salva as configurações da atualização do dia (no Agentic Toolkit)' },
  'git.read': { kind: 'read', methods: ['GET'], description: 'Visão geral do git local: branches, worktrees, alterações e histórico', validate: requireWorkspace },
  'git.write': {
    kind: 'repo-write',
    methods: ['POST', 'DELETE'],
    description: 'Gerencia o git local do projeto: fetch, pull, checkout, branches e worktrees (auditado)',
    validate: (ctx) => {
      requireWorkspace(ctx)
      const b = (ctx.req.body ?? {}) as Record<string, unknown>
      for (const k of ['branch', 'base', 'name']) {
        if (b[k] !== undefined && (typeof b[k] !== 'string' || (b[k] as string).length > 120)) fail('Nome de branch inválido', 'input.git-branch')
      }
    },
  },
  'git.push': {
    kind: 'external',
    methods: ['POST'],
    description: 'Envia uma branch ao remoto (git push -u), após confirmação na tela',
    validate: (ctx) => {
      requireWorkspace(ctx)
      if (typeof (ctx.req.body ?? {}).branch !== 'string') fail('Informe a branch', 'input.git-branch')
    },
  },
  'git.github.connect': {
    kind: 'external',
    methods: ['POST', 'DELETE'],
    description: 'Conecta (ou desconecta) o GitHub do repositório com a credencial do git desta máquina ou um token informado; a credencial fica só em memória',
    validate: (ctx) => {
      requireWorkspace(ctx)
      const b = (ctx.req.body ?? {}) as Record<string, unknown>
      if (ctx.req.method === 'POST' && !['git-credential', 'token'].includes(String(b.source))) fail('Escolha de onde vem a credencial', 'input.github-source')
      if (b.token !== undefined && (typeof b.token !== 'string' || b.token.length > 255)) fail('Token inválido', 'input.github-token')
    },
  },
  'git.prs.read': {
    kind: 'read',
    methods: ['GET'],
    description: 'Lê as pull requests do repositório no GitHub: lista, arquivos com o diff, revisões, comentários e checks',
    validate: (ctx) => {
      requireWorkspace(ctx)
      const n = ctx.req.params.number
      if (n !== undefined && !/^\d{1,9}$/.test(String(n))) fail('Pull request inválida', 'input.pr-number')
    },
  },
  'git.prs.review': {
    kind: 'external',
    methods: ['POST'],
    description: 'Envia uma revisão de pull request ao GitHub (aprovar, solicitar alterações ou comentar, com comentários de linha) ou responde a um comentário',
    validate: (ctx) => {
      requireWorkspace(ctx)
      if (!/^\d{1,9}$/.test(String(ctx.req.params.number ?? ''))) fail('Pull request inválida', 'input.pr-number')
      const c = ctx.req.params.commentId
      if (c !== undefined && !/^\d{1,15}$/.test(String(c))) fail('Comentário inválido', 'input.pr-comment')
      const b = (ctx.req.body ?? {}) as Record<string, unknown>
      if (b.event !== undefined && !['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(String(b.event))) fail('Tipo de revisão inválido', 'input.pr-event')
      if (b.comments !== undefined && (!Array.isArray(b.comments) || b.comments.length > 100)) fail('Até 100 comentários por revisão', 'input.pr-comments')
    },
  },
  'architecture.read': {
    kind: 'read',
    methods: ['GET'],
    description: 'Arquitetura viva: o desenho da plataforma montado a partir do mapeamento do projeto',
    validate: requireWorkspace,
  },
  'architecture.write': {
    kind: 'data-write',
    methods: ['PUT', 'POST', 'DELETE'],
    description: 'Guarda o arranjo da arquitetura viva, a opção de redesenho automático, ou copia uma versão para Diagramas (diretório de dados do Agentic Toolkit)',
    validate: (ctx) => {
      requireWorkspace(ctx)
      const b = (ctx.req.body ?? {}) as Record<string, unknown>
      if (b.positions !== undefined && (typeof b.positions !== 'object' || b.positions === null || Object.keys(b.positions).length > 400)) fail('Posições inválidas', 'input.architecture-positions')
      if (b.from !== undefined && !['live', 'claude'].includes(String(b.from))) fail('Versão inválida', 'input.architecture-from')
    },
  },
  'architecture.claude': {
    kind: 'data-write',
    methods: ['POST'],
    description: 'O Claude Code (somente leitura do código) desenha a arquitetura da plataforma a partir do mapeamento; o resultado vai para Diagramas',
    validate: requireWorkspace,
  },
  'refine.read': {
    kind: 'read',
    methods: ['GET'],
    description: 'Lê os cards de refinamento',
    validate: (ctx) => (requireWorkspace(ctx), requireCardId(ctx)),
  },
  'refine.write': {
    kind: 'data-write',
    methods: ['POST', 'PUT', 'DELETE'],
    description: 'Refinamento com o Claude (somente leitura do código): conversa, card refinado, edição e divisão. Grava no diretório de dados do Agentic Toolkit',
    validate: (ctx) => {
      requireWorkspace(ctx)
      requireCardId(ctx)
      const b = (ctx.req.body ?? {}) as Record<string, unknown>
      if (b.message !== undefined && (typeof b.message !== 'string' || b.message.length > 20000)) fail('Mensagem de até 20000 caracteres', 'input.refine-message')
      if (b.attachments !== undefined && (!Array.isArray(b.attachments) || b.attachments.length > 6 || !(b.attachments as unknown[]).every((a) => /^[a-f0-9]{16}\.(png|jpg|gif|webp)$/.test(String((a as Record<string, unknown>)?.id ?? ''))))) {
        fail('Até 6 imagens por mensagem', 'input.refine-attachments')
      }
      if (b.splits !== undefined && (!Array.isArray(b.splits) || b.splits.length > 6)) fail('Divida em até 6 partes', 'input.refine-splits')
    },
  },
  'refine.git': {
    kind: 'repo-write',
    methods: ['POST'],
    description: 'Prepara a branch e o worktree de uma tarefa (cria ou reaproveita; atualiza a base se pedido)',
    validate: (ctx) => {
      requireWorkspace(ctx)
      requireCardId(ctx)
      const b = (ctx.req.body ?? {}) as Record<string, unknown>
      if (!['new', 'existing'].includes(String(b.mode))) fail('Escolha criar ou usar uma branch existente', 'input.git-mode')
      if (typeof b.branch !== 'string' || b.branch.length > 120) fail('Nome de branch inválido', 'input.git-branch')
    },
  },
  'refine.develop': {
    kind: 'repo-write',
    methods: ['POST'],
    description: 'Inicia ou para o desenvolvimento de uma tarefa pelo Claude Code, com escrita no worktree da tarefa',
    validate: (ctx) => (requireWorkspace(ctx), requireCardId(ctx)),
  },
  'techs.list': { kind: 'read', methods: ['GET'], description: 'Lista as tecnologias suportadas pela instalação do Agentic Toolkit' },
  'sfcc.overview': {
    kind: 'read',
    methods: ['GET'],
    description: 'Visão geral de um projeto Salesforce B2C (cartuchos, controllers, templates, jobs, integrações e sites), lida do código, sem acessar a instância',
    validate: requireWorkspace,
  },
  'skills.read': {
    kind: 'read',
    methods: ['GET'],
    description: 'Lista as skills do Claude, as feature flags e os usos recentes, ou lê o SKILL.md de uma skill',
    validate: (ctx) => {
      const id = ctx.req.params.skillId
      if (id !== undefined && !/^[a-z0-9-]{2,64}$/.test(String(id))) fail('Skill inválida', 'input.skill-id')
    },
  },
  'skills.write': {
    kind: 'data-write',
    methods: ['PUT'],
    description: 'Liga ou desliga as skills do Claude (todas ou cada uma). Grava no diretório de dados do Agentic Toolkit',
    validate: (ctx) => {
      const b = (ctx.req.body ?? {}) as Record<string, unknown>
      if (b.enabled !== undefined && typeof b.enabled !== 'boolean') fail('enabled deve ser verdadeiro ou falso', 'input.skills-enabled')
      if (b.skills !== undefined && (typeof b.skills !== 'object' || b.skills === null || Object.values(b.skills).some((v) => typeof v !== 'boolean'))) fail('Feature flags inválidas', 'input.skills-flags')
    },
  },
  'sfcc.upload.read': {
    kind: 'read',
    methods: ['GET'],
    description: 'Mostra as ferramentas de upload do projeto Salesforce B2C, o dw.json (sem usuário nem senha), os cartuchos e o upload em andamento',
    validate: (ctx) => {
      requireWorkspace(ctx)
      const card = ctx.req.query.card
      if (card !== undefined && card !== '' && !/^[a-f0-9]{10}$/.test(String(card))) fail('Card inválido', 'input.card-id')
    },
  },
  'sfcc.upload.run': {
    kind: 'external',
    methods: ['POST'],
    description: 'Envia cartuchos para a instância Salesforce B2C do dw.json (code version) com o dwupload do projeto, de uma vez ou em upload automático; ou para o upload',
    validate: (ctx) => {
      requireWorkspace(ctx)
      const b = (ctx.req.body ?? {}) as Record<string, unknown>
      if (b.cardId !== undefined && b.cardId !== null && b.cardId !== '' && !/^[a-f0-9]{10}$/.test(String(b.cardId))) fail('Card inválido', 'input.card-id')
      if (b.mode !== undefined && !['upload', 'watch'].includes(String(b.mode))) fail('Modo de upload inválido', 'input.upload-mode')
      if (b.cartridges !== undefined && (!Array.isArray(b.cartridges) || b.cartridges.length > 30 || !(b.cartridges as unknown[]).every((c) => /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(String(c))))) {
        fail('Cartuchos inválidos', 'input.upload-cartridges')
      }
    },
  },
  'links.read': {
    kind: 'read',
    methods: ['GET'],
    description: 'Lista as ferramentas vinculadas às mudanças (diagramas e quadros)',
    validate: (ctx) => {
      requireWorkspace(ctx)
      const q = ctx.req.query as Record<string, unknown>
      if (q.change !== undefined && !/^[a-z0-9][a-z0-9-]{0,80}$/.test(String(q.change))) fail('Mudança inválida', 'input.link-change')
      if (q.kind !== undefined && !['diagram', 'board'].includes(String(q.kind))) fail('Tipo de ferramenta inválido', 'input.link-kind')
      if (q.refId !== undefined && !/^[a-z0-9-]{4,80}$/.test(String(q.refId))) fail('Ferramenta inválida', 'input.link-ref')
    },
  },
  'links.add': {
    kind: 'data-write',
    methods: ['POST'],
    description: 'Vincula um diagrama ou quadro existente a uma mudança (somente dados do Agentic Toolkit)',
    validate: (ctx) => (requireWorkspace(ctx), requireLinkBody(ctx)),
  },
  'links.remove': {
    kind: 'data-write',
    methods: ['DELETE'],
    description: 'Desvincula uma ferramenta de uma mudança; o diagrama ou quadro continua existindo',
    validate: (ctx) => {
      requireWorkspace(ctx)
      if (!/^[a-f0-9]{10}$/.test(String(ctx.req.params.linkId ?? ''))) fail('Vínculo inválido', 'input.link-id')
    },
  },
  'links.assist': {
    kind: 'data-write',
    methods: ['POST'],
    description: 'O Claude decide que ferramentas a mudança precisa (somente leitura) e cria e vincula cada uma',
    validate: (ctx) => (requireWorkspace(ctx), requireLinkChange(ctx)),
  },
  'links.create': {
    kind: 'data-write',
    methods: ['POST'],
    description: 'Cria e vincula as ferramentas sugeridas por uma revisão, depois que você aplicou a revisão',
    validate: (ctx) => {
      requireWorkspace(ctx)
      requireLinkChange(ctx)
      const tools = (ctx.req.body ?? {}).tools
      if (!Array.isArray(tools) || tools.length > 3) fail('Ferramentas inválidas (até 3)', 'input.link-tools')
    },
  },

  'boards.list': { kind: 'read', methods: ['GET'], description: 'Lista os quadros (lousa) da instalação', validate: requireWorkspace },
  'boards.get': { kind: 'read', methods: ['GET'], description: 'Abre um quadro', validate: (ctx) => (requireWorkspace(ctx), requireBoardId(ctx)) },
  'boards.create': { kind: 'data-write', methods: ['POST'], description: 'Cria um quadro no diretório de dados do Agentic Toolkit', validate: (ctx) => (requireWorkspace(ctx), requireBoardName(ctx)) },
  'boards.save': {
    kind: 'data-write',
    methods: ['PUT'],
    description: 'Salva desenho e nome de um quadro no diretório de dados do Agentic Toolkit',
    validate: (ctx) => {
      requireWorkspace(ctx)
      requireBoardId(ctx)
      requireBoardName(ctx)
      const scene = ctx.req.body?.scene
      if (scene !== undefined && (typeof scene !== 'object' || !Array.isArray(scene?.elements))) fail('Desenho inválido', 'input.board-scene')
      if (scene?.files !== undefined && (typeof scene.files !== 'object' || Array.isArray(scene.files))) fail('Arquivos do quadro inválidos', 'input.board-scene')
    },
  },
  'boards.delete': { kind: 'data-write', methods: ['DELETE'], description: 'Exclui um quadro do diretório de dados do Agentic Toolkit', validate: (ctx) => (requireWorkspace(ctx), requireBoardId(ctx)) },

  'diagrams.list': { kind: 'read', methods: ['GET'], description: 'Lista os diagramas de arquitetura da instalação', validate: requireWorkspace },
  'diagrams.get': { kind: 'read', methods: ['GET'], description: 'Abre um diagrama de arquitetura', validate: (ctx) => (requireWorkspace(ctx), requireDiagramId(ctx)) },
  'diagrams.create': { kind: 'data-write', methods: ['POST'], description: 'Cria um diagrama no diretório de dados do Agentic Toolkit', validate: (ctx) => (requireWorkspace(ctx), requireDiagramBody(ctx)) },
  'diagrams.save': { kind: 'data-write', methods: ['PUT'], description: 'Salva o código de um diagrama no diretório de dados do Agentic Toolkit', validate: (ctx) => (requireWorkspace(ctx), requireDiagramId(ctx), requireDiagramBody(ctx)) },
  'diagrams.generate': {
    kind: 'data-write',
    methods: ['POST'],
    description: 'Gera um modelo de arquitetura com o Claude Code (somente leitura) e salva como diagrama no diretório de dados',
    validate: (ctx) => (requireWorkspace(ctx), requireGeneration(ctx)),
  },
  'diagrams.cancel': { kind: 'data-write', methods: ['POST'], description: 'Cancela a geração de um diagrama em andamento', validate: (ctx) => (requireWorkspace(ctx), requireJobId(ctx)) },
  'diagrams.delete': { kind: 'data-write', methods: ['DELETE'], description: 'Exclui um diagrama do diretório de dados do Agentic Toolkit', validate: (ctx) => (requireWorkspace(ctx), requireDiagramId(ctx)) },

  'openspec.read': {
    kind: 'read',
    methods: ['GET'],
    description: 'Lê o OpenSpec da instalação (specs, mudanças, tarefas, validação pelo CLI) e gera prompts para o Claude',
    validate: (ctx) => {
      requireWorkspace(ctx)
      const q = ctx.req.query as Record<string, unknown>
      if (q.name !== undefined) requireOpenSpecName(q.name, 'mudança')
      if (q.id !== undefined) requireOpenSpecName(q.id, 'spec')
      if (q.change !== undefined && q.change !== '') requireOpenSpecName(q.change, 'mudança')
      if (q.kind !== undefined && !['install', 'propose', 'apply', 'validate', 'archive'].includes(String(q.kind))) fail('Ação de prompt inválida', 'input.openspec-kind')
    },
  },
  'openspec.write': {
    kind: 'data-write',
    methods: ['PUT'],
    description: 'Grava status manual (revisão, aprovada, etc.) e o mapeamento do OpenSpec no diretório de dados do Agentic Toolkit. Nunca escreve no repositório.',
    validate: (ctx) => {
      requireWorkspace(ctx)
      const b = (ctx.req.body ?? {}) as Record<string, unknown>
      if (ctx.req.path.endsWith('/status')) {
        if (!['change', 'spec'].includes(String(b.kind))) fail('Tipo de item inválido', 'input.openspec-kind')
        requireOpenSpecName(b.item, 'item')
        if (b.status !== null && typeof b.status !== 'string') fail('Status inválido', 'input.openspec-status')
      } else if (ctx.req.path.endsWith('/mapping')) {
        const p = String(b.path ?? '')
        if (p.length > 200) fail('Caminho longo demais', 'input.openspec-path')
      }
    },
  },
  'openspec.save': {
    kind: 'repo-exception',
    methods: ['PUT', 'POST'],
    description: 'EXCEÇÃO DE ESCRITA: cria ou edita specs, mudanças e tarefas do OpenSpec (lista em repo-exceptions.ts), com confirmação e auditoria',
    validate: (ctx) => {
      requireWorkspace(ctx)
      const b = (ctx.req.body ?? {}) as Record<string, unknown>
      if (ctx.req.path.endsWith('/file')) {
        if (typeof b.path !== 'string' || b.path.length > 300) fail('Caminho inválido', 'input.openspec-path')
        if (typeof b.content !== 'string' || Buffer.byteLength(b.content, 'utf8') > 512 * 1024) fail('Conteúdo inválido ou maior que 512 KB', 'input.openspec-content')
        if (b.expectedSha !== undefined && !/^[a-f0-9]{64}$/.test(String(b.expectedSha))) fail('Versão do arquivo inválida', 'input.openspec-sha')
      } else if (ctx.req.path.endsWith('/change') || ctx.req.path.endsWith('/change/skip')) {
        requireOpenSpecName(b.name, 'mudança')
      } else if (ctx.req.path.endsWith('/spec')) {
        if (typeof b.capability !== 'string' || b.capability.length > 160) fail('Capacidade inválida', 'input.openspec-capability')
      }
    },
  },
  'openspec.install.preview': {
    kind: 'data-write',
    methods: ['POST'],
    description: 'Prévia da instalação do OpenSpec: roda o CLI numa pasta de preparação do Agentic Toolkit e lista o que seria copiado',
    validate: (ctx) => requireWorkspace(ctx),
  },
  'openspec.install': {
    kind: 'repo-exception',
    methods: ['POST'],
    description: 'EXCEÇÃO DE ESCRITA: copia a instalação do OpenSpec (openspec/ e comandos do Claude) para a instalação, após confirmação',
    validate: (ctx) => {
      requireWorkspace(ctx)
      if (!/^[a-f0-9]{16}$/.test(String((ctx.req.body ?? {}).planId ?? ''))) fail('Prévia inválida', 'input.openspec-plan')
    },
  },
  'openspec.revise': {
    kind: 'read',
    methods: ['POST'],
    description: 'Revisa um arquivo do OpenSpec a partir de um pedido em linguagem natural (Claude Code somente leitura; nada é salvo até você aplicar)',
    validate: (ctx) => {
      requireWorkspace(ctx)
      const b = (ctx.req.body ?? {}) as Record<string, unknown>
      if (typeof b.path !== 'string' || b.path.length > 300 || b.path.includes('..')) fail('Caminho inválido', 'input.openspec-path')
      if (typeof b.instruction !== 'string' || b.instruction.trim().length < 3 || b.instruction.length > 2000) fail('Descreva a alteração em 3 a 2000 caracteres', 'input.openspec-request')
    },
  },
  'openspec.draft': {
    kind: 'read',
    methods: ['POST'],
    description: 'Rascunho de proposta, tarefas ou spec pelo Claude Code (somente leitura; o texto só é salvo se você confirmar)',
    validate: (ctx) => {
      requireWorkspace(ctx)
      const b = (ctx.req.body ?? {}) as Record<string, unknown>
      if (!['proposal', 'tasks', 'spec'].includes(String(b.kind))) fail('Tipo de rascunho inválido', 'input.openspec-kind')
      if (typeof b.request !== 'string' || b.request.trim().length < 3 || b.request.length > 4000) fail('Descreva o pedido em 3 a 4000 caracteres', 'input.openspec-request')
    },
  },
  'openspec.explore.read': {
    kind: 'read',
    methods: ['GET'],
    description: 'Lê as conversas de exploração do OpenSpec (somente leitura)',
    validate: (ctx) => {
      requireWorkspace(ctx)
      const q = ctx.req.query as Record<string, unknown>
      if (q.id !== undefined && !/^[a-f0-9]{12}$/.test(String(q.id))) fail('Conversa inválida', 'input.explore-id')
    },
  },
  'openspec.delete': {
    kind: 'repo-exception',
    methods: ['DELETE'],
    description: 'EXCEÇÃO DE ESCRITA: remove uma mudança ativa do OpenSpec (com confirmação do nome e cópia de segurança no Agentic Toolkit)',
    validate: (ctx) => {
      requireWorkspace(ctx)
      const q = ctx.req.query as Record<string, unknown>
      requireOpenSpecName(q.name, 'mudança')
      if (q.confirm !== q.name) fail('Confirme digitando o nome da mudança', 'input.openspec-confirm')
    },
  },
  'openspec.explore.link': {
    kind: 'data-write',
    methods: ['PUT'],
    description: 'Liga uma conversa de exploração à mudança criada a partir dela (só o histórico do Agentic Toolkit)',
    validate: (ctx) => {
      requireWorkspace(ctx)
      const b = (ctx.req.body ?? {}) as Record<string, unknown>
      if (!/^[a-f0-9]{12}$/.test(String(b.id ?? ''))) fail('Conversa inválida', 'input.explore-id')
      requireOpenSpecName(b.linkedChange, 'mudança')
    },
  },
  'openspec.explore.propose': {
    kind: 'read',
    methods: ['POST'],
    description: 'Rascunha a proposta de uma mudança a partir de uma conversa de exploração (somente leitura; nada é criado)',
    validate: (ctx) => {
      requireWorkspace(ctx)
      if (!/^[a-f0-9]{12}$/.test(String((ctx.req.body ?? {}).sessionId ?? ''))) fail('Conversa inválida', 'input.explore-id')
    },
  },
  'openspec.explore.delete': {
    kind: 'data-write',
    methods: ['DELETE'],
    description: 'Remove uma conversa de exploração do diretório de dados do Agentic Toolkit',
    validate: (ctx) => {
      requireWorkspace(ctx)
      if (!/^[a-f0-9]{12}$/.test(String((ctx.req.query as Record<string, unknown>).id ?? ''))) fail('Conversa inválida', 'input.explore-id')
    },
  },
  'openspec.explore.attach': {
    kind: 'data-write',
    methods: ['POST'],
    description: 'Guarda uma imagem anexada à conversa de exploração (PNG, JPG, GIF ou WEBP, até 5 MB) no diretório de dados do Agentic Toolkit',
    validate: requireWorkspace,
  },
  'openspec.explore.attachment': {
    kind: 'read',
    methods: ['GET'],
    description: 'Mostra uma imagem anexada a uma conversa de exploração',
    validate: (ctx) => {
      requireWorkspace(ctx)
      if (!/^[a-f0-9]{16}\.(png|jpg|gif|webp)$/.test(String((ctx.req.query as Record<string, unknown>).file ?? ''))) fail('Anexo inválido', 'input.explore-attachments')
    },
  },
  'openspec.create': {
    kind: 'repo-exception',
    methods: ['POST'],
    description: 'EXCEÇÃO DE ESCRITA: cria uma mudança do OpenSpec com os arquivos revisados (proposta, design, tarefas e deltas de spec), com confirmação e auditoria',
    validate: (ctx) => {
      requireWorkspace(ctx)
      const b = (ctx.req.body ?? {}) as Record<string, unknown>
      requireOpenSpecName(b.name, 'mudança')
      if (!b.files || typeof b.files !== 'object' || Array.isArray(b.files)) fail('Arquivos da mudança inválidos', 'input.openspec-files')
      const files = Object.entries(b.files as Record<string, unknown>)
      if (files.length < 2 || files.length > 30) fail('A mudança precisa de 2 a 30 arquivos', 'input.openspec-files')
      for (const [k, v] of files) {
        if (k.includes('..') || k.length > 200) fail('Caminho inválido', 'input.openspec-path')
        if (typeof v !== 'string' || Buffer.byteLength(v, 'utf8') > 512 * 1024) fail('Conteúdo inválido ou maior que 512 KB', 'input.openspec-content')
      }
    },
  },
  'openspec.explore': {
    kind: 'data-write',
    methods: ['POST'],
    description: 'Conversa de exploração com o Claude (só lê o código). Grava apenas o histórico da conversa no diretório de dados do Agentic Toolkit',
    validate: (ctx) => {
      requireWorkspace(ctx)
      const b = (ctx.req.body ?? {}) as Record<string, unknown>
      const attachments = b.attachments === undefined ? [] : b.attachments
      if (!Array.isArray(attachments) || attachments.length > 6) fail('Até 6 imagens por mensagem', 'input.explore-attachments')
      for (const a of attachments as unknown[]) {
        const att = (a ?? {}) as Record<string, unknown>
        if (!/^[a-f0-9]{16}\.(png|jpg|gif|webp)$/.test(String(att.id ?? ''))) fail('Anexo inválido', 'input.explore-attachments')
      }
      const message = b.message === undefined ? '' : b.message
      if (typeof message !== 'string' || message.length > 20000) fail('Mensagem de até 20000 caracteres', 'input.explore-message')
      if ((message as string).trim().length < 2 && (attachments as unknown[]).length === 0) fail('Escreva a mensagem ou anexe uma imagem', 'input.explore-message')
      if (b.sessionId !== undefined && !/^[a-f0-9]{12}$/.test(String(b.sessionId))) fail('Conversa inválida', 'input.explore-id')
    },
  },
  'ai.providers': { kind: 'read', methods: ['GET'], description: 'Provedores de IA disponíveis' },
  'ai.settings': { kind: 'data-write', methods: ['PUT'], description: 'Configura o provedor de IA (gravado no diretório de dados)' },
  'ai.ask': {
    kind: 'read',
    methods: ['POST'],
    description: 'Pergunta à IA sobre a instalação, com as tarefas do Refinamento vinculadas como contexto; a IA só recebe ferramentas de leitura (também no worktree das tarefas vinculadas)',
    validate: (ctx) => {
      requireWorkspace(ctx)
      const q = String(ctx.req.body?.question ?? '')
      if (!q.trim() || q.length > 8000) fail('Pergunta vazia ou longa demais', 'input.question')
      const b = (ctx.req.body ?? {}) as Record<string, unknown>
      if (b.cards !== undefined && (!Array.isArray(b.cards) || b.cards.length > 5 || !(b.cards as unknown[]).every((c) => /^[a-f0-9]{10}$/.test(String(c))))) fail('Até 5 tarefas vinculadas', 'input.ask-cards')
      if (
        b.history !== undefined &&
        (!Array.isArray(b.history) ||
          b.history.length > 20 ||
          !(b.history as unknown[]).every((t) => typeof (t as Record<string, unknown>)?.question === 'string' && typeof (t as Record<string, unknown>)?.answer === 'string' && JSON.stringify(t).length < 40_000))
      ) {
        fail('Histórico inválido', 'input.ask-history')
      }
    },
  },
} satisfies Record<string, ActionDef>

export type ActionId = keyof typeof ACTIONS

export const ACTION_KEY = 'agentic-toolkit:action'
export const Action = (id: ActionId) => SetMetadata(ACTION_KEY, id)
