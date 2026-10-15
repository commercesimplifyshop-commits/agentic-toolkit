---
name: adobe-admin-config
description: Use ao criar configurações e telas no admin do Adobe Commerce / Magento 2 - system.xml e config.xml (com escopos), acl.xml, menu.xml, rotas e controllers de admin, grids e formulários com UI components.
---

# Configuração e admin no Adobe Commerce

## Configuração (Lojas → Configuração)

```xml
<!-- etc/adminhtml/system.xml -->
<section id="vendor_modulo" translate="label" sortOrder="300" showInDefault="1" showInWebsite="1" showInStore="1">
    <label>Frete grátis</label>
    <tab>sales</tab>
    <resource>Vendor_Modulo::config</resource>
    <group id="geral" translate="label" showInDefault="1" showInWebsite="1">
        <label>Geral</label>
        <field id="valor_minimo" translate="label" type="text" showInDefault="1" showInWebsite="1">
            <label>Valor mínimo</label>
            <validate>validate-number validate-zero-or-greater</validate>
        </field>
    </group>
</section>
```

- Valor padrão em `etc/config.xml` (`<default><vendor_modulo><geral><valor_minimo>299</valor_minimo>...`).
- Leia com `ScopeConfigInterface::getValue('vendor_modulo/geral/valor_minimo', ScopeInterface::SCOPE_WEBSITE)`, encapsulado numa classe `Model/Config`.
- Escolha o escopo pelo negócio: um valor por website (moeda, frete) ou por store view (texto, idioma).
- Valor sensível: `type="obscure"` + backend model `Encrypted`.
- Antes de criar configuração, confira se já existe uma nativa. Para frete grátis, por exemplo, há o método Free Shipping e as regras de carrinho.

## ACL e menu

`etc/acl.xml` define os recursos (`Vendor_Modulo::config`, `Vendor_Modulo::registros`). `etc/adminhtml/menu.xml` adiciona o item com `resource`. Controllers de admin estendem `Magento\Backend\App\Action` e declaram `const ADMIN_RESOURCE`.

## Grids e formulários

- Use UI components: `view/adminhtml/ui_component/vendor_modulo_registro_listing.xml` e `..._form.xml`.
- O data provider estende `Magento\Ui\DataProvider\AbstractDataProvider` (formulário) ou usa a collection via `di.xml` (grid).
- Ações de massa e de linha, filtros e colunas vão no XML do listing.
- Rotas de admin em `etc/adminhtml/routes.xml` (`<router id="admin">`).

## No card

Liste o caminho completo no admin, o escopo, o valor padrão, quem pode alterar (o recurso de ACL) e se mudar o valor exige limpar cache (`config` e `full_page`).
