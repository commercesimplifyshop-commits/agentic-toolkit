import fs from 'node:fs'
import path from 'node:path'
import { SKILL_FEATURES, SKILLS } from '../src/skills/catalog'
import { skillsInEvent, withSkills } from '../src/skills/claude-skills'
import { SKILLS_SOURCE, SkillsService } from '../src/skills/skills.service'

describe('Skills do Claude (catálogo)', () => {
  it('has a SKILL.md for every skill, named after its folder, with a description Claude can match', () => {
    for (const s of SKILLS) {
      const md = fs.readFileSync(path.join(SKILLS_SOURCE, s.id, 'SKILL.md'), 'utf8')
      const front = md.match(/^---\s*\n([\s\S]*?)\n---/)
      expect(front).toBeTruthy()
      expect(front![1]).toMatch(new RegExp(`^name: ${s.id}$`, 'm'))
      const description = front![1].match(/^description: (.+)$/m)?.[1] ?? ''
      expect(description.length).toBeGreaterThan(60)
      expect(description.length).toBeLessThanOrEqual(1024)
      expect(s.features.length).toBeGreaterThan(0)
      expect(s.features.every((f) => (SKILL_FEATURES as readonly string[]).includes(f))).toBe(true)
    }
  })

  it('covers every feature that runs Claude, for both technologies', () => {
    for (const tech of ['adobe-commerce', 'salesforce-b2c'] as const) {
      for (const feature of SKILL_FEATURES) {
        expect(SKILLS.some((s) => s.features.includes(feature) && (s.techs.length === 0 || s.techs.includes(tech)))).toBe(true)
      }
      expect(SKILLS.some((s) => s.features.includes('develop') && s.techs.includes(tech))).toBe(true)
    }
  })

  it('has no folder without a catalogue entry', () => {
    const folders = fs.readdirSync(SKILLS_SOURCE).filter((f) => fs.statSync(path.join(SKILLS_SOURCE, f)).isDirectory())
    expect(folders.sort()).toEqual(SKILLS.map((s) => s.id).sort())
  })
})

describe('Skills do Claude (feature flags e sessão)', () => {
  const svc = new SkillsService()
  afterEach(() => svc.update({ enabled: true, skills: Object.fromEntries(SKILLS.map((s) => [s.id, true])) }))

  it('gives a feature only the enabled skills of the workspace technology', () => {
    const sfcc = svc.session('salesforce-b2c', 'develop')!
    const ids = sfcc.skills.map((s) => s.id)
    expect(ids).toEqual(expect.arrayContaining(['sfra-controllers', 'sfcc-quality-testing', 'delivery-discipline']))
    expect(ids.some((id) => id.startsWith('adobe-'))).toBe(false)
    expect(fs.existsSync(path.join(sfcc.pluginDir, '.claude-plugin', 'plugin.json'))).toBe(true)
    expect(fs.readdirSync(path.join(sfcc.pluginDir, 'skills')).sort()).toEqual([...ids].sort())
    expect(sfcc.skills[0].name).toMatch(/^agentic-toolkit:/)

    const adobe = svc.session('adobe-commerce', 'diagrams')!.skills.map((s) => s.id)
    expect(adobe).toEqual(expect.arrayContaining(['c4-architecture', 'mermaid-diagrams', 'adobe-architecture']))
    expect(adobe).not.toContain('sfcc-architecture')
  })

  it('turns one skill or all of them off', () => {
    svc.update({ skills: { 'sfra-controllers': false } })
    expect(svc.session('salesforce-b2c', 'develop')!.skills.map((s) => s.id)).not.toContain('sfra-controllers')
    expect(svc.view().skills.find((s) => s.id === 'sfra-controllers')?.enabled).toBe(false)
    svc.update({ enabled: false })
    expect(svc.session('salesforce-b2c', 'develop')).toBeNull()
    expect(() => svc.update({ skills: { inexistente: true } })).toThrow()
  })

  it('records a use with the title of the skill', () => {
    const use = svc.record({ workspace: 'w', feature: 'refine', skill: 'agentic-toolkit:sfra-controllers' })
    expect(use.title).toBe('Controllers SFRA')
    expect(svc.view().recent[0]).toMatchObject({ feature: 'refine', skill: 'agentic-toolkit:sfra-controllers' })
  })
})

describe('Skills na chamada do Claude Code', () => {
  const session = { pluginDir: '/dados/skills-runtime/abc', skills: [{ id: 'sfra-controllers', name: 'agentic-toolkit:sfra-controllers', title: 'Controllers SFRA' }] }

  it('adds the Skill tool, the plugin folder and the list of skills to the system prompt', () => {
    const args = withSkills(['-p', '--tools', 'Read,Grep,Glob', '--allowedTools', 'Read,Grep,Glob', '--append-system-prompt', 'Você é...'], session)
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Grep,Glob,Skill')
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('Read,Grep,Glob,Skill')
    expect(args.slice(-2)).toEqual(['--plugin-dir', '/dados/skills-runtime/abc'])
    expect(args[args.indexOf('--append-system-prompt') + 1]).toContain('agentic-toolkit:sfra-controllers')
    expect(withSkills(['-p'], null)).toEqual(['-p'])
  })

  it('reads the skills Claude loaded from the stream, like Claude Code shows them', () => {
    const ev = { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', name: 'Skill', input: { skill: 'agentic-toolkit:sfra-controllers' } }, { type: 'tool_use', name: 'Read', input: { file_path: 'x' } }] } }
    expect(skillsInEvent(JSON.stringify(ev))).toEqual(['agentic-toolkit:sfra-controllers'])
    expect(skillsInEvent('{"type":"result"}')).toEqual([])
    expect(skillsInEvent('não é json')).toEqual([])
  })
})
