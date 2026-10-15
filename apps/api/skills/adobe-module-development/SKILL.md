---
name: adobe-module-development
description: Use ao criar ou alterar um módulo Adobe Commerce / Magento 2 (app/code ou pacote composer). Cobre estrutura de pastas, registration.php, module.xml e sequence, nomes, onde cada tipo de código vive e como o módulo entra no ar.
---

# Módulos Adobe Commerce (Magento 2)

## Estrutura mínima

```
app/code/Vendor/Modulo/
  registration.php
  etc/module.xml
  composer.json            (se o projeto empacota módulos por composer)
```

```php
<?php
use Magento\Framework\Component\ComponentRegistrar;
ComponentRegistrar::register(ComponentRegistrar::MODULE, 'Vendor_Modulo', __DIR__);
```

```xml
<config xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="urn:magento:framework:Module/etc/module.xsd">
    <module name="Vendor_Modulo">
        <sequence>
            <module name="Magento_Checkout"/>
        </sequence>
    </module>
</config>
```

- **`sequence`** lista os módulos cuja configuração precisa ser carregada antes da sua. É ela que garante, por exemplo, que o seu layout ou o seu `di.xml` sobrescreva o do módulo nativo.
- **Onde fica o código**: o projeto mantém o código próprio em `app/code/<Vendor>/` ou em pacotes do repositório. Siga o vendor e o padrão já usados no projeto; nunca crie código em `vendor/`.

## Onde cada coisa vive

| Pasta | Conteúdo |
|---|---|
| `Api/` e `Api/Data/` | Interfaces de service contract e de dados |
| `Model/` | Implementações, ResourceModel, Collections |
| `Controller/<Area>/` | Actions (`execute()`), com `HttpGetActionInterface`/`HttpPostActionInterface` |
| `Block/`, `ViewModel/` | Lógica de apresentação (prefira ViewModel a Block novo) |
| `Plugin/`, `Observer/` | Extensões de comportamento |
| `Setup/Patch/Data`, `Setup/Patch/Schema` | Patches |
| `etc/` | `di.xml`, `events.xml`, `routes.xml`, `webapi.xml`, `crontab.xml`, `acl.xml`, `system.xml`, `config.xml`, `db_schema.xml` |
| `etc/frontend`, `etc/adminhtml` | Configuração por área |
| `view/<area>/layout`, `templates`, `web` | Layout XML, `.phtml`, JS e CSS |
| `i18n/pt_BR.csv` | Traduções |

## Padrões

- `declare(strict_types=1);` e tipos em parâmetros e retornos, seguindo o que o projeto já faz.
- Dependências por construtor (DI). Nunca use `ObjectManager::getInstance()` em código novo.
- Use as interfaces de `Api/` dos módulos nativos (repositories, management) em vez de models e resource models diretamente.
- Textos com `__('Texto')` e tradução em `i18n/pt_BR.csv`.

## Colocar no ar (em desenvolvimento)

`bin/magento module:enable Vendor_Modulo`, `bin/magento setup:upgrade`, `bin/magento setup:di:compile` (em modo produção ou para validar DI) e `bin/magento cache:flush`. Diga quais desses o card exige; em produção isso faz parte do deploy.
