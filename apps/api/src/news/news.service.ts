import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { CORE_DIR } from '../config/paths'
import { SecurityBulletinTopic } from './security-bulletin.topic'
import { DEFAULT_TOPIC_SETTINGS, TopicItem, TopicProvider, TopicSettings } from './topic'

const HOUR_MS = 60 * 60_000
const DIR = path.join(CORE_DIR, 'news')
const SETTINGS_FILE = path.join(DIR, 'settings.json')

export type TopicsSettings = Record<string, TopicSettings>

export interface NewsSettings {
  /** The daily routine runs in the background (on start, and again when a new day begins) */
  routine: boolean
  /** Show the popup once the day's information is ready (topics with `popup` on are listed there) */
  popup: boolean
  /** Per topic: searched and shown, and listed in the popup */
  topics: TopicsSettings
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * Days shown when no day is chosen. On Monday the weekend is included: the bulletins of Saturday
 * and Sunday, which were published while nobody was checking. Other days show only today.
 */
export function defaultDays(now = new Date()): string[] {
  if (now.getDay() !== 1) return [localDay(now)]
  const sat = new Date(now)
  sat.setDate(now.getDate() - 2)
  const sun = new Date(now)
  sun.setDate(now.getDate() - 1)
  return [localDay(sat), localDay(sun)]
}

/**
 * The "atualização do dia": a set of topics, each read in the background and kept in the core
 * data folder. Nothing here changes a repository; each topic reads its own allowed source only.
 */
@Injectable()
export class NewsService implements OnApplicationBootstrap {
  private readonly log = new Logger('Atualização do dia')
  /** Identifies this run of the application: the popup shows once per run */
  readonly bootId = randomUUID()
  private state: 'idle' | 'running' | 'ready' | 'error' = 'idle'
  private startedAt?: string
  private finishedAt?: string
  private lastError?: string
  /** The topics of the update, in the order they are shown. A new topic is added here. */
  private readonly topics: TopicProvider[]

  constructor(security: SecurityBulletinTopic) {
    this.topics = [security]
  }

  /** Starts the routine without waiting for it: the application is usable while it runs */
  onApplicationBootstrap() {
    if (this.settings().routine) void this.run()
    const timer = setInterval(() => {
      if (this.settings().routine && !this.todayReady()) void this.run()
    }, HOUR_MS)
    timer.unref()
  }

  private topicSettings(id: string): TopicSettings {
    return { ...DEFAULT_TOPIC_SETTINGS, ...(this.readSettings().topics?.[id] ?? {}) }
  }

  private readSettings(): Partial<NewsSettings> {
    try {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) as Partial<NewsSettings>
    } catch {
      return {}
    }
  }

  settings(): NewsSettings {
    const saved = this.readSettings()
    const topics: TopicsSettings = {}
    for (const t of this.topics) topics[t.id] = this.topicSettings(t.id)
    return { routine: saved.routine ?? true, popup: saved.popup ?? true, topics }
  }

  /** Saves the switches. Unknown topics are ignored: only the topics this app has can be configured. */
  saveSettings(patch: { routine?: boolean; popup?: boolean; topics?: Record<string, Partial<TopicSettings>> }) {
    const saved = this.readSettings()
    const next: Partial<NewsSettings> = { routine: saved.routine ?? true, popup: saved.popup ?? true, topics: { ...(saved.topics ?? {}) } }
    if (patch.routine !== undefined) next.routine = patch.routine
    if (patch.popup !== undefined) next.popup = patch.popup
    for (const [id, change] of Object.entries(patch.topics ?? {})) {
      if (!this.topics.some((t) => t.id === id)) continue
      // a switch that was not sent keeps its value
      const sent = Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined))
      next.topics![id] = { ...this.topicSettings(id), ...sent }
    }
    fs.mkdirSync(DIR, { recursive: true })
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2))
    return this.settings()
  }

  /** The day's information is ready when every enabled topic was read today (no enabled topic: nothing to wait for) */
  todayReady(): boolean {
    const today = localDay(new Date())
    const enabled = this.topics.filter((t) => this.topicSettings(t.id).enabled)
    return enabled.every((t) => {
      const at = t.fetchedAt()
      return !!at && localDay(new Date(at)) === today
    })
  }

  status() {
    return {
      bootId: this.bootId,
      state: this.state,
      date: localDay(new Date()),
      todayReady: this.todayReady(),
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      lastError: this.lastError,
      fetchedAt: this.topics.map((t) => t.fetchedAt()).filter(Boolean).sort().pop(),
      settings: this.settings(),
    }
  }

  /** Runs the routine once for every enabled topic. A run already in progress is not started twice. */
  async run(force = false): Promise<void> {
    if (this.state === 'running') return
    if (!force && this.todayReady()) return
    this.state = 'running'
    this.startedAt = new Date().toISOString()
    this.lastError = undefined
    const errors: string[] = []
    for (const t of this.topics.filter((x) => this.topicSettings(x.id).enabled)) {
      try {
        await t.refresh()
      } catch (err) {
        errors.push(`${t.title}: ${(err as Error).message}`)
        this.log.warn(`Não consegui atualizar "${t.title}": ${(err as Error).message}`)
      }
    }
    this.state = errors.length ? 'error' : 'ready'
    this.lastError = errors.length ? errors.join(' · ') : undefined
    this.finishedAt = new Date().toISOString()
  }

  /**
   * What the page and the popup show for one day (default: today, or the weekend on a Monday).
   * Every topic is listed, so the page can switch each one on or off; disabled topics carry no items.
   */
  today(day?: string) {
    const dates = day ? [day] : defaultDays()
    const topics = this.topics.map((t) => {
      const s = this.topicSettings(t.id)
      const items: TopicItem[] = s.enabled ? t.itemsFor(dates) : []
      return {
        id: t.id,
        title: t.title,
        description: t.description,
        enabled: s.enabled,
        popup: s.popup,
        fetchedAt: t.fetchedAt(),
        latestPublished: t.latestPublished(),
        items,
      }
    })
    const latestPublished = topics.map((t) => t.latestPublished ?? '').sort().pop() || undefined
    return { date: localDay(new Date()), dates, ready: this.todayReady(), latestPublished, topics }
  }
}
