import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { assertWritableTarget } from '../readonly/path-guard'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { TOOL_KINDS, type ToolKind } from './tool-catalog'

export interface ToolLink {
  id: string
  /** Name of the OpenSpec change (folder under changes/) */
  change: string
  kind: ToolKind
  /** Id of the diagram or board inside Agentic Toolkit's data dir */
  refId: string
  /** Title when the link was made; the list shows the current title */
  title: string
  createdAt: string
  /** Who made the link: the engineer, or Claude when it created the tool for the change */
  createdBy: 'usuário' | 'claude'
}

const CHANGE = /^[a-z0-9][a-z0-9-]{0,80}$/
const REF = /^[a-z0-9-]{4,80}$/

/**
 * Links between a change and the tools that support it. Stored in Agentic Toolkit's data dir
 * (never in the repository), so each tool can answer "which change uses me?".
 * This service only reads and writes the link table; it does not check the linked items.
 */
@Injectable()
export class LinksService {
  constructor(private readonly workspaces: WorkspacesService) {}

  private file(id: string) {
    const dir = this.workspaces.dataDirOf(id)
    assertWritableTarget(dir, [this.workspaces.rootOf(id)])
    fs.mkdirSync(dir, { recursive: true })
    return path.join(dir, 'links.json')
  }

  private read(id: string): ToolLink[] {
    try {
      return JSON.parse(fs.readFileSync(this.file(id), 'utf8')) as ToolLink[]
    } catch {
      return []
    }
  }

  private write(id: string, links: ToolLink[]) {
    const file = this.file(id)
    // Write then rename: an interrupted save never leaves a half-written link table
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(links, null, 2))
    fs.renameSync(`${file}.tmp`, file)
  }

  list(id: string, filter: { change?: string; kind?: ToolKind; refId?: string } = {}) {
    return this.read(id).filter(
      (l) => (!filter.change || l.change === filter.change) && (!filter.kind || l.kind === filter.kind) && (!filter.refId || l.refId === filter.refId),
    )
  }

  add(id: string, input: { change: string; kind: ToolKind; refId: string; title: string; createdBy?: 'usuário' | 'claude' }): ToolLink {
    if (!CHANGE.test(input.change)) throw new BadRequestException('Mudança inválida')
    if (!TOOL_KINDS.includes(input.kind)) throw new BadRequestException('Tipo de ferramenta inválido')
    if (!REF.test(input.refId)) throw new BadRequestException('Ferramenta inválida')
    const links = this.read(id)
    const same = links.find((l) => l.change === input.change && l.kind === input.kind && l.refId === input.refId)
    if (same) return same
    const link: ToolLink = {
      id: randomBytes(5).toString('hex'),
      change: input.change,
      kind: input.kind,
      refId: input.refId,
      title: String(input.title ?? '').slice(0, 160) || input.refId,
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy ?? 'usuário',
    }
    this.write(id, [...links, link])
    return link
  }

  remove(id: string, linkId: string) {
    const links = this.read(id)
    if (!links.some((l) => l.id === linkId)) throw new NotFoundException('Vínculo não encontrado')
    this.write(id, links.filter((l) => l.id !== linkId))
    return { ok: true }
  }

  /** Called when a diagram or board is deleted, so no link points at nothing */
  removeRef(id: string, kind: ToolKind, refId: string) {
    const links = this.read(id)
    const kept = links.filter((l) => !(l.kind === kind && l.refId === refId))
    if (kept.length !== links.length) this.write(id, kept)
  }

  /** Called when a change is deleted */
  removeChange(id: string, change: string) {
    const links = this.read(id)
    const kept = links.filter((l) => l.change !== change)
    if (kept.length !== links.length) this.write(id, kept)
  }
}
