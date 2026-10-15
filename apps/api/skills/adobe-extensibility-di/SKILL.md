---
name: adobe-extensibility-di
description: Use ao alterar o comportamento de código nativo ou de terceiros no Adobe Commerce / Magento 2 - plugins (before/after/around), preferences, observers, injeção de dependência no di.xml, virtual types, factories e proxies. Ajuda a escolher o mecanismo certo e a evitar conflitos.
---

# Estender sem editar o core

## Qual mecanismo usar

| Situação | Use | Evite |
|---|---|---|
| Mudar argumentos ou o retorno de um método público | **Plugin** `before`/`after` | Preference |
| Envolver a execução (cache, condição para pular o original) | Plugin `around`, só quando `before`/`after` não bastam | Around "por garantia" |
| Reagir a algo que aconteceu (pedido salvo, login) | **Observer** num evento existente | Plugin em `save()` |
| Trocar uma dependência de uma classe específica | Argumento no `di.xml` (`<type><arguments>`) ou **virtual type** | Preference global |
| Substituir a implementação de uma interface no projeto inteiro | **Preference**, como último recurso | Preference de classe concreta de terceiro |

Plugins não funcionam em métodos `final`, `private`, `protected`, estáticos, construtores nem em classes `final`. Nesses casos, procure um evento, uma interface ou o ponto de extensão acima.

## Plugin

```xml
<!-- etc/di.xml (ou etc/frontend/di.xml para afetar só a loja) -->
<type name="Magento\Checkout\Model\Cart">
    <plugin name="vendor_modulo_limite_carrinho" type="Vendor\Modulo\Plugin\LimiteCarrinho" sortOrder="10"/>
</type>
```

```php
class LimiteCarrinho
{
    public function afterGetItemsCount(\Magento\Checkout\Model\Cart $subject, int $result): int
    {
        return $result;
    }
}
```

- O primeiro argumento é `$subject`. No `after`, o segundo é o resultado, seguido dos argumentos originais. No `around`, o segundo é o `callable $proceed`, que precisa ser chamado (ou você justifica por que não chama).
- O nome do plugin é único globalmente: prefixe com vendor e módulo.
- Use a área certa (`etc/di.xml` global, `etc/frontend/di.xml`, `etc/adminhtml/di.xml`, `etc/webapi_rest/di.xml`).

## Observer

```xml
<!-- etc/events.xml -->
<event name="sales_order_place_after">
    <observer name="vendor_modulo_envia_erp" instance="Vendor\Modulo\Observer\EnviaErp"/>
</event>
```

O observer implementa `ObserverInterface::execute(Observer $observer)`. Mantenha-o rápido: integração lenta vai para fila ou cron, não para o request do cliente.

## DI

- Dependências pelo construtor, tipadas pela interface.
- **Factory** (`ClasseFactory`, gerada) para criar objetos não compartilhados; **Proxy** (`Classe\Proxy` no `di.xml`) para dependências caras usadas raramente.
- **Virtual type** quando precisa de uma variação de configuração de uma classe sem criar arquivo PHP.

## Conflitos

Antes de criar um plugin ou preference, procure nos `di.xml` do projeto e de `vendor/` quem já mexe na mesma classe. Duas preferences para a mesma interface: vence a do módulo carregado por último (`sequence`). Plugins: a ordem é por `sortOrder`.
