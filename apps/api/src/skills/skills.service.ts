import { BadRequestException, Injectable, NotFoundException, OnApplicationBootstrap } from '@nestjs/common'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { CORE_DIR, DATA_DIR, type TechId } from '../config/paths'
import { FEATURE_LABEL, SKILL_FEATURES, SKILL_PLUGIN, SKILLS, skillName, type SkillDef, type SkillFeature } from './catalog'

/** apps/api/skills, from src/skills (tests) and dist/skills (build) alike */
export const SKILLS_SOURCE = path.resolve(__dirname, '..', '..', 'skills')
const SETTINGS_FILE = path.join(CORE_DIR, 'skills.json')
const RUNTIME_DIR = path.join(DATA_DIR, 'skills-runtime')
const MAX_RECENT = 200

export interface SkillsSettings {
  /** Master switch: off, Claude runs without the toolkit's skills */
  enabled: boolean
  /** Feature flags per skill; a skill missing here is on */
  skills: Record<string, boolean>
}

/** The skills a Claude Code session gets: a plugin folder for --plugin-dir and what it holds */
export interface SkillSession {
  pluginDir: string
  skills: { id: string; name: string; title: string }[]
}

export interface SkillUse {
  at: string
  workspace?: string
  feature: SkillFeature
  skill: string
  title: string
}

/**
 * Skills of the toolkit for Claude Code. Each feature that runs Claude gets, as a plugin for that
 * session, the enabled skills of its technology that list it. Uses are reported back from the
 * session's stream (a Skill tool call), like Claude Code shows them.
 */
@Injectable()
export class SkillsService implements OnApplicationBootstrap {
  private readonly recent: SkillUse[] = []

  /** Plugin folders are rebuilt from the sources after each start, so an update reaches them */
  onApplicationBootstrap() {
    fs.rmSync(RUNTIME_DIR, { recursive: true, force: true })
  }

  settings(): SkillsSettings {
    try {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) as Partial<SkillsSettings>
      return { enabled: raw.enabled !== false, skills: raw.skills && typeof raw.skills === 'object' ? raw.skills : {} }
    } catch {
      return { enabled: true, skills: {} }
    }
  }

  update(patch: { enabled?: unknown; skills?: unknown }) {
    const next = this.settings()
    if (patch.enabled !== undefined) next.enabled = Boolean(patch.enabled)
    if (patch.skills !== undefined) {
      if (!patch.skills || typeof patch.skills !== 'object') throw new BadRequestException('Skills inválidas')
      for (const [id, on] of Object.entries(patch.skills as Record<string, unknown>)) {
        if (!SKILLS.some((s) => s.id === id)) throw new BadRequestException(`Skill desconhecida: ${id}`)
        next.skills[id] = Boolean(on)
      }
    }
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true })
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2))
    return this.view()
  }

  isOn(id: string, s = this.settings()) {
    return s.enabled && s.skills[id] !== false
  }

  private file(id: string) {
    return path.join(SKILLS_SOURCE, id, 'SKILL.md')
  }

  /** The SKILL.md of a skill */
  content(id: string) {
    const def = SKILLS.find((s) => s.id === id)
    if (!def) throw new NotFoundException('Skill não encontrada')
    return fs.readFileSync(this.file(id), 'utf8')
  }

  private description(id: string) {
    try {
      const m = this.content(id).match(/^---\s*\n[\s\S]*?^description:\s*(.+)$/m)
      return m ? m[1].trim() : ''
    } catch {
      return ''
    }
  }

  /** Configurações → IA → Skills */
  view() {
    const s = this.settings()
    return {
      enabled: s.enabled,
      features: SKILL_FEATURES.map((id) => ({ id, label: FEATURE_LABEL[id] })),
      skills: SKILLS.map((d) => ({ ...d, name: skillName(d.id), description: this.description(d.id), enabled: s.skills[d.id] !== false })),
      recent: this.recent.slice(0, 50),
    }
  }

  /** The enabled skills of a feature for a technology */
  skillsFor(tech: TechId, feature: SkillFeature): SkillDef[] {
    const s = this.settings()
    return SKILLS.filter((d) => d.features.includes(feature) && (d.techs.length === 0 || d.techs.includes(tech)) && this.isOn(d.id, s))
  }

  /** Builds (once per set of skills) the plugin folder a session loads with --plugin-dir */
  session(tech: TechId | undefined, feature: SkillFeature): SkillSession | null {
    const defs = this.skillsFor(tech ?? 'adobe-commerce', feature)
    if (!defs.length) return null
    const key = createHash('sha1').update(defs.map((d) => d.id).join(',')).digest('hex').slice(0, 12)
    const pluginDir = path.join(RUNTIME_DIR, key)
    if (!fs.existsSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'))) {
      const tmp = `${pluginDir}.tmp-${process.pid}-${Date.now()}`
      fs.mkdirSync(path.join(tmp, '.claude-plugin'), { recursive: true })
      fs.writeFileSync(path.join(tmp, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: SKILL_PLUGIN, version: '1.0.0', description: 'Skills do Agentic Toolkit' }, null, 2))
      for (const d of defs) {
        fs.mkdirSync(path.join(tmp, 'skills', d.id), { recursive: true })
        fs.copyFileSync(this.file(d.id), path.join(tmp, 'skills', d.id, 'SKILL.md'))
      }
      try {
        fs.renameSync(tmp, pluginDir)
      } catch {
        // another session built the same folder meanwhile
        fs.rmSync(tmp, { recursive: true, force: true })
      }
    }
    return { pluginDir, skills: defs.map((d) => ({ id: d.id, name: skillName(d.id), title: d.title })) }
  }

  /** Title of a skill name Claude reported ("agentic-toolkit:x", or a skill of the user's own) */
  titleOf(name: string) {
    const id = name.startsWith(`${SKILL_PLUGIN}:`) ? name.slice(SKILL_PLUGIN.length + 1) : ''
    return SKILLS.find((s) => s.id === id)?.title ?? name
  }

  record(use: Omit<SkillUse, 'at' | 'title'>) {
    const full: SkillUse = { at: new Date().toISOString(), title: this.titleOf(use.skill), ...use }
    this.recent.unshift(full)
    this.recent.length = Math.min(this.recent.length, MAX_RECENT)
    return full
  }
}
