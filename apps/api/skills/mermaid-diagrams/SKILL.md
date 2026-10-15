---
name: mermaid-diagrams
description: Use ao gerar código Mermaid (flowchart, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, C4) para que o diagrama renderize sem erro de sintaxe e fique legível.
---

# Mermaid que renderiza na primeira vez

## Regras gerais

- A primeira linha é o tipo exato pedido: `flowchart LR`, `sequenceDiagram`, `classDiagram`, `stateDiagram-v2`, `erDiagram`, `C4Context`, `C4Container` ou `C4Component`.
- IDs sem espaço, acento ou hífen, como `checkoutSvc` e `erpPedidos`. O texto visível vai no rótulo.
- Rótulo com caractere especial (parênteses, dois-pontos, barra, acento, `#`, `;`) vai entre aspas: `a["Carrinho (SFRA)"]`.
- Sem HTML, sem `click`, sem links e sem `%%{init}`.
- Uma instrução por linha, sem comentário no fim da linha.

## flowchart

```
flowchart LR
  cliente["Cliente"] -->|"adiciona item"| carrinho["Carrinho"]
  carrinho --> calc{"Subtotal >= 299?"}
  calc -->|"sim"| gratis["Frete R$ 0"]
  calc -->|"não"| normal["Frete padrão"]
  subgraph loja["Storefront"]
    carrinho
  end
```

- O rótulo da seta vai entre `|"..."|`. Losango `{"..."}` marca decisão.
- Use `subgraph id["Título"] ... end`. O id do subgraph não pode repetir o de um nó.

## sequenceDiagram

```
sequenceDiagram
  participant B as Navegador
  participant S as Storefront
  participant E as ERP
  B->>S: POST /checkout
  S->>E: cria pedido (REST)
  E-->>S: 201 número do pedido
  alt erro no ERP
    S-->>B: mensagem de falha
  end
```

- Setas: `->>` para chamada, `-->>` para resposta e `-)` para assíncrono.
- Blocos: `alt/else/end`, `opt/end` e `loop/end`.
- Na mensagem, não use `;` e não use `:` além do separador.

## Outros tipos

- **classDiagram:** `class Pedido { +String numero +total() Decimal }`, com relações como `Pedido "1" --> "*" Item`.
- **erDiagram:** entidades em MAIÚSCULAS e sem espaço (`PEDIDO ||--o{ ITEM : contem`). Atributos assim: `string numero PK`.
- **stateDiagram-v2:** `[*] --> Novo` e `Novo --> Pago : pagamento aprovado`.

## Antes de devolver

Releia procurando:
- aspas não fechadas;
- ID com hífen ou acento;
- `end` faltando em `subgraph`, `alt` ou `loop`;
- seta com sintaxe de outro tipo de diagrama.
