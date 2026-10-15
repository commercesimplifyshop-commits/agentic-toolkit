---
name: reference-architecture
description: Use sempre que desenhar ou atualizar a arquitetura de uma loja (Adobe Commerce ou Salesforce B2C) na Arquitetura viva ou num diagrama de arquitetura da plataforma. Define o formato de arquitetura de referência, em camadas, com os ids de grupo, o que entra em cada camada, como conectar e o que nunca desenhar.
---

# Arquitetura de referência de uma loja

A Arquitetura viva desenha a plataforma no formato dos diagramas de referência da Adobe e da Salesforce: camadas empilhadas de cima para baixo, sistemas externos nas laterais, caixas pequenas e conexões entre camadas. A tela posiciona tudo sozinha a partir dos ids abaixo. Por isso, use exatamente esses ids e não mande posições (x, y).

Siga estas regras em todo desenho novo e em toda atualização depois de uma nova análise. Uma atualização mantém o formato e muda só o conteúdo.

## Camadas e ids

| Onde | id | Tipo | O que entra |
|---|---|---|---|
| Topo | (sem grupo) | `person` | Cliente, Equipe da loja e, quando o código mostra, Comprador B2B e Lojista do marketplace. Sistemas que só chamam as APIs também ficam aqui, como `external` sem grupo. |
| Entrada | `c_cdn` | `container`, sem grupo | CDN ou cache de página: Fastly, Varnish ou eCDN. |
| 1ª camada | `b_store` | `boundary` | Storefront. Título: "Storefront · tema X" ou "Storefront · SFRA" / "Storefront · PWA Kit". Caixas: Home e navegação, Catálogo e busca, Página de produto, Carrinho, Checkout, Conta do cliente, Conta empresa (B2B). |
| 2ª camada | `b_api` | `boundary` | APIs e processamento: API REST, GraphQL, SCAPI / OCAPI, Webhooks de entrada, Crons, Consumers de fila, Jobs, Adobe I/O Events. |
| 3ª camada | `b_core` | `boundary` | A plataforma. Título: "Adobe Commerce 2.4.x" ou "Salesforce B2C Commerce". Caixas: os domínios (Catálogo, Carrinho e checkout, Pedidos, Clientes, Pagamentos, Preços e promoções, Estoque, Entrega, Conteúdo, B2B) e os serviços SaaS do fabricante, com tech `SaaS Adobe` ou `SaaS Salesforce`. Por último, o Admin (`c_admin`) ou o Business Manager (`c_bm`): fazem parte da plataforma, nunca ficam soltos. |
| 4ª camada | `b_infra` | `boundary` | Infraestrutura (só no Adobe Commerce): Banco de dados, Busca, Filas, Cache e sessão, Mídia. No Salesforce B2C a infraestrutura é da plataforma: omita esta camada. |
| Lateral esquerda | `b_cliente` | `boundary` | Sistemas do cliente: ERP, OMS, PIM, nota fiscal, integrações próprias. Tipo `external`. |
| Lateral direita | `b_saas` | `boundary` | SaaS e parceiros: pagamento, frete, antifraude, busca, marketing, atendimento, avaliações. Tipo `external`. |

Uma camada vazia não entra no desenho. Não crie grupos fora desta lista. Um grupo dentro de outro não aparece.

## Caixas

- **Título:** curto, de 1 a 4 palavras. Use o nome real do sistema (SAP, Adyen, Braspag), nunca "Sistema externo".
- **`tech`:** um dado só, a contagem ou a tecnologia: "38 customizações", "1 rota do projeto", "24 crons do projeto", "OpenSearch 2", "Pagamento". Num domínio sem customizações, `nativo`.
- **`description`:** fica para a evidência (módulos, cartuchos, serviços, arquivos). Ela aparece ao clicar e não no desenho.
- **Externos:** o `tech` é a categoria (ERP, Pagamento, Frete, Antifraude, Busca, Marketing e CRM…).

## Conexões

- **Entre camadas:** ligue os grupos inteiros, não caixa a caixa: `c_cdn → b_store`, `b_store → b_core`, `b_api → b_core`, `b_core → b_infra`.
- **Personas:** cada persona liga ao que acessa: o cliente à `c_cdn` (ou ao `b_store`), a equipe direto à caixa `c_admin`/`c_bm` dentro de `b_core`, quem chama as APIs ao `b_api`.
- **Sistemas externos:** ligam à caixa que os dispara, porque a direção e o gatilho são a informação principal:
  - o checkout chama o pagamento, o frete e o antifraude;
  - os crons e jobs sincronizam com o ERP (tracejado);
  - o ERP chama a API REST da loja;
  - o gateway notifica os webhooks de entrada (tracejado).
- **Rótulo:** um verbo curto ("Autoriza o pagamento", "Sincroniza", "Notifica"), com o protocolo em `tech` (HTTPS, REST, SOAP, SFTP, cron / fila, webhook).
- **Integração sem chamada no código:** diga isso no rótulo, por exemplo "definida, sem chamada".
- **Assíncrono:** conexões assíncronas (fila, cron, job, webhook) vão tracejadas (`dashed: true`).

## Nunca desenhe

- **Peças de código:** módulos, cartuchos, plugins, observers, preferences, controllers, classes, arquivos ou nomes de serviço como `erp.http.pedidos`. Eles são a evidência para descobrir, nomear e ligar as caixas, e cabem só na `description`.
- **Integrações não confirmadas:** extensões que vêm com o Magento (Klarna, Braintree, Vertex, Yotpo, Dotdigital, Amazon Pay) só entram como integração se o código do projeto as usa.
- **Sistemas duplicados:** dois módulos que falam com o mesmo sistema viram uma caixa só. Integrações próprias sem nome conhecido são agrupadas por assunto ("Integração de estoque").

## Antes de entregar

- Todo elemento está numa das camadas acima ou é persona ou entrada.
- Nenhuma caixa é um módulo ou cartucho.
- Toda integração externa tem ao menos uma conexão, com direção, gatilho e protocolo.
- O JSON segue a skill "Desenho no canvas do toolkit" (`family: "c4"`, ids únicos, `parent` apontando para um `boundary`).
