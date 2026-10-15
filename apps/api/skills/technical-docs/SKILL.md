---
name: technical-docs
description: Use ao escrever documentação técnica de um projeto (visão geral, módulo ou cartucho, fluxo, integração, onboarding, runbook). Cobre estrutura, público, nível de detalhe, exemplos e o que nunca incluir.
---

# Documentação técnica que alguém consegue usar

## Antes de escrever

- **Quem lê, e para fazer o quê?** Dev novo no time (entender e mudar), suporte (diagnosticar), negócio (saber o que existe). Escreva para esse leitor.
- **Leia o código** que sustenta cada afirmação. Documentação errada é pior que nenhuma.

## Estrutura padrão

1. **Resumo** em 3 a 5 linhas: o que é, para que serve, onde vive no código.
2. **Como funciona**: o fluxo principal em passos numerados, do gatilho ao resultado. Use um diagrama Mermaid quando houver mais de 3 participantes.
3. **Onde está no código**: tabela com o caminho real do arquivo, o papel dele e observações.
4. **Configuração**: o que é configurável e onde (admin, Business Manager, variáveis de ambiente), com valores padrão e o efeito de cada um.
5. **Integrações**: sistema, direção, protocolo, frequência, autenticação (sem segredos) e o que acontece quando falha.
6. **Como testar e diagnosticar**: passos de teste, logs relevantes, erros comuns e o que fazer em cada um.
7. **Riscos e limitações** conhecidos.

## Estilo

- Frases curtas, voz ativa, termos do próprio código.
- Caminhos e nomes em `código`. Comandos em blocos copiáveis.
- Um assunto por seção, com títulos que dizem o conteúdo ("Como o frete é calculado", não "Detalhes").
- Diga o que não foi possível verificar pelo código.

## Nunca inclua

- Senhas, tokens, chaves, hosts internos com credenciais, nem valores de `env.php`, `auth.json`, `.env` ou `dw.json`.
- Dados pessoais de clientes ou pedidos reais.
- Arquivos inteiros de código. Cite só o trecho relevante.
