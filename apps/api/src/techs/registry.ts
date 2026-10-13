import type { TechId } from '../config/paths'

export interface TechInfo {
  id: TechId
  name: string
  vendor: string
  /** One line for the setup screen */
  summary: string
}

/** Technologies the toolkit supports. Adding one means a detector, an overview and a sidebar (see techs/sfcc). */
export const TECHS: TechInfo[] = [
  {
    id: 'adobe-commerce',
    name: 'Adobe Commerce',
    vendor: 'Adobe',
    summary: 'Magento 2 e Adobe Commerce: módulos, APIs, plugins, observers, crons e filas.',
  },
  {
    id: 'salesforce-b2c',
    name: 'Salesforce B2C Commerce',
    vendor: 'Salesforce',
    summary: 'SFCC: cartuchos, controllers SFRA ou pipelines, templates ISML, jobs, sites e integrações.',
  },
]

export const techInfo = (id: TechId) => TECHS.find((t) => t.id === id)!
