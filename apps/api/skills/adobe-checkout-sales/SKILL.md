---
name: adobe-checkout-sales
description: Use ao mexer em carrinho, checkout, frete, pagamento, totais, regras de preço e pedidos no Adobe Commerce / Magento 2 - quote, totals collectors, métodos de envio (carriers), métodos de pagamento, cart price rules e fluxo de criação do pedido.
---

# Carrinho, checkout e pedido no Adobe Commerce

## Configuração antes de código

| Pedido do negócio | Primeiro tente |
|---|---|
| Frete grátis acima de X, desconto por quantidade, cupom | **Cart Price Rules** (Marketing → Regras de preço do carrinho) |
| Preço promocional por categoria ou grupo | **Catalog Price Rules** ou preço especial |
| Frete fixo, por tabela, grátis | Métodos nativos (Flat Rate, Table Rates, Free Shipping) |
| Restringir pagamento por grupo/país | Configuração do método de pagamento |

Código só quando a regra não cabe nesses recursos. Registre isso no card.

## Totais

- Um total novo (taxa, desconto especial) é um **total collector**: `etc/sales.xml` (`<section name="quote"><group name="totals"><item name="x" instance="..." sort_order="..."/>`), uma classe estendendo `Magento\Quote\Model\Quote\Address\Total\AbstractTotal` (`collect()` e `fetch()`), e o mesmo total em invoice e creditmemo se precisar ir até o financeiro.
- Para exibir no checkout: o componente JS do total em `checkout_cart_index.xml` e `checkout_index_index.xml`.

## Frete

Um carrier novo estende `AbstractCarrier` e implementa `CarrierInterface` (`collectRates(RateRequest)`, `getAllowedMethods()`). Configuração em `system.xml` sob `carriers/<codigo>`. Cotação externa: timeout curto, cache por CEP+carrinho e um fallback quando o serviço falhar.

## Pagamento

Prefira a extensão oficial do gateway. Customização via plugins no adapter ou nos commands (Payment Gateway com `CommandPool`). Nunca registre ou persista dados de cartão.

## Pedido

- O pedido nasce em `Magento\Quote\Model\QuoteManagement::submit`. Os eventos úteis são `sales_model_service_quote_submit_before/success` e `sales_order_place_after`.
- Integrações com o pedido (ERP, antifraude) vão por fila ou cron, nunca dentro do submit.
- Dados extras no pedido: extension attributes (veja a skill de dados), copiados da quote para o pedido via `etc/fieldset.xml` ou plugin.

## Testes que não podem faltar

Carrinho no limite exato da regra, abaixo e acima; cupom combinado; cliente logado e convidado; multi-endereço se a loja usa; moeda e escopo de website; pedido criado pelo admin.
