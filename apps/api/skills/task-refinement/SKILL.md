---
name: task-refinement
description: Use ao refinar uma demanda crua (ticket, pedido do cliente, print) em uma tarefa de desenvolvimento, ao escrever o card refinado, critérios de aceite e plano de execução, ao estimar complexidade ou ao decidir se a demanda deve ser dividida.
---

# Refinar uma demanda até virar tarefa executável

## Na conversa

1. **Reformule o problema** em uma ou duas frases de negócio: quem, o quê, por quê. Se o pedido já descreve uma solução ("criar um campo X"), descubra o problema por trás dele.
2. **Leia o código antes de perguntar.** Pergunte só o que o código e a configuração não respondem.
3. **Pergunte pouco e bem**: no máximo 3 perguntas por vez, objetivas, cada uma com as opções que você vê e a sua recomendação.
4. **Procure primeiro o caminho sem código.** Configuração nativa, promoção, regra de preço, atributo, extensão já instalada. Código é o último recurso, e você diz por que a configuração não basta.
5. **Mostre a solução** antes de escrever o card: onde muda, por que ali, o que fica de fora.

## O card refinado

- **Negócio**: contexto, problema, objetivo e quem é afetado, sem jargão técnico.
- **Técnico**: abordagem; cada arquivo que muda, com caminho real e o que muda nele; dados e configuração; decisões tomadas e alternativas descartadas, com o motivo; como testar.
- **Plano**: 3 a 12 passos na ordem de execução, cada um entregável e verificável sozinho. Escreva "Criar X em `caminho` que faz Y", não "Implementar a feature".
- **Critérios de aceite**: observáveis e testáveis por quem não leu o código. Use Dado/Quando/Então. Cubra o caminho feliz, os limites (valor exato do limiar, vazio, máximo) e o que não pode mudar.
- **Observações**: riscos, dependências de outras equipes, dúvidas em aberto, cuidados de deploy e de dados.

## Complexidade e divisão

- **Baixa**: um ponto de mudança, padrão conhecido, menos de meio dia.
- **Média**: vários arquivos ou camadas, ou uma configuração externa; até um dia e meio.
- **Alta**: integração nova, mudança de dados em massa, fluxo crítico (checkout, pagamento, pedido) ou incerteza técnica relevante.
- Recomende dividir quando houver entregas independentes (cada parte com valor próprio ou testável sozinha) ou quando o trabalho passar de um dia. Corte por comportamento entregável, não por camada técnica.

## Erros comuns

- Critério que repete a solução ("o plugin deve ser criado") em vez de descrever o comportamento.
- Plano com passos vagos ou fora de ordem (teste antes do código que ele testa, configuração depois do código que depende dela).
- Esquecer configuração por ambiente, tradução, cache, permissões e o que acontece com dados que já existem.
