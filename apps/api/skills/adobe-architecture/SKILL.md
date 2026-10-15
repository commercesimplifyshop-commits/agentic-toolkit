---
name: adobe-architecture
description: Use ao desenhar, documentar ou explicar a arquitetura de uma loja Adobe Commerce / Magento 2 - containers (web, admin, banco, Redis, OpenSearch, RabbitMQ, Varnish, CDN), áreas, fluxo do request, cache e integrações típicas com ERP, OMS, PIM, pagamento e frete.
---

# Arquitetura de uma loja Adobe Commerce

## Containers típicos

| Container | Tecnologia comum | Papel |
|---|---|---|
| Storefront e admin | PHP-FPM + Nginx, Magento 2.4.x | Mesma aplicação em áreas diferentes (`frontend`, `adminhtml`, `webapi_rest`, `graphql`, `crontab`) |
| Banco | MySQL/MariaDB | Catálogo (EAV), pedidos, clientes, configuração |
| Cache e sessão | Redis | Cache de configuração/layout/blocos e sessão |
| Cache de página | Varnish (ou Fastly no Adobe Commerce Cloud) | Full page cache, purge por tags |
| Busca | OpenSearch/Elasticsearch | Catálogo, busca e navegação por filtros |
| Filas | RabbitMQ (ou fila em banco) | Consumers assíncronos |
| Cron | `bin/magento cron:run` | Indexers, e-mails, consumers, jobs do projeto |
| CDN e mídia | CDN / S3 | Imagens e estáticos |

Confirme no projeto o que existe de fato: `composer.json`, `app/etc/config.php` (módulos ativos) e módulos de integração em `app/code`. Infraestrutura que o código não mostra deve entrar no diagrama marcada como suposição.

## Fluxo de um request da loja

Navegador → CDN/Varnish (hit retorna direto) → Nginx → PHP-FPM → front controller → roteador → controller → layout + blocks/ViewModels → resposta cacheável. Dados por cliente chegam depois, por customer-data sections (AJAX).

## Integrações típicas

| Sistema | Direção e forma comuns |
|---|---|
| ERP | Pedidos para o ERP (fila/cron); estoque, preço e notas do ERP para a loja (API REST/bulk ou cron de importação) |
| OMS / WMS | Pedidos e status em ambos os sentidos, por fila ou webhooks |
| PIM | Catálogo e atributos para a loja (importação em lote) |
| Pagamento | Extensão do gateway; síncrono na autorização, webhooks para status |
| Frete | Cotação síncrona no checkout (com timeout e cache) e rastreio |
| Marketing/CRM | Eventos e clientes, assíncrono |

Para cada integração encontrada no código, descubra o módulo, o gatilho (observer, cron, consumer, API exposta) e o protocolo.

## Ao desenhar

- **C1:** clientes, operadores do admin, a loja e os sistemas externos encontrados.
- **C2:** os containers acima que o projeto usa, com as filas e crons relevantes.
- **C3:** os módulos próprios (`app/code/<Vendor>`) de uma área, e como se ligam aos módulos nativos (plugins, observers, preferences).
