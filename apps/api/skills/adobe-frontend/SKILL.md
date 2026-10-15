---
name: adobe-frontend
description: Use ao mudar a vitrine do Adobe Commerce / Magento 2 - layout XML, blocks, ViewModels, templates .phtml com escape, temas, JavaScript (RequireJS, mixins, UI components, Knockout, customer-data/sections), LESS e static content. Também vale para identificar se o tema é Luma ou Hyvä.
---

# Frontend no Adobe Commerce

## Primeiro, descubra o tema

Procure o tema ativo em `app/design/frontend/<Vendor>/<tema>/theme.xml` (veja o `<parent>`) e nos pacotes `hyva-themes/*` do `composer.json`. **Hyvä** usa Alpine.js e Tailwind e não usa RequireJS, Knockout nem LESS. As técnicas abaixo (RequireJS, mixins, LESS) valem para Luma e temas derivados.

## Layout XML

- O handle é o nome do arquivo: `checkout_cart_index.xml`, `catalog_product_view.xml`, `default.xml` (todas as páginas).
- Para inserir conteúdo, use `<referenceContainer name="...">` + `<block class="Magento\Framework\View\Element\Template" name="vendor.modulo.bloco" template="Vendor_Modulo::caminho.phtml">`. Para mover: `<move element="..." destination="..." after="..."/>`. Para remover: `<referenceBlock name="..." remove="true"/>`.
- Lógica vai num **ViewModel** (`<arguments><argument name="view_model" xsi:type="object">Vendor\Modulo\ViewModel\X</argument></arguments>`), não num Block novo.
- Override de template de outro módulo: no tema (`app/design/frontend/<Vendor>/<tema>/Magento_Checkout/templates/...`) ou trocando o `template` do bloco via layout no seu módulo.

## Templates .phtml

Escape tudo que vem de dado: `$escaper->escapeHtml()`, `escapeHtmlAttr()`, `escapeUrl()`, `escapeJs()`. Textos com `__('...')`. Nada de lógica de negócio nem chamadas a repository dentro do template.

## Conteúdo por cliente (carrinho, login, preço por grupo)

Páginas são cacheadas (FPC/Varnish). Dados privados vão por **customer-data sections** (`etc/frontend/sections.xml` + `Magento_Customer/js/customer-data`) ou por AJAX. Nunca coloque `cacheable="false"` num bloco de página de catálogo: isso desliga o cache da página inteira.

## JavaScript (Luma)

- Módulos AMD em `view/frontend/web/js/`, declarados em `view/frontend/requirejs-config.js`.
- Para alterar JS nativo, use **mixins** (`config: { mixins: { 'Magento_Checkout/js/view/summary': { 'Vendor_Modulo/js/summary-mixin': true } } }`) em vez de copiar o arquivo.
- Inicialize por `data-mage-init` ou `<script type="text/x-magento-init">`.
- Checkout e minicart são UI components (Knockout): altere via layout `checkout_index_index.xml` (jsLayout) e mixins.

## CSS

LESS no tema (`web/css/source/_extend.less`) ou no módulo (`view/frontend/web/css/source/_module.less`).

## Para ver a mudança

Em desenvolvimento: `bin/magento cache:clean layout block_html full_page`. Em modo produção, também `bin/magento setup:static-content:deploy pt_BR`. Diga no card quais caches e deploys a mudança exige.
