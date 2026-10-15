<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/brand/logo-dark-bg.svg">
    <img src="apps/web/public/brand/logo-light-bg.svg" alt="Agentic Toolkit" height="56">
  </picture>
</p>

# Agentic Toolkit

Dashboard para entender e evoluir qualquer instalação **Magento 2 / Adobe Commerce** a partir do código. Você conecta uma instalação (pasta local, repositório Git, inclusive privado, ou .zip) e ganha:

- **Visão geral:**
  - versão e status de suporte;
  - módulos core, customizados e de terceiros;
  - extensões, Quality Patches, security package, 2FA/reCAPTCHA, tema e stack;
  - highlights técnicos detectados automaticamente.
- **Mapa de integrações:** todas as APIs REST/GraphQL, plugins, preferences, observers, rotas, crons e filas, classificados por etapa do fluxo de compra.
- **Debug de fluxo:** simula um pedido do início ao fim e mostra, em ordem de execução, cada plugin `before/around/after`, preference, evento e observer que roda, nativo e customizado.
- **Fluxo 3D:** a loja em formato de jogo, com a simulação do pedido B2C nativo.
- **Pergunte ao código:** IA (Claude Code local, API da Anthropic ou modelo local) que responde lendo o código, com ferramentas que só leem.
- **Explorador de código no estilo PhpStorm:** tema Darcula, abas, Find in Files, Go to File/Class, Search Everywhere e `Ctrl+clique` para ir à declaração, tudo somente leitura.
- **Pontos de atenção, segurança e patches.**
- **Refinamento:** da demanda crua ao card refinado (negócio, solução técnica, critérios de aceite, observações), com divisão em tarefas e desenvolvimento pelo Claude Code, cada tarefa no seu worktree.
- **Git:** branches, worktrees, alterações e histórico do repositório do projeto, com as ações do dia a dia.

Feito para o engenheiro que chega num projeto sem contexto e precisa, em minutos, saber o que foi customizado, onde, e o que merece cuidado.

![Fluxo 3D](docs/simulacao.png)

## Navegação de código (atalhos do PhpStorm)

Disponíveis em qualquer tela da instalação:

| Atalho | PhpStorm | O que faz |
|---|---|---|
| `Shift` `Shift` | Search Everywhere | Classes e arquivos juntos |
| `Alt+N` | Go to Class (`Ctrl+N`) | Busca por nome de classe; camel case funciona (`QuPl` → QuotePlugin) e `\` busca pelo namespace |
| `Alt+Shift+N` | Go to File (`Ctrl+Shift+N`) | Busca por nome de arquivo ou caminho; `Arquivo.php:30` abre na linha 30 |
| `Ctrl+Shift+F` ou `Alt+F` | Find in Files | Busca no projeto com diferenciar maiúsculas (`Alt+C`), palavra inteira (`Alt+W`), regex (`Alt+X`), escopo e máscara de arquivo, com pré-visualização |
| `Ctrl+F` / `Ctrl+G` | Find / Go to Line | Dentro do arquivo aberto |
| `Ctrl+clique` | Go to Declaration | Abre a classe sob o cursor (resolve `use` e namespace); classes do core abrem no GitHub na tag da sua versão |

O Chrome reserva `Ctrl+N` e `Ctrl+Shift+N` (nova janela e janela anônima), e nenhuma página consegue capturá-los. Por isso as variantes com `Alt`. Tudo isso é feito pela aplicação, com índice e busca locais, sem IA e sem custo. O código é colorido pelo CodeMirror 6 (PHP, phtml, XML, JS, LESS/CSS, JSON e YAML).

## Simulador de API

Em **Ferramentas & plugins → Simulador de API** (ou no botão "Testar no simulador" no detalhe de uma rota REST ou GraphQL) você testa os endpoints da instalação contra um ambiente seu, como no Postman:

- **Campos já preenchidos**: método, caminho, parâmetros de caminho e query (`searchCriteria` nos `GET` de listagem). O body JSON é montado a partir da assinatura PHP do método de serviço e dos getters das Data Interfaces, com os nomes de campo que o Magento espera. Parâmetros que o `webapi.xml` preenche pelo token (ex.: `cartId` nas rotas `/mine`) ficam de fora.
- **Autorização igual ao Postman**: um select com Sem autenticação, Bearer token, Admin (usuário e senha), Cliente (e-mail e senha) e Basic Auth. Admin e Cliente têm "Gerar token", que chama `/V1/integration/{admin|customer}/token` no ambiente e aplica o token. A autorização sugerida vem da ACL da rota.
- **Resposta**: status, tempo, tamanho, body formatado e headers. "Copiar como cURL" mascara o token, a menos que você marque "incluir token real".

O simulador só envia a requisição. Se o ambiente está de pé ou não é com você: quando ele não responde, aparece o motivo (conexão recusada, DNS, certificado). A URL base e o store code ficam salvos no navegador, por instalação. Senhas e tokens ficam só na memória da aba e nunca vão para disco nem para a auditoria, que registra apenas o método e a URL de destino. Antes de um `POST`/`PUT`/`DELETE` para um host que não parece local, o Agentic Toolkit pede confirmação.

## Documentação

Em **Ferramentas & plugins → Documentação** o seu Claude Code escreve uma documentação estruturada a partir do código da instalação. Você escolhe o tipo e o assunto:

| Tipo | Exemplo | O que a doc cobre |
|---|---|---|
| Módulo | `Vendor_Checkout` | Arquivos, APIs, plugins, observers, configuração e dados do módulo |
| Funcionalidade | estorno parcial de pedido | Como funciona de ponta a ponta, em todos os módulos envolvidos |
| Fluxo | do carrinho até o pedido | A ordem real de execução: entrada, serviços, plugins, observers, persistência |
| Tema | integrações com o ERP | Todos os pontos do código ligados ao assunto e como se conectam |

Toda doc segue a mesma estrutura: resumo, visão geral, onde está no código, como funciona, pontos de extensão, configuração, dados, dependências, riscos, como testar e referências com `arquivo:linha`. Durante a geração aparece o que o Claude está lendo; no fim, a lista de arquivos consultados abre no explorador de código.

- **Preview no Claude Docs**: ao terminar, a doc é publicada automaticamente no Claude Docs da sua conta claude.ai (privada até você compartilhar) e o link aparece no topo. "Regerar" abre o formulário preenchido para você ajustar e atualiza o mesmo documento.
- **Cancelar**: durante a geração ou a publicação, "Cancelar" interrompe o Claude Code.
- **Word e PDF**: gerados localmente pelo Agentic Toolkit, sem depender da publicação.

Precisa do Claude Code instalado e logado (o mesmo de "Pergunte ao código"). A publicação usa o conector Claude Docs da sua conta.

## Refinamento e desenvolvimento por tarefa

Em **Desenvolvimento → Refinamento** você leva uma demanda do texto cru até o código, sem precisar de OpenSpec:

1. **Nova demanda**: cole o texto do ticket, o pedido do cliente ou prints. O Claude lê o código (só com ferramentas de leitura nesta etapa) e responde com o entendimento, a solução que imagina e as perguntas que faltam. Vocês conversam até ficar claro.
2. **Gerar card refinado**: o card traz a descrição de negócio, a **descrição técnica** (a solução, que o Claude segue para desenvolver), o plano de execução, os critérios de aceite, os pontos de observação e a complexidade. Tudo é editável, e os botões copiam o card em Markdown, no formato do Jira ou do Azure DevOps.
3. **Dividir**: se o Claude recomendar (ou você quiser), a demanda vira de 2 a 6 tarefas. Cada parte passa pelo mesmo refinamento, só com o seu escopo, em segundo plano.
4. **Preparar git**: escolha uma branch existente ou crie uma nova a partir de uma base. Antes de criar, o painel busca a base no remoto e mostra se ela está atualizada; você decide se atualiza (fast-forward). A tarefa ganha um **worktree**, uma pasta própria em `<projeto>-worktrees/<branch>`, ao lado do projeto. A pasta principal não muda.
5. **Iniciar desenvolvimento com o Claude**: o Claude Code roda no worktree da tarefa, segue o plano, mostra o progresso no card (percentual, passo atual e atividade) e termina com um commit, sem push. Várias tarefas podem ser desenvolvidas em paralelo, cada uma na sua sessão e no seu worktree. "Parar" interrompe a sessão; o que já foi alterado fica no worktree. O push usa as credenciais do git desta máquina (num clone feito pelo painel com token somente leitura, ele é recusado pelo remoto).

Em **Desenvolvimento → Git** fica a visão do repositório local: branch atual, alterações, branches com ahead/behind e último commit, worktrees com alterações pendentes, stashes, remotos e os últimos commits. As ações são fetch, pull (fast-forward), checkout, nova branch (com ou sem worktree), criar ou remover worktree, limpar worktrees órfãos, excluir branch e **push**, sempre com confirmação. O card da tarefa leva direto à branch dela nessa tela. A **pesquisa de branches** filtra as locais pelo nome ou pelo último commit e mostra as que existem só no remoto, com checkout e worktree.

**Pull requests e code review (GitHub).** Quando o remoto do repositório é do GitHub (inclusive GitHub Enterprise), a tela de Git lista as pull requests abertas e marca as que aguardam a sua revisão. "Revisar" abre a visão de code review:

- **Arquivos alterados**: o diff de cada arquivo, com números de linha. Os comentários dos revisores aparecem na linha em que foram feitos, e os comentários em versões antigas do arquivo ficam à parte. Cada arquivo pode ser marcado como visualizado.
- **Conversa**: a descrição, os comentários, as revisões (quem aprovou ou pediu alterações) e os checks.
- **Revisar**: o "+" numa linha cria um comentário pendente. "Revisar alterações" envia tudo de uma vez ao GitHub como **Comentar**, **Aprovar** ou **Solicitar alterações**, no commit que você revisou. Dá para responder aos comentários de outros revisores. O GitHub não deixa o autor aprovar a própria PR, e a tela já avisa isso.
- **Credencial**: "Conectar ao GitHub" usa a credencial que o git desta máquina já tem para o GitHub (Git Credential Manager), sem abrir janela, ou um token colado. As duas ficam **só em memória**: somem quando a aplicação fecha, e nunca vão para o disco, para a tela nem para o log. Sem credencial, as PRs de repositórios públicos podem ser lidas, mas não revisadas.
- As revisões enviadas ficam na auditoria como requisição externa. Rascunhos de comentários e marcas de "visualizado" ficam só no navegador.

### Refinamento em projetos Salesforce B2C (modo aprendendo SFCC)

Num projeto Salesforce B2C o refinamento usa o perfil SFCC, pensado para quem vem do Adobe Commerce. O modo aprendendo fica sempre ligado:

- O Claude responde como arquiteto SFRA. Ele parte da estrutura do projeto lida pelo painel (cartuchos, cartridge path do site, hooks, serviços e jobs) e do conhecimento curado em `apps/api/src/techs/sfcc/knowledge.ts`: equivalências Adobe → SFCC, regras do SFRA e a documentação oficial que ele pode citar.
- Cada resposta termina com **"Para quem vem do Adobe"**: como seria no Magento, como é no SFCC e o que muda no jeito de pensar.
- O card refinado ganha duas seções. **Passos no Business Manager** lista atributos, site preferences, serviços, jobs, promoções e cartridge path, com o caminho no BM, e vai junto para o Jira e o Azure DevOps. O **guia "Para quem vem do Adobe"** fica no painel e na cópia em Markdown, com links só para a documentação da Salesforce.
- O desenvolvimento segue o padrão SFRA (`server.extend(module.superModule)`, `append`/`prepend`, nada em `app_storefront_base`) e verifica com os scripts que o `package.json` tem (`lint`, `test`, `compile:js`/`compile:scss`). Ele não faz upload.

### Upload para a instância (Salesforce B2C)

Em **Instância → Upload para a instância** o painel explica como o código chega na sandbox e faz o envio com a ferramenta do próprio projeto:

- **Como funciona.** O `dw.json` na raiz diz para onde enviar (`hostname`, `username`, `password`, `code-version`). O `dwupload`, que vem com o `sgmf-scripts` do SFRA, zipa cada cartucho e o envia por WebDAV para a code version. O `npm run watch` do SFRA compila o JS e o SCSS e sobe cada arquivo salvo, e o `npm run uploadCartridge` sobe cartuchos inteiros. A tela mostra as ferramentas que encontrou no projeto (scripts do `package.json`, `dwupload`, extensão Prophet do VS Code, `sfcc-ci`, `b2c-tools`) e explica cada uma.
- **De onde enviar.** Da pasta do projeto ou do worktree de uma tarefa (o card tem o atalho "Enviar para a sandbox"). Os cartuchos alterados na tarefa já vêm marcados.
- **Enviar cartuchos** sobe os escolhidos de uma vez. **Upload automático** (`dwupload watch`) sobe cada arquivo salvo até você parar. As duas ações pedem confirmação, mostrando a instância e a code version, e ficam na auditoria como requisição externa.
- **Credenciais.** O painel mostra só o hostname, a code version e se há usuário e senha. O `dwupload` lê o `dw.json` sozinho. Para isso, uma cópia temporária fica em `cartridges/` só enquanto o envio roda, como faz o `sgmf-scripts`. O envio é recusado se o `.gitignore` não ignorar `dw.json`. Usuário e senha são mascarados no log, e o Claude Code nunca lê `dw.json` nem `app/etc/env.php` (regra `Read(**/dw.json)` em todas as sessões).
- **Pré-requisitos.** `dw.json` com hostname e usuário, e o `dwupload` instalado (`npm install` no projeto). Quando falta algo, a tela avisa. Se a mudança tocou em `cartridge/client`, a tela lembra de compilar antes de enviar.

Os cards ficam em `~/.agentic-toolkit`. Se a pasta conectada não for um repositório git (por exemplo, uma cópia ou um .zip), o Git e o desenvolvimento por tarefa avisam e levam para **Configurações → Workspace → Repositório git**; o refinamento continua funcionando.

## Configurações do workspace e pré-requisitos

Em **Configurações → Workspace** ficam os dados de cada instalação, os mesmos que o setup inicial grava (e que você pode editar depois):

- **Pasta local**: onde está o código. Um workspace criado a partir de um clone ou de um .zip pode ser vinculado à pasta do seu clone de trabalho; a cópia feita pelo Agentic Toolkit é apagada. "Sincronizar" faz o `git fetch` do clone (ou lê a pasta local de novo) e analisa.
- **Pasta do projeto**: a raiz do Magento (ou a pasta com `cartridges/`) dentro da pasta, e os vendors do seu time.
- **Repositório git**: por padrão, o repositório que contém o projeto. Informe outro caminho quando o código analisado for uma cópia e o seu clone estiver em outra pasta. É o repositório usado pela tela Git e pelo desenvolvimento das tarefas.
- **Variáveis de ambiente**: entregues à sessão do Claude Code que desenvolve as tarefas (para rodar `bin/magento`, testes etc.). Ficam no diretório de dados, nunca no projeto. Valores marcados como secretos não voltam para a tela, e nomes que mudariam como as ferramentas rodam (`PATH`, `NODE_OPTIONS`, `GIT_*`, `LD_*`, `ANTHROPIC_*`…) são recusados.

Mudar a pasta, o projeto ou os vendors de um workspace já analisado inicia uma nova análise; a tela acompanha o progresso e volta para Configurações.

Cada funcionalidade declara do que precisa (repositório git, remoto, Claude Code, provedor de IA). Quando falta algo, a tela mostra um aviso com o que deixa de funcionar e um link direto para a seção de Configurações que resolve. A lista fica em `apps/web/src/shell/prereqs.tsx` (`FEATURE_NEEDS`), e a checagem em `GET /api/workspaces/<id>/prerequisites`.

## OpenSpec (desenvolvimento guiado por especificações)

Em **Ferramentas & plugins → OpenSpec** você acompanha as specs e as mudanças do projeto, com o [OpenSpec](https://github.com/Fission-AI/OpenSpec) como fonte da verdade:

- **Visão geral**: contadores (specs, requisitos, cenários, mudanças ativas, arquivadas, progresso das tarefas e problemas de validação), o fluxo das mudanças e a lista de specs com seus status.
- **Quadro (Kanban)**: colunas Planejamento, Em andamento, Em revisão, Impedida, Pronta p/ arquivar e Arquivada. Cada card abre a proposta, as tarefas marcadas, as specs alteradas e a validação.
- **Specs**: status (estável, em alteração, rascunho, aprovada, obsoleta) e requisitos com cenários.
- **Primeiro uso**: se o projeto ainda não tem OpenSpec, o painel gera o prompt de instalação para você colar no Claude Code no terminal. Se o OpenSpec estiver em outra pasta, você a mapeia informando o caminho relativo à raiz.

**Arquivos do OpenSpec.** O painel lê o `openspec/` do projeto. Criar uma mudança a partir de uma proposta revisada, editar specs e instalar o OpenSpec gravam só nos caminhos do OpenSpec, com confirmação (veja "Escrita de arquivos do OpenSpec"). Implementar e arquivar continuam sendo prompts para o seu Claude Code no terminal. Os status manuais (em revisão, impedida, aprovada etc.) ficam no `~/.agentic-toolkit` desta máquina, e não são compartilhados com o time ainda.

## Diagramas de arquitetura

Em **Ferramentas & plugins → Diagramas de arquitetura** você desenha modelos de duas formas, com salvamento automático:

- **Canvas (visual)**, para **C4** e **fluxos**: arraste elementos da paleta, ligue-os pelas alças, edite título, tecnologia e descrição no painel, coloque elementos dentro de fronteiras arrastando-os para elas, e desfaça com Ctrl+Z. Os modelos de referência Magento 2 abrem neste modo.
- **Código (Mermaid)**, para **UML** (classes, sequência, estados) e **entidades (ER)**, e para quem prefere escrever. Diagramas em código de C4 e fluxo podem ser convertidos para o canvas com um botão.
- **Criar com o Claude** gera o modelo a partir da sua descrição: em C4 e fluxo já sai como canvas editável.
- **Código gerado**: no canvas, "Ver código Mermaid" mostra o código correspondente, somente para leitura.
- **Arquiteturas de referência Magento 2**: B2C, B2B, D2C e Marketplace, para editar a partir delas.
- **Criar com o Claude**: descreva a arquitetura e escolha o cenário e o tipo de modelo. O seu Claude Code lê o código desta instalação (somente leitura) e desenha o modelo com os nomes reais de módulos e integrações. Dá para cancelar durante a geração.
- **Exportar**: SVG (vetorial), PNG (para colar em documentos), `.mmd` (código Mermaid) e `.json` do Agentic Toolkit (preserva nome e tipo).
- **Importar**: `.json` do Agentic Toolkit, `.mmd` / `.mermaid` / `.txt` ou um Markdown com um bloco ```` ```mermaid ````.

Os diagramas ficam em `~/.agentic-toolkit`, por instalação, como os quadros e as documentações. O Mermaid carrega só quando você abre a tela, e funciona sem internet.

## Quadro branco

Em **Ferramentas & plugins → Quadro branco** você rascunha fluxos, arquiteturas e ideias com o [Excalidraw](https://github.com/excalidraw/excalidraw) embutido: desenho livre, formas, setas, texto, imagens coladas, biblioteca de formas e exportação em PNG, SVG ou `.excalidraw`.

Cada instalação tem os seus quadros, salvos automaticamente em `~/.agentic-toolkit` (nunca no repositório). Fontes e traduções do Excalidraw são servidas pelo próprio Agentic Toolkit, então o quadro funciona sem internet.

## Tecnologias suportadas

Na conexão você escolhe a tecnologia da instalação. Cada uma tem a sua detecção, a sua visão geral e o seu menu.

- **Adobe Commerce** (Magento 2): módulos, APIs, plugins, observers, crons, filas e rotas, com a análise completa do extrator.
- **Salesforce B2C Commerce** (SFCC): lê o projeto com `cartridges/`: cartuchos, controllers SFRA e pipelines `.ds`, templates ISML, hooks, jobs (`<job job-id>`), serviços (`LocalServiceRegistry.createService`), sites e atributos customizados em `meta/`. A seção Instância mostra o hostname e o `code-version` do `dw.json`, e avisa se há credenciais guardadas no projeto, sem mostrar os valores.

Limites atuais do Salesforce B2C: a documentação gerada pelo Claude ainda não está disponível (ela depende do mapa de integrações do Magento). Na instância, o painel só envia código, pelo `dw.json` do projeto (veja "Upload para a instância"). Rodar jobs e consultar OCAPI ainda não existem, porque dependem de um cofre de credenciais.

## Onde os dados ficam no computador

```
~/.agentic-toolkit/
  core/                  workspaces.json, audit.log, settings.json (valem para todas as tecnologias)
  staging/               .zip recebido antes de a tecnologia ser conhecida
  techs/adobe-commerce/  repos/, uploads/, workspaces/<id>/, reference/, cache/
  techs/salesforce-b2c/  repos/, uploads/, workspaces/<id>/
```

Na primeira execução, os dados da versão anterior são copiados para `techs/adobe-commerce/` e os originais são mantidos. A pasta do código do cliente nunca é alterada.

## Ações declaradas e auditadas

Ler o código é a regra da maior parte das telas, mas escrever deixou de ser proibido por padrão: o **Git** e o **desenvolvimento por tarefa** escrevem no repositório, porque esse é o objetivo deles. O que vale para tudo, e é garantido por código:

| Proteção | Como |
|---|---|
| Toda rota declara uma ação | Rota sem `@Action` é bloqueada (fail closed). Cada ação tem tipo (leitura, dados, externa, escrita no repositório), método HTTP permitido e validador próprio, executado antes do handler. |
| Telas de análise só leem | Visão geral, mapas, explorador de código, "Pergunte ao código", diagramas e o refinamento acessam o código por `ReadOnlyFs` (sem métodos de escrita; bloqueia `../`, caminhos absolutos e links simbólicos para fora) ou pelo Claude Code com `--tools Read,Grep,Glob`. |
| Escrita no repositório só onde é o objetivo | Git (branches, worktrees, pull, push) e desenvolvimento por tarefa, sempre a partir de um botão com confirmação e registrados na auditoria como "escrita no repositório". O desenvolvimento roda no worktree da tarefa, nunca na pasta principal, e termina em commit sem push. O push é uma ação separada, com confirmação. |
| Credenciais nunca lidas | `app/etc/env.php`, `auth.json`, `.env`, chaves e `.git/config` são listados, mas o conteúdo é recusado (inclusive para a IA). Toda sessão do Claude Code nega `Read(**/dw.json)` e `Read(**/app/etc/env.php)`, o que também esconde esses arquivos do Grep e do Glob. URLs de remotos aparecem com as credenciais mascaradas. |
| Upload só com a ferramenta do projeto | O envio para uma instância Salesforce B2C roda o `dwupload` do `node_modules` do projeto, sem shell, a partir de `cartridges/`, só com `--cartridge <nome>` (e `watch`). As credenciais ficam no `dw.json`, nunca em argumentos. É classificado como requisição externa. |
| Comandos sem shell | Tudo roda pelo `CommandRunner`, sem shell. No git, continuam bloqueadas as opções que executam outro programa (`--upload-pack`, `--receive-pack`, `--exec`, `--template`, `-c core.hooksPath/sshCommand/fsmonitor`, `protocol.*.allow=always`) e clones `file://`. O Claude Code roda sempre em modo não interativo (`-p`), sem MCP e ignorando o `.claude/` do repositório do projeto. |
| Simulador de API não toca no repositório | As requisições vão só para a URL que você informou (http/https, sem credenciais na URL, nunca para o próprio Agentic Toolkit), classificadas como "requisição externa" na auditoria. |
| Auditoria e autoteste | Toda ação (permitida ou bloqueada) vai para o log. A tela "Regras & auditoria" roda um autoteste de cada proteção. |

Os testes automatizados (`npm test`) cobrem essas regras. Uma funcionalidade nova que só deva ler é marcada como tal na sua ação (tipo `read`); a restrição é a exceção declarada, não a regra.

### Escrita de arquivos do OpenSpec

O **OpenSpec** grava arquivos na pasta principal da instalação (não num worktree) e por isso tem regras próprias, declaradas em `apps/api/src/readonly/repo-exceptions.ts` e vale só para estes caminhos, relativos à raiz da instalação:

| Exceção | Caminhos | Extensões |
|---|---|---|
| `openspec` | a pasta do OpenSpec (`openspec/` ou a pasta mapeada): specs, mudanças, tarefas, `config.yaml` | `.md`, `.yaml`, `.yml`, `.gitkeep` |
| `openspec` | `.claude/commands/opsx/*.md` e `.claude/skills/openspec-*/SKILL.md`, instalados pelo `openspec init` | `.md` |

Para gravar, todo caminho passa por estas checagens, e qualquer falha bloqueia a escrita:
- o caminho precisa estar dentro de uma exceção listada, sem `..`, caminho absoluto ou link simbólico;
- arquivos de credenciais continuam bloqueados, mesmo dentro de uma exceção;
- o tamanho é limitado a 512 KB;
- edições carregam a versão (sha) que você abriu, e uma versão mais antiga é recusada, para não sobrescrever outra alteração;
- toda gravação é confirmada na tela (a instalação mostra a lista antes) e registrada na auditoria como "exceção de escrita".

A gravação passa sempre pelo `RepoWriter`, o único lugar do código que escreve em uma instalação. A instalação do OpenSpec roda o CLI numa pasta de preparação dentro do `~/.agentic-toolkit`, e só os arquivos da lista são copiados para a instalação. Os rascunhos do Claude são somente texto, e nada é salvo sem a sua confirmação.


## Instalação com o Claude Code (recomendado)

Pré-requisitos:
- [Claude Code](https://claude.com/claude-code) (terminal, app desktop ou extensão do VS Code/JetBrains);
- **Node.js 20+** e **git**;
- o código de uma instalação Magento 2 acessível pela máquina (pasta, repositório ou .zip). `vendor/` e banco de dados não são necessários.

Abra o Claude Code na pasta onde quer instalar e cole:

```text
Instale o Agentic Toolkit para mim seguindo o README de https://github.com/commercesimplifyshop-commits/magento-flow-3d.

1. Clone o repositório na pasta atual (se ainda não existir), entre nele e rode `npm install` e `npm run build`.
2. Suba o servidor com `npm start` em segundo plano e confirme que http://127.0.0.1:4310/api/system/health responde.
3. Rode `curl -s http://127.0.0.1:4310/api/system/selftest` e me mostre se todas as proteções passaram.
4. Me pergunte onde está a minha instalação Magento: caminho de uma pasta local, URL de um repositório Git ou um arquivo .zip.
   - Pasta local: valide com POST /api/workspaces/inspect {"path": "<caminho>"} e me mostre o checklist. Se o Magento estiver numa subpasta, use a candidata encontrada. Depois crie com POST /api/workspaces {"source":"local","path":"<raiz>"}.
   - Repositório Git: explique as 3 formas de acesso a repositório privado da seção "Repositórios privados" do README e use a que eu escolher. Nunca grave o token em arquivo nem o mostre nos logs.
   - .zip: me diga para usar a aba "Arquivo .zip" no navegador.
5. Liste os vendors de app/code da instalação, me pergunte quais são do meu time e salve com PUT /api/workspaces/<id> {"ownVendors": [...]}.
6. Rode a análise (POST /api/workspaces/<id>/analysis), acompanhe o job até terminar e me mostre os highlights de GET /api/workspaces/<id>/overview.
7. Abra http://127.0.0.1:4310 no navegador e me explique em poucas linhas as áreas do menu lateral.

Regras: durante a instalação, não edite, mova ou apague nada dentro da instalação Magento e não faça commit de nada do diretório ~/.agentic-toolkit.
```

Depois, para a IA analisar as customizações com profundidade (resumos e pontos de atenção), rode dentro do repositório do Agentic Toolkit:

```text
/magento-map <id-da-instalação>
```

## Instalação manual

```bash
git clone https://github.com/commercesimplifyshop-commits/magento-flow-3d.git agentic-toolkit
cd agentic-toolkit
npm install
npm run build
npm start          # http://127.0.0.1:4310
```

Para desenvolvimento: `npm run dev` (API em :4310 com watch + Vite em http://localhost:5173 com proxy para a API).

Variáveis opcionais:

| Variável | Padrão | Para quê |
|---|---|---|
| `AGENTIC_TOOLKIT_DATA` | `~/.agentic-toolkit` | Onde ficam clones, uploads, mapas, anotações, configurações e log de auditoria |
| `AGENTIC_TOOLKIT_PORT` / `AGENTIC_TOOLKIT_HOST` | `4310` / `127.0.0.1` | Porta e interface. Mantenha em localhost: o servidor lê código-fonte. |
| `ANTHROPIC_API_KEY` | — | Para o provedor "API da Anthropic" |
| `AGENTIC_TOOLKIT_CLAUDE_BIN` | detectado | Caminho do executável do Claude Code, se não estiver no PATH |

## Repositórios privados

Na tela "Conectar", aba "Repositório Git", há três formas de acesso:

1. **Git já configurado na máquina (recomendado).** Se você consegue rodar `git clone` do repositório no terminal (chave SSH, agente SSH ou Git Credential Manager), o Agentic Toolkit usa o mesmo acesso. Nenhum segredo passa pelo app.
2. **Token somente leitura.** Ele é usado só no clone ou no fetch, viaja num header HTTP passado por variável de ambiente do git, e nunca vai para a URL, o `.git/config` ou o disco.
   - **GitHub:** fine-grained token → só o repositório → *Contents: Read-only*.
   - **GitLab:** project access token, role Reporter, escopo `read_repository`.
   - **Bitbucket:** repository access token com *Repositories: Read*.
   - **Azure DevOps:** PAT com *Code: Read*.
3. **Deploy key SSH somente leitura.** Uma chave dedicada, cadastrada no repositório sem permissão de escrita. Informe o caminho da chave privada.

O clone é superficial (`--depth 1`), fica em `~/.agentic-toolkit/techs/<tecnologia>/repos`, com `core.symlinks=false` e push desativado. "Buscar atualizações" faz só `git fetch`.

## Inteligência artificial

Em **Configurações**, escolha o provedor de "Pergunte ao código":

| Provedor | Como funciona |
|---|---|
| **Claude Code local** (padrão) | Usa a sua sessão do Claude Code. Roda dentro da instalação com `--tools Read,Grep,Glob`, `--disallowedTools Edit,Write,Bash,…`, `--setting-sources user` e `--strict-mcp-config`, com leitura do mapa via `--add-dir` (só o diretório de dados). |
| **API da Anthropic** | `claude-opus-5-5`, num loop com ferramentas próprias que só leem: `list_dir`, `read_file`, `grep` e `search_map`. A chave fica só em memória (ou em `ANTHROPIC_API_KEY`). |
| **Modelo local / compatível com OpenAI** | Ollama, LM Studio, vLLM… com as mesmas ferramentas. O modelo precisa suportar tool calling. |

### Tarefas do Refinamento no "Pergunte ao código"

A conversa conhece as tarefas do Refinamento deste workspace:

- **Vincular**: "+ Vincular tarefa do Refinamento" acima da caixa de texto, ou o atalho "Perguntar sobre esta tarefa" no card (abre `/w/<id>/ask?card=<card>`).
- **Colar o link** do card (`…/w/<id>/refinamento/<card>`) ou citar o id (`tarefa a1b2c3d4e5`) na pergunta. A tarefa entra no contexto e fica vinculada nas próximas perguntas. Link de outro workspace é avisado, não lido.
- **Pedir para buscar** ("busque a tarefa do frete grátis"): o Claude procura no índice das tarefas e lê a que encontrar.

A tarefa vinculada vai inteira para o contexto: negócio, descrição técnica, plano (com os passos feitos), critérios de aceite, observações, passos no Business Manager, status e resumo do desenvolvimento, e os arquivos que a branch mudou. Com o Claude Code, o **worktree** da tarefa também fica liberado para leitura, porque é lá que está o código desenvolvido. O índice e os arquivos das tarefas ficam em `~/.agentic-toolkit/.../ask-context/`, nunca no projeto. A conversa também leva as últimas 6 perguntas e respostas, para perguntas de seguimento ("e para os outros idiomas?").

### Skills do Claude

Toda funcionalidade que roda o Claude Code recebe **skills** do Agentic Toolkit, de acordo com a tecnologia do workspace: Pergunte ao código, Refinamento, Desenvolvimento por tarefa, OpenSpec, Diagramas e Documentação. Uma skill é um `SKILL.md` com o conhecimento de como fazer bem aquele tipo de trabalho. Elas ficam em `apps/api/skills/<id>/SKILL.md`, e o catálogo (que liga cada skill às tecnologias e funcionalidades) fica em `apps/api/src/skills/catalog.ts`.

| Grupo | Skills |
|---|---|
| Comuns | investigação do código, refinamento de demandas, entrega de tarefas, escrita OpenSpec, arquitetura C4, diagramas Mermaid, documentação técnica |
| Adobe Commerce | módulos, plugins/observers/DI, dados (schema, patches, EAV), frontend (layout, templates, JS), APIs e integrações, admin/configuração/ACL, cron/filas/indexers, carrinho/checkout/pedido, qualidade e testes, arquitetura da loja |
| Salesforce B2C | controllers SFRA, cartuchos e módulos, hooks/carrinho/pedido, ISML/textos/assets, metadata e Business Manager, serviços e integrações, jobs, qualidade e testes, deploy e upload, arquitetura da loja |

- **Feature flags.** Em **Configurações → Skills do Claude** dá para desligar todas ou cada uma, ver o `SKILL.md` e os usos recentes. Uma skill desligada não chega a nenhuma sessão.
- **Como chegam ao Claude.** As skills ligadas daquela funcionalidade e tecnologia viram um plugin montado em `~/.agentic-toolkit/skills-runtime/` e passado com `--plugin-dir`. A sessão ganha a ferramenta `Skill` e a lista das skills no system prompt. Nada é escrito no projeto.
- **Relato de uso.** Quando o Claude carrega uma skill, a tela mostra `⏺ Skill(agentic-toolkit:nome)`, como no Claude Code: no chat e no card do refinamento, no painel de desenvolvimento, no Pergunte ao código, no chat do OpenSpec e no log dos diagramas e da documentação.
- As sessões continuam com `--setting-sources user` (para usar o modelo que você escolheu no Claude Code), então os seus plugins pessoais também ficam disponíveis. O system prompt orienta o Claude a preferir as skills do Agentic Toolkit.
- As skills valem para o Claude Code. Os provedores "API da Anthropic" e "modelo local" do Pergunte ao código não as usam.

## Compartilhando com o time

Cada engenheiro roda o Agentic Toolkit na própria máquina e conecta o projeto em que trabalha. Nada é enviado para fora, exceto as perguntas à IA para o provedor escolhido. Para levar a análise de um colega:
- copie a pasta `~/.agentic-toolkit/workspaces/<id>/maps` dele;
- ou rode `/magento-map` de novo.

As anotações nunca devem ir para o git do Agentic Toolkit: contêm detalhes do código do cliente.

## Arquitetura

```
apps/api            NestJS: workspaces, análise, visão geral, arquivos, IA, refinamento, git, ações e auditoria
  src/readonly      path-guard, ReadOnlyFs, CommandRunner (allowlist), ações + guarda global, auditoria
apps/web            React + Vite: dashboard (src/shell) e o fluxo 3D / debug (React Three Fiber)
packages/analyzer   extrator estático (webapi.xml, di.xml, events.xml, routes.xml, crontab.xml…) e referência do core
.claude/skills      /magento-map: análise das customizações pelo Claude
```

Como o debug calcula a ordem de execução sem a loja rodando:
- **Plugins:** o mesmo algoritmo do `PluginListGenerator`/`Interceptor` do framework. Sem `sortOrder` = `PHP_INT_MIN`; o `around` abre um novo nível.
- **Observers:** escopo global e depois a área, na ordem de `app/etc/config.php`.
- **Base:** um roteiro nativo conferido no código do core 2.4 (`apps/web/src/debug/scenario.ts`).

Para listar o que é nativo mesmo sem `vendor/`, o Agentic Toolkit baixa da tag pública `magento/magento2` correspondente só os XMLs e as classes de plugin.

**Limites:** é análise estática. Ficam de fora:
- eventos disparados dentro de código customizado;
- chamadas do JavaScript do tema;
- configurações que estão no banco.

Os módulos exclusivos do Adobe Commerce e o MSI não estão na referência pública do core.

## Desenvolvimento

```bash
npm run dev     # API (watch) + web (Vite)
npm test        # testes das ações, do git, do refinamento e do detector Magento
npm run build   # build de produção (API + web)
```

Novas funcionalidades entram no menu lateral em `apps/web/src/shell/Layout.tsx` e declaram seus pré-requisitos em `apps/web/src/shell/prereqs.tsx`. Toda rota nova da API precisa declarar uma ação em `apps/api/src/readonly/actions.ts`; sem isso, ela é bloqueada.
