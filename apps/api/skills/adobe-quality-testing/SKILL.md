---
name: adobe-quality-testing
description: Use ao verificar, testar ou revisar código Adobe Commerce / Magento 2 - php -l, PHP_CodeSniffer com o padrão Magento2, PHPUnit (unitário e integração), setup:di:compile, segurança (escape, CSRF, ACL, SQL) e performance (cache, collections, loops).
---

# Qualidade no Adobe Commerce

## Verificar o que você mudou

Rode só o que existe no projeto e cabe no ambiente:

1. `php -l <arquivo>` em cada PHP alterado.
2. `vendor/bin/phpcs --standard=Magento2 <arquivos>` se o padrão estiver instalado (`magento/magento-coding-standard`).
3. `vendor/bin/phpunit -c dev/tests/unit/phpunit.xml.dist <pasta do teste>` para os testes unitários do módulo.
4. `bin/magento setup:di:compile` quando mexeu em construtores, plugins ou `di.xml` (pega dependência errada e plugin inválido). Exige banco e ambiente: se não houver, registre como pendente.

## Teste unitário

- Fica em `Test/Unit/` do módulo, espelhando o namespace.
- Mocke dependências com `$this->createMock(Interface::class)`, e teste a regra, não o framework.
- Um teste por comportamento do critério de aceite: limite exato, abaixo, acima, vazio.

## Segurança

- Escape toda saída em template (`escapeHtml`, `escapeHtmlAttr`, `escapeUrl`, `escapeJs`).
- POST de formulário: controller com `HttpPostActionInterface` e validação de form key (nativa) ou `CsrfAwareActionInterface` com justificativa.
- Admin: `ADMIN_RESOURCE` e ACL. API: recurso de ACL correto, nunca `anonymous` para dado privado.
- SQL: nada concatenado. Use bind, SearchCriteria ou os métodos do `AdapterInterface`.
- Nada de segredo no código ou no git: credencial vai em configuração criptografada ou em `env.php` (que você não lê).

## Performance

- Nada de `load()` dentro de loop. Use collection com `addFieldToFilter`, `setPageSize` e só os campos necessários.
- Respeite o cache de página: dado por cliente vai por customer-data/AJAX.
- Chamada externa no request só com timeout curto e cache.
- Plugins `around` em métodos muito chamados (preço, estoque) custam caro. Prefira `after`.

## Revisão final

Releia o diff procurando `var_dump`, `print_r`, `die`, `ObjectManager::getInstance`, textos sem `__()`, `cacheable="false"` em layout e arquivos fora do módulo.
