---
name: openspec-authoring
description: Use ao escrever ou revisar arquivos OpenSpec (proposal.md, design.md, tasks.md e deltas de specs com requisitos e cenários), ao propor uma mudança OpenSpec a partir de uma conversa ou ao explorar specs existentes.
---

# Escrever OpenSpec bem

OpenSpec separa **specs** de **mudanças**. As specs ficam em `openspec/specs/<capacidade>/spec.md` e descrevem o comportamento atual do sistema. As mudanças ficam em `openspec/changes/<nome>/` e trazem a proposta, o desenho, as tarefas e os deltas de spec.

## Nome da mudança

kebab-case curto, verbo + objeto: `exibir-frete-na-pdp`, `integrar-erp-pedidos`. Nada de datas ou números de ticket.

## proposal.md

```
# Proposal
## Why
Problema e objetivo de negócio, em 2 a 5 frases.
## What Changes
- O que muda, descrito como comportamento.
## Capabilities
### New Capabilities
- `catalogo/frete-pdp`: o que cobre
### Modified Capabilities
- `checkout/totais`: o que muda
## Impact
Código, configuração, APIs, dados e equipes afetados, com caminhos reais.
```

## design.md

Só quando houver decisão técnica a registrar. Seções: `## Context`, `## Goals / Non-Goals`, `## Decisions` (cada decisão com a alternativa descartada e o motivo) e `## Risks / Trade-offs`.

## Delta de spec

O delta fica em `specs/<capacidade>/spec.md`, dentro da pasta da mudança.

- **Capacidade nova:** `## Purpose` (uma frase com 50+ caracteres) e `## ADDED Requirements`.
- **Capacidade existente:**
  - `## MODIFIED Requirements`, com o requisito **inteiro** reescrito, não só a parte que mudou.
  - `## REMOVED Requirements`, com o motivo.
  - `## RENAMED Requirements`, com FROM/TO.
- **Cada requisito:** `### Requirement: Nome curto`, uma frase normativa com **SHALL** ou **MUST** e pelo menos um cenário:

```
#### Scenario: Pedido acima do limite
- **WHEN** o subtotal do carrinho é R$ 300,00
- **THEN** o frete padrão custa R$ 0,00
- **AND** o carrinho mostra "Você ganhou frete grátis!"
```

- **Cenários** levam exatamente quatro `#`. O validador ignora outros níveis.
- **Capacidade** é comportamento do sistema ("checkout/frete-gratis"), não tarefa ("criar-plugin").

## tasks.md

Grupos `## 1. Nome` com subtarefas `- [ ] 1.1 Descrição`, pequenas e verificáveis, citando o arquivo ou a classe. Cubra preparação, implementação, configuração, testes e validação final (`openspec validate <nome> --strict`).

## Revisão antes de entregar

- Todo requisito tem cenário, e os cenários são verificáveis.
- O delta MODIFIED repete o requisito completo.
- Os caminhos citados existem no código.
