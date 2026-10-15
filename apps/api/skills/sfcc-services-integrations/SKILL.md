---
name: sfcc-services-integrations
description: Use ao integrar o Salesforce B2C com sistemas externos (ERP, OMS, PIM, gateway, frete, antifraude) - LocalServiceRegistry e o service framework (service, profile, credential), timeouts e circuit breaker, mocks, logs, e quando usar job, webhook ou chamada síncrona.
---

# Serviços e integrações no SFCC

## Definição

Serviço, profile e credential são configurados em Administration → Operations → Services, ou versionados em `services.xml` sem a senha:

- **credential**: URL e usuário. A senha é cadastrada no Business Manager.
- **profile**: timeout, rate limit e circuit breaker.
- **service**: tipo (HTTP, HTTPForm, SOAP, FTP/SFTP), credential, profile, log e mock.

## Código

```js
'use strict';

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Logger = require('dw/system/Logger').getLogger('erp', 'pedidos');

var service = LocalServiceRegistry.createService('erp.http.pedidos', {
    createRequest: function (svc, pedido) {
        svc.setRequestMethod('POST');
        svc.addHeader('Content-Type', 'application/json');
        return JSON.stringify(pedido);
    },
    parseResponse: function (svc, client) {
        return JSON.parse(client.text);
    },
    mockCall: function () {
        return { statusCode: 201, statusMessage: 'Created', text: '{"numero":"MOCK-1"}' };
    },
    filterLogMessage: function (msg) {
        return msg.replace(/"cpf":"[^"]*"/g, '"cpf":"***"');
    }
});

function enviar(pedido) {
    var result = service.call(pedido);
    if (!result.ok) {
        Logger.error('Falha ao enviar pedido {0}: {1} {2}', pedido.numero, result.status, result.errorMessage);
        return null;
    }
    return result.object;
}

module.exports = { enviar: enviar };
```

- `result.ok`, `result.object` (o que o `parseResponse` devolveu), `result.status` (`OK`, `ERROR`, `SERVICE_UNAVAILABLE`), `result.errorMessage`.
- `SERVICE_UNAVAILABLE` significa circuit breaker aberto ou rate limit atingido: trate sem derrubar a página.
- Use `filterLogMessage` para mascarar dados pessoais quando o log de comunicação estiver ligado.
- Crie o serviço dentro da função ou num helper (não no topo de um módulo usado em muitos requests, se o projeto evita isso).

## Síncrono, job ou webhook

| Caso | Forma |
|---|---|
| Resposta necessária na hora (cotação de frete, autorização de pagamento, CEP) | Chamada síncrona, timeout curto (1 a 3 s no profile), fallback |
| Envio de pedidos, clientes, exportações | **Job** agendado, lendo pedidos por status/atributo, com reprocessamento |
| Estoque, preço, catálogo vindos de fora | Arquivos de import (catalog, inventory, pricebook) via WebDAV + job de importação, ou job que chama a API de origem |
| Sistema externo avisando mudança | Endpoint (controller ou hook SCAPI) leve que só registra e deixa o processamento para um job |

## No card

Serviço (id), credential e profile a criar; direção; gatilho; formato; idempotência; o que acontece em falha (retry, marcação no pedido, alerta); e os passos no Business Manager.
