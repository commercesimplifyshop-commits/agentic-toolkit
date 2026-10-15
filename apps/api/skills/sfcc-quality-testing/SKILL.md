---
name: sfcc-quality-testing
description: Use ao verificar, testar ou revisar código Salesforce B2C (SFRA) - testes unitários mocha/chai/sinon com proxyquire e mocks de dw.*, lint (eslint/stylelint do sgmf-scripts), compilação do client, segurança (CSRF, encoding, credenciais) e performance e quotas.
---

# Qualidade no SFRA

## Verificar o que você mudou

Use os scripts que existem no `package.json` do projeto:

1. `npm run lint`: eslint e stylelint.
2. `npm test`: testes unitários em `test/unit` (mocha).
3. `npm run compile:js` / `npm run compile:scss`: só se mexeu em `cartridge/client`.

Se `node_modules` não estiver instalado, não instale: registre as verificações como pendentes. Para scripts sem `require('dw/...')` no topo, `node --check arquivo.js` pega erro de sintaxe.

## Teste unitário

As APIs `dw.*` não existem fora da instância. Os testes carregam o módulo com **proxyquire**, trocando cada `require` por um stub:

```js
var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru().noPreserveCache();

describe('freteGratisHelper', function () {
    var helper = proxyquire('../../../../cartridges/app_projeto/cartridge/scripts/helpers/freteGratisHelper', {
        'dw/campaign/PromotionMgr': {
            getDiscounts: function () {
                return { getApproachingShippingDiscounts: function () { return { toArray: function () { return []; } }; } };
            }
        },
        'dw/util/StringUtils': { formatMoney: function (m) { return 'R$ ' + m.value; } }
    });

    it('indica frete grátis atingido quando não há desconto pendente', function () {
        assert.isTrue(helper.status({ defaultShipment: {} }).achieved);
    });
});
```

- O caminho do arquivo de teste espelha o do cartucho em `test/unit/<cartucho>/...`. Reaproveite os mocks de `test/mocks` do projeto, se existirem.
- Um teste por critério de aceite: abaixo do limite, no limite, acima, carrinho vazio.

## Segurança

- POST de formulário com `csrfProtection.validateRequest` (ou `validateAjaxRequest`), e o template com `csrf.tokenName`/`csrf.token`.
- Nada de `encoding="off"` com dado do cliente no ISML.
- Rotas de conta com `userLoggedIn` e checagem de que o recurso pertence ao cliente.
- Nenhuma credencial no código ou no git (`dw.json`, chaves de API ficam fora; credenciais de serviço no Business Manager).

## Performance e quotas

- Nada de `ProductMgr.getProduct` ou `OrderMgr.getOrder` dentro de laços grandes no storefront. Use `ProductSearchModel` e iteradores.
- Rotas de catálogo com cache (`cache.applyDefaultCache` e semelhantes); a parte personalizada vai em remote include.
- Sessão e `custom` de sessão pequenos. Nada de guardar objetos grandes.
- Cache de dados caros com `CacheMgr` (`caches.json` no cartucho) quando fizer sentido.
- Quotas aparecem em Administration → Operations → Quota Status. Código que gera violação de quota precisa ser corrigido antes de produção.

## Revisão final

Releia o diff procurando `Logger.debug` esquecido, texto fixo no ISML, arquivo em `static/` editado à mão, alteração em `app_storefront_base` e `require` com caminho de cartucho fixo onde caberia `*/`.
