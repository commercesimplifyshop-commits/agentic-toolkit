# StoreFlow 3D

Visualização 3D, em formato de jogo, do fluxo de compra do **Magento 2 / Adobe Commerce**, com um mapa de **todas as APIs, plugins, preferences, observers, rotas, crons e filas** de uma instalação real, encaixados em cada etapa do pedido. Inclui um **debug de fluxo** que simula um único pedido do início ao fim e mostra, chamada por chamada e na ordem de execução, tudo o que roda: nativo e customizado.

![Simulação do fluxo de pedido](docs/simulacao.png)

Feito para engenheiros Magento que precisam entender rápido um projeto que não conhecem: o que foi customizado no checkout, quem intercepta o `placeOrder`, em que ordem os observers de `sales_order_save_after` rodam, quais endpoints REST estão abertos como `anonymous`.

## Instalação com o Claude Code (recomendado)

Pré-requisitos: [Claude Code](https://claude.com/claude-code) (terminal, app desktop ou extensão VS Code/JetBrains), **Node.js 18+**, **git** e o código de uma instalação Magento 2 na sua máquina. A pasta `vendor/` e o banco de dados não são necessários.

Abra o Claude Code na pasta onde quer instalar o projeto e cole o prompt abaixo:

```text
Instale e configure o StoreFlow 3D para mim, seguindo o README do repositório https://github.com/commercesimplifyshop-commits/magento-flow-3d.

1. Clone o repositório na pasta atual (se ainda não existir) e rode `npm install` dentro dele.
2. Me pergunte o caminho da minha instalação Magento 2 (a pasta que contém app/code e composer.json) e confirme que ela existe.
3. Descubra a versão do Magento no composer.json ou composer.lock (pacote magento/product-community-edition ou magento/product-enterprise-edition) e rode `node tools/native-reference.mjs <tag>` com a tag correspondente do repositório magento/magento2 (ex.: 2.4.6-p3). Se a tag exata não existir, use a mais próxima da mesma versão e me avise.
4. Liste os vendors de app/code e me pergunte quais são da minha agência/loja (o resto será tratado como "Terceiros"). Use isso no --own.
5. Rode `node tools/extract.mjs <caminho-do-magento> --name <slug> --native reference/magento2-<tag> --own <Vendors>` (slug = nome da pasta do projeto em minúsculas) e me mostre o resumo por zona.
6. Rode a skill /magento-map deste repositório para analisar o código, começando pelas zonas "outros" e "checkout". Grave as anotações em public/maps/<slug>.annotations.json e valide os IDs.
7. Suba o app com `npm run dev` em segundo plano e me passe a URL. Me explique em poucas linhas como usar a aba "Na instalação", a busca, os "Pontos de atenção" e o "Debug de fluxo".

Não envie nenhum dado da minha instalação para fora da máquina e não faça commit de public/maps/ (é dado do cliente e já está no .gitignore).
```

O Claude Code vai seguir os passos, pedindo confirmação quando precisar de uma decisão sua. A análise da etapa 6 lê o código PHP das customizações, então leva mais tempo em projetos grandes. Você pode rodar `/magento-map` de novo depois para cobrir as outras zonas: ela continua de onde parou e não apaga anotações anteriores.

## Instalação manual

```bash
git clone https://github.com/commercesimplifyshop-commits/magento-flow-3d.git
cd magento-flow-3d
npm install

# Referência do core na mesma versão da sua loja (só XMLs e classes de plugin, poucos MB)
node tools/native-reference.mjs 2.4.6-p3

# Inventário da instalação
node tools/extract.mjs ../minha-loja --name minha-loja \
  --native reference/magento2-2.4.6-p3 --own MinhaAgencia,MinhaLoja

npm run dev   # http://localhost:5173
```

Sem nenhum mapa gerado, o app abre só com a simulação (dados mock).

## O que tem no app

| Recurso | O que faz |
|---|---|
| **Simulação** | Clientes fictícios navegam, compram e abandonam carrinhos. Os pedidos passam por fatura, separação, embalagem e envio com os status nativos (`pending` → `processing` → `complete`). |
| **Na instalação** | Em cada zona (Entrada, Catálogo, Produto, Carrinho, Checkout, Admin, CD, Expedição, Integrações), lista o que existe na sua instalação, com filtros por origem (customizado, terceiros, nativo) e por tipo, e links para abrir o XML ou a classe PHP no VS Code. |
| **Busca** | Encontra qualquer ponto de integração (`placeOrder`, `sales_order_save_after`, um módulo…) e leva até a zona dele. |
| **Análise do Claude** | Resumo do que cada customização faz, zona correta e **pontos de atenção** (endpoints `anonymous` que gravam dados, valores do cliente somados a totais, dados pessoais em log…). |
| **Debug de fluxo** | Simula um pedido em 12 etapas. Para cada requisição, mostra a pilha completa: plugins `before`/`around`/`after` na ordem real, preferences, eventos e observers. Tem play/pause, avanço chamada a chamada (`→`), próxima etapa (`Shift+→`), velocidade de 0,5× a 4× e o filtro "só customizações". |

## Como funciona

```
tools/extract.mjs ──► public/maps/<slug>.json              inventário determinístico (regenerável)
/magento-map      ──► public/maps/<slug>.annotations.json  análise do Claude (preservada entre extrações)
src/              ──► app React + Three.js que lê os dois arquivos
```

- **`tools/extract.mjs`**: lê `webapi.xml`, `schema.graphqls`, `di.xml`, `events.xml`, `routes.xml`, `crontab.xml` e `communication.xml` de `app/code` e da referência do core. Também lê a ordem dos módulos em `app/etc/config.php` e detecta plugins `around` que não chamam `$proceed`. Cada item é classificado numa zona por regras (`tools/classify.mjs`).
- **`tools/native-reference.mjs`**: checkout esparso do `magento/magento2` na tag da sua versão, com só os arquivos necessários. Ele permite listar as APIs, plugins e observers nativos mesmo quando a instalação não tem `vendor/`.
- **`tools/context.mjs`**: junta o código PHP por trás de cada customização (corpo dos métodos interceptados) para o Claude analisar em lote.
- **`.claude/skills/magento-map`**: skill do Claude Code que orquestra a análise. Ela fica disponível automaticamente quando o Claude Code é aberto dentro deste repositório.

### Como o debug calcula a ordem

A análise é estática: não precisa da loja rodando. A ordem é calculada com as mesmas regras do framework:

- **Roteiro nativo** (`src/debug/scenario.ts`): requisições, métodos e eventos de uma compra B2C no Luma 2.4, conferidos no código do core.
- **Plugins**: o mesmo algoritmo do `PluginListGenerator` e do `Interceptor::___callPlugins`. Plugin sem `sortOrder` executa primeiro (`PHP_INT_MIN`) e cada `around` aninha os plugins seguintes. O app avisa quando há empate de `sortOrder` envolvendo uma customização, porque no PHP 7.x a ordem entre eles não é garantida.
- **Observers**: escopo global e depois a área, na ordem dos módulos em `app/etc/config.php`. Uma redeclaração com o mesmo nome sobrescreve ou desativa a anterior.
- **Preferences** e módulos desativados também são considerados.

**Limites:** ficam de fora da pilha os eventos disparados dentro de código customizado, as chamadas feitas pelo JavaScript do tema e os plugins em classes que não estão no roteiro. Os pontos de entrada customizados de cada etapa aparecem em "Também nesta etapa". Os módulos exclusivos do Adobe Commerce e o MSI não estão na referência pública do core.

## Privacidade

Tudo roda localmente. `public/maps/` (inventário e análise da sua instalação) e `reference/` estão no `.gitignore`. Os pontos de atenção são achados de leitura de código: confirme em ambiente de desenvolvimento antes de reportar.

## Próximos passos

- **Modo gravação**: um módulo Magento que registra as chamadas reais de plugins e eventos num ambiente dev e as reproduz no debug, validando a ordem calculada.
- **Modo ao vivo**: alimentar a simulação com eventos reais (`src/sources/websocketSource.ts` já define a interface).
