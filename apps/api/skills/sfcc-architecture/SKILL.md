---
name: sfcc-architecture
description: Use ao desenhar, documentar ou explicar a arquitetura de uma loja Salesforce B2C Commerce - instâncias e realm, storefront SFRA ou PWA Kit headless, Business Manager, OCAPI/SCAPI, eCDN, jobs e WebDAV, e integrações típicas com ERP, OMS, PIM, pagamento e frete.
---

# Arquitetura de uma loja Salesforce B2C Commerce

## Containers típicos

| Container | Papel |
|---|---|
| Storefront SFRA | Renderização no servidor (controllers + ISML) dentro da instância B2C. É o que este projeto tem quando há `app_storefront_base` |
| Storefront headless (PWA Kit / Composable Storefront) | React no Managed Runtime, consumindo SCAPI (Shopper APIs) |
| Business Manager | Administração: catálogo, preços, promoções, conteúdo, configuração, jobs |
| SCAPI / OCAPI | APIs da plataforma (shopper e admin), estendidas por hooks |
| Jobs + WebDAV (IMPEX) | Importação e exportação em lote (catálogo, estoque, preços, pedidos) |
| eCDN | CDN e WAF da plataforma na frente do storefront |
| Einstein | Recomendações e busca preditiva (se ativo) |
| Order Management | Salesforce OM ou um OMS externo |

É SaaS: banco, servidores e escala são da Salesforce. O projeto controla os cartuchos, o metadata, a configuração e as integrações.

## Instâncias

Realm com sandboxes e o grupo principal: development → staging → production. Dados e código chegam a production por **replicação** a partir de staging.

## Fluxo de um request (SFRA)

Navegador → eCDN → instância (page cache) → controller (cadeia de middleware de todos os cartuchos do path) → models/helpers → `dw.*` (Basket, Product, Order) → ISML → resposta. Partes personalizadas chegam por remote includes.

## Integrações típicas

| Sistema | Direção e forma comuns |
|---|---|
| ERP | Pedidos exportados por job (XML/API); estoque e preço importados por arquivo no WebDAV + job |
| OMS | Pedidos por job ou API; status de volta por API/hook |
| PIM | Catálogo em XML de importação (catalog.xsd) via WebDAV + job |
| Pagamento | Cartucho do gateway (`int_*`/`link_*`) com `app.payment.processor.*`; notificações por controller |
| Frete | Serviço síncrono no checkout, com timeout e fallback |
| Marketing/CRM | Marketing Cloud ou outro, por job ou eventos |

Para cada integração encontrada no código, identifique o cartucho, o serviço (`LocalServiceRegistry`), o gatilho (controller, hook, job) e o protocolo.

## Ao desenhar

- **C1:** cliente, operadores do Business Manager, a loja e os sistemas externos.
- **C2:** storefront, Business Manager, APIs, jobs/WebDAV, eCDN e os sistemas externos com as setas de integração.
- **C3:** os cartuchos do projeto na ordem do cartridge path, mostrando o que cada um estende da base e quais serviços e jobs ele tem.
