import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { assertWritableTarget } from '../readonly/path-guard'
import { WorkspacesService } from '../workspaces/workspaces.service'

export interface BoardScene {
  elements: unknown[]
  appState?: Record<string, unknown>
  files?: Record<string, unknown>
}

export interface Board {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  scene: BoardScene
}

/** Whiteboards (Excalidraw scenes) kept in StoreFlow's data dir, per installation. */
@Injectable()
export class BoardsService {
  constructor(private readonly workspaces: WorkspacesService) {}

  private protectedRoots(id: string) {
    const root = this.workspaces.get(id).magentoRoot
    return root ? [root] : []
  }

  private dir(id: string) {
    const dir = path.join(this.workspaces.dataDirOf(id), 'boards')
    assertWritableTarget(dir, this.protectedRoots(id))
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  private file(id: string, boardId: string) {
    if (!/^[a-z0-9-]{4,80}$/.test(boardId)) throw new BadRequestException('Quadro inválido')
    return path.join(this.dir(id), `${boardId}.json`)
  }

  private write(id: string, board: Board) {
    const file = this.file(id, board.id)
    assertWritableTarget(file, this.protectedRoots(id))
    // Write then rename: an interrupted save never leaves a half-written board
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(board))
    fs.renameSync(`${file}.tmp`, file)
  }

  list(id: string) {
    const dir = this.dir(id)
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const b = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Board
          const elements = (b.scene.elements ?? []).filter((e) => !(e as { isDeleted?: boolean }).isDeleted).length
          return { id: b.id, name: b.name, createdAt: b.createdAt, updatedAt: b.updatedAt, elements }
        } catch {
          return null
        }
      })
      .filter(Boolean)
      .sort((a, b) => (b!.updatedAt > a!.updatedAt ? 1 : -1))
  }

  get(id: string, boardId: string): Board {
    const file = this.file(id, boardId)
    if (!fs.existsSync(file)) throw new NotFoundException('Quadro não encontrado')
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  }

  create(id: string, name: string) {
    const now = new Date().toISOString()
    const clean = name.trim() || 'Quadro sem título'
    const board: Board = { id: `${slug(clean) || 'quadro'}-${randomBytes(3).toString('hex')}`, name: clean, createdAt: now, updatedAt: now, scene: { elements: [] } }
    this.write(id, board)
    return board
  }

  save(id: string, boardId: string, input: { name?: string; scene?: BoardScene }) {
    const board = this.get(id, boardId)
    if (input.name !== undefined) board.name = input.name.trim() || board.name
    if (input.scene) board.scene = { elements: input.scene.elements, appState: input.scene.appState, files: input.scene.files }
    board.updatedAt = new Date().toISOString()
    this.write(id, board)
    return { id: board.id, name: board.name, updatedAt: board.updatedAt }
  }

  delete(id: string, boardId: string) {
    const file = this.file(id, boardId)
    if (fs.existsSync(file)) fs.unlinkSync(file)
    return { ok: true }
  }
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
