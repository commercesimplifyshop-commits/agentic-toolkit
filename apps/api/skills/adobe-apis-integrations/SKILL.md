---
name: adobe-apis-integrations
description: Use ao criar ou analisar APIs e integrações no Adobe Commerce / Magento 2 - REST (webapi.xml, service contracts, ACL), GraphQL (schema.graphqls e resolvers), APIs assíncronas e bulk, clientes HTTP para sistemas externos (ERP, OMS, PIM, gateways) e integrações por fila.
---

# APIs e integrações no Adobe Commerce

## Expor uma API REST

1. Uma interface de service contract em `Api/` com PHPDoc completo nos parâmetros e no retorno. O framework usa o PHPDoc para serializar, então tipos errados quebram a API.
2. Um `preference` da interface para a implementação no `di.xml`.
3. A rota em `etc/webapi.xml`:

```xml
<route url="/V1/vendor-modulo/registros/:codigo" method="GET">
    <service class="Vendor\Modulo\Api\RegistroRepositoryInterface" method="getByCodigo"/>
    <resources><resource ref="Vendor_Modulo::registros"/></resources>
</route>
```

4. O recurso de ACL em `etc/acl.xml`. Use `anonymous` só para dado público e `self` para o cliente logado (com `%customer_id%` forçado nos parâmetros).

## GraphQL

`etc/schema.graphqls` com `type Query { ... @resolver(class: "Vendor\\Modulo\\Model\\Resolver\\X") }`, e um resolver implementando `ResolverInterface::resolve()`. Valide a autorização do contexto (`$context->getUserId()`) e use `@cache(cacheIdentity: ...)` em queries públicas.

## Consumir um sistema externo

- Um client dedicado (`Model/Client/ErpClient`) com `Magento\Framework\HTTP\Client\Curl` ou Guzzle (se o projeto já usa).
- URL, usuário e chave em configuração (`system.xml`, com o campo de chave como `obscure` e `backend_model` `Magento\Config\Model\Config\Backend\Encrypted`), nunca no código.
- Timeout explícito, log do request e da resposta sem dados sensíveis (`Psr\Log\LoggerInterface` com handler próprio) e tratamento de erro que não derruba o checkout.

## Síncrono ou assíncrono

- **Chamada no request do cliente** só se a resposta for necessária naquele momento (ex.: cotação de frete). Mesmo assim, com timeout curto e cache.
- **Envio de pedidos, estoque, preços, cadastros**: assíncrono, por fila (veja a skill de cron e filas) ou por cron com controle de reprocessamento.
- **APIs assíncronas e bulk** (`/async/V1/...`, `/async/bulk/V1/...`) para cargas grandes vindas de fora, processadas por consumers.

## No card

Para cada integração, registre: direção, gatilho, frequência, formato, autenticação (sem segredos), idempotência (o que acontece se rodar duas vezes) e o comportamento em falha (retry, fila de erro, alerta).
