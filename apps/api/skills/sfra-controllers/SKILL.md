---
name: sfra-controllers
description: Use ao criar, estender ou analisar controllers SFRA (Salesforce B2C Commerce) - server.get/post, server.extend(module.superModule), append, prepend, replace, middleware (https, csrf, cache, login), viewData, res.render, res.json e eventos de rota.
---

# Controllers SFRA

## Rota

O arquivo `cartridge/controllers/Cart.js` com `server.get('Show', ...)` atende `Cart-Show`. Para montar URLs, use `URLUtils.url('Cart-Show')` (ou `URLUtils.https`).

## Estender a rota de outro cartucho (o padrão)

```js
'use strict';

var server = require('server');
server.extend(module.superModule);

var cache = require('*/cartridge/scripts/middleware/cache');

server.append('Show', function (req, res, next) {
    var viewData = res.getViewData();
    viewData.freteGratis = require('*/cartridge/scripts/helpers/freteGratisHelper').status(req.currentCustomer);
    res.setViewData(viewData);
    next();
});

module.exports = server.exports();
```

- **`append`** roda depois do middleware original, e o `viewData` já tem o que a rota base montou. É o caso mais comum: adicionar dado, log ou analytics.
- **`prepend`** roda antes. Use para validar ou bloquear a requisição.
- **`replace`** troca a rota inteira: você assume o código e deixa de receber correções da base. Só quando a lógica base não serve, e diga isso no card.
- O arquivo precisa ter o mesmo nome e caminho do controller que estende, num cartucho à esquerda no cartridge path.
- Sempre `module.exports = server.exports();` no fim.

## Rota nova

```js
server.post('SalvarPreferencia', server.middleware.https, csrfProtection.validateAjaxRequest, function (req, res, next) {
    var form = req.form;
    // valide, faça a escrita dentro de Transaction.wrap
    res.json({ success: true });
    next();
});
```

## Middleware

| Middleware | Para quê |
|---|---|
| `server.middleware.https` | Exigir HTTPS (formulários, conta, checkout) |
| `server.middleware.include` | Rota usada só como remote include |
| `csrfProtection.generateToken` / `validateRequest` / `validateAjaxRequest` | CSRF em formulários (`*/cartridge/scripts/middleware/csrf`) |
| `userLoggedIn.validateLoggedIn` / `validateLoggedInAjax` | Exigir login (`*/cartridge/scripts/middleware/userLoggedIn`) |
| `cache.applyDefaultCache`, `applyPromotionSensitiveCache`, `applyInventorySensitiveCache` | Cache da resposta (`*/cartridge/scripts/middleware/cache`) |
| `consentTracking.consent` | Consentimento de rastreamento |

## Resposta

- `res.render('cart/cart', modelo)` para template ISML (o caminho fica sob `templates/default`).
- `res.json({...})` para AJAX.
- `res.redirect(URLUtils.url('Home-Show'))` para redirecionar.
- `res.setStatusCode(404)` para mudar o status.
- Sempre chame `next()`. Esquecer o `next()` corta os appends seguintes.

## Escrita depois da renderização

Para escrever após o render, use `this.on('route:BeforeComplete', function (req, res) { Transaction.wrap(function () { ... }); });`. É o padrão do SFRA em perfil e endereço, e garante que a escrita aconteça no fim da cadeia, uma vez.

## Cuidados

- Rota cacheada não pode depender do cliente (carrinho, login). A parte personalizada vai em remote include sem cache.
- Não faça chamadas a serviços externos em rota cacheada de catálogo.
