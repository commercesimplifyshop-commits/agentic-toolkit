export type DiagramKind = 'c4' | 'uml' | 'flow' | 'other'

export interface Template {
  id: string
  kind: DiagramKind
  label: string
  hint: string
  source: string
}

/** Starting points in Mermaid syntax. Every one renders offline, no CDN. */
export const TEMPLATES: Template[] = [
  {
    id: 'c4-context',
    kind: 'c4',
    label: 'C4 · Contexto',
    hint: 'O sistema, quem usa e os sistemas externos com que conversa.',
    source: `C4Context
  title Loja e integrações
  Person(cliente, "Cliente", "Compra pela vitrine")
  Person(admin, "Operador", "Gerencia pedidos e catálogo")
  System(loja, "Loja Magento", "E-commerce B2C")
  System_Ext(erp, "ERP", "Faturamento e estoque")
  System_Ext(pagamento, "Gateway de pagamento", "Cartão e Pix")
  Rel(cliente, loja, "Compra", "HTTPS")
  Rel(admin, loja, "Administra", "HTTPS")
  Rel(loja, erp, "Envia pedidos", "API REST")
  Rel(loja, pagamento, "Autoriza pagamento", "API")`,
  },
  {
    id: 'c4-container',
    kind: 'c4',
    label: 'C4 · Contêineres',
    hint: 'Aplicações, serviços e bancos dentro de um sistema.',
    source: `C4Container
  title Loja Magento: contêineres
  Person(cliente, "Cliente")
  System_Boundary(loja, "Loja Magento") {
    Container(web, "Vitrine", "PHP / Luma", "Catálogo e checkout")
    Container(admin, "Admin", "PHP", "Gestão da loja")
    Container(api, "API REST", "PHP", "Integrações")
    ContainerDb(db, "Banco", "MySQL", "Pedidos, clientes, catálogo")
    ContainerDb(cache, "Cache", "Redis", "Sessões e cache de página")
  }
  System_Ext(erp, "ERP", "Faturamento")
  Rel(cliente, web, "Navega e compra", "HTTPS")
  Rel(web, api, "Consulta", "JSON/HTTPS")
  Rel(admin, api, "Administra", "JSON/HTTPS")
  Rel(api, db, "Lê e grava", "SQL")
  Rel(web, cache, "Lê e grava", "RESP")
  Rel(api, erp, "Envia pedidos", "REST")`,
  },
  {
    id: 'c4-component',
    kind: 'c4',
    label: 'C4 · Componentes',
    hint: 'Módulos e classes principais dentro de um contêiner.',
    source: `C4Component
  title Checkout: componentes
  Container_Boundary(checkout, "Módulo de checkout") {
    Component(controller, "Controller", "PHP", "Recebe a requisição do checkout")
    Component(quote, "Quote Service", "PHP", "Monta o carrinho e os totais")
    Component(payment, "Payment Manager", "PHP", "Escolhe e chama o meio de pagamento")
    Component(order, "Order Placer", "PHP", "Cria o pedido após aprovação")
  }
  ContainerDb(db, "Banco", "MySQL")
  System_Ext(gateway, "Gateway", "Pagamento")
  Rel(controller, quote, "Usa")
  Rel(controller, payment, "Usa")
  Rel(payment, gateway, "Autoriza", "API")
  Rel(payment, order, "Aprovado →")
  Rel(order, db, "Persiste", "SQL")`,
  },
  {
    id: 'uml-class',
    kind: 'uml',
    label: 'UML · Classes',
    hint: 'Classes, atributos, métodos e relacionamentos.',
    source: `classDiagram
  direction LR
  class Quote {
    +int id
    +string customerEmail
    +float grandTotal
    +collectTotals() void
    +placeOrder() Order
  }
  class Order {
    +int id
    +string status
    +place() void
    +cancel() void
  }
  class PaymentMethod {
    <<interface>>
    +authorize(amount) bool
  }
  class CreditCard
  class Pix
  Quote "1" --> "0..1" Order : gera
  Quote --> PaymentMethod : usa
  PaymentMethod <|.. CreditCard
  PaymentMethod <|.. Pix`,
  },
  {
    id: 'uml-sequence',
    kind: 'uml',
    label: 'UML · Sequência',
    hint: 'A ordem das mensagens entre atores e componentes.',
    source: `sequenceDiagram
  actor Cliente
  participant Vitrine
  participant Checkout
  participant Pagamento
  participant ERP
  Cliente->>Vitrine: finaliza o pedido
  Vitrine->>Checkout: place-order
  Checkout->>Pagamento: autoriza valor
  alt aprovado
    Pagamento-->>Checkout: OK
    Checkout->>ERP: envia pedido
    Checkout-->>Cliente: confirmação
  else recusado
    Pagamento-->>Checkout: recusado
    Checkout-->>Cliente: pede outro cartão
  end`,
  },
  {
    id: 'uml-state',
    kind: 'uml',
    label: 'UML · Estados',
    hint: 'Os estados de um objeto e as transições entre eles.',
    source: `stateDiagram-v2
  [*] --> Pendente
  Pendente --> Pago: pagamento aprovado
  Pendente --> Cancelado: cliente cancela
  Pago --> Faturado: nota emitida
  Faturado --> Enviado: despachado
  Enviado --> Entregue: confirmação
  Pago --> Reembolsado: estorno total
  Entregue --> [*]
  Cancelado --> [*]
  Reembolsado --> [*]`,
  },
  {
    id: 'flow-deploy',
    kind: 'flow',
    label: 'Fluxo · Implantação',
    hint: 'Ambientes, servidores e como o tráfego chega até eles.',
    source: `flowchart LR
  usuario([Usuário]) --> cdn[CDN]
  cdn --> lb{{Load balancer}}
  lb --> web1[Web 1]
  lb --> web2[Web 2]
  web1 --> redis[(Redis)]
  web2 --> redis
  web1 --> db[(MySQL primário)]
  web2 --> db
  db -.réplica.-> rep[(MySQL réplica)]`,
  },
  {
    id: 'flow-process',
    kind: 'flow',
    label: 'Fluxo · Processo',
    hint: 'Passos e decisões de um processo de negócio.',
    source: `flowchart TD
  inicio([Pedido recebido]) --> valida{Dados válidos?}
  valida -- não --> erro[Devolve ao cliente]
  valida -- sim --> estoque{Tem estoque?}
  estoque -- não --> espera[Entra em backorder]
  estoque -- sim --> cobra[Cobra pagamento]
  cobra --> fim([Pedido criado])`,
  },
  {
    id: 'other-er',
    kind: 'other',
    label: 'Banco · Entidades (ER)',
    hint: 'Tabelas e relacionamentos de dados.',
    source: `erDiagram
  CUSTOMER ||--o{ ORDER : faz
  ORDER ||--|{ ORDER_ITEM : contém
  PRODUCT ||--o{ ORDER_ITEM : aparece_em
  CUSTOMER {
    int entity_id PK
    string email
  }
  ORDER {
    int entity_id PK
    string status
    decimal grand_total
  }
  ORDER_ITEM {
    int item_id PK
    int product_id FK
    int qty_ordered
  }
  PRODUCT {
    int entity_id PK
    string sku
  }`,
  },
]

/** Magento 2 reference architectures by business model (C4 containers, editable). */
export const MAGENTO_TEMPLATES: Template[] = [
  {
    id: 'mg-b2c',
    kind: 'c4',
    label: 'Magento 2 · B2C',
    hint: 'Loja para o consumidor final: vitrine, busca, checkout e ERP.',
    source: `C4Container
  title Magento 2 · B2C
  Person(consumidor, "Consumidor", "Compra pela vitrine")
  System_Boundary(loja, "Loja Magento 2") {
    Container(vitrine, "Vitrine", "Luma / PHP", "Catálogo, carrinho e checkout")
    Container(admin, "Admin", "PHP", "Pedidos, catálogo e promoções")
    Container(api, "API REST / GraphQL", "PHP", "Integrações e front headless")
    Container(worker, "Consumers", "PHP / RabbitMQ", "Processos assíncronos: e-mail, estoque, ERP")
    ContainerDb(db, "Banco", "MySQL", "Pedidos, clientes, catálogo")
    ContainerDb(busca, "Busca", "OpenSearch", "Busca e filtros")
    ContainerDb(cache, "Cache", "Redis", "Sessões e cache de bloco")
  }
  Container_Ext(cdn, "CDN / Varnish", "Cache de página e imagens")
  System_Ext(pagamento, "Gateway de pagamento", "Cartão e Pix")
  System_Ext(erp, "ERP", "Faturamento e estoque")
  System_Ext(transacional, "E-mail / WhatsApp", "Mensagens transacionais")
  Rel(consumidor, cdn, "Navega e compra", "HTTPS")
  Rel(cdn, vitrine, "Cache miss")
  Rel(vitrine, api, "Consulta", "JSON")
  Rel(vitrine, busca, "Busca", "HTTP")
  Rel(vitrine, cache, "Lê e grava", "RESP")
  Rel(api, db, "Lê e grava", "SQL")
  Rel(admin, db, "Gerencia", "SQL")
  Rel(worker, erp, "Sincroniza pedidos", "REST")
  Rel(vitrine, pagamento, "Autoriza", "API")
  Rel(worker, transacional, "Envia", "API")`,
  },
  {
    id: 'mg-b2b',
    kind: 'c4',
    label: 'Magento 2 · B2B',
    hint: 'Empresas com contas, preços negociados, cotação e aprovação.',
    source: `C4Container
  title Magento 2 · B2B
  Person(comprador, "Comprador da empresa", "Compra com a conta corporativa")
  Person(vendedor, "Representante", "Negocia e cria cotações")
  System_Boundary(loja, "Loja Magento 2 B2B") {
    Container(portal, "Portal B2B", "Luma / PHP", "Contas de empresa, pedidos rápidos e cotações")
    Container(admin, "Admin", "PHP", "Empresas, listas de preço e aprovações")
    Container(api, "API REST", "PHP", "Integração com ERP e CRM")
    ContainerDb(db, "Banco", "MySQL", "Empresas, cotações, pedidos")
    ContainerDb(busca, "Busca", "OpenSearch", "Catálogo compartilhado")
  }
  System_Ext(erp, "ERP", "Preços, crédito e estoque")
  System_Ext(crm, "CRM", "Oportunidades e representantes")
  System_Ext(pagamento, "Boleto / Faturamento", "Pagamento a prazo")
  Rel(comprador, portal, "Compra", "HTTPS")
  Rel(vendedor, admin, "Cria cotação", "HTTPS")
  Rel(portal, api, "Consulta preço e crédito", "JSON")
  Rel(portal, busca, "Busca", "HTTP")
  Rel(api, db, "Lê e grava", "SQL")
  Rel(api, erp, "Preço negociado e estoque", "REST")
  Rel(admin, crm, "Sincroniza", "REST")
  Rel(portal, pagamento, "Pedido a prazo", "API")`,
  },
  {
    id: 'mg-d2c',
    kind: 'c4',
    label: 'Magento 2 · D2C',
    hint: 'Marca que vende direto ao consumidor, com dados e marketing próprios.',
    source: `C4Container
  title Magento 2 · D2C
  Person(cliente, "Cliente da marca", "Compra e assina pelo site ou app")
  System_Boundary(marca, "Plataforma D2C") {
    Container(storefront, "Storefront", "PWA / headless", "Vitrine da marca e experiências")
    Container(api, "API GraphQL", "PHP", "Catálogo, carrinho e conta do cliente")
    Container(admin, "Admin", "PHP", "Catálogo, pedidos e assinaturas")
    ContainerQueue(fila, "Fila de eventos", "RabbitMQ", "Eventos de pedido e cliente")
    ContainerDb(db, "Banco", "MySQL", "Pedidos, clientes, assinaturas")
  }
  System_Ext(cdp, "CDP / CRM", "Perfil único do cliente")
  System_Ext(mkt, "Automação de marketing", "E-mail, SMS e push")
  System_Ext(pim, "PIM", "Fichas técnicas e mídia")
  System_Ext(fidelidade, "Fidelidade", "Pontos e cupons")
  System_Ext(pagamento, "Gateway", "Cartão, Pix e carteiras")
  Rel(cliente, storefront, "Navega e compra", "HTTPS")
  Rel(storefront, api, "GraphQL", "HTTPS")
  Rel(admin, api, "Administra", "HTTPS")
  Rel(api, db, "Lê e grava", "SQL")
  Rel(api, fila, "Publica eventos", "AMQP")
  Rel(fila, cdp, "Envia perfil", "API")
  Rel(fila, mkt, "Dispara campanhas", "API")
  Rel(admin, pim, "Importa fichas", "API")
  Rel(api, fidelidade, "Pontos", "REST")
  Rel(api, pagamento, "Autoriza", "API")`,
  },
  {
    id: 'mg-marketplace',
    kind: 'c4',
    label: 'Magento 2 · Marketplace',
    hint: 'Vários vendedores no mesmo catálogo, com pedido dividido e repasse.',
    source: `C4Container
  title Magento 2 · Marketplace
  Person(cliente, "Consumidor", "Compra produtos de vários vendedores")
  Person(vendedor, "Vendedor", "Gerencia catálogo, pedidos e repasses")
  System_Boundary(mp, "Marketplace Magento 2") {
    Container(vitrine, "Vitrine", "Luma / PHP", "Catálogo unificado e checkout")
    Container(portal, "Portal do vendedor", "PHP", "Cadastro, catálogo e pedidos do vendedor")
    Container(admin, "Admin", "PHP", "Aprovação de vendedores e comissões")
    Container(api, "API REST", "PHP", "Integrações dos vendedores")
    ContainerQueue(fila, "Fila", "RabbitMQ", "Divisão do pedido por vendedor")
    ContainerDb(db, "Banco", "MySQL", "Vendedores, pedidos divididos, repasses")
  }
  System_Ext(pagamento, "Gateway com split", "Divide o pagamento entre a loja e cada vendedor")
  System_Ext(frete, "Transportadoras", "Frete por vendedor")
  System_Ext(erp, "ERP do vendedor", "Estoque e preço próprios")
  Rel(cliente, vitrine, "Compra", "HTTPS")
  Rel(vendedor, portal, "Gerencia", "HTTPS")
  Rel(portal, api, "Cadastra produtos", "JSON")
  Rel(admin, db, "Aprova e define comissão", "SQL")
  Rel(vitrine, fila, "Pedido pago", "AMQP")
  Rel(fila, db, "Grava um pedido por vendedor", "SQL")
  Rel(fila, pagamento, "Split e repasse", "API")
  Rel(fila, frete, "Cota frete por vendedor", "API")
  Rel(api, erp, "Sincroniza estoque", "REST")`,
  },
]

export const KIND_LABEL: Record<DiagramKind, string> = { c4: 'C4', uml: 'UML', flow: 'Fluxo', other: 'Outro' }

export const BLANK_SOURCE = 'flowchart LR\n  A[Início] --> B[Fim]'
