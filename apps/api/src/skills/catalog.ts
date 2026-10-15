import type { TechId } from '../config/paths'

/** The features of the app that run Claude Code, and so can use skills */
export const SKILL_FEATURES = ['ask', 'refine', 'develop', 'openspec', 'diagrams', 'docs'] as const
export type SkillFeature = (typeof SKILL_FEATURES)[number]

export const FEATURE_LABEL: Record<SkillFeature, string> = {
  ask: 'Pergunte ao código',
  refine: 'Refinamento',
  develop: 'Desenvolvimento por tarefa',
  openspec: 'OpenSpec',
  diagrams: 'Diagramas',
  docs: 'Documentação',
}

export interface SkillDef {
  /** Folder under apps/api/skills and the skill name Claude sees (agentic-toolkit:<id>) */
  id: string
  title: string
  group: 'comum' | 'adobe-commerce' | 'salesforce-b2c'
  /** Technologies it applies to; empty means all */
  techs: TechId[]
  features: SkillFeature[]
}

const ADOBE: TechId[] = ['adobe-commerce']
const SFCC: TechId[] = ['salesforce-b2c']
const BUILD: SkillFeature[] = ['ask', 'refine', 'develop', 'openspec']

/**
 * The skills of the toolkit. Each one is a SKILL.md written for this app; a feature gets the
 * enabled skills of its technology that list it.
 */
export const SKILLS: SkillDef[] = [
  { id: 'code-investigation', title: 'Investigação do código', group: 'comum', techs: [], features: ['ask', 'refine', 'openspec', 'docs', 'diagrams'] },
  { id: 'task-refinement', title: 'Refinamento de demandas', group: 'comum', techs: [], features: ['refine', 'openspec'] },
  { id: 'delivery-discipline', title: 'Entrega de tarefas', group: 'comum', techs: [], features: ['develop'] },
  { id: 'openspec-authoring', title: 'Escrita OpenSpec', group: 'comum', techs: [], features: ['openspec'] },
  { id: 'c4-architecture', title: 'Arquitetura C4', group: 'comum', techs: [], features: ['diagrams', 'docs'] },
  { id: 'mermaid-diagrams', title: 'Diagramas Mermaid', group: 'comum', techs: [], features: ['diagrams', 'docs'] },
  { id: 'technical-docs', title: 'Documentação técnica', group: 'comum', techs: [], features: ['docs'] },
  { id: 'architecture-canvas', title: 'Desenho no canvas do toolkit', group: 'comum', techs: [], features: ['diagrams'] },
  { id: 'integration-discovery', title: 'Descoberta de integrações', group: 'comum', techs: [], features: ['diagrams', 'docs', 'ask', 'refine'] },

  { id: 'adobe-module-development', title: 'Módulos Magento 2', group: 'adobe-commerce', techs: ADOBE, features: [...BUILD, 'docs'] },
  { id: 'adobe-extensibility-di', title: 'Plugins, observers e DI', group: 'adobe-commerce', techs: ADOBE, features: BUILD },
  { id: 'adobe-data-schema', title: 'Dados: schema, patches e EAV', group: 'adobe-commerce', techs: ADOBE, features: BUILD },
  { id: 'adobe-frontend', title: 'Frontend: layout, templates e JS', group: 'adobe-commerce', techs: ADOBE, features: BUILD },
  { id: 'adobe-apis-integrations', title: 'APIs e integrações', group: 'adobe-commerce', techs: ADOBE, features: [...BUILD, 'diagrams', 'docs'] },
  { id: 'adobe-admin-config', title: 'Admin, configuração e ACL', group: 'adobe-commerce', techs: ADOBE, features: BUILD },
  { id: 'adobe-cron-queues-indexers', title: 'Cron, filas e indexers', group: 'adobe-commerce', techs: ADOBE, features: [...BUILD, 'docs'] },
  { id: 'adobe-checkout-sales', title: 'Carrinho, checkout e pedido', group: 'adobe-commerce', techs: ADOBE, features: BUILD },
  { id: 'adobe-quality-testing', title: 'Qualidade e testes', group: 'adobe-commerce', techs: ADOBE, features: ['refine', 'develop'] },
  { id: 'adobe-architecture', title: 'Arquitetura da loja', group: 'adobe-commerce', techs: ADOBE, features: ['ask', 'diagrams', 'docs'] },

  { id: 'sfra-controllers', title: 'Controllers SFRA', group: 'salesforce-b2c', techs: SFCC, features: BUILD },
  { id: 'sfcc-cartridges-modules', title: 'Cartuchos e módulos', group: 'salesforce-b2c', techs: SFCC, features: [...BUILD, 'docs'] },
  { id: 'sfcc-hooks-checkout', title: 'Hooks, carrinho e pedido', group: 'salesforce-b2c', techs: SFCC, features: BUILD },
  { id: 'sfcc-isml-frontend', title: 'ISML, textos e assets', group: 'salesforce-b2c', techs: SFCC, features: BUILD },
  { id: 'sfcc-metadata-business-manager', title: 'Metadata e Business Manager', group: 'salesforce-b2c', techs: SFCC, features: [...BUILD, 'docs'] },
  { id: 'sfcc-services-integrations', title: 'Serviços e integrações', group: 'salesforce-b2c', techs: SFCC, features: [...BUILD, 'diagrams', 'docs'] },
  { id: 'sfcc-jobs', title: 'Jobs', group: 'salesforce-b2c', techs: SFCC, features: [...BUILD, 'docs'] },
  { id: 'sfcc-quality-testing', title: 'Qualidade e testes', group: 'salesforce-b2c', techs: SFCC, features: ['refine', 'develop'] },
  { id: 'sfcc-deploy-upload', title: 'Deploy e upload', group: 'salesforce-b2c', techs: SFCC, features: ['refine', 'develop', 'docs'] },
  { id: 'sfcc-architecture', title: 'Arquitetura da loja', group: 'salesforce-b2c', techs: SFCC, features: ['ask', 'diagrams', 'docs'] },
]

/** Claude Code names plugin skills "<plugin>:<skill>" */
export const SKILL_PLUGIN = 'agentic-toolkit'
export const skillName = (id: string) => `${SKILL_PLUGIN}:${id}`
