---
name: sfcc-hooks-checkout
description: Use ao mexer em carrinho, cálculo, frete, pagamento, pedido ou extensões de API no Salesforce B2C Commerce - hooks.json, HookMgr, dw.order.calculate, processadores de pagamento, Transaction, Basket e Order, promoções e hooks de OCAPI/SCAPI.
---

# Hooks, carrinho e pedido no SFCC

## Configuração antes de código

| Pedido do negócio | Primeiro tente |
|---|---|
| Frete grátis acima de X, desconto, brinde, cupom | **Promotions + Campaigns** (Merchant Tools → Online Marketing) |
| "Faltam R$ X para..." | `PromotionMgr.getDiscounts(basket)` → `getApproachingOrderDiscounts()` / `getApproachingShippingDiscounts(shipment)` (o SFRA já usa em `models/cart`) |
| Preço por grupo ou período | Price books e customer groups |
| Métodos e custos de frete | Shipping methods (Merchant Tools → Ordering) |

## Registrar um hook

`package.json` do cartucho: `{ "hooks": "./cartridge/scripts/hooks.json" }`.

```json
{
  "hooks": [
    { "name": "dw.order.calculate", "script": "./cart/calculate.js" },
    { "name": "app.payment.processor.meu_gateway", "script": "./payment/processor/meuGateway.js" }
  ]
}
```

- O caminho do script é relativo ao `hooks.json`. Ele **não** passa pelo cartridge path.
- Quando vários cartuchos registram o mesmo hook, todos rodam na ordem do cartridge path. Num hook que já existe na base (`dw.order.calculate`), registrar de novo faz o cálculo rodar duas vezes. Prefira estender os helpers que o hook chama via `require('*/...')`. Se registrar mesmo assim, diga por que no card.
- Hook próprio: `HookMgr.hasHook('app.x')` e `HookMgr.callHook('app.x', 'funcao', args)`.

## Cálculo

O SFRA chama `dw.order.calculate` depois de cada mudança no carrinho (`basketCalculationHelpers.calculateTotals`). O script calcula preços, aplica promoções (`PromotionMgr.applyDiscounts`), frete e impostos, e chama `basket.updateTotals()`. Mudança de total é aqui, ou nos helpers que ele usa.

## Transações

- Toda escrita em objeto persistente (Basket, Order, Customer, CustomObject, atributos `custom`) vai dentro de `Transaction.wrap(function () { ... })`.
- Ler não precisa de transação.
- Nos hooks de checkout das Shopper APIs a plataforma já gerencia a transação: abrir outra pode falhar. Confira na documentação do hook.

## Pagamento

`app.payment.processor.<id>` com `Handle(basket, paymentInformation)` (cria o payment instrument) e `Authorize(orderNumber, paymentInstrument, paymentProcessor)` (autoriza no gateway). O id é o do Payment Processor configurado no Business Manager. Nunca registre ou persista dados de cartão.

## Pedido

- `OrderMgr.createOrder(basket)` cria o pedido. Depois da autorização: `OrderMgr.placeOrder(order)`. Em falha: `OrderMgr.failOrder(order, true)`. O fluxo do SFRA fica em `CheckoutServices-PlaceOrder` e `checkoutHelpers`.
- Integrações com o pedido (ERP, OMS) vão por job ou serviço assíncrono, não dentro do PlaceOrder.

## Hooks de API (OCAPI/SCAPI)

`dw.ocapi.shop.basket.beforePOST`, `afterPOST`, `modifyPOSTResponse` etc. Devolva `Status` (`new Status(Status.OK)` ou `Status.ERROR` com código), mantenha esses hooks rápidos e não chame serviços lentos neles.
