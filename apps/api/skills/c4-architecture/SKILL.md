---
name: c4-architecture
description: Use ao desenhar ou descrever arquitetura com o modelo C4 (contexto, containers, componentes), ao escolher o nível de detalhe de um diagrama ou ao nomear sistemas, containers, relações e fronteiras.
---

# Modelar arquitetura com C4

## Escolha o nível

| Nível | Pergunta que responde | Elementos |
|---|---|---|
| Contexto (C1) | Quem usa o sistema e com quais sistemas ele conversa? | Pessoas, o sistema (uma caixa), sistemas externos |
| Containers (C2) | Quais aplicações e bancos compõem o sistema? | Storefront, admin/Business Manager, APIs, bancos, filas, busca, CDN, jobs |
| Componentes (C3) | Como um container é organizado por dentro? | Módulos ou cartuchos, serviços, controllers, integrações |

Um diagrama, um nível. Para mostrar dois níveis, faça dois diagramas.

## Regras

- **Todo elemento tem nome, tipo e uma frase de responsabilidade.** Containers e componentes também levam a tecnologia: "PHP 8.3 / Magento 2.4.7", "SFRA / cartucho app_custom", "MySQL 8", "RabbitMQ".
- **Toda relação tem verbo e protocolo**: "envia pedidos [REST/JSON, assíncrono]", "consulta estoque [SOAP]". A seta aponta no sentido de quem inicia a chamada.
- **Fronteiras** agrupam o que pertence ao mesmo sistema ou time: o e-commerce, o ERP do cliente, a plataforma SaaS.
- **Nomes reais** do projeto (módulo, cartucho, serviço, fila) quando o código mostra. Use nomes genéricos só quando não houver.
- **De 5 a 20 elementos.** Passou disso, divida.

## Erros comuns

- Misturar classes (o nível 4 do C4) num diagrama de containers.
- Setas sem rótulo, ou bidirecionais "porque os dois conversam".
- Não deixar claro o que é assíncrono (filas, jobs, webhooks) e o que é síncrono.
- Desenhar o sistema "ideal" em vez do que o código mostra. Se o desenho for uma proposta, diga isso no título.
