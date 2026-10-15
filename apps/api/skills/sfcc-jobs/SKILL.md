---
name: sfcc-jobs
description: Use ao criar ou analisar jobs no Salesforce B2C Commerce - job steps customizados em steptypes.json (script-module-step e chunk-script-module-step), parâmetros, status, agendamento em jobs.xml/Business Manager, e processamento em lote dentro das quotas.
---

# Jobs no SFCC

## Declarar o step

O arquivo é `steptypes.json` na raiz do cartucho (ao lado de `package.json`). Há dois tipos de step:

```json
{
  "step-types": {
    "script-module-step": [
      {
        "@type-id": "custom.Projeto.EnviaPedidos",
        "module": "app_projeto/cartridge/scripts/jobs/enviaPedidos.js",
        "function": "execute",
        "transactional": "false",
        "parameters": {
          "parameter": [
            { "@name": "DiasAtras", "@type": "long", "@required": "false", "default-value": "1" }
          ]
        },
        "status-codes": {
          "status": [
            { "@code": "ERROR", "description": "Falhou" },
            { "@code": "OK", "description": "Concluído" }
          ]
        }
      }
    ],
    "chunk-script-module-step": [
      {
        "@type-id": "custom.Projeto.AtualizaEstoque",
        "module": "app_projeto/cartridge/scripts/jobs/atualizaEstoque.js",
        "before-step-function": "beforeStep",
        "total-count-function": "getTotalCount",
        "read-function": "read",
        "process-function": "process",
        "write-function": "write",
        "after-step-function": "afterStep",
        "chunk-size": 100,
        "transactional": "true"
      }
    ]
  }
}
```

## Qual tipo

- **script-module-step** (tarefa): uma função `execute(parameters, stepExecution)` que devolve `new Status(Status.OK)` ou `Status.ERROR`. Para tarefas curtas ou chamadas únicas.
- **chunk-script-module-step**: para volumes grandes (pedidos, produtos). `read` devolve um item por vez (ou `undefined` para terminar), `process` transforma, e `write` recebe a lista do chunk. Com `transactional: true`, cada chunk é uma transação.

## Agendamento

O job é criado em Administration → Operations → Jobs: um ou mais steps, o escopo (site ou organização) e o agendamento. Também pode ir versionado em `jobs.xml` no site import. Diga no card qual job criar, em qual escopo, os parâmetros e a frequência.

## Boas práticas

- **Idempotente**: rodar duas vezes não duplica efeito. Marque o que já foi processado, com atributo ou status.
- Iteradores (`OrderMgr.searchOrders`, `ProductMgr.queryAllSiteProducts`) em vez de carregar listas inteiras. Feche os `SeekableIterator` (`close()`).
- Respeite os limites de tempo e as quotas. Divida em chunks e não guarde coleções grandes em memória.
- Log com `Logger.getLogger('jobs', 'enviaPedidos')` e um resumo no fim (processados, falhas).
- Integrações chamadas pelo job usam o service framework (veja a skill de serviços).
