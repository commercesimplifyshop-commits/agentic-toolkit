---
name: sfcc-isml-frontend
description: Use ao mudar a vitrine SFRA (Salesforce B2C) - templates ISML (isdecorate, isinclude, remote include, isif, isloop, isset, isprint e encoding), textos em .properties com Resource.msg, JS e SCSS do cliente compilados pelo sgmf-scripts, override de templates e content assets/slots.
---

# Frontend SFRA: ISML, textos e assets

## Templates

- Os templates ficam em `cartridge/templates/default/<pasta>/<nome>.isml`, e o controller chama `res.render('<pasta>/<nome>', modelo)`. No template, o modelo é `pdict`.
- **Override**: um arquivo com o mesmo caminho num cartucho à esquerda substitui o da base inteiro. Prefira criar um template novo pequeno e incluí-lo, e copie só templates curtos.

```html
<isdecorate template="common/layout/page">
    <isinclude template="cart/freteGratisMensagem" />
</isdecorate>
```

| Tag | Uso |
|---|---|
| `<isif condition="${...}">` / `<iselseif>` / `<iselse>` | Condicional |
| `<isloop items="${pdict.items}" var="item" status="loopState">` | Laço |
| `<isset name="x" value="${...}" scope="page" />` | Variável |
| `<isinclude template="..." />` | Inclui outro template (mesmo request, mesmo cache) |
| `<isinclude url="${URLUtils.url('Rota-Parte')}" />` | **Remote include**: request separado, com cache próprio. Use para partes personalizadas (minicart, saudação) |
| `<isprint value="${...}" encoding="htmlcontent" />` | Saída com encoding explícito |
| `<isscript>` | Evite. Lógica vai no controller, model ou helper |

## Segurança

`${...}` é HTML-encoded por padrão. Nunca use `encoding="off"` com dado vindo do cliente ou de atributo editável. Para atributos HTML e JS, use o encoding próprio (`htmldoublequote`, `jshtml`).

## Textos

`cartridge/templates/resources/cart.properties` (padrão) e `cart_pt_BR.properties`, com chave `msg.frete.faltam=Faltam {0} para ganhar frete grátis`.

- No ISML: `${Resource.msg('msg.frete.faltam', 'cart', null)}`. Com parâmetro: `${Resource.msgf('msg.frete.faltam', 'cart', null, valorFormatado)}`.
- Nunca deixe texto fixo no template. Mantenha a codificação dos `.properties` que o projeto já usa (UTF-8 ou escapes `á`).

## JS e SCSS do cliente

- A fonte fica em `cartridge/client/default/js/` e `scss/`. Arquivos no primeiro nível de `js/` são entradas do webpack, compiladas por `npm run compile:js` / `compile:scss` (sgmf-scripts) para `cartridge/static/default/`.
- Para estender o JS da base: `var base = require('base/cart/cart');` (o alias `base` vem de `paths.base` no `package.json`). No SCSS: `@import "~base/..."`.
- Para incluir no template: `assets.addJs('/js/meuArquivo.js')` e `assets.addCss('/css/meu.css')`, dentro de `<isscript>` no topo do template (padrão do SFRA).
- O static compilado precisa ir junto no upload. Compilar antes de enviar faz parte do plano.

## Conteúdo editável

Texto ou banner que o negócio quer mudar sem deploy: content asset (`<iscontentasset aid="..."/>`), content slot ou Page Designer, em vez de texto no código.
