---
name: sfcc-deploy-upload
description: Use ao planejar ou explicar como o código chega a uma instância Salesforce B2C - dw.json, code versions, upload com dwupload/sgmf-scripts (npm run uploadCartridge e npm run watch), ativação da versão, cartridge path, site import e replicação entre instâncias.
---

# Do código à instância no SFCC

## Conceitos

- **Instâncias**: sandboxes (por dev), e no grupo principal development, staging e production. O código sobe para sandbox, development ou staging. Production recebe por **replicação** a partir de staging.
- **Code version**: uma pasta de código na instância (`version_dev`, `2026-10-15_release`). Só a versão **ativa** roda. Ativação: Administration → Site Development → Code Deployment.
- **Não há build no servidor.** O que você envia é o que roda, inclusive o `static/` compilado do cliente.

## Sandbox no dia a dia

- `dw.json` na raiz do projeto (fora do git) com `hostname`, `username`, `password` (access key do WebDAV) e `code-version`.
- `npm run uploadCartridge` (`sgmf-scripts --uploadCartridge`) envia cartuchos inteiros: zipa, envia por WebDAV para a code version e descompacta.
- `npm run watch` (`sgmf-scripts --watch`) compila JS/SCSS e envia cada arquivo salvo.
- `dwupload --cartridge <nome>` / `dwupload watch --cartridge <nome>` é a ferramenta por baixo dos dois.
- No Agentic Toolkit, a tela **Instância → Upload para a instância** faz o envio e o upload automático a partir do projeto ou do worktree da tarefa.

## Ordem de uma entrega

1. Compilar o client, se mudou (`npm run compile:js`, `compile:scss`).
2. Enviar os cartuchos alterados para a code version.
3. Importar o metadata novo (site import) se houver atributos, preferences, serviços ou jobs.
4. Configurar no Business Manager o que não é importado (valores, credenciais, cartridge path).
5. Ativar a code version, se não for a ativa.
6. Testar. Em staging: replicar para production (code e data replication) no horário combinado.

## CI/CD

Pipelines costumam usar `sfcc-ci` ou `b2c-tools` com um API client do Account Manager: `code:deploy` (zip da versão) e `code:activate`. Usuário e senha pessoais não vão para o CI.

## No card

Diga quais cartuchos sobem, se há site import, os passos no Business Manager, a ordem e o que precisa ser replicado. Upload e ativação nunca são feitos pelo desenvolvimento automático: são uma ação separada, com confirmação.
