import fs from 'node:fs'
import { CORE_DIR, ensureDataDirs } from '../src/config/paths'
import { ACTIONS } from '../src/readonly/actions'
import { McpSettingsService } from '../src/mcp/mcp-settings.service'
import { MCP_TOOLS } from '../src/mcp/mcp-tools'
import { McpService } from '../src/mcp/mcp.service'
import { assistantTools, CHANGES_THE_APP, describeContext } from '../src/ui/ui-assistant.service'
import { UiCommandsService } from '../src/ui/ui-commands.service'
import { UI_FEATURES, UI_PAGES } from '../src/ui/ui-catalog'
import { UiPrefsService } from '../src/ui/ui-prefs.service'
import { contrast } from '../src/ui/style-guide'

beforeAll(() => {
  ensureDataDirs()
  fs.mkdirSync(CORE_DIR, { recursive: true })
})

describe('Preferências de interface', () => {
  it('turns features off and on by id or title, but never the fixed ones', () => {
    const ui = new UiPrefsService()
    ui.apply([{ type: 'reset', scope: 'tudo' }], 'tela')
    expect(ui.apply([{ type: 'feature', feature: 'Fluxo 3D', enabled: false }], 'mcp').done).toEqual(['Fluxo 3D: desativada'])
    expect(ui.read()).toMatchObject({ disabled: ['flow'], updatedBy: 'mcp' })
    expect(ui.view().features.find((f) => f.id === 'flow')?.enabled).toBe(false)
    expect(() => ui.apply([{ type: 'feature', feature: 'overview', enabled: false }], 'tela')).toThrow('não pode ser desativada')
    expect(() => ui.apply([{ type: 'feature', feature: 'inexistente', enabled: false }], 'tela')).toThrow('não existe')
    ui.apply([{ type: 'feature', feature: 'flow', enabled: true }], 'tela')
    expect(ui.read().disabled).toEqual([])
  })

  it('moves and hides the blocks of a page, and an invalid change writes nothing', () => {
    const ui = new UiPrefsService()
    ui.apply([{ type: 'reset', scope: 'tudo' }], 'tela')
    const ids = () => ui.view().pages.find((p) => p.id === 'overview')!.blocks.map((b) => b.id)
    ui.apply([{ type: 'block-move', page: 'overview', block: 'Stack', position: 'after', ref: 'highlights' }], 'assistente')
    expect(ids().slice(0, 3)).toEqual(['kpis', 'highlights', 'stack'])
    ui.apply([{ type: 'block-move', page: 'overview', block: 'activity', position: 'top' }], 'assistente')
    expect(ids()[0]).toBe('activity')
    ui.apply([{ type: 'block-move', page: 'overview', block: 'activity', position: 'down' }], 'assistente')
    expect(ids().slice(0, 2)).toEqual(['kpis', 'activity'])
    ui.apply([{ type: 'block-visibility', page: 'Visão geral', block: 'Atividade recente', visible: false }], 'assistente')
    expect(ui.view().pages[0].blocks.find((b) => b.id === 'activity')?.visible).toBe(false)
    // all or nothing: the valid first change is not written when the second fails
    const before = JSON.stringify(ui.read().pages)
    expect(() => ui.apply([{ type: 'block-move', page: 'overview', block: 'kpis', position: 'bottom' }, { type: 'block-visibility', page: 'overview', block: 'nada', visible: false }], 'tela')).toThrow('não existe')
    expect(JSON.stringify(ui.read().pages)).toBe(before)
    ui.apply([{ type: 'reset', scope: 'overview' }], 'tela')
    expect(ids()).toEqual(UI_PAGES[0].blocks.map((b) => b.id))
  })

  it('renames features, replaces texts, changes the theme, arranges the menu and takes custom CSS, all of it undoable', () => {
    const ui = new UiPrefsService()
    ui.apply([{ type: 'reset', scope: 'tudo' }], 'tela')
    expect(ui.apply([{ type: 'rename', feature: 'Pergunte ao código', title: 'Pergunte a Sophia' }], 'assistente').done[0]).toBe('Pergunte ao código agora se chama "Pergunte a Sophia"')
    // the new name finds it too
    ui.apply([{ type: 'feature', feature: 'Pergunte a Sophia', enabled: false }], 'assistente')
    expect(ui.read().disabled).toContain('ask')
    expect(ui.view().features.find((f) => f.id === 'ask')).toMatchObject({ title: 'Pergunte a Sophia', originalTitle: 'Pergunte ao código' })

    ui.apply([{ type: 'text', from: 'Highlights técnicos', to: 'Pontos de destaque' }], 'tela')
    expect(ui.read().texts).toEqual([{ from: 'Highlights técnicos', to: 'Pontos de destaque' }])

    ui.apply([{ type: 'theme', token: 'accent', value: '#2563eb' }, { type: 'theme', token: 'font-size', value: '15px' }], 'tela')
    expect(ui.read().theme).toEqual({ accent: '#2563eb', 'font-size': '15px' })
    expect(() => ui.apply([{ type: 'theme', token: 'accent', value: 'red; background: url(x)' }], 'tela')).toThrow('Valor inválido')
    expect(() => ui.apply([{ type: 'theme', token: 'nada', value: '#fff' }], 'tela')).toThrow('desconhecido')

    ui.apply([{ type: 'menu-move', feature: 'arquitetura-viva', position: 'top', section: 'Favoritos' }], 'tela')
    expect(ui.read().menu.order[0]).toBe('arquitetura-viva')
    expect(ui.read().menu.sections['arquitetura-viva']).toBe('Favoritos')

    ui.apply([{ type: 'css', css: '.sf-card { border-radius: 4px; }' }, { type: 'css', css: '.sf-btn { font-weight: 700; }', mode: 'append' }], 'tela')
    expect(ui.read().css).toBe('.sf-card { border-radius: 4px; }\n.sf-btn { font-weight: 700; }')
    for (const bad of ['@import "x.css";', '.a { background: url(https://x) }', '.a { b: expression(alert(1)) }', '</style><script>', '.a { color: red'])
      expect(() => ui.apply([{ type: 'css', css: bad }], 'tela')).toThrow()

    // undo goes back one step at a time
    ui.undo('tela')
    expect(ui.read().css).toBe('')
    ui.apply([{ type: 'undo' }], 'tela')
    expect(ui.read().menu.order).toEqual([])
    expect(() => ui.apply([{ type: 'undo' }, { type: 'reset', scope: 'tema' }], 'tela')).toThrow('sozinho')
    ui.apply([{ type: 'reset', scope: 'textos' }], 'tela')
    expect(ui.read()).toMatchObject({ labels: {}, texts: [] })
    ui.apply([{ type: 'reset', scope: 'tudo' }], 'tela')
  })

  it('writes the style guide of the current theme and warns when a color makes text hard to read', () => {
    expect(contrast('#ffffff', '#000000')).toBe(21)
    expect(contrast('#ededef', '#111113')).toBeGreaterThan(15)
    expect(contrast('hsl(0 0% 50%)', '#000')).toBeNull()
    const ui = new UiPrefsService()
    ui.apply([{ type: 'reset', scope: 'tudo' }], 'tela')
    const g = ui.styleGuide()
    expect(g.markdown).toContain('| `accent` | `#f97316` |')
    // the default theme has two pairs just under the minimum: the guide says so
    expect(g.contrast.filter((c) => !c.ok).map((c) => c.label)).toEqual(['legendas sobre os cartões', 'texto branco sobre o destaque (botão ✦ Assistente)'])
    // a panel as light as the text: applied, but said
    const r = ui.apply([{ type: 'theme', token: 'panel', value: '#dddddd' }], 'assistente')
    expect(r.done.some((d) => d.startsWith('Atenção: texto sobre os cartões'))).toBe(true)
    expect(ui.styleGuide().markdown).toContain('`#dddddd` (padrão `#111113`)')
    expect(ui.styleGuide().markdown).toContain('**abaixo do mínimo**')
    ui.apply([{ type: 'reset', scope: 'tudo' }], 'tela')
  })

  it('moves and hides the blocks any page found by itself, each one only within its own group', () => {
    const ui = new UiPrefsService()
    ui.apply([{ type: 'reset', scope: 'tudo' }], 'tela')
    ui.registerBlocks('modules', [
      { id: 'resumo', title: 'Resumo', container: 'page' },
      { id: 'linha-vendors', title: 'Linha: Vendors, Origem', container: 'page' },
      { id: 'vendors', title: 'Vendors', container: 'grupo-2' },
      { id: 'origem', title: 'Origem', container: 'grupo-2' },
    ])
    expect(ui.view().pages.find((p) => p.id === 'modules')?.blocks.map((b) => b.id)).toEqual(['resumo', 'linha-vendors', 'vendors', 'origem'])
    ui.apply([{ type: 'block-move', page: 'Módulos & extensões', block: 'origem', position: 'before', ref: 'vendors' }], 'assistente')
    expect(ui.read().pages.modules.order).toEqual(['resumo', 'linha-vendors', 'origem', 'vendors'])
    ui.apply([{ type: 'block-move', page: 'modules', block: 'linha-vendors', position: 'top' }], 'assistente')
    expect(ui.read().pages.modules.order).toEqual(['linha-vendors', 'resumo', 'origem', 'vendors'])
    expect(() => ui.apply([{ type: 'block-move', page: 'modules', block: 'vendors', position: 'before', ref: 'resumo' }], 'tela')).toThrow('grupos diferentes')
    ui.apply([{ type: 'block-visibility', page: 'modules', block: 'Resumo', visible: false }], 'tela')
    expect(ui.read().pages.modules.hidden).toEqual(['resumo'])
    // the overview declares its own blocks: what a screen finds there is ignored; bad input is refused
    ui.registerBlocks('overview', [{ id: 'x', title: 'x' }])
    expect(ui.view().pages.find((p) => p.id === 'overview')?.blocks.some((b) => b.id === 'x')).toBe(false)
    expect(() => ui.registerBlocks('nao-existe', [])).toThrow('desconhecida')
    expect(() => ui.registerBlocks('modules', [{ id: '../x' }])).toThrow('inválido')
    ui.apply([{ type: 'reset', scope: 'tudo' }], 'tela')
  })

  it('takes a whole palette in one call, undone in one step, and the guide then speaks of a light theme', async () => {
    const ui = new UiPrefsService()
    ui.apply([{ type: 'reset', scope: 'tudo' }], 'tela')
    const tool = MCP_TOOLS.find((t) => t.name === 'mudar_tema')!
    const api = async (_m: string, _u: string, body?: unknown) => ui.apply((body as { actions: never[] }).actions, 'mcp')
    await tool.run({ itens: { accent: '#1d4ed8', bg: '#eef3fb', panel: '#ffffff', 'panel-2': '#f5f8fd', text: '#0f1d3a', muted: '#4a5878', border: '#d5deec' } }, api as never)
    expect(Object.keys(ui.read().theme)).toHaveLength(7)
    expect(ui.styleGuide().markdown).toContain('Tema claro')
    ui.undo('tela')
    expect(ui.read().theme).toEqual({})
    await expect(tool.run({}, api as never)).rejects.toThrow('Informe')
    ui.apply([{ type: 'reset', scope: 'tudo' }], 'tela')
  })

  it('the catalog has unique ids and a description for each feature', () => {
    expect(new Set(UI_FEATURES.map((f) => f.id)).size).toBe(UI_FEATURES.length)
    expect(UI_FEATURES.every((f) => f.description.length > 20)).toBe(true)
  })
})

describe('Assistente', () => {
  it('knows what "this diagram" and "this task" are from the screen the person is on', () => {
    expect(describeContext({ workspace: 'loja-1a2b3c', path: '/w/loja-1a2b3c/diagrams?diagram=fluxo-ab12cd' })).toContain('Diagrama aberto na tela ("este diagrama"): fluxo-ab12cd')
    expect(describeContext({ workspace: 'loja-1a2b3c', path: '/w/loja-1a2b3c/refinamento/0123456789' })).toContain('Tarefa aberta na tela ("esta tarefa", "este card"): 0123456789')
    expect(describeContext({ workspace: 'loja-1a2b3c', path: '/w/loja-1a2b3c/api-client?route=rest%3APOST' })).toContain('Rota aberta no Simulador de API: rest:POST')
    expect(describeContext({})).toContain('não está dentro de um workspace')
  })

  it('changes the app only with the developer mode on: without it, those tools are not even given', () => {
    const off = assistantTools(false).map((t) => t.name)
    const on = assistantTools(true).map((t) => t.name)
    for (const t of ['mudar_tema', 'trocar_texto', 'renomear_funcionalidade', 'mover_bloco', 'mostrar_bloco', 'ativar_funcionalidade', 'organizar_menu', 'css_personalizado', 'desfazer_interface', 'restaurar_interface']) {
      expect(CHANGES_THE_APP.has(t)).toBe(true)
      expect(off).not.toContain(t)
      expect(on).toContain(t)
    }
    // reading the interface and using the features stays available in both
    for (const t of ['ver_interface', 'guia_de_estilo', 'gerar_diagrama', 'criar_card', 'preencher_simulador_api', 'abrir_tela']) expect(off).toContain(t)
  })

  it('asks the open screens to open a page or fill the simulator, never anything else', () => {
    const commands = new UiCommandsService()
    const seen: unknown[] = []
    commands.commands.subscribe((c) => seen.push(c))
    commands.send({ type: 'navigate', workspace: 'loja-1a2b3c', path: 'diagrams?diagram=x-1' })
    commands.send({ type: 'api-client-fill', workspace: 'loja-1a2b3c', routeId: 'rest:POST /V1/carts/mine', request: { pathParams: { cartId: 7 }, body: { cart: { id: 1 } } } })
    expect(seen).toHaveLength(2)
    expect((seen[1] as { request: { body: string; pathParams: Record<string, string> } }).request).toMatchObject({ body: JSON.stringify({ cart: { id: 1 } }, null, 2), pathParams: { cartId: '7' } })
    expect(() => commands.send({ type: 'navigate', workspace: 'loja-1a2b3c', path: 'https://evil.example' })).toThrow()
    expect(() => commands.send({ type: 'navigate', workspace: 'loja-1a2b3c', path: 'nao-existe' })).toThrow('Tela desconhecida')
    expect(() => commands.send({ type: 'send-request', workspace: 'loja-1a2b3c' })).toThrow('Comando desconhecido')
  })
})

describe('MCP', () => {
  it('answers the protocol and lists only the tools of the groups that are on', async () => {
    const settings = new McpSettingsService()
    const mcp = new McpService(settings)
    const init = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })
    expect(init).toMatchObject({ result: { protocolVersion: '2025-03-26', serverInfo: { name: 'agentic-toolkit' } } })
    expect(await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
    const names = async () => ((await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name)
    expect(await names()).toEqual(expect.arrayContaining(['guia', 'ativar_funcionalidade', 'mover_bloco', 'buscar_no_mapa']))
    expect(await names()).not.toContain('perguntar_ao_codigo')
    settings.save({ groups: { interface: false, acoes: true } })
    expect(await names()).not.toContain('ativar_funcionalidade')
    expect(await names()).toContain('perguntar_ao_codigo')
    const off = await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'mover_bloco', arguments: {} } })
    expect(off).toMatchObject({ error: { message: expect.stringContaining('desligada') } })
    const guide = (await mcp.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'guia', arguments: { topico: 'arquitetura viva' } } })) as { result: { content: { text: string }[] } }
    expect(guide.result.content[0].text).toContain('Arquitetura viva')
    expect(await mcp.handle({ jsonrpc: '2.0', id: 5, method: 'nada' })).toMatchObject({ error: { code: -32601 } })
    // the in-app assistant reaches every group, whatever the settings for external clients
    const internal = (await mcp.handle({ jsonrpc: '2.0', id: 6, method: 'tools/list' }, { client: 'assistente' })) as { result: { tools: { name: string }[] } }
    expect(internal.result.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['ativar_funcionalidade', 'gerar_diagrama', 'anexar_ao_card', 'preencher_simulador_api']))
    settings.save({ groups: { interface: true, acoes: false } })
  })

  it('keeps the token, checks it in constant time and only changes it on request', () => {
    const settings = new McpSettingsService()
    const t = settings.read().token
    expect(t).toMatch(/^atk_/)
    expect(settings.read().token).toBe(t)
    expect(settings.read().enabled).toBe(false)
    expect(settings.accepts(`Bearer ${t}`)).toBe(true)
    expect(settings.accepts('Bearer errado')).toBe(false)
    expect(settings.accepts(undefined)).toBe(false)
    expect(settings.rotate().token).not.toBe(t)
    expect(() => settings.save({ groups: { codigo: true } })).toThrow('Grupo desconhecido')
    // the assistant's token works even with the MCP off, and is told apart from an external client
    expect(settings.caller(`Bearer ${settings.internalToken}`)).toBe('assistente')
    expect(settings.accepts(`Bearer ${settings.internalToken}`)).toBe(false)
  })

  it('no tool writes to the code, and every route is declared', () => {
    expect(MCP_TOOLS.every((t) => ['sempre', 'interface', 'consulta', 'trabalho', 'acoes'].includes(t.group))).toBe(true)
    for (const id of ['ui.get', 'ui.change', 'ui.assistant', 'ui.events', 'ui.command', 'mcp.rpc', 'mcp.settings', 'mcp.settings.get', 'mcp.token'] as const) expect(ACTIONS[id].kind).not.toMatch(/^repo/)
  })
})
