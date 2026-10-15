/**
 * What an engineer coming from Adobe Commerce needs to build on Salesforce B2C Commerce (SFRA).
 * Curated by hand: the refinement gives it to Claude, so answers map each idea from one
 * platform to the other instead of guessing, and only cite documentation listed here.
 */

export interface Equivalence {
  topic: string
  adobe: string
  sfcc: string
  /** What changes in how you think about it */
  note: string
}

export const ADOBE_TO_SFCC: Equivalence[] = [
  { topic: 'Unidade de código', adobe: 'Módulo (app/code/Vendor/Module, registration.php, module.xml)', sfcc: 'Cartucho (cartridges/<nome>/cartridge, package.json do cartucho)', note: 'Não há registro nem sequência de módulos: a ordem é o cartridge path do site, configurado no Business Manager. O primeiro cartucho do path que tem o arquivo vence.' },
  { topic: 'Sobrescrever comportamento', adobe: 'Plugin (before/after/around) ou preference no di.xml', sfcc: 'Controller com server.extend(module.superModule) e server.append/prepend/replace; scripts com module.superModule', note: 'Não existe DI nem interceptors. Você cria o mesmo arquivo no seu cartucho, à esquerda no cartridge path, e estende o original. append/prepend somam middleware; replace troca a rota inteira (use pouco).' },
  { topic: 'Eventos', adobe: 'Observer (events.xml) e eventos de dispatch', sfcc: 'Hooks (hooks.json no package.json do cartucho; dw.system.HookMgr)', note: 'Hooks têm nomes fixos da plataforma (dw.order.calculate, app.payment.processor.*, dw.ocapi.shop.*) ou nomes seus chamados com HookMgr.callHook. Todos os cartuchos que registram o hook são executados.' },
  { topic: 'Views', adobe: 'Layout XML, blocks e templates .phtml', sfcc: 'Templates ISML (cartridge/templates/default), decorators (<isdecorate>), <isinclude> e remote includes', note: 'Não há layout XML: o controller escolhe o template com res.render e passa o view model (viewData). Blocks viram models em cartridge/models.' },
  { topic: 'JavaScript e CSS', adobe: 'RequireJS, UI components, LESS, static content deploy', sfcc: 'cartridge/client/default/js e scss, compilados por sgmf-scripts (webpack) para cartridge/static', note: 'O que roda no navegador precisa ser compilado (npm run compile:js / compile:scss) antes do upload; o static compilado é o que vai para a instância.' },
  { topic: 'Schema e atributos', adobe: 'db_schema.xml, EAV, extension attributes, data/schema patches', sfcc: 'Atributos customizados de system objects (Product, Order, Customer, Basket...) e custom objects, em metadata XML (meta/system-objecttype-extensions.xml)', note: 'Não há SQL nem tabelas. Atributos são importados (site import ou Business Manager) e acessados como objeto.custom.meuAtributo.' },
  { topic: 'Configuração', adobe: 'system.xml, config.xml, core_config_data (escopos default/website/store)', sfcc: 'Site Preferences (atributos customizados de SitePreferences) e Global Preferences', note: 'Lidas com Site.getCurrent().getCustomPreferenceValue("x"). O valor é configurado por site no Business Manager e vai em sites/<site>/preferences.xml quando versionado.' },
  { topic: 'Rotas', adobe: 'routes.xml + controller por action (Vendor\\Module\\Controller\\X\\Y)', sfcc: 'Controller SFRA (cartridge/controllers/X.js) com server.get("Y", ...) gera a rota X-Y', note: 'Middleware de rota: server.middleware.https, csrfProtection.validateRequest, userLoggedIn.validateLoggedIn, cache.applyDefaultCache.' },
  { topic: 'Integrações HTTP', adobe: 'Guzzle/Curl client, classes de API', sfcc: 'LocalServiceRegistry.createService (dw.svc), com service, profile e credential no Business Manager', note: 'Timeout, rate limit e circuit breaker ficam no profile do serviço. Credenciais nunca no código: ficam no service credential.' },
  { topic: 'Cron e filas', adobe: 'crontab.xml, message queues (consumers)', sfcc: 'Jobs (steptypes.json do cartucho + job configurado no Business Manager), com steps script ou chunk', note: 'Chunk-oriented steps processam grandes volumes por partes. Não há fila de mensagens nativa: use jobs agendados ou custom objects como fila.' },
  { topic: 'APIs para headless', adobe: 'REST/GraphQL (webapi.xml, schema.graphqls)', sfcc: 'SCAPI (Shopper APIs) e OCAPI, estendidas por hooks dw.ocapi.*; ou controllers que devolvem JSON (res.json)', note: 'No SFRA a maior parte do front é renderizada no servidor; endpoints AJAX são controllers com res.json.' },
  { topic: 'Carrinho e pedido', adobe: 'Quote, Order, totals collectors', sfcc: 'Basket, Order, hook dw.order.calculate (cartridge/scripts/hooks/cart/calculate.js)', note: 'Toda escrita em objetos persistentes precisa de Transaction.wrap(function () { ... }). Totais são recalculados pelo hook de cálculo.' },
  { topic: 'Preço, promoção, estoque', adobe: 'Price rules, catalog/cart price rules, MSI', sfcc: 'Price books, promoções e campanhas (Business Manager), inventory lists', note: 'Promoções costumam ser configuração, não código. Antes de codificar uma regra de preço, confirme se uma promoção resolve.' },
  { topic: 'Cache', adobe: 'Full page cache, Varnish, cache tags', sfcc: 'Page cache por resposta (cache.applyDefaultCache, res.cachePeriod) e remote includes para partes dinâmicas', note: 'Conteúdo por cliente (carrinho, login) fica em remote include sem cache; o resto da página pode ser cacheado.' },
  { topic: 'Traduções', adobe: 'i18n/pt_BR.csv, __()', sfcc: 'cartridge/templates/resources/*.properties, Resource.msg("chave", "arquivo", null)', note: 'Um arquivo .properties por locale (checkout_pt_BR.properties).' },
  { topic: 'Deploy', adobe: 'setup:upgrade, di:compile, static-content:deploy', sfcc: 'Upload dos cartuchos para uma code version (WebDAV) e ativação da versão; dados via site import', note: 'Não há build no servidor. Em sandbox, o upload é feito pelo dwupload (npm run watch ou uploadCartridge) usando o dw.json.' },
  { topic: 'Testes', adobe: 'PHPUnit, MFTF, integration tests', sfcc: 'Testes unitários mocha + proxyquire (test/unit), integração com sgmf-scripts --integration contra a sandbox', note: 'APIs dw.* não existem fora da instância: nos testes unitários elas são mocks (test/mocks).' },
]

/** Rules of the platform that an Adobe engineer tends to miss */
export const SFRA_RULES = [
  'Nunca altere app_storefront_base nem cartuchos de terceiros (int_*, plugin_*, link_*): estenda no cartucho do projeto, à esquerda no cartridge path.',
  'Controllers: var server = require("server"); server.extend(module.superModule); use append/prepend; replace só quando não houver alternativa. Termine com module.exports = server.exports().',
  'Escrita em objetos persistentes sempre dentro de Transaction.wrap. Nada de escrita em controllers GET cacheados.',
  'Atributos customizados e site preferences entram como metadata XML (site import) e passos no Business Manager; diga quais.',
  'Respeite as quotas da plataforma (objetos por request, tamanho de coleções, tempo de script); evite loops sobre catálogo inteiro fora de jobs.',
  'Serviços externos com LocalServiceRegistry; credenciais no Business Manager, nunca no código.',
  'Textos visíveis em .properties (Resource.msg); nada fixo no ISML.',
  'Código de cliente em cartridge/client; o static compilado não é editado à mão.',
]

/** Documentation the answers may link to; Claude must not invent other URLs */
export const SFCC_DOCS: { title: string; url: string }[] = [
  { title: 'B2C Commerce: visão geral para desenvolvedores', url: 'https://developer.salesforce.com/docs/commerce/b2c-commerce/overview' },
  { title: 'SFRA: visão geral', url: 'https://developer.salesforce.com/docs/commerce/sfra/overview' },
  { title: 'Customizar o SFRA (sem alterar app_storefront_base)', url: 'https://developer.salesforce.com/docs/commerce/sfra/guide/b2c-customizing-sfra.html' },
  { title: 'Módulos do SFRA e module.superModule', url: 'https://developer.salesforce.com/docs/commerce/sfra/guide/b2c-sfra-modules.html' },
  { title: 'Customização com hooks', url: 'https://developer.salesforce.com/docs/commerce/sfra/guide/extensibility_via_hooks.html' },
  { title: 'Script API (dw.*)', url: 'https://developer.salesforce.com/docs/commerce/b2c-commerce/references/b2c-script-api' },
  { title: 'Script API: dw.system (Transaction, Site, Logger)', url: 'https://developer.salesforce.com/docs/commerce/b2c-commerce/references/b2c-script-api/dw.system.html' },
  { title: 'Job steps customizados', url: 'https://developer.salesforce.com/docs/commerce/b2c-commerce/guide/b2c-custom-job-steps.html' },
  { title: 'Web services (dw.svc)', url: 'https://developer.salesforce.com/docs/commerce/b2c-commerce/guide/b2c-webservices.html' },
  { title: 'ISML', url: 'https://developer.salesforce.com/docs/commerce/b2c-commerce/guide/b2c-isml.html' },
  { title: 'Governança e quotas', url: 'https://developer.salesforce.com/docs/commerce/sfra/guide/b2c-governance-and-quotas.html' },
  { title: 'Trailhead: cartuchos B2C Commerce', url: 'https://trailhead.salesforce.com/content/learn/modules/b2c-cartridges' },
]

/** Only these hosts are kept in the links of a refined card */
export const DOC_HOSTS = ['developer.salesforce.com', 'help.salesforce.com', 'trailhead.salesforce.com']

/** The knowledge as prompt text */
export function sfccKnowledge() {
  return [
    'Equivalências Adobe Commerce → Salesforce B2C (SFRA):',
    ...ADOBE_TO_SFCC.map((e) => `- ${e.topic}: Adobe "${e.adobe}" → SFCC "${e.sfcc}". ${e.note}`),
    '',
    'Regras do SFRA:',
    ...SFRA_RULES.map((r) => `- ${r}`),
    '',
    'Documentação que você pode citar (use só estes links):',
    ...SFCC_DOCS.map((d) => `- ${d.title}: ${d.url}`),
  ].join('\n')
}
