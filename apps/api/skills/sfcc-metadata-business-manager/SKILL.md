---
name: sfcc-metadata-business-manager
description: Use quando uma solução Salesforce B2C precisar de dados ou configuração fora do código - atributos customizados de system objects, site preferences, custom objects, metadata XML do site import, e os passos no Business Manager com o caminho exato de cada tela.
---

# Metadata e Business Manager no SFCC

No SFCC boa parte da solução é configuração. Ela entra no repositório como **site import** (XML) e/ou como **passos no Business Manager** que precisam estar no card.

## Onde fica no repositório

Estrutura comum (confira a do projeto):

```
sites/site_template/
  meta/system-objecttype-extensions.xml     Atributos customizados e site preferences
  meta/custom-objecttype-definitions.xml    Custom objects
  services.xml                              Serviços, profiles e credentials (sem senha)
  jobs.xml                                  Jobs e agendamentos
  sites/<SiteID>/preferences.xml            Valores de site preferences
  sites/<SiteID>/site.xml                   Configuração do site (cartridge path)
```

Importação: Business Manager → Administration → Site Development → Site Import & Export (zip da pasta), ou pela CLI do time.

## Atributo customizado

```xml
<type-extension type-id="Product">
    <custom-attribute-definitions>
        <attribute-definition attribute-id="freteGratisElegivel">
            <display-name xml:lang="x-default">Elegível a frete grátis</display-name>
            <type>boolean</type>
            <mandatory-flag>false</mandatory-flag>
        </attribute-definition>
    </custom-attribute-definitions>
    <group-definitions>
        <attribute-group group-id="frete">
            <display-name xml:lang="x-default">Frete</display-name>
            <attribute attribute-id="freteGratisElegivel"/>
        </attribute-group>
    </group-definitions>
</type-extension>
```

- No código: `product.custom.freteGratisElegivel`. Escrever exige `Transaction.wrap`.
- Sem `attribute-group`, o atributo não aparece nas telas do Business Manager.
- Atributo de produto usado em busca ou filtro precisa também da configuração de search (Searchable Attributes) e de reindexação.

## Site preference (o "system.xml" do SFCC)

É um atributo em `type-id="SitePreferences"`, num grupo. O valor por site fica em `preferences.xml` ou em Merchant Tools → Site Preferences → Custom Preferences → <grupo>.

No código: `require('dw/system/Site').getCurrent().getCustomPreferenceValue('lojaParcelasMax')`. Trate `null` com um padrão.

## Custom object (tabela própria)

Definição em `custom-objecttype-definitions.xml` (chave, atributos, escopo site/organização, `retention-days` se for temporário). Uso:
- `CustomObjectMgr.createCustomObject('Tipo', chave)` dentro de transação;
- `getCustomObject`, `queryCustomObjects`;
- apague o que não precisa mais (quota de objetos).

## Passos no Business Manager (formato do card)

Um passo por item, com o caminho completo, por exemplo:
- Merchant Tools → Site Preferences → Custom Preferences → Frete: definir "Valor mínimo" = 299.
- Administration → Sites → Manage Sites → RefArch → Settings: incluir `app_projeto` no início do cartridge path.
- Administration → Operations → Services: conferir a credential `erp.http.cred` (senha cadastrada pelo time, nunca no git).

Diga também em quais instâncias fazer (sandbox, development, staging) e o que é replicado de staging para production (dados de site e catálogo são replicados; configuração de Administration geralmente não).
