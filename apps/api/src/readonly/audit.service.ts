import { Injectable } from '@nestjs/common'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../config/paths'

export interface AuditEntry {
  at: string
  action: string
  kind: string
  method: string
  url: string
  workspace?: string
  verdict: 'allowed' | 'blocked'
  rule?: string
  detail?: string
}

const MAX_MEMORY = 500

/** Append-only log of every action and of every blocked attempt. */
@Injectable()
export class AuditService {
  private readonly file = path.join(DATA_DIR, 'audit.log')
  private readonly recent: AuditEntry[] = []

  record(entry: Omit<AuditEntry, 'at'>) {
    const full = { at: new Date().toISOString(), ...entry }
    this.recent.unshift(full)
    this.recent.length = Math.min(this.recent.length, MAX_MEMORY)
    try {
      fs.appendFileSync(this.file, JSON.stringify(full) + '\n')
    } catch {
      // the in-memory log still works if the disk is unavailable
    }
  }

  list(limit = 200) {
    return this.recent.slice(0, limit)
  }
}
