---
name: integration-discovery
description: Use para descobrir no código as integrações de uma loja Adobe Commerce ou Salesforce B2C com sistemas externos (ERP, OMS, PIM, pagamento, frete, antifraude, marketing, CRM) e classificar cada uma por direção, gatilho, protocolo e uso real. Serve para desenhar arquitetura, documentar integrações e responder "com quem a loja conversa".
---

# Descobrir as integrações no código

O mapeamento automático vê rotas, APIs, crons, filas, hooks e serviços declarados. Ele **não** vê para onde o código liga, com que frequência nem quem chama. Esse é o seu trabalho aqui.

## Onde procurar

### Adobe Commerce

| O que procurar (Grep) | Indica |
|---|---|
| `GuzzleHttp\\Client`, `Magento\\Framework\\HTTP\\Client\\Curl`, `curl_init`, `ZendClient`, `LaminasClient` | Chamada HTTP de saída |
| `SoapClient` | SOAP |
| `ftp_connect`, `ssh2_sftp`, `phpseclib`, `League\\Flysystem` | Arquivos por FTP/SFTP/S3 |
| `PublisherInterface`, `->publish(` + `queue_*.xml` | Fila (assíncrono) |
| `webapi.xml` com rotas do projeto, controllers `Webhook`/`Callback`/`Notify` | Entrada vinda de fora |
| `system.xml` com campos `api_url`, `endpoint`, `token`, `client_id` | Configuração de integração (o nome do sistema costuma estar no label) |
| `crontab.xml` + classe que chama um client | Integração agendada |

### Salesforce B2C

| O que procurar (Grep) | Indica |
|---|---|
| `LocalServiceRegistry.createService('id'` | Serviço externo. O id costuma dizer o sistema |
| Quem faz `require` do script que cria o serviço | De onde ele é chamado: controller (síncrono), job (agendado) ou hook |
| `steptypes.json` + `jobs.xml` | Integração agendada e a frequência |
| Controllers `*Notify*`, `*Webhook*`, `*Callback*` em cartuchos `int_*` | Entrada vinda de fora |
| `dw.ocapi.*` em `hooks.json` | Extensão das APIs da plataforma |
| `dw/net/SFTPClient`, `dw/net/FTPClient`, `dw/io/File` com IMPEX | Troca de arquivos (catálogo, estoque, preço, pedidos) |

## Para cada integração encontrada, registre

1. **Sistema e papel**: "ERP SAP: recebe pedidos". O nome vem do id do serviço, da classe, da URL de configuração ou de comentários.
2. **Direção**: a loja chama (saída) ou é chamada (entrada). Webhooks são entrada.
3. **Gatilho**: no request do cliente (síncrono), job/cron (agendado), fila ou evento (observer/hook).
4. **Protocolo e formato**: REST/JSON, SOAP/XML, SFTP/CSV, arquivo IMPEX.
5. **Quem faz**: o módulo ou cartucho, com `caminho:linha`.
6. **Uso real**: se nada chama o client ou o serviço, a integração está "definida, sem chamada no código". Diga isso; não desenhe como se estivesse ativa.

## Cuidados

- Não invente sistemas. Se o código só mostra um `api_url` genérico, chame de "Sistema externo (configurado em …)".
- Nunca abra nem cite credenciais (`env.php`, `dw.json`, valores de tokens). O nome do campo basta.
- A mesma integração costuma ter ida e volta (pedido enviado por job, status recebido por webhook): registre as duas, cada uma com o seu gatilho.
