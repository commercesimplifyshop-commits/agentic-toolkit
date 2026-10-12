import type { CustomerStage, FulfillmentStage, MagentoStatus } from '../domain/types'

export const STAGE_LABEL: Record<CustomerStage, string> = {
  arriving: 'Chegando',
  browsing: 'Navegando no catálogo',
  viewing_product: 'Vendo produto',
  cart: 'No carrinho',
  checkout_shipping: 'Checkout · Entrega',
  checkout_payment: 'Checkout · Pagamento',
  leaving: 'Saindo',
}

export const FULFILLMENT_LABEL: Record<FulfillmentStage, string> = {
  awaiting_payment: 'Aguardando pagamento',
  invoiced: 'Faturado',
  picking: 'Em separação',
  packing: 'Em embalagem',
  awaiting_pickup: 'Aguardando coleta',
  in_transit: 'Em trânsito',
  delivered: 'Entregue',
  canceled: 'Cancelado',
}

export const STATUS_LABEL: Record<MagentoStatus, string> = {
  pending: 'Pending',
  pending_payment: 'Pending Payment',
  processing: 'Processing',
  complete: 'Complete',
  canceled: 'Canceled',
}

export const STATUS_TONE: Record<MagentoStatus, string> = {
  pending: 'warn',
  pending_payment: 'warn',
  processing: 'info',
  complete: 'ok',
  canceled: 'bad',
}
