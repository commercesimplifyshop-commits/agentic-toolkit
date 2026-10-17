import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AiService } from '../src/ai/ai.service'
import { ensureDataDirs } from '../src/config/paths'
import { McpSettingsService } from '../src/mcp/mcp-settings.service'
import { CommandRunner } from '../src/readonly/command-runner.service'
import { StudioService } from '../src/studio/studio.service'
import type { WorkspacesService } from '../src/workspaces/workspaces.service'

function studio() {
  ensureDataDirs()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-proj-'))
  const workspaces = { get: () => ({ id: 'loja-1a2b3c', name: 'Loja' }), rootOf: () => root } as unknown as WorkspacesService
  const ai = { claudeBinary: () => null } as unknown as AiService
  return { svc: new StudioService(ai, new CommandRunner(), workspaces, new McpSettingsService()), root }
}

describe('Estúdio', () => {
  it('creates conversations for the workspace project and keeps attachments with safe names', () => {
    const { svc } = studio()
    expect(() => svc.create('loja-1a2b3c', 'outro', '')).toThrow('Escolha o código')
    const s = svc.create('loja-1a2b3c', 'workspace', '')
    expect(s).toMatchObject({ target: 'workspace', title: 'Nova conversa', started: false, turns: [], targetName: 'Loja' })
    expect(s.claudeSessionId).toMatch(/^[0-9a-f-]{36}$/)
    const f = svc.attach(s.id, { originalname: '../../print <tela>.png', mimetype: 'image/png', size: 4, buffer: Buffer.from('png!') })
    expect(f.id).toMatch(/^[a-f0-9]{16}\.png$/)
    expect(f.name).not.toContain('/')
    expect(f.name).not.toContain('<')
    expect(fs.existsSync(path.join(svc.filesDir(s.id), f.id))).toBe(true)
    expect(() => svc.attach(s.id, { originalname: 'grande.zip', mimetype: 'application/zip', size: 30 * 1024 * 1024, buffer: Buffer.alloc(1) })).toThrow('20 MB')
    expect(svc.list('loja-1a2b3c').map((x) => x!.id)).toContain(s.id)
    expect(() => svc.get('../etc')).toThrow('inválida')
  })

  it('refuses a bad model, an unknown attachment and a message with nothing in it, before running anything', () => {
    const { svc } = studio()
    const s = svc.create('loja-1a2b3c', 'workspace', 'teste')
    expect(() => svc.send(s.id, { text: '' })).toThrow('Escreva')
    expect(() => svc.send(s.id, { text: 'oi', model: 'opus; rm -rf /' })).toThrow('Modelo inválido')
    expect(() => svc.send(s.id, { text: 'oi', attachments: ['../../x'] })).toThrow('Anexo inválido')
    // the binary is missing in this test: the run itself is never started
    expect(() => svc.send(s.id, { text: 'oi', model: 'opus', mode: 'plan' })).toThrow('Claude Code não encontrado')
  })

  it('reads the branch the code is on now, and none outside a git checkout', async () => {
    const { svc, root } = studio()
    expect((await svc.branches('loja-1a2b3c')).workspace).toBeNull()
    execFileSync('git', ['init', '-q', '-b', 'feature/vitrine'], { cwd: root })
    expect((await svc.branches('loja-1a2b3c')).workspace).toBe('feature/vitrine')
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root }).toString().trim()
    git('commit', '-q', '--allow-empty', '-m', 'x')
    git('checkout', '-q', '--detach')
    expect((await svc.branches('loja-1a2b3c')).workspace).toBe(git('rev-parse', '--short', 'HEAD'))
  })

  it('shows no diff for a path outside the project', async () => {
    const { svc } = studio()
    const s = svc.create('loja-1a2b3c', 'workspace', 'x')
    await expect(svc.changes(s.id, '../../etc/passwd')).rejects.toThrow('Caminho inválido')
  })

  it('accepts the restart script only as it is meant to run', () => {
    const runner = new CommandRunner()
    const script = path.resolve(__dirname, '..', 'bin', 'restart-server.mjs')
    expect(() => runner.validate('node', [script, '--port', '4310', '--log', '/tmp/x.log'])).not.toThrow()
    expect(() => runner.validate('node', [script, '--port', '4310'])).toThrow()
    expect(() => runner.validate('node', [script, '--port', '4310; calc', '--log', 'x'])).toThrow()
    expect(() => runner.validate('node', [path.resolve(__dirname, '..', 'bin', 'outro.mjs')])).toThrow()
  })
})
