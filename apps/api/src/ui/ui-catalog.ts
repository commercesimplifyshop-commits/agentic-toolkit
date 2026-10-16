import type { TechId } from '../config/paths'

/**
 * What the interface is made of, for the preferences a person (or an AI through the MCP) can change:
 * the features of the sidebar and the blocks of the pages that can be moved or hidden.
 * Feature ids are the paths of the sidebar (apps/web/src/shell/Layout.tsx); block ids are the ones
 * the pages give to <Blocks> (apps/web/src/shell/components/Blocks.tsx).
 */
export interface UiFeature {
  id: string
  title: string
  section: string
  /** Technologies whose menu has it; empty means all */
  techs: TechId[]
  /** What it is for and how to work with it: shown in Configurações and in the MCP guide */
  description: string
  /** Cannot be turned off */
  locked?: boolean
}

export interface UiBlock {
  id: string
  title: string
  /** Blocks found on the page by themselves move only among the blocks of the same group (container) */
  container?: string
}

export interface UiPage {
  id: string
  title: string
  techs: TechId[]
  blocks: UiBlock[]
}

const ADOBE: TechId[] = ['adobe-commerce']
const SFCC: TechId[] = ['salesforce-b2c']

export const UI_FEATURES: UiFeature[] = [
  { id: 'overview', title: 'Visão geral', section: 'Início', techs: [], locked: true, description: 'Painel do projeto: versão, módulos, extensões, pontos de integração, stack, segurança e atividade. Os blocos podem ser reordenados e ocultados.' },
  { id: 'ask', title: 'Pergunte ao código', section: 'Início', techs: [], description: 'Perguntas em linguagem natural sobre o código, respondidas pela IA configurada com ferramentas só de leitura e o mapa do projeto como contexto.' },
  { id: 'tutorial', title: 'Como é uma solução', section: 'Tutorial', techs: SFCC, description: 'Tutorial de como uma solução Salesforce B2C é organizada (cartuchos, controllers, ISML, jobs), com exemplos do projeto.' },
  { id: 'tutorial/customizacoes', title: 'Customizações frequentes', section: 'Tutorial', techs: SFCC, description: 'Guia das customizações mais comuns no Salesforce B2C e onde cada uma fica no projeto.' },
  { id: 'code', title: 'Explorador de código', section: 'Desenvolvimento', techs: [], description: 'Navegação nos arquivos do projeto, busca em texto e por classe, no estilo do PhpStorm (Shift Shift, Ctrl+Shift+F). Arquivos sensíveis não são lidos.' },
  { id: 'diagrams', title: 'Diagramas de arquitetura', section: 'Desenvolvimento', techs: [], description: 'Editor de diagramas (canvas C4, fluxo, Mermaid) e geração de diagramas pelo Claude a partir do código.' },
  { id: 'openspec', title: 'OpenSpec', section: 'Desenvolvimento', techs: [], description: 'Changes e specs do OpenSpec do projeto: leitura, escrita assistida, exploração e propostas de mudança.' },
  { id: 'refinamento', title: 'Refinamento', section: 'Desenvolvimento', techs: [], description: 'Cards de demanda refinados pela IA (negócio, técnico, plano, critérios de aceite), divisão em tarefas e desenvolvimento em branch.' },
  { id: 'git', title: 'Git', section: 'Desenvolvimento', techs: [], description: 'Estado do repositório, branches, worktrees e pull requests do GitHub com revisão.' },
  { id: 'arquitetura-viva', title: 'Arquitetura viva', section: 'Arquitetura', techs: [], description: 'Arquitetura de referência da plataforma em camadas, montada do mapeamento e atualizada a cada análise; o Claude pode desenhar uma versão mais rica.' },
  { id: 'modules', title: 'Módulos & extensões', section: 'Arquitetura', techs: ADOBE, description: 'Módulos habilitados por origem (core, customizados, terceiros) e extensões do composer.' },
  { id: 'integrations/api', title: 'APIs REST & GraphQL', section: 'Arquitetura', techs: ADOBE, description: 'Endpoints REST e operações GraphQL do projeto, com ACL e riscos (escrita anônima).' },
  { id: 'integrations/plugins', title: 'Plugins & preferences', section: 'Arquitetura', techs: ADOBE, description: 'Plugins e preferences do projeto, com a classe e o método alvo.' },
  { id: 'integrations/events', title: 'Eventos & observers', section: 'Arquitetura', techs: ADOBE, description: 'Observers do projeto por evento.' },
  { id: 'integrations/async', title: 'Crons & filas', section: 'Arquitetura', techs: ADOBE, description: 'Crons e consumers de fila do projeto.' },
  { id: 'integrations/routes', title: 'Rotas & controllers', section: 'Arquitetura', techs: ADOBE, description: 'Rotas de frontend e admin do projeto.' },
  { id: 'sfcc/cartridges', title: 'Cartuchos & dependências', section: 'Arquitetura', techs: SFCC, description: 'Cartuchos do projeto, o cartridge path de cada site e as dependências.' },
  { id: 'sfcc/controllers', title: 'Controllers & rotas', section: 'Arquitetura', techs: SFCC, description: 'Controllers SFRA e rotas (append, prepend, replace).' },
  { id: 'sfcc/templates', title: 'Templates ISML', section: 'Arquitetura', techs: SFCC, description: 'Templates ISML por cartucho.' },
  { id: 'sfcc/jobs', title: 'Jobs & agendamentos', section: 'Arquitetura', techs: SFCC, description: 'Jobs do projeto e seus steps.' },
  { id: 'sfcc/services', title: 'Integrações & serviços', section: 'Arquitetura', techs: SFCC, description: 'Serviços do LocalServiceRegistry e os cartuchos que os chamam.' },
  { id: 'sfcc/sites', title: 'Sites & atributos', section: 'Arquitetura', techs: SFCC, description: 'Sites e atributos custom por tipo de objeto.' },
  { id: 'sfcc/instance', title: 'Perfil da instância', section: 'Instância', techs: SFCC, description: 'Dados da instância configurada (hostname, code version).' },
  { id: 'sfcc/upload', title: 'Upload para a instância', section: 'Instância', techs: SFCC, description: 'Envio dos cartuchos para um sandbox.' },
  { id: 'ia/harness', title: 'Harness da IA', section: 'IA', techs: [], description: 'Desenho da arquitetura do harness da IA configurada: o que roda o modelo (Claude Code, API da Anthropic ou modelo compatível com OpenAI), o que ele carrega (plugins, skills, subagentes, MCP), as permissões e o que cada funcionalidade do app usa.' },
  { id: 'api-client', title: 'Simulador de API', section: 'Ferramentas', techs: [], description: 'Monta e envia requisições para as APIs da loja num ambiente escolhido, com confirmação.' },
  { id: 'docs', title: 'Documentação', section: 'Ferramentas', techs: [], description: 'Documentação técnica gerada pela IA (tema, módulo, funcionalidade, fluxo), exportável em Word e PDF.' },
  { id: 'board', title: 'Quadro branco', section: 'Ferramentas', techs: [], description: 'Quadro livre para desenhar e colar imagens.' },
  { id: 'flow', title: 'Fluxo 3D', section: 'Fluxo de pedido', techs: ADOBE, description: 'O fluxo do pedido em 3D, com as customizações em cada etapa.' },
  { id: 'debug', title: 'Debug de fluxo', section: 'Fluxo de pedido', techs: ADOBE, description: 'Execução passo a passo do fluxo, com o que cada customização faz.' },
  { id: 'risks', title: 'Pontos de atenção', section: 'Qualidade & segurança', techs: ADOBE, description: 'Riscos encontrados no código (reescritas do core, endpoints anônimos de escrita…).' },
  { id: 'security', title: 'Segurança & patches', section: 'Qualidade & segurança', techs: ADOBE, description: 'Patches aplicados, pacote de segurança, 2FA, reCAPTCHA e fim do suporte.' },
]

export const UI_PAGES: UiPage[] = [
  {
    id: 'overview',
    title: 'Visão geral (Adobe Commerce)',
    techs: ADOBE,
    blocks: [
      { id: 'kpis', title: 'Indicadores' },
      { id: 'highlights', title: 'Highlights técnicos' },
      { id: 'modules', title: 'Módulos por origem e customizações por etapa' },
      { id: 'kinds', title: 'Tipos de customização' },
      { id: 'vendors', title: 'Extensões por vendor' },
      { id: 'stack', title: 'Stack' },
      { id: 'code', title: 'Código próprio (app/code)' },
      { id: 'patches', title: 'Patches & segurança' },
      { id: 'activity', title: 'Atividade recente' },
    ],
  },
]

/** Lower case, no accents, single spaces: to find a feature or block by what a person calls it */
export const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, ' ')
    .trim()

/** Finds by id, by title, or by a title that contains what was asked (only when that is unambiguous) */
export function findBy<T extends { id: string; title: string }>(list: T[], q: string): T | undefined {
  const n = norm(q)
  const exact = list.find((x) => x.id === q || norm(x.id) === n || norm(x.title) === n)
  if (exact) return exact
  const partial = list.filter((x) => norm(x.title).includes(n) || n.includes(norm(x.title)))
  return partial.length === 1 ? partial[0] : undefined
}

/** The theme tokens the person (or an AI) may change: each one is a CSS variable of apps/web/src/shell/shell.css */
export interface ThemeToken {
  id: string
  variable: string
  title: string
  kind: 'color' | 'length' | 'font'
  /** Default value, as in shell.css */
  value: string
}

export const THEME_TOKENS: ThemeToken[] = [
  { id: 'accent', variable: '--sf-accent', title: 'Cor de destaque (botões principais, item ativo, links)', kind: 'color', value: '#f97316' },
  { id: 'bg', variable: '--sf-bg', title: 'Fundo da aplicação', kind: 'color', value: '#0a0a0b' },
  { id: 'panel', variable: '--sf-panel', title: 'Fundo dos cartões e painéis', kind: 'color', value: '#111113' },
  { id: 'panel-2', variable: '--sf-panel-2', title: 'Fundo de painéis em destaque e campos', kind: 'color', value: '#18181b' },
  { id: 'hover', variable: '--sf-hover', title: 'Fundo ao passar o mouse', kind: 'color', value: '#1f1f23' },
  { id: 'border', variable: '--sf-border', title: 'Cor das bordas', kind: 'color', value: '#26262b' },
  { id: 'text', variable: '--sf-text', title: 'Cor do texto', kind: 'color', value: '#ededef' },
  { id: 'muted', variable: '--sf-muted', title: 'Texto secundário', kind: 'color', value: '#8b8b94' },
  { id: 'faint', variable: '--sf-faint', title: 'Texto apagado (legendas)', kind: 'color', value: '#5c5c66' },
  { id: 'blue', variable: '--sf-blue', title: 'Azul (informação, gráficos)', kind: 'color', value: '#3b82f6' },
  { id: 'green', variable: '--sf-green', title: 'Verde (sucesso)', kind: 'color', value: '#22c55e' },
  { id: 'yellow', variable: '--sf-yellow', title: 'Amarelo (atenção)', kind: 'color', value: '#eab308' },
  { id: 'red', variable: '--sf-red', title: 'Vermelho (erro, risco)', kind: 'color', value: '#ef4444' },
  { id: 'purple', variable: '--sf-purple', title: 'Roxo (gráficos)', kind: 'color', value: '#a78bfa' },
  { id: 'radius', variable: '--sf-radius', title: 'Arredondamento dos cartões', kind: 'length', value: '12px' },
  { id: 'font', variable: '--sf-font', title: 'Fonte', kind: 'font', value: "Inter, system-ui, sans-serif" },
  { id: 'font-size', variable: '--sf-font-size', title: 'Tamanho base do texto', kind: 'length', value: '13.5px' },
  { id: 'sidebar-width', variable: '--sf-sidebar-width', title: 'Largura do menu lateral', kind: 'length', value: '248px' },
]

/**
 * Stable selectors for custom CSS: what the AI can target when no preference covers the change.
 * Keep in sync with the class names of the web app.
 */
export const CSS_MAP: [string, string][] = [
  ['.sf-sidebar', 'menu lateral'],
  ['.sf-nav[data-feature="<id>"]', 'um item do menu (id da funcionalidade)'],
  ['.sf-side-section', 'título de uma seção do menu'],
  ['.sf-rail', 'faixa estreita à esquerda com os workspaces'],
  ['.sf-topbar', 'barra do topo com o caminho da página'],
  ['.sf-content[data-feature="<id>"]', 'a área de conteúdo quando aquela funcionalidade está aberta'],
  ['.sf-page-head', 'cabeçalho de uma página (título e botões)'],
  ['.sf-page-head h1', 'título da página'],
  ['.sf-card', 'cartão (bloco de informação)'],
  ['[data-block="<id>"]', 'um bloco de uma página configurável (ex.: [data-block="stack"])'],
  ['.sf-kpi', 'indicador numérico da Visão geral'],
  ['.sf-btn', 'botão'],
  ['.sf-btn.primary', 'botão principal'],
  ['.sf-badge', 'etiqueta pequena'],
  ['.sf-input', 'campo de texto'],
  ['.sf-assist-fab', 'botão do assistente'],
]
