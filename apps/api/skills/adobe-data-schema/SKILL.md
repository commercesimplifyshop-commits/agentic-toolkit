---
name: adobe-data-schema
description: Use ao criar ou alterar dados persistidos no Adobe Commerce / Magento 2 - tabelas com declarative schema (db_schema.xml e whitelist), data e schema patches, atributos EAV (produto, cliente, categoria), extension attributes, models, resource models, collections e repositories.
---

# Dados no Adobe Commerce

## Tabela nova ou coluna: declarative schema

```xml
<!-- etc/db_schema.xml -->
<schema xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="urn:magento:framework:Setup/Declaration/Schema/etc/schema.xsd">
    <table name="vendor_modulo_registro" resource="default" engine="innodb" comment="Registros">
        <column xsi:type="int" name="entity_id" unsigned="true" nullable="false" identity="true"/>
        <column xsi:type="varchar" name="codigo" length="64" nullable="false"/>
        <column xsi:type="timestamp" name="created_at" default="CURRENT_TIMESTAMP" on_update="false"/>
        <constraint xsi:type="primary" referenceId="PRIMARY"><column name="entity_id"/></constraint>
        <constraint xsi:type="unique" referenceId="VENDOR_MODULO_REGISTRO_CODIGO"><column name="codigo"/></constraint>
    </table>
</schema>
```

- Gere a whitelist com `bin/magento setup:db-declaration:generate-whitelist --module-name=Vendor_Modulo` e versione `etc/db_schema_whitelist.json`.
- Coluna em tabela nativa: declare só a coluna nova num `db_schema.xml` do seu módulo com o mesmo `name` da tabela.
- Nunca altere o banco por SQL solto nem com `InstallSchema`/`UpgradeSchema` (legado).

## Dados: data patch

`Setup/Patch/Data/NomeDoPatch.php` implementando `DataPatchInterface` (`apply()`, `getDependencies()`, `getAliases()`). Roda uma vez por ambiente em `setup:upgrade`. Use para criar atributos EAV, configurações padrão, blocos CMS e dados de referência. Implemente `PatchRevertableInterface` quando fizer sentido desfazer.

## Atributos EAV

Crie com `EavSetupFactory` (produto, categoria) ou `CustomerSetupFactory` (cliente) dentro de um data patch. Defina `type`, `input`, `label`, `global` (escopo), `visible_on_front`, `used_in_product_listing` e o `group`. Atributo de cliente usado em formulário também precisa entrar em `used_in_forms`.

## Extension attributes

Para pendurar dados em entidades de service contract (pedido, item de carrinho, cliente) e expô-los na API: `etc/extension_attributes.xml`, mais um plugin no repository (`afterGet`, `afterGetList`, `afterSave`) que carrega e salva o dado na sua tabela.

## Camada de acesso

- **Model** (`AbstractModel`) + **ResourceModel** (`AbstractDb`, com tabela e chave) + **Collection** (`AbstractCollection`).
- Exponha por **repository** (`Api/XRepositoryInterface` com `getById`, `save`, `delete`, `getList(SearchCriteriaInterface)`) quando outros módulos ou a API usarem o dado.
- Filtre listas com `SearchCriteriaBuilder` e nunca carregue collections inteiras sem filtro e paginação.

## Cuidados

Diga no card: volume esperado, índices necessários, o que acontece com registros que já existem, e se a mudança exige reindexação ou limpeza de cache.
