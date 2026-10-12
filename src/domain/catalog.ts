import type { CategoryId, PaymentMethod, Product } from './types'

export const CATEGORIES: { id: CategoryId; name: string; color: string }[] = [
  { id: 'roupas', name: 'Roupas', color: '#f472b6' },
  { id: 'calcados', name: 'Calçados', color: '#f59e0b' },
  { id: 'eletronicos', name: 'Eletrônicos', color: '#38bdf8' },
  { id: 'casa', name: 'Casa & Decoração', color: '#34d399' },
]

export const categoryName = (id: CategoryId) => CATEGORIES.find((c) => c.id === id)?.name ?? id

const raw: [string, string, CategoryId, number, string][] = [
  ['MH01-BLK-M', 'Camiseta Básica Algodão', 'roupas', 59.9, '#1f2937'],
  ['MJ02-BLU-G', 'Jaqueta Jeans Clássica', 'roupas', 229.9, '#2563eb'],
  ['WS03-RED-P', 'Vestido Midi Floral', 'roupas', 189.9, '#e11d48'],
  ['MP04-GRY-42', 'Calça Chino Slim', 'roupas', 149.9, '#9ca3af'],
  ['SH01-WHT-40', 'Tênis Runner Pro', 'calcados', 399.9, '#f8fafc'],
  ['SH02-BRN-41', 'Bota Couro Adventure', 'calcados', 459.9, '#92400e'],
  ['SH03-PNK-36', 'Sapatilha Comfort', 'calcados', 129.9, '#fb7185'],
  ['SH04-BLK-43', 'Chinelo Slide', 'calcados', 79.9, '#111827'],
  ['EL01-SPK', 'Caixa de Som Bluetooth', 'eletronicos', 349.9, '#0ea5e9'],
  ['EL02-HDP', 'Fone Over-ear ANC', 'eletronicos', 899.9, '#475569'],
  ['EL03-WTC', 'Smartwatch Fit 5', 'eletronicos', 1299.0, '#6366f1'],
  ['EL04-PWB', 'Power Bank 20.000mAh', 'eletronicos', 199.9, '#14b8a6'],
  ['HM01-LMP', 'Luminária de Mesa LED', 'casa', 139.9, '#facc15'],
  ['HM02-PIL', 'Kit Almofadas Linho', 'casa', 119.9, '#a3e635'],
  ['HM03-MUG', 'Jogo de Canecas Cerâmica', 'casa', 89.9, '#fb923c'],
  ['HM04-PLT', 'Vaso Autoirrigável', 'casa', 69.9, '#22c55e'],
]

export function createProducts(): Product[] {
  return raw.map(([sku, name, categoryId, price, color], i) => ({
    sku,
    name,
    categoryId,
    price,
    color,
    stock: 8 + ((i * 7) % 17),
    views: 0,
    addsToCart: 0,
  }))
}

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  pix: 'Pix',
  cartao: 'Cartão de crédito',
  boleto: 'Boleto bancário',
}

export const SHIPPING_METHODS = [
  { code: 'correios_pac', label: 'Correios PAC', price: 24.9 },
  { code: 'correios_sedex', label: 'Correios SEDEX', price: 42.5 },
  { code: 'transportadora', label: 'Transportadora Expressa', price: 31.0 },
]

export const CITIES = [
  'São Paulo, SP', 'Rio de Janeiro, RJ', 'Belo Horizonte, MG', 'Curitiba, PR', 'Porto Alegre, RS',
  'Salvador, BA', 'Recife, PE', 'Fortaleza, CE', 'Brasília, DF', 'Goiânia, GO', 'Campinas, SP', 'Florianópolis, SC',
]

export const TRAFFIC_SOURCES = ['Google orgânico', 'Instagram Ads', 'Acesso direto', 'E-mail marketing', 'Google Shopping']

export const AVATAR_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#8b5cf6', '#ec4899', '#14b8a6', '#f43f5e', '#84cc16']
