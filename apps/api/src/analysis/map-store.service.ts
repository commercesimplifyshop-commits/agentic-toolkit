import { Injectable } from '@nestjs/common'
import fs from 'node:fs'
import path from 'node:path'
import { assertWritableTarget } from '../readonly/path-guard'
import { WorkspacesService } from '../workspaces/workspaces.service'

/** Integration map (extractor output) and annotations of a workspace, inside StoreFlow's data dir. */
@Injectable()
export class MapStore {
  constructor(private readonly workspaces: WorkspacesService) {}

  dir(id: string) {
    const dir = path.join(this.workspaces.dataDirOf(id), 'maps')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  readMap(id: string) {
    const file = path.join(this.dir(id), `${id}.json`)
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
  }

  readAnnotations(id: string) {
    const file = path.join(this.dir(id), `${id}.annotations.json`)
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
  }

  /** Merges annotations (zone/summary/risk per item); never touches the Magento code. */
  saveAnnotations(id: string, input: { zones?: Record<string, string>; items?: Record<string, unknown>; scope?: string }) {
    const file = path.join(this.dir(id), `${id}.annotations.json`)
    assertWritableTarget(file, [this.workspaces.rootOf(id)])
    const current = this.readAnnotations(id) ?? { items: {}, zones: {} }
    const next = {
      generatedAt: new Date().toISOString().slice(0, 10),
      scope: input.scope ?? current.scope,
      zones: { ...current.zones, ...input.zones },
      items: { ...current.items, ...input.items },
    }
    fs.writeFileSync(file, JSON.stringify(next, null, 1))
    return next
  }
}
