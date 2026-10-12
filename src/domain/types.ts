// Domain model of the storefront + back-office flow.
// Everything the 3D world shows is derived from StoreEvents, so a real Magento
// integration only has to emit the same events (see src/sources/).

export type CategoryId = 'roupas' | 'calcados' | 'eletronicos' | 'casa'

export interface Product {
  sku: string
  name: string
  categoryId: CategoryId
  price: number
  stock: number // salable quantity (MSI)
  color: string
  views: number
  addsToCart: number
}

export type CustomerStage =
  | 'arriving'
  | 'browsing'
  | 'viewing_product'
  | 'cart'
  | 'checkout_shipping'
  | 'checkout_payment'
  | 'leaving'

export interface CartItem {
  sku: string
  name: string
  qty: number
  price: number
}

export interface HistoryEntry {
  at: number
  label: string
}

export interface Customer {
  id: string
  label: string
  isGuest: boolean
  source: string
  color: string
  stage: CustomerStage
  categoryId?: CategoryId
  viewingSku?: string
  quoteId?: string
  cart: CartItem[]
  shippingMethod?: string
  paymentMethod?: PaymentMethod
  city?: string
  endReason?: 'left' | 'abandoned_cart' | 'checkout_abandoned' | 'ordered'
  leftAt?: number
  history: HistoryEntry[]
}

export type PaymentMethod = 'pix' | 'cartao' | 'boleto'

// Magento order state/status (sales_order.state / status)
export type MagentoStatus = 'pending' | 'pending_payment' | 'processing' | 'complete' | 'canceled'

// Fulfillment stage: where the order physically is (beyond Magento's status)
export type FulfillmentStage =
  | 'awaiting_payment'
  | 'invoiced'
  | 'picking'
  | 'packing'
  | 'awaiting_pickup'
  | 'in_transit'
  | 'delivered'
  | 'canceled'

export interface Order {
  incrementId: string
  customerId: string
  customerLabel: string
  items: CartItem[]
  subtotal: number
  shippingAmount: number
  grandTotal: number
  paymentMethod: PaymentMethod
  shippingMethod: string
  city: string
  status: MagentoStatus
  stage: FulfillmentStage
  invoiceId?: string
  trackingNumber?: string
  carrier?: string
  placedAt: number
  updatedAt: number
  stageAt: Partial<Record<FulfillmentStage, number>>
  history: HistoryEntry[]
}

export type TruckPhase = 'docked' | 'outbound' | 'inbound'

export interface Truck {
  id: string
  phase: TruckPhase
  phaseStartedAt: number
  orderIds: string[]
}

export type StoreEvent =
  | { type: 'session.started'; at: number; customerId: string; label: string; isGuest: boolean; source: string; color: string }
  | { type: 'category.viewed'; at: number; customerId: string; categoryId: CategoryId }
  | { type: 'product.viewed'; at: number; customerId: string; sku: string }
  | { type: 'cart.item_added'; at: number; customerId: string; quoteId: string; sku: string; qty: number }
  | { type: 'cart.viewed'; at: number; customerId: string }
  | { type: 'checkout.shipping_step'; at: number; customerId: string; shippingMethod: string; city: string }
  | { type: 'checkout.payment_step'; at: number; customerId: string; paymentMethod: PaymentMethod }
  | { type: 'session.ended'; at: number; customerId: string; reason: NonNullable<Customer['endReason']> }
  | { type: 'order.placed'; at: number; customerId: string; incrementId: string; shippingAmount: number }
  | { type: 'order.invoiced'; at: number; incrementId: string; invoiceId: string }
  | { type: 'order.canceled'; at: number; incrementId: string; reason: string }
  | { type: 'fulfillment.picking'; at: number; incrementId: string }
  | { type: 'fulfillment.packing'; at: number; incrementId: string }
  | { type: 'fulfillment.awaiting_pickup'; at: number; incrementId: string }
  | { type: 'truck.departed'; at: number; truckId: string; shipments: { incrementId: string; trackingNumber: string; carrier: string }[] }
  | { type: 'shipment.delivered'; at: number; incrementId: string }
  | { type: 'truck.returning'; at: number; truckId: string }
  | { type: 'truck.returned'; at: number; truckId: string }
  | { type: 'inventory.restocked'; at: number; sku: string; qty: number }

export type StoreEventType = StoreEvent['type']
