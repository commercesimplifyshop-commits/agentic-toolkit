// Native Magento 2.4 (Luma) B2C purchase flow, as a script of requests, method
// calls and dispatched events. Verified against magento/magento2 2.4.1-p1:
// Checkout\Model\Cart, Quote\Model\QuoteManagement, Sales\Model\Service\OrderService,
// Sales\Model\Order::place, Sales\Model\Order\Invoice, Sales\Model\ShipOrder.
// The trace engine (trace.ts) overlays the installation's plugins, preferences
// and observers on top of this script.

import type { ZoneId } from '../domain/zones'

export type Area = 'frontend' | 'webapi_rest' | 'adminhtml' | 'global'

export type FlowNode =
  | { kind: 'call'; types: string[]; method: string; children?: FlowNode[]; note?: string }
  | { kind: 'event'; name: string; note?: string }
  | { kind: 'rest'; route: string; types: string[]; method: string; children?: FlowNode[] }
  | { kind: 'note'; text: string }

export interface FlowStep {
  id: string
  zone: ZoneId
  title: string
  request: string
  area: Area
  description: string
  nodes: FlowNode[]
  /** Show this zone's async/extra entry points (crons, webhooks…) on this step */
  zoneExtras?: boolean
}

const call = (types: string | string[], method: string, children: FlowNode[] = [], note?: string): FlowNode => ({
  kind: 'call',
  types: Array.isArray(types) ? types : [types],
  method,
  children,
  note,
})
const ev = (name: string, note?: string): FlowNode => ({ kind: 'event', name, note })
const note = (text: string): FlowNode => ({ kind: 'note', text })

const FRONT_CONTROLLER = ['Magento\\Framework\\App\\FrontControllerInterface', 'Magento\\Framework\\App\\FrontController']
const RESPONSE = ['Magento\\Framework\\App\\Response\\Http', 'Magento\\Framework\\HTTP\\PhpEnvironment\\Response']

const saveEvents = (prefix: string): FlowNode[] => [ev(`${prefix}_save_before`), ev(`${prefix}_save_after`), ev(`${prefix}_save_commit_after`)]

const collectTotals = (): FlowNode =>
  call('Magento\\Quote\\Model\\Quote', 'collectTotals', [ev('sales_quote_collect_totals_before'), ev('sales_quote_address_collect_totals_before'), ev('sales_quote_address_collect_totals_after'), ev('sales_quote_collect_totals_after')])

const quoteSave = (): FlowNode =>
  call(['Magento\\Quote\\Api\\CartRepositoryInterface', 'Magento\\Quote\\Model\\QuoteRepository'], 'save', saveEvents('sales_quote'))

/** A storefront page or action: front controller → action → result → response. */
function action(route: string, fullAction: string, controller: string[], inner: FlowNode[] = [], renderLayout = true): FlowNode[] {
  const render: FlowNode[] = renderLayout
    ? [
        ev('layout_load_before'),
        ev('layout_generate_blocks_before'),
        ev('layout_generate_blocks_after'),
        ev('layout_render_before'),
        ev(`layout_render_before_${fullAction}`),
        ev('core_layout_render_element', 'disparado uma vez por bloco renderizado'),
      ]
    : []
  return [
    call(FRONT_CONTROLLER, 'dispatch', [
      call([...controller, 'Magento\\Framework\\App\\ActionInterface'], 'execute', [
        ev('controller_action_predispatch'),
        ev(`controller_action_predispatch_${route}`),
        ev(`controller_action_predispatch_${fullAction}`),
        ...inner,
        ev(`controller_action_postdispatch_${fullAction}`),
        ev(`controller_action_postdispatch_${route}`),
        ev('controller_action_postdispatch'),
      ]),
      ...render,
    ]),
    ev('controller_front_send_response_before'),
    call(RESPONSE, 'sendContent'),
  ]
}

/** A REST call: webapi front controller → service contract → JSON response. */
function rest(route: string, types: string[], method: string, children: FlowNode[] = []): FlowNode[] {
  return [
    call(['Magento\\Webapi\\Controller\\Rest', ...FRONT_CONTROLLER], 'dispatch', [
      { kind: 'rest', route, types, method, children },
      call('Magento\\Framework\\Webapi\\Rest\\Response', 'prepareResponse'),
    ]),
  ]
}

const PAYMENT_INFO = ['Magento\\Checkout\\Api\\PaymentInformationManagementInterface', 'Magento\\Checkout\\Model\\PaymentInformationManagement']
const CART_MANAGEMENT = ['Magento\\Quote\\Api\\CartManagementInterface', 'Magento\\Quote\\Model\\QuoteManagement']
const ORDER_MANAGEMENT = ['Magento\\Sales\\Api\\OrderManagementInterface', 'Magento\\Sales\\Model\\Service\\OrderService']

export const SCENARIO: { name: string; description: string; steps: FlowStep[] } = {
  name: 'Compra B2C nativa · cliente logado · Luma',
  description: 'Uma compra do início ao fim: home → categoria → produto → carrinho → checkout de 2 etapas → pedido → fatura → envio.',
  steps: [
    {
      id: 'home',
      zone: 'entrada',
      title: 'Acessa a loja',
      request: 'GET /',
      area: 'frontend',
      description: 'Primeira requisição da sessão: front controller, página CMS da home e envio da resposta.',
      nodes: action('cms', 'cms_index_index', ['Magento\\Cms\\Controller\\Index\\Index']),
      zoneExtras: true,
    },
    {
      id: 'category',
      zone: 'catalogo',
      title: 'Abre uma categoria',
      request: 'GET /categoria.html',
      area: 'frontend',
      description: 'Inicializa a categoria, carrega a listagem (layered navigation) e renderiza a PLP.',
      nodes: action('catalog', 'catalog_category_view', ['Magento\\Catalog\\Controller\\Category\\View'], [
        ev('catalog_controller_category_init_after'),
        call('Magento\\Catalog\\Model\\Layer', 'getProductCollection', [ev('catalog_block_product_list_collection'), ev('catalog_product_collection_load_after')]),
      ]),
      zoneExtras: true,
    },
    {
      id: 'product',
      zone: 'produto',
      title: 'Abre um produto',
      request: 'GET /produto.html',
      area: 'frontend',
      description: 'Helper de visualização inicializa o produto, dispara os eventos de PDP e monta o layout.',
      nodes: action('catalog', 'catalog_product_view', ['Magento\\Catalog\\Controller\\Product\\View'], [
        call('Magento\\Catalog\\Helper\\Product\\View', 'prepareAndRender', [
          call('Magento\\Catalog\\Helper\\Product', 'initProduct', [ev('catalog_controller_product_init_before'), ev('catalog_controller_product_init_after')]),
          ev('catalog_controller_product_view'),
          ev('catalog_product_load_after'),
        ]),
      ]),
      zoneExtras: true,
    },
    {
      id: 'add-to-cart',
      zone: 'carrinho',
      title: 'Adiciona ao carrinho',
      request: 'POST /checkout/cart/add',
      area: 'frontend',
      description: 'Cart::addProduct → Quote::addProduct, recalcula totais, salva a quote e recarrega a seção "cart" do customer-data.',
      nodes: [
        ...action(
          'checkout',
          'checkout_cart_add',
          ['Magento\\Checkout\\Controller\\Cart\\Add'],
          [
            call('Magento\\Checkout\\Model\\Cart', 'addProduct', [
              ev('checkout_cart_product_add_before'),
              call('Magento\\Quote\\Model\\Quote', 'addProduct', [ev('sales_quote_add_item'), ev('sales_quote_product_add_after')]),
              ev('checkout_cart_product_add_after'),
            ]),
            call('Magento\\Checkout\\Model\\Cart', 'save', [ev('checkout_cart_save_before'), collectTotals(), quoteSave(), ev('checkout_cart_save_after')]),
            ev('checkout_cart_add_product_complete'),
          ],
          false,
        ),
        note('O navegador recarrega a seção "cart" do customer-data: GET /customer/section/load'),
        call(['Magento\\Checkout\\CustomerData\\Cart'], 'getSectionData', [
          call(['Magento\\Checkout\\CustomerData\\AbstractItem', 'Magento\\Checkout\\CustomerData\\DefaultItem', 'Magento\\Checkout\\CustomerData\\ItemInterface'], 'getItemData'),
        ]),
      ],
      zoneExtras: true,
    },
    {
      id: 'cart',
      zone: 'carrinho',
      title: 'Abre o carrinho',
      request: 'GET /checkout/cart',
      area: 'frontend',
      description: 'Página do carrinho: valida itens, recalcula totais e renderiza.',
      nodes: action('checkout', 'checkout_cart_index', ['Magento\\Checkout\\Controller\\Cart\\Index'], [collectTotals()]),
    },
    {
      id: 'checkout',
      zone: 'checkout',
      title: 'Entra no checkout',
      request: 'GET /checkout',
      area: 'frontend',
      description: 'Monta o jsLayout do checkout (LayoutProcessor/AttributeMerger) e o window.checkoutConfig (ConfigProviders).',
      nodes: action('checkout', 'checkout_index_index', ['Magento\\Checkout\\Controller\\Index\\Index'], [
        call(['Magento\\Checkout\\Block\\Checkout\\LayoutProcessor', 'Magento\\Checkout\\Block\\Checkout\\LayoutProcessorInterface'], 'process', [
          call('Magento\\Checkout\\Block\\Checkout\\AttributeMerger', 'merge'),
        ]),
        call(['Magento\\Checkout\\Model\\CompositeConfigProvider', 'Magento\\Checkout\\Model\\ConfigProviderInterface'], 'getConfig', [
          call(['Magento\\Checkout\\Model\\DefaultConfigProvider'], 'getConfig'),
          call(['Magento\\CheckoutAgreements\\Model\\AgreementsConfigProvider'], 'getConfig'),
        ]),
      ]),
    },
    {
      id: 'estimate-shipping',
      zone: 'checkout',
      title: 'Calcula o frete',
      request: 'POST /rest/default/V1/carts/mine/estimate-shipping-methods',
      area: 'webapi_rest',
      description: 'Etapa Entrega: ao informar o CEP, o front estima os métodos de envio (collectRates).',
      nodes: rest('rest:POST /V1/carts/mine/estimate-shipping-methods', ['Magento\\Quote\\Api\\ShipmentEstimationInterface', 'Magento\\Quote\\Model\\ShippingMethodManagement'], 'estimateByExtendedAddress', [
        call('Magento\\Quote\\Model\\Quote\\Address', 'requestShippingRates', [call(['Magento\\Shipping\\Model\\Shipping', 'Magento\\Quote\\Model\\Quote\\Address\\RateCollectorInterface'], 'collectRates')]),
      ]),
    },
    {
      id: 'shipping-information',
      zone: 'checkout',
      title: 'Salva entrega',
      request: 'POST /rest/default/V1/carts/mine/shipping-information',
      area: 'webapi_rest',
      description: 'Botão "Próximo": grava endereço e método de entrega na quote e devolve os métodos de pagamento e totais.',
      nodes: rest('rest:POST /V1/carts/mine/shipping-information', ['Magento\\Checkout\\Api\\ShippingInformationManagementInterface', 'Magento\\Checkout\\Model\\ShippingInformationManagement'], 'saveAddressInformation', [
        collectTotals(),
        quoteSave(),
        call(['Magento\\Quote\\Api\\PaymentMethodManagementInterface', 'Magento\\Quote\\Model\\PaymentMethodManagement'], 'getList'),
        call(['Magento\\Quote\\Api\\CartTotalRepositoryInterface', 'Magento\\Quote\\Model\\Cart\\CartTotalRepository'], 'get'),
      ]),
    },
    {
      id: 'place-order',
      zone: 'checkout',
      title: 'Finaliza o pedido',
      request: 'POST /rest/default/V1/carts/mine/payment-information',
      area: 'webapi_rest',
      description: 'Botão "Finalizar": salva o pagamento e converte a quote em pedido (QuoteManagement::placeOrder → OrderService::place).',
      nodes: rest('rest:POST /V1/carts/mine/payment-information', PAYMENT_INFO, 'savePaymentInformationAndPlaceOrder', [
        call(PAYMENT_INFO, 'savePaymentInformation', [
          call(['Magento\\Quote\\Api\\PaymentMethodManagementInterface', 'Magento\\Quote\\Model\\PaymentMethodManagement'], 'set', [ev('sales_quote_payment_import_data_before')]),
        ], 'chamado via $this, que é o Interceptor: os plugins deste método também rodam'),
        call(CART_MANAGEMENT, 'placeOrder', [
          ev('checkout_submit_before'),
          call(CART_MANAGEMENT, 'submit', [
            call('Magento\\Quote\\Model\\Quote', 'reserveOrderId', [call('Magento\\SalesSequence\\Model\\Sequence', 'getNextValue')]),
            ev('sales_model_service_quote_submit_before'),
            call(ORDER_MANAGEMENT, 'place', [
              call('Magento\\Sales\\Model\\Order', 'place', [
                ev('sales_order_place_before'),
                call('Magento\\Sales\\Model\\Order\\Payment', 'place', [ev('sales_order_payment_place_start'), ev('sales_order_payment_place_end')]),
                ev('sales_order_place_after'),
              ]),
              call(['Magento\\Sales\\Api\\OrderRepositoryInterface', 'Magento\\Sales\\Model\\OrderRepository'], 'save', saveEvents('sales_order')),
            ]),
            ev('sales_model_service_quote_submit_success'),
            call('Magento\\Sales\\Model\\Order\\Email\\Sender\\OrderSender', 'send', [ev('email_order_set_template_vars_before')], 'disparado pelo observer nativo Quote\\Observer\\SubmitObserver'),
          ]),
          ev('checkout_submit_all_after'),
        ]),
      ]),
    },
    {
      id: 'success',
      zone: 'checkout',
      title: 'Página de sucesso',
      request: 'GET /checkout/onepage/success',
      area: 'frontend',
      description: 'Confirmação do pedido para o cliente.',
      nodes: action('checkout', 'checkout_onepage_success', ['Magento\\Checkout\\Controller\\Onepage\\Success'], [ev('checkout_onepage_controller_success_action')]),
      zoneExtras: true,
    },
    {
      id: 'invoice',
      zone: 'admin',
      title: 'Pagamento confirmado → fatura',
      request: 'Gatilho: webhook, cron de pagamento ou admin',
      area: 'global',
      description: 'Invoice::register → pay() (sales_order_invoice_pay) → sales_order_invoice_register; o pedido vai para processing.',
      nodes: [
        note('A área depende de quem confirma o pagamento (cron, webhook REST ou admin); aqui só os observers/plugins globais.'),
        call('Magento\\Sales\\Model\\Order\\Invoice', 'register', [
          call('Magento\\Sales\\Model\\Order\\Invoice', 'pay', [call('Magento\\Sales\\Model\\Order\\Payment', 'pay', [ev('sales_order_payment_pay')]), ev('sales_order_invoice_pay')]),
          ev('sales_order_invoice_register'),
        ]),
        call(['Magento\\Sales\\Api\\InvoiceRepositoryInterface', 'Magento\\Sales\\Model\\Order\\InvoiceRepository'], 'save', saveEvents('sales_order_invoice')),
        call(['Magento\\Sales\\Api\\OrderRepositoryInterface', 'Magento\\Sales\\Model\\OrderRepository'], 'save', saveEvents('sales_order')),
        call('Magento\\Sales\\Model\\Order\\Email\\Sender\\InvoiceSender', 'send', [ev('email_invoice_set_template_vars_before')]),
      ],
      zoneExtras: true,
    },
    {
      id: 'ship',
      zone: 'expedicao',
      title: 'Envio do pedido',
      request: 'POST /rest/default/V1/order/:orderId/ship',
      area: 'webapi_rest',
      description: 'ERP/WMS cria o envio: ShipOrder registra o shipment, salva shipment e pedido (state complete) e notifica o cliente.',
      nodes: rest('rest:POST /V1/order/:orderId/ship', ['Magento\\Sales\\Api\\ShipOrderInterface', 'Magento\\Sales\\Model\\ShipOrder'], 'execute', [
        call(['Magento\\Sales\\Api\\ShipmentRepositoryInterface', 'Magento\\Sales\\Model\\Order\\ShipmentRepository'], 'save', saveEvents('sales_order_shipment')),
        call(['Magento\\Sales\\Api\\OrderRepositoryInterface', 'Magento\\Sales\\Model\\OrderRepository'], 'save', saveEvents('sales_order')),
        call('Magento\\Sales\\Model\\Order\\Email\\Sender\\ShipmentSender', 'send', [ev('email_shipment_set_template_vars_before')]),
      ]),
      zoneExtras: true,
    },
  ],
}
