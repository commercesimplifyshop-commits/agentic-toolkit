---
name: architecture-canvas
description: Use ao desenhar um diagrama no canvas do Agentic Toolkit (o JSON com family, nodes e edges que o editor de diagramas e a Arquitetura viva abrem), por exemplo um modelo C4 de contexto, contêineres ou componentes, ou um fluxograma. Define o formato exato, as regras que o editor exige e como deixar o desenho legível.
---

# Desenhar no canvas do Agentic Toolkit

O editor de diagramas e a tela **Arquitetura viva** abrem um grafo JSON. Se o JSON sair fora destas regras, o desenho é recusado ou fica quebrado.

## Formato

```json
{
  "family": "c4",
  "nodes": [
    { "id": "p_cliente", "type": "person", "title": "Cliente", "description": "Compra na loja" },
    { "id": "b_loja", "type": "boundary", "title": "Loja · Salesforce B2C Commerce" },
    { "id": "c_store", "type": "container", "title": "Storefront", "tech": "SFRA", "description": "Controllers e ISML", "parent": "b_loja" },
    { "id": "x_erp", "type": "external", "title": "ERP SAP", "tech": "REST/JSON", "description": "Recebe os pedidos" }
  ],
  "edges": [
    { "id": "e1", "source": "p_cliente", "target": "c_store", "label": "Navega e compra", "tech": "HTTPS" },
    { "id": "e2", "source": "c_store", "target": "x_erp", "label": "Envia pedidos", "tech": "HTTP POST, job", "dashed": true }
  ]
}
```

- **family**: `c4` para arquitetura e `flow` para processo.
- **Tipos c4**: `person`, `system`, `external`, `container`, `db`, `queue`, `boundary`.
- **Tipos flow**: `start`, `process`, `decision`, `end`, `database`, `external`.
- **id**: só letras, números, `_` e `-`, até 40 caracteres, únicos. Use prefixos legíveis (`p_`, `b_`, `c_`, `x_`, `d_`, `q_`).
- **parent**: só pode apontar para um nó `boundary`. Não aninhe uma boundary dentro de outra; use boundaries lado a lado.
- **x e y**: não envie. O app arranja o desenho em camadas.

## Regras que o editor exige

- **Nenhuma seta entra ou sai de uma `boundary`**, porque ela não tem ponto de conexão. Ligue ao elemento de dentro (por exemplo, ao primeiro cartucho do path ou ao módulo certo).
- Toda seta liga dois ids que existem.
- Até 300 elementos e 600 conexões. Para leitura, mire em 12 a 30 elementos.

## Para ficar legível

- **title**: o nome real (módulo, cartucho, serviço, sistema).
- **tech**: tecnologia ou protocolo.
- **description**: uma frase sobre o que faz.
- **Seta**: tem verbo no `label` e protocolo no `tech`. Use `dashed: true` para assíncrono (job, cron, fila, webhook) e linha cheia para síncrono.
- **Seta de volta**: só quando a iniciativa é do outro lado (um webhook que chega, por exemplo). Não desenhe "ida e volta" de uma chamada comum.
- **Agrupamento**: a loja numa boundary, os sistemas do cliente em outra, os SaaS e terceiros em outra.
- **Pessoas e sistemas externos** que não pertencem a um grupo ficam sem `parent`.
- Integração que existe no código mas não é chamada aparece com essa ressalva na `description` ("definido, sem chamada no código").

## Resposta

Quando o pedido for um desenho de canvas, responda **só** com um bloco ```json com o objeto. Nada antes nem depois.
