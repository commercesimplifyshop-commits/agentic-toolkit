---
name: sfcc-cartridges-modules
description: Use ao organizar código em cartuchos Salesforce B2C (SFRA) - cartridge path e ordem, criar cartucho novo, module.superModule, require com * e ~, estender models, helpers e scripts sem copiar a base, e onde cada tipo de arquivo vive.
---

# Cartuchos e módulos no SFRA

## Cartridge path

A ordem dos cartuchos fica nas configurações do site, em Business Manager → Administration → Sites → Manage Sites → <site> → Settings. Quando o projeto versiona o site import, ela também aparece em `<custom-cartridges>` no `site.xml`.

- Um arquivo com o mesmo caminho relativo em dois cartuchos: **vence o mais à esquerda**.
- Ordem típica: `app_projeto:int_terceiro:plugin_x:app_storefront_base`.
- Cartucho novo só roda depois de entrar no path. Isso é um passo no Business Manager e precisa estar no card.

## Estrutura de um cartucho

```
cartridges/app_projeto/
  package.json                 { "hooks": "./cartridge/scripts/hooks.json" }  (se tiver hooks)
  cartridge/
    app_projeto.properties     (gerado ao criar o cartucho)
    controllers/               Rotas SFRA
    models/                    View models (ex.: cart.js, product/*)
    scripts/                   Helpers, hooks, jobs, serviços
    templates/default/         ISML
    templates/resources/       .properties de tradução
    client/default/js|scss     Fonte do front (compilado para static/)
    static/default/            Gerado pelo build; não edite à mão
    forms/default/             Definições de formulário XML
```

## Resolver módulos

| Forma | Resolve para |
|---|---|
| `require('*/cartridge/scripts/helpers/cartHelpers')` | Primeiro cartucho do path que tem o arquivo. Use para tudo que pode ser sobrescrito |
| `require('~/cartridge/scripts/x')` | O cartucho atual |
| `require('app_storefront_base/cartridge/scripts/x')` | Um cartucho específico (evite; amarra a implementação) |
| `require('dw/order/BasketMgr')` | Script API da plataforma |
| `module.superModule` | O mesmo arquivo no próximo cartucho do path (ou `null`) |

## Estender sem copiar

Model:

```js
'use strict';
var base = module.superModule;

function CartModel(basket) {
    base.call(this, basket);
    this.freteGratis = require('*/cartridge/scripts/helpers/freteGratisHelper').status(basket);
}

module.exports = CartModel;
```

Helper ou script que exporta um objeto:

```js
'use strict';
var base = module.superModule;

function novaFuncao() { /* ... */ }

module.exports = Object.assign({}, base, { novaFuncao: novaFuncao });
```

Models de produto do SFRA são montados por decorators (`*/cartridge/models/product/decorators/*`). Estenda o decorator ou o factory, não o model inteiro.

## Boas práticas

- Lógica em helpers (`scripts/helpers/`), testáveis. Controllers finos.
- Nunca altere `app_storefront_base` nem cartuchos de terceiros (`int_*`, `plugin_*`, `link_*`, `bm_*`).
- Um cartucho do projeto (ou poucos, por domínio). Não crie um cartucho por tarefa.
