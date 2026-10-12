import { Injectable } from '@nestjs/common'
import fs from 'node:fs'
import path from 'node:path'
import { isSensitive, ReadOnlyViolation, resolveInside } from './path-guard'

export interface DirEntry {
  name: string
  path: string
  type: 'dir' | 'file'
  size?: number
  sensitive?: boolean
}

const MAX_FILE_BYTES = 2 * 1024 * 1024

/**
 * The only way the API touches Magento code. It exposes read operations only;
 * there is deliberately no write, rename, delete or chmod here.
 */
@Injectable()
export class ReadOnlyFs {
  exists(root: string, rel: string) {
    try {
      return fs.existsSync(resolveInside(root, rel))
    } catch {
      return false
    }
  }

  isDir(root: string, rel: string) {
    try {
      return fs.statSync(resolveInside(root, rel)).isDirectory()
    } catch {
      return false
    }
  }

  list(root: string, rel = ''): DirEntry[] {
    const dir = resolveInside(root, rel)
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isFile())
      .map((e) => {
        const childRel = path.posix.join(rel.split(path.sep).join('/'), e.name)
        const entry: DirEntry = { name: e.name, path: childRel, type: e.isDirectory() ? 'dir' : 'file' }
        if (e.isFile()) {
          entry.size = fs.statSync(path.join(dir, e.name)).size
          if (isSensitive(childRel)) entry.sensitive = true
        }
        return entry
      })
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
  }

  /** Text content of a file. Sensitive files are refused, big files truncated. */
  read(root: string, rel: string, maxBytes = MAX_FILE_BYTES): { content: string; truncated: boolean; size: number } {
    if (isSensitive(rel)) throw new ReadOnlyViolation(`Arquivo sensível não é lido: ${rel}`, 'read.sensitive-file')
    const file = resolveInside(root, rel)
    const fd = fs.openSync(file, 'r') // read-only flag, by construction
    try {
      const size = fs.fstatSync(fd).size
      const buf = Buffer.alloc(Math.min(size, maxBytes))
      fs.readSync(fd, buf, 0, buf.length, 0)
      return { content: buf.toString('utf8'), truncated: size > maxBytes, size }
    } finally {
      fs.closeSync(fd)
    }
  }

  readJson<T = unknown>(root: string, rel: string): T | null {
    try {
      return JSON.parse(this.read(root, rel).content) as T
    } catch {
      return null
    }
  }

  /** Depth-limited walk, skipping heavy/irrelevant folders. */
  walk(root: string, rel: string, opts: { maxFiles?: number; skip?: string[] } = {}): string[] {
    const out: string[] = []
    const skip = new Set(opts.skip ?? ['node_modules', '.git', 'vendor', 'generated', 'pub', 'var', 'dev', 'setup', 'update'])
    const stack = [rel]
    while (stack.length && out.length < (opts.maxFiles ?? 50000)) {
      const cur = stack.pop()!
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(resolveInside(root, cur), { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) {
        const child = cur ? `${cur}/${e.name}` : e.name
        if (e.isDirectory()) {
          if (!skip.has(e.name)) stack.push(child)
        } else if (e.isFile()) out.push(child)
      }
    }
    return out
  }

  /** Plain-text search (used by the AI tools). Skips sensitive files. */
  grep(root: string, pattern: string, opts: { under?: string; glob?: RegExp; maxMatches?: number } = {}) {
    const re = new RegExp(pattern, 'i')
    const matches: { file: string; line: number; text: string }[] = []
    for (const file of this.walk(root, opts.under ?? '', { maxFiles: 60000 })) {
      if (matches.length >= (opts.maxMatches ?? 200)) break
      if (isSensitive(file) || (opts.glob && !opts.glob.test(file))) continue
      if (!/\.(php|xml|phtml|js|ts|json|graphqls|less|html|yaml|yml|md|csv)$/i.test(file)) continue
      let text: string
      try {
        text = this.read(root, file, 512 * 1024).content
      } catch {
        continue
      }
      const lines = text.split('\n')
      for (let i = 0; i < lines.length && matches.length < (opts.maxMatches ?? 200); i++) {
        if (re.test(lines[i])) matches.push({ file, line: i + 1, text: lines[i].trim().slice(0, 240) })
      }
    }
    return matches
  }
}
