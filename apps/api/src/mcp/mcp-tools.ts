import { UI_FEATURES, UI_PAGES } from '../ui/ui-catalog'
import type { McpGroup } from './mcp-settings.service'

/** Calls the app's own API, so every tool goes through the same read-only guard and audit as the screen */
export type ApiCall = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) => Promise<unknown>

export interface McpTool {
  name: string
  title: string
  group: McpGroup | 'sempre'
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean }
  /** Changes something (interface preferences or data of the app); never the code */
  writes?: boolean
  run: (args: Record<string, unknown>, api: ApiCall) => Promise<unknown>
}

const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra })
const WS = str('Id ou nome do workspace. Pode omitir quando só existe um. Veja listar_workspaces.')

type Workspace = { id: string; name: string; tech: string; status: string; edition?: string; version?: string }

/** The workspace a tool works on: by id, by name, or the only one there is */
async function workspace(api: ApiCall, q: unknown): Promise<Workspace> {
  const list = ((await api('GET', '/workspaces')) as Workspace[]).filter((w) => w.status === 'analyzed')
  if (!q) {
    if (list.length === 1) return list[0]
    throw new Error(`Informe o workspace: ${list.map((w) => `${w.id} (${w.name})`).join(', ') || 'nenhum analisado'}`)
  }
  const n = String(q).toLowerCase()
  const w = list.find((x) => x.id === q) ?? list.find((x) => x.name.toLowerCase() === n) ?? list.find((x) => x.id.startsWith(n) || x.name.toLowerCase().includes(n))
  if (!w) throw new Error(`Workspace "${q}" não encontrado. Disponíveis: ${list.map((x) => `${x.id} (${x.name})`).join(', ')}`)
  return w
}

const enc = encodeURIComponent

/** A REST or GraphQL route of the map, by id or by "METHOD /path" (or part of it) */
async function findRoute(api: ApiCall, ws: string, q: string): Promise<string> {
  const r = (await api('GET', `/workspaces/${ws}/map`)) as { map: { items?: { id: string; kind: string; title: string; module: string }[] } | null }
  const routes = (r.map?.items ?? []).filter((i) => i.kind === 'rest' || i.kind === 'graphql')
  const exact = routes.find((i) => i.id === q || i.title === q)
  if (exact) return exact.id
  const n = q.toLowerCase().replace(/\s+/g, ' ').trim()
  const found = routes.filter((i) => `${i.title} ${i.module}`.toLowerCase().includes(n))
  if (found.length === 1) return found[0].id
  if (!found.length) throw new Error(`Nenhuma rota REST/GraphQL do mapa corresponde a "${q}". Use buscar_no_mapa com tipo rest ou graphql.`)
  throw new Error(`Mais de uma rota corresponde a "${q}": ${found.slice(0, 12).map((i) => `${i.id} (${i.title})`).join('; ')}. Informe o id.`)
}

/** The guide the AI reads first: what each feature is for and how the tools reach it */
export function guide(topic?: string) {
  const features = UI_FEATURES.filter((f) => !topic || f.id === topic || f.title.toLowerCase().includes(topic.toLowerCase()))
  return [
    'Agentic Toolkit: dashboard somente leitura para entender projetos Adobe Commerce (Magento 2) e Salesforce B2C. Ele nunca escreve no código do projeto; o que grava fica no seu diretório de dados.',
    '',
    'Como trabalhar:',
    '1. listar_workspaces mostra os projetos conectados (o id é usado nas outras ferramentas).',
    '2. Para mudar a interface: guia_de_estilo explica o tema (cores, onde aparecem, contraste); ver_interface mostra o que dá para mudar e o estado atual. Nomes (renomear_funcionalidade), qualquer texto da tela (trocar_texto), cores, fonte e tamanhos (mudar_tema), menu (organizar_menu, ativar_funcionalidade), blocos das páginas (mostrar_bloco, mover_bloco) e, para o resto do visual, CSS (css_personalizado). Tudo aparece na hora para quem está com o app aberto e pode ser desfeito (desfazer_interface).',
    '   O que exige mudar o código do app (uma funcionalidade nova, o que um botão faz, a lógica de uma tela) não é possível por aqui: diga isso e sugira criar uma tarefa no Refinamento.',
    '3. Para entender o projeto: visao_geral, buscar_no_mapa (plugins, observers, APIs, crons, rotas por módulo), buscar_no_codigo, ler_arquivo e arquitetura_viva.',
    '4. Ações com IA ou tarefas longas (gerar_diagrama, analisar_projeto, desenhar_arquitetura) devolvem um jobId: chame aguardar_tarefa com ele para esperar o resultado (o diagramId, por exemplo).',
    '',
    'Fluxos que ligam as funcionalidades:',
    '- Diagrama → tarefa: ver_diagrama para entender o desenho, criar_card com a demanda e o diagrama em "diagramas" (ele fica anexado e entra no refinamento). Para refinar em seguida: aguardar_card, refinar_card e aguardar_card de novo.',
    '- Tarefa → diagrama: ver_card, gerar_diagrama (ou criar_diagrama com Mermaid que você escreve), aguardar_tarefa e anexar_ao_card.',
    '- Módulo → diagrama: listar_modulos ou buscar_no_mapa para achar o módulo e o que ele tem, gerar_diagrama pedindo o diagrama daquele módulo, e abrir_tela para mostrá-lo.',
    '- Simulador de API: buscar_no_mapa (tipo rest ou graphql) para achar a rota, modelo_requisicao_api para ver parâmetros e body, e preencher_simulador_api com valores de exemplo coerentes com o código. Nada é enviado: a pessoa confere e clica em Enviar.',
    '- abrir_tela leva a pessoa à tela do resultado (um diagrama, um card, o simulador).',
    '',
    'Funcionalidades (id · título · tecnologia):',
    ...features.map((f) => `- ${f.id} · ${f.title} · ${f.techs.join(', ') || 'todas'}${f.locked ? ' · fixa' : ''}\n  ${f.description}`),
    '',
    'Páginas com blocos configuráveis:',
    ...UI_PAGES.map((p) => `- ${p.id} · ${p.title}: ${p.blocks.map((b) => `${b.id} (${b.title})`).join(', ')}`),
  ].join('\n')
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'guia',
    title: 'Guia do Agentic Toolkit',
    group: 'sempre',
    description: 'Explica o Agentic Toolkit, cada funcionalidade e como usar as ferramentas deste servidor. Chame primeiro quando não souber por onde começar; "topico" filtra por uma funcionalidade.',
    inputSchema: { type: 'object', properties: { topico: str('Id ou nome de uma funcionalidade (opcional)') } },
    run: async (a) => guide(a.topico ? String(a.topico) : undefined),
  },

  {
    name: 'guia_de_estilo',
    title: 'Guia de estilo do tema',
    group: 'sempre',
    description: 'O guia de estilo do tema atual: cada cor e medida com o valor de agora e o padrão, onde aparece na tela, a regra de uso, o contraste medido (WCAG) entre texto e fundo, os componentes e os seletores para CSS. Leia antes de mudar cores ou o visual, e para sugerir paletas legíveis.',
    inputSchema: { type: 'object', properties: {} },
    run: async (_a, api) => ((await api('GET', '/ui/style-guide')) as { markdown: string }).markdown,
  },

  // ---- interface ----------------------------------------------------------------------------
  {
    name: 'ver_interface',
    title: 'Ver a interface',
    group: 'interface',
    description: 'Mostra tudo o que dá para mudar na interface e o estado atual: funcionalidades do menu (nome, seção, ativa ou não), blocos das páginas, textos trocados, itens do tema (cores, fonte, tamanhos) com o valor atual, o CSS personalizado e os seletores estáveis para CSS. Use antes de mudar algo, para pegar os ids.',
    inputSchema: { type: 'object', properties: {} },
    run: async (_a, api) => {
      const v = (await api('GET', '/ui')) as {
        prefs: { texts: { from: string; to: string }[]; css: string; menu: { order: string[] } }
        features: { id: string; title: string; originalTitle: string; section: string; enabled: boolean; locked?: boolean; techs: string[] }[]
        pages: { id: string; title: string; blocks: { id: string; title: string; visible: boolean }[] }[]
        theme: { id: string; title: string; kind: string; current: string; changed: boolean }[]
        cssMap: [string, string][]
        canUndo: boolean
      }
      return {
        funcionalidades: v.features.map((f) => ({ id: f.id, nome: f.title, ...(f.title !== f.originalTitle ? { nome_original: f.originalTitle } : {}), secao: f.section, tecnologias: f.techs.length ? f.techs : 'todas', estado: f.locked ? 'fixa' : f.enabled ? 'ativa' : 'desativada' })),
        ordem_do_menu: v.prefs.menu.order.length ? v.prefs.menu.order : 'padrão',
        paginas: v.pages.map((p) => ({ id: p.id, titulo: p.title, blocos: p.blocks.map((b, i) => ({ posicao: i + 1, id: b.id, titulo: b.title, visivel: b.visible })) })),
        textos_trocados: v.prefs.texts,
        tema: v.theme.map((t) => ({ id: t.id, titulo: t.title, tipo: t.kind, valor: t.current, alterado: t.changed })),
        css_personalizado: v.prefs.css || '(nenhum)',
        seletores_para_css: Object.fromEntries(v.cssMap),
        pode_desfazer: v.canUndo,
      }
    },
  },
  {
    name: 'ativar_funcionalidade',
    title: 'Ativar ou desativar uma funcionalidade',
    group: 'interface',
    writes: true,
    description: 'Ativa ou desativa uma funcionalidade do menu lateral (ex.: desativar "Fluxo 3D" porque a pessoa não usa). Uma funcionalidade desativada some do menu; os dados dela continuam guardados. A Visão geral é fixa.',
    inputSchema: { type: 'object', properties: { funcionalidade: str('Id ou título da funcionalidade (veja ver_interface)'), ativa: { type: 'boolean', description: 'true para ativar, false para desativar' } }, required: ['funcionalidade', 'ativa'] },
    run: async (a, api) => api('POST', '/ui/actions', { actions: [{ type: 'feature', feature: a.funcionalidade, enabled: a.ativa === true }] }),
  },
  {
    name: 'mostrar_bloco',
    title: 'Mostrar ou ocultar um bloco',
    group: 'interface',
    writes: true,
    description: 'Oculta ou mostra um bloco de informação de uma página (ex.: ocultar "Atividade recente" da Visão geral). Toda página com cartões e seções tem blocos, que aparecem em ver_interface depois que a página foi aberta no app.',
    inputSchema: { type: 'object', properties: { pagina: str('Id ou título da página (veja ver_interface)'), bloco: str('Id ou título do bloco'), visivel: { type: 'boolean', description: 'true para mostrar, false para ocultar' } }, required: ['pagina', 'bloco', 'visivel'] },
    run: async (a, api) => api('POST', '/ui/actions', { actions: [{ type: 'block-visibility', page: a.pagina, block: a.bloco, visible: a.visivel === true }] }),
  },
  {
    name: 'mover_bloco',
    title: 'Mover um bloco',
    group: 'interface',
    writes: true,
    description: 'Muda um bloco de lugar na página: para o topo, para o fim, uma posição acima ou abaixo, ou antes/depois de outro bloco do mesmo grupo (nas páginas além da Visão geral, um bloco se move dentro do seu grupo: a linha de cartões ou as seções da página) (ex.: colocar "Stack" abaixo de "Highlights técnicos" = posicao "after", referencia "highlights").',
    inputSchema: {
      type: 'object',
      properties: {
        pagina: str('Id ou título da página'),
        bloco: str('Id ou título do bloco a mover'),
        posicao: str('Para onde', { enum: ['top', 'bottom', 'up', 'down', 'before', 'after'] }),
        referencia: str('Bloco de referência, para before/after'),
      },
      required: ['pagina', 'bloco', 'posicao'],
    },
    run: async (a, api) => api('POST', '/ui/actions', { actions: [{ type: 'block-move', page: a.pagina, block: a.bloco, position: a.posicao, ref: a.referencia }] }),
  },
  {
    name: 'renomear_funcionalidade',
    title: 'Renomear uma funcionalidade',
    group: 'interface',
    writes: true,
    description: 'Dá um novo nome a uma funcionalidade: muda no menu e no título da página (ex.: "Pergunte ao código" → "Pergunte a Sophia"). Nome vazio volta ao original.',
    inputSchema: { type: 'object', properties: { funcionalidade: str('Id, nome original ou nome atual'), nome: str('O novo nome (vazio para o original)') }, required: ['funcionalidade'] },
    run: async (a, api) => api('POST', '/ui/actions', { actions: [{ type: 'rename', feature: a.funcionalidade, title: a.nome ? String(a.nome) : null }] }),
  },
  {
    name: 'trocar_texto',
    title: 'Trocar um texto da tela',
    group: 'interface',
    writes: true,
    description: 'Troca qualquer texto visível do app por outro, em todas as telas: títulos de seção, rótulos de botões, legendas, cabeçalhos (ex.: "Highlights técnicos" → "Pontos de destaque"). Informe o texto exatamente como está escrito (títulos de seção do menu aparecem em maiúsculas mas são escritos normalmente, ex.: "Desenvolvimento"). Omita "novo" para voltar ao original. Para nomes de funcionalidades prefira renomear_funcionalidade.',
    inputSchema: { type: 'object', properties: { texto: str('O texto atual, exatamente como está escrito'), novo: str('O texto novo (omita para voltar ao original)') }, required: ['texto'] },
    run: async (a, api) => api('POST', '/ui/actions', { actions: [{ type: 'text', from: String(a.texto), to: a.novo === undefined || a.novo === null ? null : String(a.novo) }] }),
  },
  {
    name: 'mudar_tema',
    title: 'Mudar cores, fonte e tamanhos',
    group: 'interface',
    writes: true,
    description: 'Muda o tema: cores (accent = destaque, bg = fundo, panel = cartões, panel-2, hover, text, muted, faint, border, blue, green, yellow, red, purple), fonte, tamanho do texto, arredondamento (radius) e largura do menu (sidebar-width). Para uma paleta ou várias mudanças, mande TODAS de uma vez em "itens" ({"accent": "#1d4ed8", "bg": "#eef3fb", ...}): vira um único passo, desfeito com um só desfazer_interface. Para um item só, "item" e "valor". Cores em #hex, rgb() ou hsl(); tamanhos em px, rem, em ou %. Valor vazio volta ao padrão. Leia guia_de_estilo antes de trocar a paleta.',
    inputSchema: {
      type: 'object',
      properties: {
        itens: { type: 'object', description: 'Vários itens de uma vez: {"id do item": "valor"}', additionalProperties: { type: 'string' } },
        item: str('Um item só (ex.: accent)'),
        valor: str('O valor do item (vazio para o padrão)'),
      },
    },
    run: async (a, api) => {
      const many = a.itens && typeof a.itens === 'object' ? Object.entries(a.itens as Record<string, unknown>) : []
      const pairs = many.length ? many : a.item ? [[String(a.item), a.valor]] : []
      if (!pairs.length) throw new Error('Informe "itens" ({"accent": "#1d4ed8"}) ou "item" e "valor"')
      return api('POST', '/ui/actions', { actions: pairs.map(([token, value]) => ({ type: 'theme', token: String(token), value: value ? String(value) : null })) })
    },
  },
  {
    name: 'organizar_menu',
    title: 'Organizar o menu',
    group: 'interface',
    writes: true,
    description: 'Muda uma funcionalidade de lugar no menu lateral (topo, fim, acima, abaixo, antes ou depois de outra) e/ou de seção (uma seção existente ou nova, ex.: "Favoritos"). Seção vazia volta à original.',
    inputSchema: {
      type: 'object',
      properties: {
        funcionalidade: str('Id ou nome da funcionalidade'),
        posicao: str('Para onde', { enum: ['top', 'bottom', 'up', 'down', 'before', 'after'] }),
        referencia: str('Outra funcionalidade, para before/after'),
        secao: str('Nome da seção onde ela deve ficar'),
      },
      required: ['funcionalidade'],
    },
    run: async (a, api) => api('POST', '/ui/actions', { actions: [{ type: 'menu-move', feature: a.funcionalidade, position: a.posicao, ref: a.referencia, section: a.secao === undefined ? undefined : String(a.secao) }] }),
  },
  {
    name: 'css_personalizado',
    title: 'CSS personalizado',
    group: 'interface',
    writes: true,
    description: 'Para qualquer mudança visual que as outras ferramentas não cobrem (espaçamentos, bordas, tamanho de um elemento, esconder um botão, mudar o layout de uma área): escreve CSS aplicado a todo o app. Use os seletores estáveis de ver_interface (ex.: [data-block="stack"], .sf-nav[data-feature="ask"], .sf-content[data-feature="overview"] .sf-card). "acrescentar" soma ao CSS atual; "substituir" troca tudo; css vazio remove. Não aceita @import, url() nem scripts.',
    inputSchema: { type: 'object', properties: { css: str('As regras CSS'), modo: str('acrescentar ou substituir', { enum: ['acrescentar', 'substituir'] }) }, required: ['css'] },
    run: async (a, api) => api('POST', '/ui/actions', { actions: [{ type: 'css', css: a.css ? String(a.css) : null, mode: a.modo === 'substituir' ? 'replace' : 'append' }] }),
  },
  {
    name: 'desfazer_interface',
    title: 'Desfazer a última mudança de interface',
    group: 'interface',
    writes: true,
    description: 'Desfaz a última mudança de interface (nome, texto, tema, menu, blocos, CSS), venha de onde vier. Pode ser chamada várias vezes para voltar mais passos.',
    inputSchema: { type: 'object', properties: {} },
    run: async (_a, api) => api('POST', '/ui/actions', { actions: [{ type: 'undo' }] }),
  },
  {
    name: 'restaurar_interface',
    title: 'Restaurar o padrão',
    group: 'interface',
    writes: true,
    description: 'Volta ao padrão: "tudo", "funcionalidades" (todas ativas), "textos" (nomes e textos), "tema", "menu", "css" ou os blocos de uma página (o id dela).',
    inputSchema: { type: 'object', properties: { escopo: str('tudo, funcionalidades, textos, tema, menu, css ou o id de uma página') }, required: ['escopo'] },
    run: async (a, api) => api('POST', '/ui/actions', { actions: [{ type: 'reset', scope: a.escopo }] }),
  },

  // ---- consulta -----------------------------------------------------------------------------
  {
    name: 'listar_workspaces',
    title: 'Listar workspaces',
    group: 'consulta',
    description: 'Os projetos conectados ao Agentic Toolkit: id, nome, tecnologia (adobe-commerce ou salesforce-b2c), versão e estado da análise.',
    inputSchema: { type: 'object', properties: {} },
    run: async (_a, api) => ((await api('GET', '/workspaces')) as Workspace[]).map((w) => ({ id: w.id, nome: w.name, tecnologia: w.tech, edicao: w.edition, versao: w.version, estado: w.status })),
  },
  {
    name: 'visao_geral',
    title: 'Visão geral do projeto',
    group: 'consulta',
    description: 'O resumo do projeto que a Visão geral mostra: versão, módulos por origem, extensões, pontos de integração, riscos, stack e highlights.',
    inputSchema: { type: 'object', properties: { workspace: WS } },
    run: async (a, api) => {
      const w = await workspace(api, a.workspace)
      return api('GET', w.tech === 'salesforce-b2c' ? `/workspaces/${w.id}/sfcc/overview` : `/workspaces/${w.id}/overview`)
    },
  },
  {
    name: 'buscar_no_mapa',
    title: 'Buscar no mapa de integrações',
    group: 'consulta',
    description: 'Procura no mapa extraído do código (Adobe Commerce): plugins, preferences, observers, endpoints REST, operações GraphQL, crons, filas e rotas, com módulo, arquivo e linha. Filtre por tipo, módulo, origem ou texto.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: WS,
        tipo: str('plugin, preference, observer, rest, graphql, cron, queue ou route', { enum: ['plugin', 'preference', 'observer', 'rest', 'graphql', 'cron', 'queue', 'route'] }),
        modulo: str('Parte do nome do módulo (ex.: Vendor_Checkout)'),
        origem: str('custom, thirdparty ou native', { enum: ['custom', 'thirdparty', 'native'] }),
        texto: str('Texto no título ou nos detalhes'),
        limite: { type: 'number', description: 'Máximo de itens (padrão 50, até 300)' },
      },
    },
    run: async (a, api) => {
      const w = await workspace(api, a.workspace)
      const r = (await api('GET', `/workspaces/${w.id}/map`)) as { map: { items?: Record<string, unknown>[] } | null }
      const t = a.texto ? String(a.texto).toLowerCase() : ''
      const items = (r.map?.items ?? []).filter(
        (i) =>
          (!a.tipo || i.kind === a.tipo) &&
          (!a.origem || i.origin === a.origem) &&
          (!a.modulo || String(i.module).toLowerCase().includes(String(a.modulo).toLowerCase())) &&
          (!t || JSON.stringify(i).toLowerCase().includes(t)),
      )
      const limit = Math.min(300, Math.max(1, Number(a.limite) || 50))
      return { total: items.length, itens: items.slice(0, limit) }
    },
  },
  {
    name: 'buscar_no_codigo',
    title: 'Buscar no código',
    group: 'consulta',
    description: 'Busca um texto nos arquivos do projeto (até 300 ocorrências), com arquivo e linha. Arquivos sensíveis (env.php, auth.json, chaves) não são lidos.',
    inputSchema: { type: 'object', properties: { workspace: WS, texto: str('O texto a procurar'), pasta: str('Restringe a uma pasta (caminho relativo)') }, required: ['texto'] },
    run: async (a, api) => {
      const w = await workspace(api, a.workspace)
      return api('GET', `/workspaces/${w.id}/search?q=${enc(String(a.texto))}${a.pasta ? `&under=${enc(String(a.pasta))}` : ''}`)
    },
  },
  {
    name: 'ler_arquivo',
    title: 'Ler um arquivo',
    group: 'consulta',
    description: 'Lê um arquivo do projeto pelo caminho relativo à raiz. Arquivos sensíveis são recusados.',
    inputSchema: { type: 'object', properties: { workspace: WS, caminho: str('Caminho relativo, ex.: app/code/Vendor/Module/etc/di.xml') }, required: ['caminho'] },
    run: async (a, api) => {
      const w = await workspace(api, a.workspace)
      return api('GET', `/workspaces/${w.id}/file?path=${enc(String(a.caminho))}`)
    },
  },
  {
    name: 'listar_pasta',
    title: 'Listar uma pasta',
    group: 'consulta',
    description: 'Lista os arquivos e pastas de um caminho do projeto (vazio = raiz).',
    inputSchema: { type: 'object', properties: { workspace: WS, caminho: str('Caminho relativo (vazio para a raiz)') } },
    run: async (a, api) => {
      const w = await workspace(api, a.workspace)
      return api('GET', `/workspaces/${w.id}/files?path=${enc(String(a.caminho ?? ''))}`)
    },
  },
  {
    name: 'arquitetura_viva',
    title: 'Arquitetura viva',
    group: 'consulta',
    description: 'A arquitetura de referência do projeto em camadas (storefront, APIs e processamento, plataforma, infraestrutura, sistemas do cliente e parceiros), com as conexões e as evidências do código de cada elemento.',
    inputSchema: { type: 'object', properties: { workspace: WS } },
    run: async (a, api) => {
      const w = await workspace(api, a.workspace)
      const v = (await api('GET', `/workspaces/${w.id}/architecture/live`)) as { graph: { nodes: { id: string; type: string; title: string; tech?: string; parent?: string }[]; edges: { source: string; target: string; label?: string; tech?: string }[] }; details: Record<string, { lines: string[] }> }
      const title = (id: string) => v.graph.nodes.find((n) => n.id === id)?.title ?? id
      return {
        elementos: v.graph.nodes.map((n) => ({ id: n.id, tipo: n.type, titulo: n.title, tech: n.tech, camada: n.parent ? title(n.parent) : undefined, evidencias: v.details[n.id]?.lines.slice(0, 12) })),
        conexoes: v.graph.edges.map((e) => `${title(e.source)} → ${title(e.target)}${e.label ? `: ${e.label}` : ''}${e.tech ? ` [${e.tech}]` : ''}`),
      }
    },
  },
  {
    name: 'listar_cards',
    title: 'Cards de refinamento',
    group: 'consulta',
    description: 'Os cards de refinamento do workspace (demandas refinadas pela IA) com título e estado.',
    inputSchema: { type: 'object', properties: { workspace: WS } },
    run: async (a, api) => {
      const w = await workspace(api, a.workspace)
      return api('GET', `/workspaces/${w.id}/refine/cards`)
    },
  },
  {
    name: 'harness_da_ia',
    title: 'Harness da IA',
    group: 'consulta',
    description: 'O harness da IA configurada no app: o que roda o modelo (Claude Code, API da Anthropic ou modelo compatível com OpenAI), modelo, autenticação, plugins, skills, subagentes e MCP carregados, e o que cada funcionalidade usa (motor, ferramentas, acesso, skills do toolkit). Mostra também quais funcionalidades sempre usam o Claude Code.',
    inputSchema: { type: 'object', properties: { workspace: WS } },
    run: async (a, api) => {
      const w = await workspace(api, a.workspace)
      return api('GET', `/workspaces/${w.id}/ai/harness`)
    },
  },
  {
    name: 'status_tarefa',
    title: 'Status de uma tarefa',
    group: 'consulta',
    description: 'O andamento de uma tarefa longa (análise, desenho, documentação) pelo jobId que outra ferramenta devolveu.',
    inputSchema: { type: 'object', properties: { jobId: str('O id da tarefa') }, required: ['jobId'] },
    run: async (a, api) => api('GET', `/jobs/${enc(String(a.jobId))}`),
  },
  {
    name: 'auditoria',
    title: 'Auditoria',
    group: 'consulta',
    description: 'As últimas ações registradas na auditoria (o que foi lido, gravado ou bloqueado), incluindo as feitas por este MCP.',
    inputSchema: { type: 'object', properties: { limite: { type: 'number', description: 'Quantas (padrão 30)' } } },
    run: async (a, api) => ((await api('GET', '/system/audit')) as unknown[]).slice(0, Math.min(200, Number(a.limite) || 30)),
  },


  // ---- consulta: the items of each feature ---------------------------------------------------
  {
    name: 'listar_modulos',
    title: 'Listar módulos',
    group: 'consulta',
    description: 'Os módulos do projeto que aparecem no mapa (Adobe Commerce), com a origem (custom, thirdparty) e quantos plugins, observers, APIs, crons e rotas cada um tem. Filtre por parte do nome.',
    inputSchema: { type: 'object', properties: { workspace: WS, texto: str('Parte do nome do módulo (ex.: Checkout, Erp)') } },
    run: async (a, api) => {
      const w = await workspace(api, a.workspace)
      const r = (await api('GET', `/workspaces/${w.id}/map`)) as { map: { items?: { module: string; origin: string; kind: string }[] } | null }
      const t = a.texto ? String(a.texto).toLowerCase() : ''
      const mods = new Map<string, { modulo: string; origem: string; itens: Record<string, number> }>()
      for (const i of r.map?.items ?? []) {
        if (i.origin === 'native' || (t && !i.module.toLowerCase().includes(t))) continue
        const m = mods.get(i.module) ?? { modulo: i.module, origem: i.origin, itens: {} }
        m.itens[i.kind] = (m.itens[i.kind] ?? 0) + 1
        mods.set(i.module, m)
      }
      return [...mods.values()].sort((x, y) => x.modulo.localeCompare(y.modulo)).slice(0, 300)
    },
  },
  {
    name: 'listar_diagramas',
    title: 'Listar diagramas',
    group: 'consulta',
    description: 'Os diagramas do workspace (Diagramas de arquitetura): id, nome, tipo e data. Use o id em ver_diagrama, anexar_ao_card e abrir_tela.',
    inputSchema: { type: 'object', properties: { workspace: WS } },
    run: async (a, api) => {
      const w = await workspace(api, a.workspace)
      return ((await api('GET', `/workspaces/${w.id}/diagrams`)) as { id: string; name: string; kind: string; mode?: string; updatedAt: string }[]).map((d) => ({ id: d.id, nome: d.name, tipo: d.kind, formato: d.mode === 'canvas' ? 'canvas' : 'mermaid', atualizado: d.updatedAt }))
    },
  },
  {
    name: 'ver_diagrama',
    title: 'Ver um diagrama',
    group: 'consulta',
    description: 'O conteúdo de um diagrama (Mermaid ou o grafo do canvas), para entender o que ele mostra antes de criar uma tarefa ou explicar.',
    inputSchema: { type: 'object', properties: { workspace: WS, diagrama: str('Id do diagrama (veja listar_diagramas)') }, required: ['diagrama'] },
    run: async (a, api) => {
      const w = await workspace(api, a.workspace)
      return api('GET', `/workspaces/${w.id}/diagrams/${enc(String(a.diagrama))}`)
    },
  },
  {
    name: 'ver_card',
    title: 'Ver uma tarefa do Refinamento',
    group: 'consulta',
    description: 'Uma tarefa (card) do Refinamento: título, estado, a conversa, o card refinado (negócio, técnico, plano, critérios) e os diagramas anexados.',
    inputSchema: { type: 'object', properties: { workspace: WS, card: str('Id do card (veja listar_cards)') }, required: ['card'] },
    run: async (a, api) => {
      const w = await workspace(api, a.workspace)
      const c = (await api('GET', `/workspaces/${w.id}/refine/cards/${enc(String(a.card))}`)) as Record<string, unknown> & { messages?: { role: string; content: string }[] }
      return { ...c, messages: (c.messages ?? []).slice(-8).map((m) => ({ role: m.role, content: m.content.slice(0, 3000) })) }
    },
  },
  {
    name: 'modelo_requisicao_api',
    title: 'Modelo de requisição de uma rota',
    group: 'consulta',
    description: 'O modelo de requisição de uma rota REST ou GraphQL do mapa: método, caminho, parâmetros de caminho, query, body com os campos da interface PHP e a autenticação sugerida. Use antes de preencher_simulador_api. "rota" aceita o id do mapa ou um texto como "POST /V1/carts/mine".',
    inputSchema: { type: 'object', properties: { workspace: WS, rota: str('Id da rota no mapa ou "MÉTODO /caminho"') }, required: ['rota'] },
    run: async (a, api) => {
      const w = await workspace(api, a.workspace)
      const routeId = await findRoute(api, w.id, String(a.rota))
      return { routeId, ...((await api('GET', `/workspaces/${w.id}/api-client/template?route=${enc(routeId)}`)) as object) }
    },
  },
  {
    name: 'aguardar_tarefa',
    title: 'Aguardar uma tarefa',
    group: 'consulta',
    description: 'Espera uma tarefa longa terminar (até 50 segundos por chamada) e devolve o resultado, como o diagramId de um diagrama gerado. Se voltar "running", chame de novo.',
    inputSchema: { type: 'object', properties: { jobId: str('O id da tarefa') }, required: ['jobId'] },
    run: async (a, api) => {
      const started = Date.now()
      for (;;) {
        const job = (await api('GET', `/jobs/${enc(String(a.jobId))}`)) as { status: string; result?: unknown; error?: string; log?: string[] }
        if (job.status !== 'running' || Date.now() - started > 50_000) return { estado: job.status, resultado: job.result, erro: job.error, ultimas_linhas: (job.log ?? []).slice(-5) }
        await new Promise((r) => setTimeout(r, 3000))
      }
    },
  },

  {
    name: 'aguardar_card',
    title: 'Aguardar uma tarefa do Refinamento',
    group: 'consulta',
    description: 'Espera o Claude do app terminar o que está fazendo numa tarefa do Refinamento (responder ou refinar), até 50 segundos por chamada, e devolve o estado, a última resposta e o card refinado. Se ainda estiver ocupado, chame de novo.',
    inputSchema: { type: 'object', properties: { workspace: WS, card: str('Id do card') }, required: ['card'] },
    run: async (a, api) => {
      const w = await workspace(api, a.workspace)
      const started = Date.now()
      for (;;) {
        const c = (await api('GET', `/workspaces/${w.id}/refine/cards/${enc(String(a.card))}`)) as { id: string; title: string; status: string; busy?: string; error?: string; refinement?: unknown; messages: { role: string; content: string }[] }
        if (!c.busy || Date.now() - started > 50_000) return { card: c.id, titulo: c.title, estado: c.status, ocupado: c.busy ?? null, erro: c.error, ultima_resposta: c.messages.at(-1)?.role === 'assistant' ? c.messages.at(-1)!.content.slice(0, 4000) : null, refinamento: c.refinement ?? null }
        await new Promise((r) => setTimeout(r, 3000))
      }
    },
  },

  // ---- trabalho: create and link items of the toolkit ----------------------------------------
  {
    name: 'criar_diagrama',
    title: 'Criar um diagrama (Mermaid)',
    group: 'trabalho',
    writes: true,
    description: 'Cria um diagrama em Diagramas de arquitetura a partir de um Mermaid que você escreve (flowchart, sequenceDiagram, classDiagram, erDiagram, C4…). Sem custo de IA no app. Para um diagrama lido do código pelo Claude do app, use gerar_diagrama. Devolve o id.',
    inputSchema: {
      type: 'object',
      properties: { workspace: WS, nome: str('Nome do diagrama'), mermaid: str('O código Mermaid'), tipo: str('c4, uml, flow ou other', { enum: ['c4', 'uml', 'flow', 'other'] }) },
      required: ['nome', 'mermaid'],
    },
    run: async (a, api) => {
      const w = await workspace(api, a.workspace)
      const d = (await api('POST', `/workspaces/${w.id}/diagrams`, { name: String(a.nome), kind: a.tipo ?? 'flow', mode: 'code', source: String(a.mermaid) })) as { id: string; name: string }
      return { diagramId: d.id, nome: d.name, abrir: `diagrams?diagram=${d.id}` }
    },
  },
  {
    name: 'anexar_ao_card',
    title: 'Anexar um diagrama a uma tarefa',
    group: 'trabalho',
    writes: true,
    description: 'Anexa um diagrama a uma tarefa do Refinamento. O diagrama aparece no card e entra como contexto quando o Claude conversa e refina a tarefa.',
    inputSchema: { type: 'object', properties: { workspace: WS, card: str('Id do card'), diagrama: str('Id do diagrama') }, required: ['card', 'diagrama'] },
    run: async (a, api) => {
      const w = await workspace(api, a.workspace)
      const c = (await api('POST', `/workspaces/${w.id}/refine/cards/${enc(String(a.card))}/attached`, { kind: 'diagram', refId: String(a.diagrama) })) as { id: string; title: string; attached?: unknown[] }
      return { card: c.id, titulo: c.title, anexos: c.attached }
    },
  },
  {
    name: 'abrir_tela',
    title: 'Abrir uma tela',
    group: 'trabalho',
    description: 'Abre uma tela do app para a pessoa (nas abas do Agentic Toolkit que estão abertas): uma funcionalidade pelo id (veja guia) e, opcionalmente, um item: diagrams com o id do diagrama, refinamento com o id do card, api-client com o id da rota.',
    inputSchema: { type: 'object', properties: { workspace: WS, tela: str('Id da funcionalidade: diagrams, refinamento, api-client, arquitetura-viva, modules, settings…'), item: str('Id do diagrama, do card ou da rota (opcional)') }, required: ['tela'] },
    run: async (a, api) => {
      const w = await workspace(api, a.workspace)
      const tela = String(a.tela).replace(/^\/+/, '')
      const item = a.item ? String(a.item) : ''
      const path = !item ? tela : tela === 'diagrams' ? `diagrams?diagram=${enc(item)}` : tela === 'refinamento' ? `refinamento/${enc(item)}` : tela === 'api-client' ? `api-client?route=${enc(item)}` : `${tela}/${enc(item)}`
      await api('POST', '/ui/commands', { type: 'navigate', workspace: w.id, path })
      return { aberto: path }
    },
  },
  {
    name: 'preencher_simulador_api',
    title: 'Preencher o Simulador de API',
    group: 'trabalho',
    description: 'Preenche o Simulador de API na tela com uma rota do mapa e os valores que você escolher (parâmetros de caminho, query, headers, body ou query GraphQL). Use modelo_requisicao_api antes para ver os campos. Nada é enviado: a pessoa confere o ambiente e clica em Enviar.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: WS,
        rota: str('Id da rota no mapa ou "MÉTODO /caminho"'),
        parametros: { type: 'object', description: 'Parâmetros de caminho, ex.: {"cartId": "123"}', additionalProperties: { type: 'string' } },
        query: { type: 'object', description: 'Query string, ex.: {"searchCriteria[pageSize]": "10"}', additionalProperties: { type: 'string' } },
        headers: { type: 'object', description: 'Headers extras', additionalProperties: { type: 'string' } },
        body: { description: 'Body JSON (objeto ou texto) para REST' },
        graphql: str('A query ou mutation GraphQL'),
        variaveis: { description: 'Variáveis GraphQL (objeto)' },
        observacao: str('Uma nota curta para a pessoa sobre os valores escolhidos'),
      },
      required: ['rota'],
    },
    run: async (a, api) => {
      const w = await workspace(api, a.workspace)
      const routeId = await findRoute(api, w.id, String(a.rota))
      await api('POST', '/ui/commands', {
        type: 'api-client-fill',
        workspace: w.id,
        routeId,
        request: { pathParams: a.parametros, query: a.query, headers: a.headers, body: a.body, graphqlQuery: a.graphql, graphqlVariables: a.variaveis, note: a.observacao },
      })
      return { preenchido: routeId, aviso: 'Preenchido na tela do Simulador de API. Nada foi enviado: a pessoa confere a URL base e clica em Enviar.' }
    },
  },

  // ---- ações --------------------------------------------------------------------------------
  {
    name: 'gerar_diagrama',
    title: 'Gerar um diagrama com o Claude',
    group: 'acoes',
    writes: true,
    description: 'O Claude do app lê o código e desenha um diagrama do que for pedido (um módulo, um fluxo, uma integração). Tem custo e leva alguns minutos: devolve um jobId; chame aguardar_tarefa para receber o diagramId. Tipos: c4-context, c4-container, c4-component, uml-class, uml-sequence, uml-state, flow, er.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: WS,
        pedido: str('O que desenhar, ex.: "o módulo Vendor_Erp: como os pedidos vão para o ERP"'),
        tipo: str('Tipo de modelo', { enum: ['c4-context', 'c4-container', 'c4-component', 'uml-class', 'uml-sequence', 'uml-state', 'flow', 'er'] }),
      },
      required: ['pedido'],
    },
    run: async (a, api) => {
      const w = await workspace(api, a.workspace)
      return api('POST', `/workspaces/${w.id}/diagrams/generate`, { request: String(a.pedido), scenario: 'custom', type: a.tipo ?? 'flow' })
    },
  },
  {
    name: 'analisar_projeto',
    title: 'Analisar o projeto de novo',
    group: 'acoes',
    writes: true,
    description: 'Reanalisa o projeto (mapa, visão geral, arquitetura viva). Devolve um jobId; acompanhe com status_tarefa.',
    inputSchema: { type: 'object', properties: { workspace: WS } },
    run: async (a, api) => {
      const w = await workspace(api, a.workspace)
      return api('POST', `/workspaces/${w.id}/analysis`)
    },
  },
  {
    name: 'perguntar_ao_codigo',
    title: 'Perguntar ao código',
    group: 'acoes',
    description: 'Faz uma pergunta ao "Pergunte ao código", respondida pela IA configurada no app com ferramentas só de leitura. Tem custo de uso da IA e pode levar alguns minutos.',
    inputSchema: { type: 'object', properties: { workspace: WS, pergunta: str('A pergunta') }, required: ['pergunta'] },
    run: async (a, api) => {
      const w = await workspace(api, a.workspace)
      return api('POST', `/workspaces/${w.id}/ask`, { question: String(a.pergunta) })
    },
  },
  {
    name: 'desenhar_arquitetura',
    title: 'Desenhar a arquitetura com o Claude',
    group: 'acoes',
    writes: true,
    description: 'Pede ao Claude Code do app para desenhar a arquitetura viva lendo o código (formato de arquitetura de referência). Tem custo. Devolve um jobId.',
    inputSchema: { type: 'object', properties: { workspace: WS } },
    run: async (a, api) => {
      const w = await workspace(api, a.workspace)
      return api('POST', `/workspaces/${w.id}/architecture/live/claude`, {})
    },
  },
  {
    name: 'criar_card',
    title: 'Criar card de refinamento',
    group: 'acoes',
    writes: true,
    description: 'Cria uma tarefa no Refinamento com a demanda descrita e devolve o id na hora; o Claude do app responde à primeira mensagem em segundo plano (custo, cerca de um minuto; use aguardar_card). "diagramas" anexa diagramas existentes à tarefa, como contexto do refinamento.',
    inputSchema: {
      type: 'object',
      properties: { workspace: WS, demanda: str('A demanda, como a pessoa escreveria'), diagramas: { type: 'array', items: { type: 'string' }, description: 'Ids de diagramas para anexar' } },
      required: ['demanda'],
    },
    run: async (a, api) => {
      const w = await workspace(api, a.workspace)
      const ids = Array.isArray(a.diagramas) ? a.diagramas.map(String).slice(0, 10) : []
      const extra = ids.length ? `\n\nDiagrama(s) anexado(s) à tarefa: ${ids.join(', ')}.` : ''
      // the card comes back at once; the app's Claude answers the first message in the background
      let card = (await api('POST', `/workspaces/${w.id}/refine/cards?async=1`, { message: `${String(a.demanda)}${extra}` })) as { id: string; title: string }
      for (const d of ids) card = (await api('POST', `/workspaces/${w.id}/refine/cards/${card.id}/attached`, { kind: 'diagram', refId: d })) as { id: string; title: string }
      return { card: card.id, titulo: card.title, abrir: `refinamento/${card.id}`, aviso: 'O Claude do app está respondendo à primeira mensagem (cerca de um minuto). Use aguardar_card antes de refinar_card.' }
    },
  },
  {
    name: 'refinar_card',
    title: 'Refinar uma tarefa',
    group: 'acoes',
    writes: true,
    description: 'Gera o card refinado de uma tarefa (negócio, técnico, plano, critérios, complexidade) a partir da conversa e dos diagramas anexados. Roda em segundo plano (custo, alguns minutos): depois use aguardar_card. A tarefa precisa ter a primeira resposta do Claude (aguardar_card depois de criar_card).',
    inputSchema: { type: 'object', properties: { workspace: WS, card: str('Id do card') }, required: ['card'] },
    run: async (a, api) => {
      const w = await workspace(api, a.workspace)
      const c = (await api('POST', `/workspaces/${w.id}/refine/cards/${enc(String(a.card))}/refine?async=1`)) as { id: string; title: string }
      return { card: c.id, titulo: c.title, aviso: 'Refinando em segundo plano (alguns minutos). Use aguardar_card para saber quando terminou.' }
    },
  },
  {
    name: 'conversar_card',
    title: 'Mandar uma mensagem na tarefa',
    group: 'acoes',
    writes: true,
    description: 'Manda uma mensagem na conversa de refinamento de uma tarefa (uma informação nova, uma pergunta); o Claude do app responde lendo o código. Tem custo.',
    inputSchema: { type: 'object', properties: { workspace: WS, card: str('Id do card'), mensagem: str('A mensagem') }, required: ['card', 'mensagem'] },
    run: async (a, api) => {
      const w = await workspace(api, a.workspace)
      await api('POST', `/workspaces/${w.id}/refine/cards/${enc(String(a.card))}/messages?async=1`, { message: String(a.mensagem) })
      return { aviso: 'Mensagem enviada; o Claude do app responde em segundo plano. Use aguardar_card para ler a resposta.' }
    },
  },
]
