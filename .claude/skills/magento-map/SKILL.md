---
name: magento-map
description: Analisa as customizações de uma instalação Magento 2 já conectada ao Agentic Toolkit (plugins, preferences, observers, APIs, rotas, crons, filas), explicando cada uma, corrigindo a etapa do fluxo e apontando riscos. Use quando o usuário pedir para analisar, anotar ou aprofundar o mapa de uma instalação, ou rodar /magento-map.
---

# Analisar uma instalação no Agentic Toolkit

**Regra crítica: somente leitura.** Nunca edite, mova ou apague nada dentro da instalação Magento. Tudo o que você grava vai para o diretório de dados do Agentic Toolkit (`~/.agentic-toolkit`, ou `AGENTIC_TOOLKIT_DATA`).

Argumentos: `[workspace-id] [zona]`. Sem id, liste as instalações com `curl -s http://127.0.0.1:4310/api/workspaces` (ou leia `~/.agentic-toolkit/workspaces.json`) e pergunte qual.

## 1. Garantir que o mapa existe

A instalação precisa estar conectada e analisada no app (tela "Conectar"). Se o status não for `analyzed`, rode a análise:

```bash
curl -s -X POST http://127.0.0.1:4310/api/workspaces/<id>/analysis
```

Arquivos (dentro do diretório de dados):
- `workspaces/<id>/maps/<id>.json`: saída do extrator. Não edite à mão; é regenerado a cada análise.
- `workspaces/<id>/maps/<id>.annotations.json`: as suas anotações. São preservadas entre análises.

## 2. Ler o código em lotes

Na raiz do repositório do Agentic Toolkit:

```bash
node packages/analyzer/context.mjs <id> --maps-dir ~/.agentic-toolkit/workspaces/<id>/maps --zone <zona> --unannotated --max-lines 22 > <scratchpad>/ctx.md
```

Comece por `outros`, depois `checkout`, `carrinho`, `admin`, `integracoes` e por fim o resto. Leia o arquivo gerado (em partes, se for grande).

## 3. Anotar

Formato de cada item:

```json
{ "<id exato do item>": { "zone": "<zona>", "summary": "1–2 frases", "risk": { "level": "alto|medio|baixo", "note": "evidência" } } }
```

Zonas válidas: `entrada`, `catalogo`, `produto`, `carrinho`, `checkout`, `admin`, `armazem`, `expedicao`, `integracoes`, `outros`.

- **zone**: a etapa em que o código executa, não o nome do módulo. Ex.: e-mail de fatura vai para `admin`; observer de `customer_login` vai para `entrada`; cron que consulta o status do pagamento vai para `admin`.
- **summary**: em pt-BR, citando o método ou evento interceptado e o efeito de negócio.
- **risk** só com evidência no código. Procure principalmente:
  - REST `anonymous` (ou `self` carregando entidade por id sem checar o dono) que grava dados, altera preço/total ou expõe dados pessoais;
  - controller de frontend que grava sem sessão ou form key;
  - valor vindo do cliente somado a totais;
  - dados pessoais ou credenciais em log;
  - confiança em cookie para identificar admin/vendedor;
  - preference que substitui um controller ou model inteiro do core.

  Siga a cadeia antes de marcar `alto`.

Grave mesclando, pela API (preferível) ou direto no arquivo de anotações:

```bash
curl -s -X PUT http://127.0.0.1:4310/api/workspaces/<id>/annotations -H "Content-Type: application/json" --data-binary @<scratchpad>/notes.json
```

O corpo é `{ "zones": { "<zona>": "visão geral" }, "items": { ... }, "scope": "o que esta passada cobriu" }`. Itens novos entram e os existentes são atualizados; nada é apagado.

## 4. Validar e entregar

- Confira que todo id anotado existe em `<id>.json`.
- Recarregue o dashboard: o resumo aparece em cada item, as zonas corrigidas se refletem na visão geral e os riscos ficam em "Pontos de atenção".
- Resuma para o usuário: cobertura (anotados / customizados), reclassificações e os riscos `alto` com `arquivo:linha`. Deixe claro que são achados de leitura de código, a confirmar em dev.
- Nunca faça commit de nada do diretório de dados: é código e dado do cliente.
