import { integrationName, isBundledExtension, recognise } from '../src/diagrams/integration-catalog'

describe('Integrações reconhecidas pelo nome', () => {
  it('recognises named products in modules, cartridges and services', () => {
    expect(recognise('Adyen_Payment')).toMatchObject({ name: 'Adyen', category: 'Pagamento', named: true })
    expect(recognise('MercadoPago_Core')).toMatchObject({ name: 'Mercado Pago' })
    expect(recognise('int_cybersource')).toMatchObject({ name: 'CyberSource', category: 'Pagamento' })
    expect(recognise('link_adyen')).toMatchObject({ name: 'Adyen' })
    expect(recognise('erp.sap.pedidos')).toMatchObject({ name: 'SAP', category: 'ERP' })
    expect(recognise('Loja_SapPedidos')).toMatchObject({ name: 'SAP' })
    expect(recognise('Frenet_Shipping')).toMatchObject({ name: 'Frenet', category: 'Frete' })
    expect(recognise('ClearSale_Integration')).toMatchObject({ category: 'Antifraude' })
    expect(recognise('Smile_ElasticsuiteCore')).toMatchObject({ name: 'ElasticSuite', category: 'Busca' })
  })

  it("falls back to the project's own generic integrations", () => {
    expect(recognise('Loja_Erp')).toMatchObject({ name: 'ERP', named: false })
    expect(recognise('Loja_IntegracaoOms')).toMatchObject({ name: 'OMS' })
    expect(recognise('pagamento.gateway.autoriza')).toMatchObject({ name: 'Gateway de pagamento', named: false })
  })

  it('names the project integrations whose system the name does not tell, merging them by subject', () => {
    expect(integrationName('Loja_StockIntegration')).toBe('Integração de estoque')
    expect(integrationName('Loja_StockIntegrationApi')).toBe('Integração de estoque')
    expect(integrationName('Loja_PriceIntegrationApi')).toBe('Integração de preços')
    expect(integrationName('Loja_BudgetIntegration')).toBe('Integração de orçamentos')
    expect(integrationName('Loja_AcmeConnector')).toBe('Acme')
    expect(integrationName('Loja_Integration')).toBe('Integração (Loja_Integration)')
  })

  it('treats the extensions bundled with Magento as installed, not as in use', () => {
    for (const pkg of ['klarna/m2-payments', 'paypal/module-braintree', 'vertex/module-tax', 'yotpo/magento2-module-yotpo-reviews', 'dotmailer/dotmailer-magento2-extension', 'amzn/amazon-pay-module']) expect(isBundledExtension(pkg)).toBe(true)
    expect(isBundledExtension('adyen/module-payment')).toBe(false)
    expect(recognise('Loja_ShippingOrderEmail')).toBeNull()
  })

  it('does not see systems in ordinary words, nor in the platform itself', () => {
    expect(recognise('Loja_Sapataria')).toBeNull()
    expect(recognise('Loja_Catalogo')).toBeNull()
    expect(recognise('Magento_Payment')).toBeNull()
    expect(recognise('app_storefront_base')).toBeNull()
    expect(recognise('Loja_Tinyurl')).toBeNull()
  })
})
