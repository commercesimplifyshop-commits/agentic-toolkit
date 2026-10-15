---
name: code-investigation
description: Use antes de responder qualquer pergunta sobre o código deste projeto, explicar um fluxo, estimar o impacto de uma mudança ou citar arquivos. Método para investigar com Read, Grep e Glob, seguir a cadeia de chamadas e citar caminho:linha sem inventar.
---

# Investigar o código antes de afirmar

Você responde sobre um projeto real. Toda afirmação sobre o código precisa vir de um arquivo que você leu nesta sessão.

## Método

1. **Ache a porta de entrada.** Rota, controller, comando, cron/job, observer/hook, endpoint de API ou template que dispara o comportamento. Use Grep pelo texto visível na tela, pelo nome da rota ou da configuração.
2. **Siga a cadeia.** De quem chama para quem é chamado: controller → service/helper/model → persistência ou integração. Em cada salto, abra o arquivo e confirme a assinatura.
3. **Procure quem altera o comportamento sem aparecer na chamada.** Plugins, preferences e observers (Adobe); `server.append/prepend/replace`, `module.superModule` e hooks (SFCC). Eles costumam explicar o "por que não funciona como o código base diz".
4. **Confira a configuração.** XML de DI, rotas, cron, `hooks.json`, `package.json` do cartucho, metadata, site preferences: o código sozinho não conta a história toda.
5. **Delimite o que o código não responde.** Valores configurados no admin ou no Business Manager, dados de produção, comportamento de serviços externos. Diga isso explicitamente.

## Ao responder

- Cite arquivos como `caminho/do/arquivo.ext:linha`, relativo à raiz do projeto.
- Separe **o que o código faz hoje** de **o que você sugere**.
- Se há duas implementações possíveis (ex.: cartucho base e cartucho do projeto, ou duas preferences), diga qual vence e por quê (ordem do cartridge path, `sequence` do módulo, `sortOrder` do plugin).
- Não invente classes, métodos, rotas ou integrações. Se não achou, diga "não encontrei" e onde procurou.
- Nunca abra nem cite arquivos de credenciais (`app/etc/env.php`, `auth.json`, `.env`, `dw.json`, chaves).

## Buscas úteis

- Adobe Commerce
  - Rotas: `<route id="...">` em `etc/frontend/routes.xml` e `etc/adminhtml/routes.xml`.
  - Plugins de uma classe: o nome da classe alvo dentro de `<type name="...">` nos `di.xml`.
  - Observers: `<event name="...">` em `etc/events.xml` (e `etc/frontend/events.xml`, `etc/adminhtml/events.xml`).
  - APIs: `etc/webapi.xml` e `etc/schema.graphqls`.
- Salesforce B2C
  - Rotas: `server.get('Nome'`, `server.post(`, `server.append(` em `cartridges/*/cartridge/controllers`.
  - Hooks: o nome do hook (`dw.order.calculate`, `app.payment.processor.*`) nos `hooks.json`.
  - Serviços: `LocalServiceRegistry.createService('` nos scripts.
  - Ordem dos cartuchos: `<custom-cartridges>` em `sites/<site>/site.xml`.
