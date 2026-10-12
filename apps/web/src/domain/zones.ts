export type ZoneId = 'entrada' | 'catalogo' | 'produto' | 'carrinho' | 'checkout' | 'admin' | 'armazem' | 'expedicao' | 'integracoes'

export interface Zone {
  id: ZoneId
  step: number
  name: string
  side: 'Frontend' | 'Backend' | 'Logística' | 'Integrações'
  center: [number, number] // x, z
  size: [number, number] // width (x), depth (z)
  color: string
  summary: string
  magento: string[]
}

export const ZONES: Zone[] = [
  {
    id: 'entrada',
    step: 1,
    name: 'Entrada da loja',
    side: 'Frontend',
    center: [-19, 4],
    size: [6, 8],
    color: '#c7d2fe',
    summary: 'Visitante chega na loja e uma sessão é iniciada (anônima ou logada).',
    magento: ['Sessão PHP / customer_session', 'Cookie de quote para visitante', 'GraphQL: createEmptyCart quando necessário'],
  },
  {
    id: 'catalogo',
    step: 2,
    name: 'Catálogo',
    side: 'Frontend',
    center: [-10, -4],
    size: [12, 9],
    color: '#fbcfe8',
    summary: 'Cliente navega pelas categorias (PLP). Cada prateleira é uma categoria.',
    magento: ['catalog_controller_category_init_after', 'GraphQL: products(filter: {category_uid})', 'Estoque vendável via MSI'],
  },
  {
    id: 'produto',
    step: 3,
    name: 'Página de produto',
    side: 'Frontend',
    center: [-10, 6],
    size: [8, 5],
    color: '#fde68a',
    summary: 'Cliente abre um produto (PDP), vê preço, estoque e decide se adiciona ao carrinho.',
    magento: ['catalog_controller_product_view', 'GraphQL: products(filter: {sku})', 'Tabela report_viewed_product_index'],
  },
  {
    id: 'carrinho',
    step: 4,
    name: 'Carrinho',
    side: 'Frontend',
    center: [-1, 6],
    size: [6, 5],
    color: '#bbf7d0',
    summary: 'Itens ficam numa quote. Carrinho abandonado = quote ativa sem pedido.',
    magento: ['checkout_cart_add_product_complete', 'Tabelas quote / quote_item', 'GraphQL: addProductsToCart'],
  },
  {
    id: 'checkout',
    step: 5,
    name: 'Checkout',
    side: 'Frontend',
    center: [-1, -4],
    size: [7, 8],
    color: '#bae6fd',
    summary: 'Duas etapas nativas: Entrega (endereço + frete) e Pagamento (método + revisão).',
    magento: ['Etapa shipping: setShippingAddressesOnCart / estimate-shipping-methods', 'Etapa payment: setPaymentMethodOnCart', 'placeOrder → sales_order_place_after'],
  },
  {
    id: 'admin',
    step: 6,
    name: 'Admin · Pedidos',
    side: 'Backend',
    center: [9, -5],
    size: [7, 7],
    color: '#ddd6fe',
    summary: 'Pedido entra no painel (Vendas > Pedidos). Pagamento confirmado gera a fatura.',
    magento: ['Grid sales_order_grid', 'sales_order_invoice_pay (fatura)', 'Status: pending → processing | canceled'],
  },
  {
    id: 'armazem',
    step: 7,
    name: 'Centro de distribuição',
    side: 'Logística',
    center: [19, -3],
    size: [10, 10],
    color: '#e2e8f0',
    summary: 'Pedido faturado vai para separação (picking) e embalagem (packing).',
    magento: ['Fora do core: WMS/ERP integrado', 'MSI: dedução da reserva ao enviar', 'Source selection algorithm (MSI)'],
  },
  {
    id: 'expedicao',
    step: 8,
    name: 'Expedição & Entrega',
    side: 'Logística',
    center: [19, 8],
    size: [10, 5],
    color: '#fed7aa',
    summary: 'Ao carregar no caminhão o envio é criado com código de rastreio; a transportadora confirma a entrega.',
    magento: ['sales_order_shipment_save_after', 'sales_shipment_track (rastreio)', 'Status: processing → complete'],
  },
  {
    id: 'integracoes',
    step: 9,
    name: 'Integrações',
    side: 'Integrações',
    center: [8.5, 5.5],
    size: [6, 5],
    color: '#a5f3fc',
    summary: 'ERP, marketing, filas e crons: tudo que roda fora do clique do cliente e conversa com sistemas externos.',
    magento: ['communication.xml / queue_consumer.xml (filas)', 'crontab.xml (jobs agendados)', 'Webhooks e integrações via REST'],
  },
]

export const zoneById = (id: ZoneId) => ZONES.find((z) => z.id === id)!

// Fixed points used by the 3D scene
export const POINTS = {
  spawn: [-25, 4] as [number, number],
  door: [-21.5, 4] as [number, number],
  pdpPedestal: [-10, 6] as [number, number],
  shippingCounter: [-3, -7] as [number, number],
  paymentCounter: [1, -7] as [number, number],
  adminDesk: [9, -5] as [number, number],
  picking: [16.5, -3] as [number, number],
  packing: [21.5, -3] as [number, number],
  dock: [17, 8] as [number, number],
  truckDock: [21, 12.6] as [number, number],
  roadZ: 12.6,
}

// Row z for each category shelf in the catalog zone
export const SHELF_ROWS: Record<string, number> = {
  roupas: -7.4,
  calcados: -5.2,
  eletronicos: -3.0,
  casa: -0.8,
}

// Seconds the truck takes to drive between the dock and off-screen
export const TRUCK_DRIVE_SECONDS = 6
