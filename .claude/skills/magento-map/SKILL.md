---
name: magento-map
description: Mapeia uma instalação Magento 2 (APIs REST/GraphQL, plugins, preferences, observers, rotas, crons, filas) no fluxo de compra do StoreFlow 3D, explicando cada customização e apontando riscos. Use quando o usuário pedir para mapear, analisar ou atualizar o mapa de um projeto Magento, ou rodar /magento-map.
---

# Mapear uma instalação Magento no StoreFlow 3D

Argumentos esperados: `<caminho-da-instalacao> [slug] [zona]`. Se faltar o caminho, pergunte. O slug padrão é o nome da pasta do projeto.

## 1. Extração determinística (sem Claude)

Rode a partir da raiz do `magento-flow-3d`:

```bash
node tools/extract.mjs <magento-root> --name <slug> --native reference/magento2-<versão> --own <Vendors,Da,Agência>
```

- `--native`: checkout esparso do `magento/magento2` na tag da instalação (veja `magento/product-*-edition` no `composer.json`). Se `reference/magento2-<tag>` não existir, crie com `node tools/native-reference.mjs <tag>`.
- `--own`: vendors que são da agência/cliente (o resto de `app/code` vira "Terceiros"). Infira pelos nomes em `app/code`; na dúvida, pergunte.
- O resultado vai para `public/maps/<slug>.json`. Nunca edite esse arquivo à mão: ele é regenerado.

## 2. Análise do Claude (anotações)

As anotações ficam em `public/maps/<slug>.annotations.json` e sobrevivem a novas extrações:

```json
{
  "generatedAt": "AAAA-MM-DD",
  "scope": "o que esta passada cobriu",
  "zones": { "<zona>": "visão geral da etapa nesta instalação" },
  "items": {
    "<id exato do item>": {
      "zone": "<zona correta>",
      "summary": "1–2 frases: o que faz e em que momento do fluxo",
      "risk": { "level": "alto|medio|baixo", "note": "por quê, com a evidência" }
    }
  }
}
```

Zonas válidas: `entrada`, `catalogo`, `produto`, `carrinho`, `checkout`, `admin`, `armazem`, `expedicao`, `integracoes`, `outros`.

Fluxo de trabalho:

1. Mescle com o arquivo existente. Nunca apague anotações anteriores; só atualize as que você revisou.
2. Gere o contexto de código em lotes, por zona, e leia (salve no scratchpad, não no repo):
   `node tools/context.mjs <slug> --zone <zona> --unannotated --max-lines 22 > <scratchpad>/ctx.md`
   Comece por `outros`, depois `checkout`, `carrinho`, `admin`, `integracoes` e por fim o resto.
3. Para cada item:
   - **zone**: a etapa em que o código executa, não o nome do módulo. Ex.: e-mail transacional de fatura vai para `admin`; observer de `customer_login` vai para `entrada`; cron que consulta o status do Pix vai para `admin`.
   - **summary**: em pt-BR, direto, citando o método/evento interceptado e o efeito de negócio.
   - **risk** só com evidência no código. Procure principalmente:
     - REST com ACL `anonymous` (ou `self` carregando entidade por ID sem checar o dono) que escreve dados, altera preço/total ou expõe dados pessoais;
     - controllers de frontend que fazem escrita sem sessão ou form key;
     - valores vindos do cliente somados a totais sem validação;
     - dados pessoais ou credenciais em log;
     - confiança em cookie para identificar admin/vendedor;
     - preferences que substituem controllers/models inteiros do core (risco de upgrade).
     Antes de marcar `alto`, siga a cadeia (ex.: o valor gravado realmente chega ao grand_total?) e confira se a rota é bloqueada no nginx do projeto.
4. Escreva `zones.<zona>` com 2–4 frases sobre como a etapa difere do nativo nesta instalação.
5. Valide os IDs antes de terminar:
   `node -e "const m=require('./public/maps/<slug>.json'),a=require('./public/maps/<slug>.annotations.json');const ids=new Set(m.items.map(i=>i.id));console.log(Object.keys(a.items).filter(k=>!ids.has(k)))"` (deve imprimir `[]`).

## 3. Entrega

- Recarregue o app (`npm run dev`) e confira a zona analisada e o painel "Pontos de atenção".
- Resuma para o usuário: cobertura (itens anotados / customizados), itens reclassificados e os riscos `alto` com arquivo:linha. Deixe claro que são achados de leitura de código, a confirmar em ambiente dev.
- Os mapas contêm dados do cliente: `public/maps/` está no `.gitignore` e não deve ir para o git.
