import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { assertWritableTarget } from '../readonly/path-guard'
import { parseGraph } from './graph'
import { WorkspacesService } from '../workspaces/workspaces.service'

export const DIAGRAM_KINDS = ['c4', 'uml', 'flow', 'other'] as const
export type DiagramKind = (typeof DIAGRAM_KINDS)[number]
export const DIAGRAM_MODES = ['code', 'canvas'] as const
export type DiagramMode = (typeof DIAGRAM_MODES)[number]

export interface Diagram {
  id: string
  name: string
  kind: DiagramKind
  /** "code": Mermaid source. "canvas": JSON graph (see graph.ts), edited visually */
  mode?: DiagramMode
  /** Mermaid source (code mode) or the JSON graph (canvas mode) */
  source: string
  createdAt: string
  updatedAt: string
}

/** Architecture diagrams (Mermaid source) kept in Agentic Toolkit's data dir, per installation. */
@Injectable()
export class DiagramsService {
  constructor(private readonly workspaces: WorkspacesService) {}

  private protectedRoots(id: string) {
    const root = this.workspaces.get(id).root
    return root ? [root] : []
  }

  private dir(id: string) {
    const dir = path.join(this.workspaces.dataDirOf(id), 'diagrams')
    assertWritableTarget(dir, this.protectedRoots(id))
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  private file(id: string, diagramId: string) {
    if (!/^[a-z0-9-]{4,80}$/.test(diagramId)) throw new BadRequestException('Diagrama inválido')
    return path.join(this.dir(id), `${diagramId}.json`)
  }

  private write(id: string, diagram: Diagram) {
    const file = this.file(id, diagram.id)
    assertWritableTarget(file, this.protectedRoots(id))
    // Write then rename: an interrupted save never leaves a half-written diagram
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(diagram, null, 2))
    fs.renameSync(`${file}.tmp`, file)
  }

  list(id: string) {
    const dir = this.dir(id)
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Diagram
          return { id: d.id, name: d.name, kind: d.kind, mode: d.mode ?? 'code', createdAt: d.createdAt, updatedAt: d.updatedAt, lines: d.source.split('\n').length }
        } catch {
          return null
        }
      })
      .filter(Boolean)
      .sort((a, b) => (b!.updatedAt > a!.updatedAt ? 1 : -1))
  }

  get(id: string, diagramId: string): Diagram {
    const file = this.file(id, diagramId)
    if (!fs.existsSync(file)) throw new NotFoundException('Diagrama não encontrado')
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  }

  create(id: string, input: { name?: string; kind?: DiagramKind; mode?: DiagramMode; source?: string }) {
    const now = new Date().toISOString()
    const name = input.name?.trim() || 'Diagrama sem título'
    const diagram: Diagram = {
      id: `${slug(name) || 'diagrama'}-${randomBytes(3).toString('hex')}`,
      name,
      kind: input.kind ?? 'c4',
      mode: input.mode ?? 'code',
      source: normalizeSource(input.mode ?? 'code', input.source ?? ''),
      createdAt: now,
      updatedAt: now,
    }
    this.write(id, diagram)
    return diagram
  }

  save(id: string, diagramId: string, input: { name?: string; kind?: DiagramKind; mode?: DiagramMode; source?: string }) {
    const diagram = this.get(id, diagramId)
    if (input.name !== undefined) diagram.name = input.name.trim() || diagram.name
    if (input.kind !== undefined) diagram.kind = input.kind
    if (input.mode !== undefined) diagram.mode = input.mode
    if (input.source !== undefined) diagram.source = normalizeSource(input.mode ?? diagram.mode ?? 'code', input.source)
    diagram.updatedAt = new Date().toISOString()
    this.write(id, diagram)
    return { id: diagram.id, name: diagram.name, updatedAt: diagram.updatedAt }
  }

  delete(id: string, diagramId: string) {
    const file = this.file(id, diagramId)
    if (fs.existsSync(file)) fs.unlinkSync(file)
    return { ok: true }
  }
}

/** Canvas sources must be a valid graph; code sources are stored as written. */
function normalizeSource(mode: DiagramMode, source: string) {
  if (mode !== 'canvas' || !source.trim()) return source
  return JSON.stringify(parseGraph(source))
}

function slug(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}
