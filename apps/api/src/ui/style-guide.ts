import { CSS_MAP, THEME_TOKENS } from './ui-catalog'

/** Where each token shows on the screen and how to use it: the heart of the style guide */
const USAGE: Record<string, { where: string; rule: string }> = {
  accent: { where: 'botões de ação principal (✦ Assistente, Desenhar com o Claude), item ativo e marcadores, links de destaque, foco dos campos, interruptores ligados', rule: 'Uma cor só, de marca. Precisa contrastar com o fundo (bg/panel) e com o branco do texto dos botões em destaque. Evite verde, amarelo e vermelho: confundem com estados.' },
  bg: { where: 'fundo de toda a aplicação, atrás dos cartões', rule: 'O mais escuro da escala. panel e panel-2 devem ser um pouco mais claros que ele.' },
  panel: { where: 'cartões, menu lateral, painéis e botões comuns', rule: 'Levemente mais claro que bg; o texto (text) precisa de contraste de pelo menos 4.5:1 sobre ele.' },
  'panel-2': { where: 'campos de texto, painéis em destaque, painel do assistente, trechos de código', rule: 'Um degrau acima de panel.' },
  hover: { where: 'fundo dos itens do menu e das listas ao passar o mouse', rule: 'Entre panel e panel-2: sutil.' },
  border: { where: 'bordas de cartões, campos, botões e divisórias (a cor mais usada do app)', rule: 'Sutil: deve separar sem chamar atenção.' },
  text: { where: 'texto principal, títulos e o fundo dos botões "primários" (que usam texto escuro)', rule: 'Contraste de pelo menos 4.5:1 sobre bg, panel e panel-2.' },
  muted: { where: 'texto secundário: descrições, subtítulos, ajuda dos campos', rule: 'Contraste de pelo menos 4.5:1 sobre panel.' },
  faint: { where: 'legendas, rótulos de seção do menu, datas, texto desativado', rule: 'Pode ficar abaixo de 4.5:1 só para texto não essencial; mantenha acima de 3:1.' },
  blue: { where: 'informação, gráficos e badges azuis', rule: 'Estado "informação".' },
  green: { where: 'sucesso, "disponível", ponto verde de ao vivo', rule: 'Estado "deu certo": não use como destaque decorativo.' },
  yellow: { where: 'atenção, riscos médios', rule: 'Estado "atenção".' },
  red: { where: 'erros, riscos altos, botões de excluir', rule: 'Estado "erro/perigo": reserve para isso.' },
  purple: { where: 'gráficos (terceiros, extensões)', rule: 'Cor de série de gráfico.' },
  radius: { where: 'cantos dos cartões e painéis grandes (botões e campos têm cantos próprios, um pouco menores)', rule: 'Entre 0px (quadrado) e 16px.' },
  font: { where: 'todo o texto, exceto código', rule: 'Use fontes instaladas no sistema (ex.: "Segoe UI", Arial, system-ui); fontes da web não são carregadas.' },
  'font-size': { where: 'tamanho base do texto (títulos e legendas são fixos em px e não acompanham)', rule: 'Entre 12px e 16px.' },
  'sidebar-width': { where: 'largura do menu lateral aberto', rule: 'Entre 200px e 320px.' },
}

/** Text over a background: the pairs that must stay readable */
const PAIRS: [fg: string, bg: string, min: number, label: string][] = [
  ['text', 'bg', 4.5, 'texto sobre o fundo'],
  ['text', 'panel', 4.5, 'texto sobre os cartões'],
  ['text', 'panel-2', 4.5, 'texto sobre campos e painéis em destaque'],
  ['muted', 'panel', 4.5, 'texto secundário sobre os cartões'],
  ['faint', 'panel', 3, 'legendas sobre os cartões'],
  ['accent', 'panel', 3, 'destaque sobre os cartões (ícones, bordas, links)'],
  ['#ffffff', 'accent', 3, 'texto branco sobre o destaque (botão ✦ Assistente)'],
  ['red', 'panel', 3, 'vermelho sobre os cartões'],
  ['green', 'panel', 3, 'verde sobre os cartões'],
]

const NAMED: Record<string, string> = { white: '#ffffff', black: '#000000', red: '#ff0000', blue: '#0000ff', green: '#008000', orange: '#ffa500', gray: '#808080', grey: '#808080', navy: '#000080', purple: '#800080', teal: '#008080', yellow: '#ffff00' }

/** An sRGB color from #hex, rgb() or a few names; null when it cannot be measured (hsl, other names) */
export function toRgb(value: string): [number, number, number] | null {
  const v = (NAMED[value.toLowerCase()] ?? value).trim()
  let m = /^#([0-9a-f]{3,8})$/i.exec(v)
  if (m) {
    let h = m[1]
    if (h.length <= 4) h = h.slice(0, 3).split('').map((c) => c + c).join('')
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
  }
  m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i.exec(v)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** WCAG contrast ratio between two colors (1 to 21) */
export function contrast(a: string, b: string): number | null {
  const ca = toRgb(a)
  const cb = toRgb(b)
  if (!ca || !cb) return null
  const lum = ([r, g, bl]: number[]) => {
    const f = (c: number) => {
      const s = c / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl)
  }
  const [hi, lo] = [lum(ca), lum(cb)].sort((x, y) => y - x)
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
}

/** The contrast checks with the current theme; the ones below the minimum are the problems */
export function contrastChecks(theme: Record<string, string>) {
  const value = (id: string) => (id.startsWith('#') ? id : (theme[id] ?? THEME_TOKENS.find((t) => t.id === id)?.value ?? ''))
  return PAIRS.map(([fg, bg, min, label]) => {
    const ratio = contrast(value(fg), value(bg))
    return { label, fg, bg, ratio, min, ok: ratio === null ? null : ratio >= min }
  })
}

/**
 * The style guide of the current theme, for a person or an AI: every token with its current and
 * default value, where it shows, the rule to follow, the measured contrast, and what can be changed.
 */
export function styleGuide(theme: Record<string, string>, css: string) {
  const tokens = THEME_TOKENS.map((t) => ({ ...t, current: theme[t.id] ?? t.value, changed: theme[t.id] !== undefined, ...USAGE[t.id] }))
  const checks = contrastChecks(theme)
  const colors = tokens.filter((t) => t.kind === 'color')
  const others = tokens.filter((t) => t.kind !== 'color')
  const row = (t: (typeof tokens)[number]) => `| \`${t.id}\` | \`${t.current}\`${t.changed ? ` (padrão \`${t.value}\`)` : ''} | ${t.where} | ${t.rule} |`
  const problems = checks.filter((c) => c.ok === false)
  // light or dark, by the background: the guide speaks of the theme as it is now
  const bgRgb = toRgb(theme.bg ?? THEME_TOKENS.find((t) => t.id === 'bg')!.value)
  const dark = !bgRgb || (bgRgb[0] + bgRgb[1] + bgRgb[2]) / 3 < 128
  const markdown = [
    '# Guia de estilo do Agentic Toolkit',
    '',
    `Tema ${dark ? 'escuro' : 'claro'}, com uma cor de destaque. ` +
      'Os valores abaixo são os de agora (os alterados mostram o padrão). Para mudar: `mudar_tema` (vários itens de uma vez em `itens`), `desfazer_interface` para voltar, `restaurar_interface` com escopo `tema` para o padrão.',
    '',
    '## Cores',
    '',
    '| Item | Valor | Onde aparece | Regra |',
    '|---|---|---|---|',
    ...colors.map(row),
    '',
    '### Escala de superfícies',
    dark ? '`bg` (fundo) → `panel` (cartões) → `hover` → `panel-2` (campos e destaques): cada degrau um pouco mais claro. `border` separa os degraus. Em tema escuro, mantenha essa ordem; inverter deixa os cartões "afundados".' : '`bg` (fundo) é um pouco mais escuro ou colorido que `panel` (cartões, em geral branco); `hover` e `panel-2` ficam entre os dois. `border` precisa ser visível sobre o branco. Em tema claro, as áreas com cor fixa no código (gráficos, editor de código, diagramas) continuam escuras.',
    '',
    '### Cores de estado',
    '`green` = deu certo, `yellow` = atenção, `red` = erro ou perigo, `blue` = informação. Não as use como destaque decorativo: a pessoa lê o estado pela cor. O fundo suave de cada uma (badges, avisos) é calculado a partir dela; o do destaque também (`--sf-accent-soft`).',
    '',
    '### Contraste (WCAG, medido no tema atual)',
    '',
    '| Par | Contraste | Mínimo | Situação |',
    '|---|---|---|---|',
    ...checks.map((c) => `| ${c.label} | ${c.ratio ?? '—'}${c.ratio ? ':1' : ''} | ${c.min}:1 | ${c.ok === null ? 'não medido (use #hex ou rgb)' : c.ok ? 'ok' : '**abaixo do mínimo**'} |`),
    '',
    problems.length ? `**Atenção:** ${problems.map((p) => p.label).join('; ')} estão abaixo do mínimo: o texto fica difícil de ler.` : 'Todos os pares medidos estão legíveis.',
    '',
    '## Tipografia, cantos e medidas',
    '',
    '| Item | Valor | Onde aparece | Regra |',
    '|---|---|---|---|',
    ...others.map(row),
    '',
    'Fixos (mudam só com CSS personalizado): títulos de página 22px negrito, títulos de cartão 15px, legendas 11–12px, código em fonte monoespaçada 12px, botões com cantos de 9px.',
    '',
    '## Componentes',
    '',
    '- **Botão comum** (`.sf-btn`): fundo `panel`, borda `border`, texto `text`.',
    '- **Botão primário** (`.sf-btn.primary`): fundo `text` com texto escuro, o mais forte da tela.',
    '- **Botão de destaque** (`.sf-btn.accent`, ✦ Assistente): fundo `accent` com texto branco.',
    '- **Cartão** (`.sf-card`): fundo `panel`, borda `border`, cantos `radius`.',
    '- **Item ativo do menu** (`.sf-nav.active`): fundo `hover`, texto `text` em negrito.',
    '- **Badges e avisos** (`.sf-badge`, `.sf-callout`): cor de estado com fundo suave.',
    '',
    '## O que dá para mudar e como',
    '',
    '- **Cores, fonte, tamanhos:** `mudar_tema`. Uma paleta inteira vai numa chamada só, em `itens` (ex.: `{"accent": "#2563eb", "bg": "#0b1220"}`): é um único passo, desfeito de uma vez.',
    '- **Textos e nomes:** `trocar_texto`, `renomear_funcionalidade`.',
    '- **Qualquer outro detalhe visual:** `css_personalizado`, de preferência com variáveis (`var(--sf-accent)`) para continuar seguindo o tema. Seletores estáveis:',
    ...CSS_MAP.map(([sel, what]) => `  - \`${sel}\`: ${what}`),
    '',
    '## Limites do tema hoje',
    '',
    '- **Tema claro:** ainda não é completo. Parte das cores está fixa no código (gráficos, editor de código, diagramas, algumas bordas e fundos), então trocar só `bg`, `panel` e `text` para tons claros deixa áreas escuras. Para um tema claro, combine `mudar_tema` com `css_personalizado` e confira cada tela.',
    '- **Fontes:** só as instaladas no sistema.',
    `- **CSS personalizado ativo:** ${css ? `${css.length} caracteres (veja em ver_interface).` : 'nenhum.'}`,
  ].join('\n')
  return { markdown, tokens, contrast: checks }
}
