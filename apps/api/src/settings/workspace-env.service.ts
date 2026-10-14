import { BadRequestException, Injectable } from '@nestjs/common'
import fs from 'node:fs'
import path from 'node:path'
import { WorkspacesService } from '../workspaces/workspaces.service'

export interface EnvVar {
  key: string
  value: string
  /** Shown masked and never sent back to the browser */
  secret: boolean
}

/** What the screen sees: secret values never leave the server */
export interface EnvVarView {
  key: string
  secret: boolean
  value?: string
  hasValue: boolean
}

const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const MAX_VARS = 40
const MAX_VALUE = 4000

/**
 * Names that would change how the tools themselves run (which programs, which credentials, which
 * hooks), so a project variable can never set them.
 */
const RESERVED = /^(PATH|PATHEXT|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|SYSTEMROOT|COMSPEC|TEMP|TMP|SHELL|NODE_OPTIONS|NODE_PATH|GIT_.*|LD_.*|DYLD_.*|ANTHROPIC_.*|CLAUDE_.*|AGENTIC_TOOLKIT_.*|NPM_CONFIG_.*|PYTHONPATH|PYTHONSTARTUP|PERL5OPT|RUBYOPT|BASH_ENV|ENV)$/i

/** A secret is guessed from the name; the screen can change it */
export const looksSecret = (key: string) => /PASS|SECRET|TOKEN|KEY|AUTH|CREDENTIAL|PRIVATE/i.test(key)

/**
 * Environment variables of a workspace: given to the commands that run the project for a task
 * (the development session of Claude Code). Kept in the workspace's data folder, never in the
 * project.
 */
@Injectable()
export class WorkspaceEnvService {
  constructor(private readonly workspaces: WorkspacesService) {}

  private file(id: string) {
    return path.join(this.workspaces.dataDirOf(id), 'env.json')
  }

  private read(id: string): EnvVar[] {
    try {
      const list = JSON.parse(fs.readFileSync(this.file(id), 'utf8')) as EnvVar[]
      return Array.isArray(list) ? list.filter((v) => v && KEY.test(v.key) && typeof v.value === 'string') : []
    } catch {
      return []
    }
  }

  view(id: string): EnvVarView[] {
    return this.read(id).map((v) => ({ key: v.key, secret: v.secret, hasValue: v.value !== '', ...(v.secret ? {} : { value: v.value }) }))
  }

  /** Values to add to a command's environment */
  values(id: string): Record<string, string> {
    return Object.fromEntries(this.read(id).map((v) => [v.key, v.value]))
  }

  /**
   * Replaces the list. A secret whose value is not sent keeps the value it had, so the screen
   * can save the list without ever holding the secret.
   */
  save(id: string, input: unknown): EnvVarView[] {
    if (!Array.isArray(input)) throw new BadRequestException('Envie a lista de variáveis')
    if (input.length > MAX_VARS) throw new BadRequestException(`Até ${MAX_VARS} variáveis por workspace`)
    const current = new Map(this.read(id).map((v) => [v.key, v]))
    const seen = new Set<string>()
    const next: EnvVar[] = []
    for (const raw of input as Record<string, unknown>[]) {
      const key = String(raw?.key ?? '').trim()
      if (!KEY.test(key)) throw new BadRequestException(`Nome de variável inválido: "${key}" (letras, números e _, sem começar com número)`)
      if (RESERVED.test(key)) throw new BadRequestException(`${key} é reservada: ela mudaria como as ferramentas rodam, e não pode ser definida aqui`)
      if (seen.has(key.toUpperCase())) throw new BadRequestException(`${key} aparece duas vezes`)
      seen.add(key.toUpperCase())
      const secret = typeof raw?.secret === 'boolean' ? raw.secret : looksSecret(key)
      let value: string
      if (typeof raw?.value === 'string') value = raw.value
      else if (current.has(key)) value = current.get(key)!.value
      else value = ''
      if (value.length > MAX_VALUE) throw new BadRequestException(`O valor de ${key} passa de ${MAX_VALUE} caracteres`)
      next.push({ key, value, secret })
    }
    fs.writeFileSync(this.file(id), JSON.stringify(next, null, 2))
    return this.view(id)
  }
}
