// Maps a Magento integration point to a zone of the StoreFlow purchase flow.
// Rules are ordered: the first match wins, so specific rules come first.
// Anything left as "outros" is a candidate for Claude to classify by reading the code.

const RULES = [
  ['checkout', 'frete/endereço no checkout', /collectrates|shippingtablerates|estimate-?shipping|shippingmethodmanagement|shipping-?information|postcode|viacep|deliverydate|storepickup|offlineshipping|flatrate|guest-?carts?\/[^ ]*\/shipping|addresses?oncart|shippingaddress/],
  ['checkout', 'pagamento / finalização', /payment|braspag|pagarme|pagseguro|mercadopago|\bpix|interest|installment|placeorder|place-?order|checkoutagreements|totals|checkout_submit|submit_all_after|sales_model_service_quote_submit|checkout_onepage|checkout_type_onepage|checkout/],
  ['expedicao', 'envio e rastreio', /shipment|shiporder|\btrack|carrier|nfe|danfe|inventoryshipping|sourcededuction/],
  ['armazem', 'estoque e CD', /inventory|stock|warehouse|\bsource|reservation|\bmsi\b/],
  ['admin', 'pós-pedido no admin', /sales_order|salesorder|\border|invoice|creditmemo|refund|\brma\b|antifraud|workflow|sales\b|adminhtml|backend|admin_user|\badmin|authorization/],
  ['carrinho', 'carrinho / quote', /quote|cart|salesrule|coupon|gift|wishlist|customerbalance|reorder/],
  ['produto', 'página de produto', /product|price|gallery|swatch|review|productlabel|msrp|bundle|configurable|grouped|downloadable|weee/],
  ['catalogo', 'navegação e busca', /category|catalog|search|algolia|elastic|layer|attributefilter|menu|urlrewrite|seo|banner|cms|pagebuilder|\bpage\b|eav|attribute/],
  ['entrada', 'sessão e conta do cliente', /customer|login|account|session|\bauth|password|lgpd|gdpr|newsletter|captcha|persistent|\bstore\b|directory/],
  ['integracoes', 'integração / processo assíncrono', /\berp\b|\bsap\b|linx|totvs|bling|masterdata|\bpim|integration|import|export|rabbit|queue|cron|webhook|rdstation|datalayer|\bga\b|criteo|google|zenvia|sms|email|analytics|async/],
]

export function classify(primary, fallback = '') {
  for (const text of [primary, fallback]) {
    const sig = text.toLowerCase()
    for (const [zone, reason, re] of RULES) {
      if (re.test(sig)) return { zone, reason }
    }
  }
  return { zone: 'outros', reason: 'sem regra correspondente' }
}
