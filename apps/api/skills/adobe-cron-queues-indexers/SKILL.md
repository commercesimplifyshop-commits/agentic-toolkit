---
name: adobe-cron-queues-indexers
description: Use ao criar ou analisar processamento em segundo plano no Adobe Commerce / Magento 2 - cron (crontab.xml e grupos), message queues (communication.xml, queue_topology, queue_publisher, queue_consumer), consumers, indexers e mview, e cargas em lote.
---

# Cron, filas e indexers no Adobe Commerce

## Cron

```xml
<!-- etc/crontab.xml -->
<config xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="urn:magento:module:Magento_Cron:etc/crontab.xsd">
    <group id="default">
        <job name="vendor_modulo_sincroniza_estoque" instance="Vendor\Modulo\Cron\SincronizaEstoque" method="execute">
            <schedule>*/15 * * * *</schedule>
        </job>
    </group>
</config>
```

- Para agenda configurável no admin, use `<config_path>caminho/da/config</config_path>` no lugar de `<schedule>`.
- Um grupo próprio (`etc/cron_groups.xml`) separa jobs longos para eles não atrasarem os nativos.
- O job precisa ser **idempotente** e processar em lotes, com limite de tempo e de memória. Nada de carregar tudo numa collection.
- Use lock (`Magento\Framework\Lock\LockManagerInterface`) para não rodar duas instâncias ao mesmo tempo.

## Filas (message queue)

Arquivos do módulo:
- `etc/communication.xml`: tópico e tipo da mensagem.
- `etc/queue_publisher.xml`: para onde o tópico publica (`amqp` ou `db`).
- `etc/queue_topology.xml`: exchange e bindings.
- `etc/queue_consumer.xml`: consumer, fila e handler.

Publique com `Magento\Framework\MessageQueue\PublisherInterface::publish('topico', $dados)`. O consumer roda por `bin/magento queue:consumers:start nome` ou pelo cron (`consumers_runner`). Trate falhas: rejeite com retry ou registre e siga, nunca entre em loop infinito. Use filas para o que não precisa acontecer durante o request: envio ao ERP, e-mail, exportação.

## Indexers

- Indexer próprio: `etc/indexer.xml` + `etc/mview.xml` (tabelas observadas) + classe implementando `ActionInterface` e `MviewActionInterface`.
- Mudança em preço, estoque, categoria ou atributo filtrável pode exigir reindex. Diga qual (`catalog_product_price`, `cataloginventory_stock`, `catalogsearch_fulltext`...).
- Em produção, os indexers ficam em "Update by Schedule": a mudança aparece quando o cron do indexer rodar.

## No card

Frequência, volume por execução, tempo esperado, o que acontece em falha e em reexecução, e como acompanhar (log, tabela de controle, `cron_schedule`, `queue_message_status`).
