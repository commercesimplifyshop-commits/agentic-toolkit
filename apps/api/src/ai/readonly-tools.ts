import type { TechId } from '../config/paths'
import { ReadOnlyViolation } from '../readonly/path-guard'
import type { ReadOnlyFs } from '../readonly/readonly-fs.service'

/**
 * Tools offered to API-based models. Every one of them reads; there is no tool
 * that writes, runs commands or touches the network.
 */
export interface ToolSpec {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, { type: string; description: string }>
    required: string[]
    additionalProperties: false
  }
}

export const READONLY_TOOLS: ToolSpec[] = [
  {
    name: 'list_dir',
    description: 'Lista arquivos e pastas de um caminho da instalação Magento (relativo à raiz). Use "" para a raiz.',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Caminho relativo, ex.: app/code/Vendor/Module/etc' } }, required: ['path'], additionalProperties: false },
  },
  {
    name: 'read_file',
    description: 'Lê um arquivo de texto da instalação (até 200 KB). Arquivos de credenciais (env.php, auth.json, .env, chaves) são bloqueados.',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Caminho relativo do arquivo' } }, required: ['path'], additionalProperties: false },
  },
  {
    name: 'grep',
    description: 'Busca uma expressão regular (sem diferenciar maiúsculas) no código da instalação. Retorna arquivo, linha e trecho.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Expressão regular' },
        under: { type: 'string', description: 'Pasta onde buscar (relativa). Vazio = instalação inteira; prefira app/code para customizações.' },
      },
      required: ['pattern', 'under'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_map',
    description:
      'Busca no mapa de integrações já extraído (REST, GraphQL, plugins, preferences, observers, rotas, crons, filas), com zona do fluxo, módulo, origem e resumos já analisados.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Termos separados por espaço (ex.: "placeOrder plugin", "sales_order_save_after")' },
        origin: { type: 'string', description: 'custom, thirdparty, native ou all' },
      },
      required: ['query', 'origin'],
      additionalProperties: false,
    },
  },
]

interface MapLike {
  items: { id: string; kind: string; title: string; subtitle: string; module: string; origin: string; zone: string; file: string; line: number; details: Record<string, unknown> }[]
}

export function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: { rofs: ReadOnlyFs; root: string; map: MapLike | null; notes: { items?: Record<string, { summary?: string; risk?: unknown }> } | null },
): string {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  try {
    switch (name) {
      case 'list_dir':
        return ctx.rofs
          .list(ctx.root, str('path'))
          .slice(0, 300)
          .map((e) => `${e.type === 'dir' ? 'd' : 'f'} ${e.path}${e.sensitive ? ' (sensível, não legível)' : ''}`)
          .join('\n')
      case 'read_file': {
        const r = ctx.rofs.read(ctx.root, str('path'), 200 * 1024)
        return r.truncated ? `${r.content}\n… [truncado: ${r.size} bytes]` : r.content
      }
      case 'grep': {
        let re: RegExp
        try {
          re = new RegExp(str('pattern'))
        } catch {
          return 'Erro: expressão regular inválida'
        }
        const matches = ctx.rofs.grep(ctx.root, re.source, { under: str('under'), maxMatches: 80 })
        return matches.length ? matches.map((m) => `${m.file}:${m.line}: ${m.text}`).join('\n') : 'Nenhum resultado'
      }
      case 'search_map': {
        if (!ctx.map) return 'Mapa ainda não gerado para esta instalação.'
        const terms = str('query').toLowerCase().split(/\s+/).filter(Boolean)
        const origin = str('origin') || 'all'
        const hits = ctx.map.items
          .filter((i) => origin === 'all' || i.origin === origin)
          .filter((i) => {
            const text = [i.title, i.subtitle, i.module, JSON.stringify(i.details), ctx.notes?.items?.[i.id]?.summary ?? ''].join(' ').toLowerCase()
            return terms.every((t) => text.includes(t))
          })
          .slice(0, 40)
        if (!hits.length) return 'Nenhum item no mapa'
        return hits
          .map((i) => {
            const n = ctx.notes?.items?.[i.id]
            return [`[${i.kind}] ${i.title} — ${i.subtitle}`, `  módulo ${i.module} (${i.origin}) · zona ${i.zone} · ${i.file}:${i.line}`, n?.summary ? `  resumo: ${n.summary}` : '', n?.risk ? `  risco: ${JSON.stringify(n.risk)}` : '']
              .filter(Boolean)
              .join('\n')
          })
          .join('\n')
      }
      default:
        return `Ferramenta desconhecida: ${name}`
    }
  } catch (err) {
    if (err instanceof ReadOnlyViolation) return `Bloqueado pela regra de somente leitura: ${err.message}`
    return `Erro: ${(err as Error).message}`
  }
}

/** The chat's system prompt for a technology: same rules everywhere, the role and the first places to look change */
export function systemPromptFor(tech: TechId): string {
  if (tech === 'adobe-commerce') return SYSTEM_PROMPT
  return SYSTEM_PROMPT.replace('Você é um engenheiro Magento 2 sênior', 'Você é um engenheiro Salesforce B2C Commerce (SFCC) sênior, com experiência em SFRA, cartuchos, templates ISML, jobs e OCAPI')
    .replace('Comece pelo mapa de integrações (search_map) quando a pergunta for sobre APIs, plugins, observers, eventos ou fluxo de pedido; depois leia o código.', 'Comece pelos cartuchos e controllers (Grep em cartridges/) quando a pergunta for sobre rotas, fluxos ou integrações; depois leia o código.')
    .replace('Diferencie o que é nativo do Magento, de terceiros e customizado.', 'Diferencie o que é da plataforma Salesforce, de cartuchos de terceiros e customizado.')
}

export const SYSTEM_PROMPT = `Você é um engenheiro Magento 2 sênior ajudando um colega a entender uma instalação que ele não conhece.

Regras:
- Você tem acesso SOMENTE LEITURA ao código, pelas ferramentas disponíveis. Nunca proponha que você mesmo altere arquivos; se a pergunta pedir uma mudança, explique o que mudar e onde, sem executar.
- Responda em português do Brasil, de forma direta. Cite arquivos como caminho:linha.
- Antes de afirmar algo sobre o código, confirme lendo o arquivo. Diferencie o que é nativo do Magento, de terceiros e customizado.
- Comece pelo mapa de integrações (search_map) quando a pergunta for sobre APIs, plugins, observers, eventos ou fluxo de pedido; depois leia o código.
- Se uma informação depende de configuração de banco ou de ambiente que você não tem, diga isso explicitamente.`
