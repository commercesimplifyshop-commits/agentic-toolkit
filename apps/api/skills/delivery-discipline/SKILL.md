---
name: delivery-discipline
description: Use ao implementar uma tarefa já refinada no worktree. Cobre como seguir o plano passo a passo, manter o diff pequeno, verificar o que mudou, fazer o commit e escrever o resumo final da entrega.
---

# Entregar uma tarefa refinada

## Antes de editar

- Leia a descrição técnica e o plano inteiros. Leia os arquivos que vão mudar e os vizinhos (quem chama, quem estende).
- Confirme a branch e o worktree com `git status` e `git branch --show-current`. Trabalhe só neles.
- Se a descrição técnica contradiz o código (o arquivo não existe, o método tem outra assinatura), ajuste o mínimo para cumprir a intenção e registre a divergência no resumo. Não reescreva a solução.

## Durante

- Execute o plano na ordem. Ao concluir cada passo, escreva a linha de progresso no formato pedido (`PROGRESSO: n/total - nome`).
- Diff pequeno e focado: não reformate arquivos inteiros, não renomeie o que não precisa, não "aproveite para melhorar" fora do escopo.
- Siga o estilo do arquivo que você está editando: indentação, aspas, nomes, comentários.
- Nunca edite código de terceiros, do core ou da base (`vendor/`, `app_storefront_base`, `int_*`, `plugin_*`). Estenda.
- Nunca abra, copie ou altere arquivos de credenciais.

## Verificação

- Rode as verificações que o projeto tem para o que você mudou: sintaxe, lint, testes unitários. Se as dependências não estão instaladas, não instale: registre como pendente.
- Releia o diff (`git diff`) antes do commit procurando código de debug, arquivos que não deveriam estar ali, segredos e textos sem tradução.

## Commit e resumo

- Um commit com tudo da tarefa, na branch da tarefa, com a mensagem pedida. Sem push.
- Resumo final em Markdown, com estas seções:
  - **O que foi feito.**
  - **Arquivos alterados**, um por linha, com o porquê.
  - **Como testar**, em passos que alguém sem contexto consegue seguir.
  - **Configuração manual** no admin ou no Business Manager, se houver.
  - **Pendências e riscos.**
