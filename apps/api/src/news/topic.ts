/**
 * A topic of the daily update (security bulletins today; release notes or others later).
 * Every topic reads its own source in the background and turns it into items the page and the
 * popup show the same way, so adding a topic does not change the layout.
 */
export type Tone = 'red' | 'yellow' | 'green' | 'neutral'

export interface TopicItem {
  id: string
  title: string
  url: string
  /** Publication day, yyyy-mm-dd */
  date?: string
  /** Urgency rating, 1 (most urgent) upwards. The traffic light reads it. */
  priority?: number
  /** Colour of the card: red needs action, yellow needs a check, green is fine */
  tone: Tone
  /** Short labels, e.g. severities */
  tags: string[]
  /** Plain-text lines with the impact or details */
  lines: string[]
  /** Official pages to act on (installation and release notes), shown as buttons */
  actions: { label: string; url: string }[]
}

export interface TopicProvider {
  id: string
  title: string
  description: string
  /** Reads the source. Throws on failure; the previous data is kept. */
  refresh(): Promise<void>
  /** When the source was last read successfully (ISO), if ever */
  fetchedAt(): string | undefined
  /** Most recent publication day among the items read so far */
  latestPublished(): string | undefined
  /** Items published on the given days (yyyy-mm-dd) */
  itemsFor(days: string[]): TopicItem[]
}

/** Per-topic switches: `enabled` searches and shows the topic, `popup` lists it in the popup */
export interface TopicSettings {
  enabled: boolean
  popup: boolean
}

export const DEFAULT_TOPIC_SETTINGS: TopicSettings = { enabled: true, popup: true }
