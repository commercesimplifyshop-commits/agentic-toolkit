import type { FlowStep } from './FlowStory'

/** Shown with the tutorial: names change between releases, so each one must be checked against the docs of the version in use */
export const VERIFY_NOTE =
  'Nomes de hooks, caminhos do Business Manager e versões de API mudam entre releases. Antes de usar um nome deste tutorial, confirme-o na documentação oficial da versão do seu projeto.'

export const GLOSSARY: { term: string; meaning: string }[] = [
  { term: 'Business Manager (BM)', meaning: 'Painel de administração da loja: catálogo, preços, promoções, pedidos, métodos de pagamento e entrega, jobs e configurações.' },
  { term: 'Instância (sandbox)', meaning: 'Um ambiente da sua organização (desenvolvimento, staging, produção). Cada um tem seu próprio código e seus próprios dados.' },
  { term: 'Site e locale', meaning: 'Uma vitrine dentro da mesma organização, com moeda, idioma e catálogo próprios. Uma organização costuma ter vários sites.' },
  { term: 'Cartucho (cartridge)', meaning: 'Pasta com uma parte do código: controllers, templates, scripts e configurações. A loja é a soma dos cartuchos, na ordem definida no cartridge path do site.' },
  { term: 'Code version', meaning: 'Uma versão do código enviada à instância. Só uma fica ativa por vez; trocar de versão é como você publica uma mudança.' },
  { term: 'SFRA', meaning: 'Salesforce Reference Architecture: o storefront de referência em JavaScript, com controllers (server.get/post), templates ISML e extensão por cartuchos.' },
  { term: 'ISML', meaning: 'Linguagem de template do Salesforce, parecida com HTML com tags próprias (isif, isloop, isprint).' },
  { term: 'Job', meaning: 'Tarefa agendada ou manual no BM: importar catálogo, sincronizar pedidos, limpar dados. Roda em lote, fora da requisição do cliente.' },
  { term: 'OCAPI / SCAPI', meaning: 'APIs do Salesforce: OCAPI para administração e integração de dados; SCAPI (Shopper APIs) para a experiência do comprador, com autenticação SLAS.' },
  { term: 'Custom attribute', meaning: 'Campo extra de um objeto (produto, cliente, pedido), declarado no projeto em meta/ e importado para a instância.' },
]

export const CONSTRUCTION: FlowStep[] = [
  {
    icon: '🎯',
    title: 'Entender o negócio',
    where: 'Reunião com o cliente e o time de produto',
    detail: 'Antes de código: quais sites (país, idioma, moeda), quais canais, quais meios de pagamento e de entrega, e o que é específico do cliente. Essas respostas definem quantos sites, cartuchos e integrações existem.',
  },
  {
    icon: '🏗️',
    title: 'Preparar as instâncias',
    where: 'Account Manager e Business Manager',
    detail: 'Cada projeto tem pelo menos desenvolvimento (sandbox), staging e produção. A organização, os sites e os usuários são criados no Account Manager; a configuração de loja fica no Business Manager, instância por instância.',
  },
  {
    icon: '📦',
    title: 'Criar o projeto',
    where: 'Repositório Git com cartridges/ e package.json',
    detail: 'O ponto de partida costuma ser o SFRA (dependência sgmf-scripts) ou um storefront PWA Kit. Customizações ficam em cartuchos próprios, separados do SFRA, para que uma atualização do SFRA não apague o seu código.',
  },
  {
    icon: '🧩',
    title: 'Desenvolver os cartuchos',
    where: 'cartridges/<seu_cartucho>/cartridge/',
    detail: 'controllers/ recebem a requisição (server.get, server.post, server.append para estender um controller existente). templates/ tem o ISML. scripts/ tem a lógica de negócio. hooks.json registra os pontos de extensão que o SFRA chama.',
  },
  {
    icon: '🗂️',
    title: 'Configurar os dados',
    where: 'Business Manager e meta/ no projeto',
    detail: 'Catálogo, price books, promoções, métodos de pagamento e de entrega, custom attributes (declarados em meta/) e preferências do site. Parte disso vai no código, parte é configuração na instância. Mudanças de dados também podem ser feitas por import de site ou por job.',
  },
  {
    icon: '🚀',
    title: 'Implantar o código',
    where: 'CLI, UX Studio ou upload WebDAV para uma code version',
    detail: 'Os cartuchos são enviados para uma code version na instância e essa versão é ativada. Confira o cartridge path do site: ele define a ordem em que os cartuchos são lidos, e um cartucho fora dele não tem efeito.',
  },
  {
    icon: '🧪',
    title: 'Testar',
    where: 'Sandbox, Log Center e testes automatizados',
    detail: 'Teste o fluxo completo de compra na sandbox: carrinho, checkout, pagamento e pedido. Os logs de erro ficam no BM; jobs têm histórico próprio. Automatize o que se repete, principalmente o checkout.',
  },
  {
    icon: '✅',
    title: 'Promover para produção',
    where: 'Mesma code version em staging e produção',
    detail: 'O código que passou no teste é o mesmo que vai para produção, sem recompilar. Dados (catálogo, preços, configurações) são replicados por import e export de site, com cuidado para não sobrescrever pedidos e clientes reais.',
  },
]

export interface Customization {
  id: string
  title: string
  /** How a stakeholder usually asks for it */
  request: string
  /** The short answer: what changes and where */
  answer: string
  flow: FlowStep[]
  pitfalls: string[]
}

export const CUSTOMIZATIONS: Customization[] = [
  {
    id: 'pagamento',
    title: 'Novo método de pagamento',
    request: '"Queremos aceitar Pix (ou boleto, ou carteira digital) no checkout."',
    answer:
      'Dois lados: o método precisa existir no Business Manager (o método de pagamento e o processador ligado a ele) e o código cuida do formulário, da autorização e do retorno. O cartucho ganha um processador e um formulário no checkout.',
    flow: [
      { icon: '🛒', title: 'Cliente escolhe', where: 'Checkout, passo de pagamento', detail: 'O checkout lista os métodos ativos para o site e a moeda. Se o método não aparece, a causa costuma ser a configuração no BM (site, moeda ou ativação) e não o código.' },
      { icon: '🧾', title: 'Formulário', where: 'templates/ do cartucho (ISML)', detail: 'Mostra os campos específicos do método, por exemplo a chave Pix ou o CPF. A validação acontece no servidor, nunca só no navegador.' },
      { icon: '🔌', title: 'Processador', where: 'hooks.json e scripts/ do cartucho', detail: 'O SFRA chama o processador registrado para o método, por meio de um hook do tipo app.payment.processor.<ID>. Confirme o nome exato do hook na versão do seu SFRA.' },
      { icon: '🌐', title: 'Gateway', where: 'Serviço em LocalServiceRegistry (configurado no BM)', detail: 'A chamada ao provedor de pagamento passa por um serviço configurado no BM, com timeout e tratamento de erro. A credencial fica no BM, não no código.' },
      { icon: '📝', title: 'Pedido criado', where: 'Retorno do gateway', detail: 'Se o pagamento foi aprovado, o pedido é criado com o status certo. Pagamentos assíncronos (Pix, boleto) precisam de um retorno por notificação, que atualiza o pedido depois.' },
    ],
    pitfalls: [
      'Nunca guarde número de cartão no seu código ou no banco. Use o tokenizador do provedor.',
      'Pagamento assíncrono não é aprovado na hora: o pedido precisa de um estado de "aguardando" e de uma rotina para confirmar.',
      'Notificações podem chegar mais de uma vez. Trate a operação como idempotente.',
    ],
  },
  {
    id: 'entrega',
    title: 'Novo método de entrega',
    request: '"Queremos entrega expressa para capitais e retirada na loja."',
    answer:
      'O BM define zonas, tarifas e os métodos disponíveis. Quando o preço depende de regra própria (região, peso, horário), o cálculo entra no cartucho. Retirada em loja depende de estoque por loja, então também envolve integração.',
    flow: [
      { icon: '📍', title: 'Endereço', where: 'Checkout, passo de entrega', detail: 'O cliente informa o endereço. Ele é a entrada da regra: capital ou interior, CEP, região.' },
      { icon: '🗺️', title: 'Opções de envio', where: 'Métodos de entrega no BM (zonas e tarifas)', detail: 'A loja lista os métodos que valem para aquele endereço, a partir das zonas e das tarifas configuradas no BM.' },
      { icon: '🧮', title: 'Regra de custo', where: 'scripts/ do cartucho (cálculo do frete)', detail: 'Quando a tarifa não basta, um script calcula o custo: por exemplo, frete grátis acima de um valor, ou um adicional por região. O cálculo roda no carrinho, a cada mudança.' },
      { icon: '🏬', title: 'Retirada em loja', where: 'Integração com estoque por loja', detail: 'Mostrar só lojas com estoque exige dados de estoque por loja, normalmente vindos de um ERP por job ou por serviço. Planeje essa integração antes de prometer a data.' },
      { icon: '📦', title: 'Pedido com entrega', where: 'Pedido e status de envio', detail: 'O método escolhido e o custo calculado ficam gravados no pedido, para que a cobrança e a logística usem o mesmo valor.' },
    ],
    pitfalls: [
      'O custo calculado precisa ser o mesmo na tela, no total do pedido e na cobrança. Se cada parte calcula por conta própria, o cliente vê um valor e paga outro.',
      'Regras de frete devem ser testadas com CEPs reais, incluindo as fronteiras de faixa e CEPs sem cobertura.',
    ],
  },
  {
    id: 'preco',
    title: 'Nova regra de preço',
    request: '"Clientes do clube pagam 10% a menos em produtos da categoria X, e leve 3 pague 2 nas meias."',
    answer:
      'Preço tem três camadas: o preço base (price book), as promoções (regras que a loja já sabe aplicar) e, quando a regra não cabe nelas, um cálculo próprio no cartucho. Comece pela camada mais simples que resolve o pedido.',
    flow: [
      { icon: '🏷️', title: 'Preço base', where: 'Price books no BM', detail: 'Cada produto tem um preço por price book. Um price book pode ser atribuído a um grupo de clientes ou a um site, e é a primeira camada.' },
      { icon: '🎯', title: 'Promoções', where: 'Promoções no BM (Promotion Engine)', detail: 'Descontos por produto, categoria, quantidade (leve 3 pague 2), cupom ou grupo de clientes. Cobrem a maioria dos pedidos sem código.' },
      { icon: '🧠', title: 'Regra própria', where: 'Hook de cálculo do carrinho (cartucho)', detail: 'Quando a regra não cabe nas promoções, um hook de cálculo do carrinho ajusta os preços das linhas. Confirme o hook de cálculo na versão do SFRA e a ordem em relação às promoções.' },
      { icon: '🧾', title: 'Total do carrinho', where: 'Cálculo do carrinho', detail: 'O total é recalculado a cada mudança no carrinho. A regra precisa ser estável: o mesmo carrinho deve dar o mesmo total.' },
      { icon: '✅', title: 'Pedido com o preço certo', where: 'Pedido gravado', detail: 'O valor final e as promoções aplicadas ficam no pedido. Assim um reembolso ou uma disputa usa o que foi cobrado, não o preço de hoje.' },
    ],
    pitfalls: [
      'Teste a ordem das regras: um desconto calculado antes de outro muda o resultado final.',
      'Regra por cliente precisa de grupo de clientes ou de um price book. Não confie em dados que o navegador envia.',
      'Arredondamento: decida onde arredondar (por linha ou no total) e teste com centavos.',
    ],
  },
  {
    id: 'atributo',
    title: 'Campo novo no produto ou no cliente',
    request: '"Precisamos do campo cor do tecido no produto e do CPF no cadastro."',
    answer:
      'Um custom attribute declarado no projeto (meta/) cria o campo na instância. Depois é preciso mostrá-lo (template), editá-lo (controller ou importação) e garantir que ele aparece nas integrações que precisam dele.',
    flow: [
      { icon: '📐', title: 'Declarar', where: 'meta/system-objecttype-extensions.xml', detail: 'O atributo é declarado no tipo de objeto (Product, Customer). Depois de importado, ele vira um campo da instância.' },
      { icon: '📥', title: 'Importar', where: 'Import de site ou job no BM', detail: 'A definição precisa chegar à instância antes de qualquer dado. Sem isso, o código que lê o campo recebe vazio.' },
      { icon: '🖥️', title: 'Exibir', where: 'templates/ (ISML) do cartucho', detail: 'O template lê o atributo do objeto e mostra quando ele tem valor. Trate o caso vazio, que vai existir em todos os produtos antigos.' },
      { icon: '✏️', title: 'Editar', where: 'Controller do formulário (ex.: cadastro)', detail: 'O controller recebe o valor, valida (CPF tem dígitos verificadores) e grava no objeto do cliente.' },
      { icon: '🔁', title: 'Integrar', where: 'Feeds, ERP e APIs (OCAPI/SCAPI)', detail: 'Se o ERP ou um feed precisa do campo, ele precisa estar no export ou na API. Campo que não sai da loja não existe para o resto da empresa.' },
    ],
    pitfalls: [
      'Dados pessoais como CPF pedem cuidado de LGPD: guarde só o necessário e controle quem pode ver.',
      'Atributo removido do meta/ não apaga os dados já gravados. Planeje a limpeza à parte.',
    ],
  },
  {
    id: 'integracao',
    title: 'Nova integração (ERP, CRM, nota fiscal)',
    request: '"Quando o pedido for pago, enviar para o ERP e receber a nota fiscal."',
    answer:
      'A integração fica em um serviço definido no cartucho e configurado no BM (endereço, credenciais, timeout). Eventos em tempo real chamam o serviço; sincronizações em lote rodam em jobs.',
    flow: [
      { icon: '💳', title: 'Evento', where: 'Confirmação do pedido (controller ou hook)', detail: 'O pedido pago dispara a integração. Se o evento acontece no checkout, a chamada não pode travar a compra: ela vai para uma fila ou para um job.' },
      { icon: '📡', title: 'Serviço', where: 'LocalServiceRegistry.createService no cartucho', detail: 'O serviço é o ponto único de chamada HTTP. As credenciais e a URL ficam no BM, nunca no código.' },
      { icon: '⏱️', title: 'Tempo limite e retry', where: 'Configuração do serviço no BM', detail: 'Defina timeout e número de tentativas. Falha de integração precisa ficar registrada para reprocessar, sem bloquear o cliente.' },
      { icon: '🧾', title: 'Nota fiscal', where: 'Retorno do ERP', detail: 'O retorno com a nota é gravado no pedido ou em um objeto próprio, e o cliente recebe o aviso por e-mail quando estiver pronto.' },
      { icon: '📊', title: 'Log e reprocessamento', where: 'Log customizado e job de reenvio', detail: 'Um job que reenvia o que falhou evita pedido sem nota. Acompanhe pelo log e por um painel de pendências.' },
    ],
    pitfalls: [
      'Nunca chame o ERP de forma síncrona dentro do checkout sem timeout curto.',
      'Reenvio sem idempotência duplica pedidos no ERP. Use um identificador único do pedido.',
    ],
  },
  {
    id: 'pagina',
    title: 'Nova página ou fluxo do cliente',
    request: '"Uma página de comparação de produtos e um botão na ficha do produto."',
    answer:
      'No SFRA, uma página é um controller (a rota), scripts ou models (os dados) e um template ISML (a tela). Para mudar uma página existente sem copiá-la, estenda o controller com server.append ou server.replace no seu cartucho.',
    flow: [
      { icon: '🌍', title: 'Requisição', where: 'URL da loja', detail: 'O navegador pede uma URL. A rota é o nome registrado no controller, por exemplo Compare-Show.' },
      { icon: '🎛️', title: 'Controller', where: 'cartridge/controllers/', detail: 'Recebe a requisição, chama os scripts e decide o que renderizar. server.append adiciona lógica depois do controller original.' },
      { icon: '⚙️', title: 'Dados', where: 'cartridge/scripts/ e models/', detail: 'A lógica que busca e prepara os dados. Ela não deve conhecer HTML: isso fica no template.' },
      { icon: '🖼️', title: 'Template', where: 'cartridge/templates/default/ (ISML)', detail: 'Monta a tela. Use os templates e componentes do SFRA para manter o visual e a acessibilidade.' },
      { icon: '📄', title: 'Resposta', where: 'Navegador', detail: 'A página volta ao cliente. Teste com o mesmo site, moeda e idioma que o cliente real usa.' },
    ],
    pitfalls: [
      'Copiar um controller do SFRA inteiro impede as atualizações futuras. Prefira server.append ou server.replace.',
      'Rotas novas precisam de teste de acesso: um controller sem proteção pode mostrar dados de outro cliente.',
    ],
  },
]
