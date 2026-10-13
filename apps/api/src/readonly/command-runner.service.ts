import { Injectable } from '@nestjs/common'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { ANALYZER_DIR, DATA_DIR } from '../config/paths'
import { assertWritableTarget, isInside, ReadOnlyViolation } from './path-guard'

export interface RunOptions {
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
  /** Directories that must never be written to (the Magento roots involved) */
  protectedRoots?: string[]
  onLine?: (line: string) => void
  /** Real binary to spawn when the validated program name is a logical one (e.g. claude → claude.exe path) */
  executable?: string
  stdin?: string
  /** Stops the process (e.g. the user cancelled a documentation run) */
  signal?: AbortSignal
}

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/** git subcommands Agentic Toolkit may use: clone/fetch into its data dir and read-only queries. */
const GIT_ALLOWED = new Set(['clone', 'fetch', 'rev-parse', 'log', 'ls-remote', 'ls-files', 'remote', 'sparse-checkout', 'checkout', 'branch', 'shortlog', 'show'])
const GIT_FORBIDDEN_FLAGS = [/^--upload-pack/, /^--receive-pack/, /^-u$/, /^--exec/, /^--template/, /^--config=core\.(hooksPath|sshCommand|fsmonitor)/]

const ANALYZER_SCRIPTS = new Set(['extract.mjs', 'native-reference.mjs', 'context.mjs'])

/** OpenSpec verbs that only read: list, show, status and validate (see validateOpenSpec). */
export const OPENSPEC_READ_VERBS = ['list', 'show', 'status', 'validate', '--version']
const OPENSPEC_VALIDATE_FLAGS = ['--all', '--changes', '--specs', '--json', '--strict', '--no-interactive', '--type', '--concurrency', '--report']

/** Claude Code may only use tools that read */
export const CLAUDE_READONLY_TOOLS = ['Read', 'Grep', 'Glob']
export const CLAUDE_DENIED_TOOLS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash', 'WebFetch', 'WebSearch']

/**
 * Publishing a finished doc to Claude Docs is a separate run with no access to
 * code at all: no Read/Grep/Glob, cwd inside the data dir, and only the Claude
 * Docs connector (create/fill/read, never delete) plus the Artifact tool that
 * creates the doc's page from the Docs type.
 */
export const CLAUDE_DOCS_BUILTINS = ['Artifact', 'ToolSearch']
const DOCS_MCP = 'mcp__claude_ai_Claude_Docs__'
export const CLAUDE_DOCS_TOOLS = [...CLAUDE_DOCS_BUILTINS, ...['guide', 'create', 'batch', 'update', 'read', 'query'].map((t) => DOCS_MCP + t)]
export const CLAUDE_DOCS_DENIED = [...CLAUDE_DENIED_TOOLS, 'Read', 'Grep', 'Glob', 'PowerShell', 'Agent', `${DOCS_MCP}delete`]

/**
 * Validates and runs external programs. Every command is checked against an
 * allowlist before it starts; anything that could write to a Magento
 * repository is rejected.
 */
@Injectable()
export class CommandRunner {
  validate(cmd: string, args: string[], opts: RunOptions = {}) {
    const protectedRoots = opts.protectedRoots ?? []
    switch (cmd) {
      case 'git':
        return this.validateGit(args, opts)
      case process.execPath:
      case 'node': {
        const script = args[0] ? path.resolve(args[0]) : ''
        if (path.dirname(script) !== ANALYZER_DIR || !ANALYZER_SCRIPTS.has(path.basename(script))) {
          throw new ReadOnlyViolation(`Script node não permitido: ${args[0]}`, 'cmd.node-script')
        }
        for (const flag of ['--out', '--dir', '--maps-dir']) {
          const i = args.indexOf(flag)
          if (i >= 0) assertWritableTarget(args[i + 1], protectedRoots)
        }
        if (path.basename(script) === 'native-reference.mjs' && !args.includes('--dir')) {
          throw new ReadOnlyViolation('native-reference precisa de --dir dentro do diretório de dados', 'cmd.node-script')
        }
        return
      }
      case 'claude': {
        // Version check: no prompt, no tools, nothing to protect
        if (args.length === 1 && args[0] === '--version') return
        const listAfter = (flag: string) => {
          const i = args.indexOf(flag)
          return i < 0 ? null : (args[i + 1] ?? '').split(/[ ,]+/).filter(Boolean)
        }
        // --tools restricts the tool set itself; --allowedTools only pre-approves
        for (const flag of ['--tools', '--allowedTools']) {
          const tools = listAfter(flag)
          if (!tools || tools.length === 0 || tools.some((t) => !CLAUDE_READONLY_TOOLS.includes(t))) {
            throw new ReadOnlyViolation(`Claude Code precisa de ${flag} só com ferramentas de leitura (${CLAUDE_READONLY_TOOLS.join(', ')})`, 'cmd.claude-tools')
          }
        }
        const denied = listAfter('--disallowedTools') ?? []
        if (CLAUDE_DENIED_TOOLS.some((t) => !denied.includes(t))) throw new ReadOnlyViolation('Claude Code precisa negar explicitamente Edit/Write/Bash/Web*', 'cmd.claude-tools')
        // A Magento repo could ship .claude/settings.json with hooks: only user settings load
        if (listAfter('--setting-sources')?.join(',') !== 'user') throw new ReadOnlyViolation('Claude Code precisa de --setting-sources user (ignora hooks do repositório)', 'cmd.claude-settings')
        if (!args.includes('--strict-mcp-config')) throw new ReadOnlyViolation('Claude Code precisa de --strict-mcp-config (sem servidores MCP)', 'cmd.claude-mcp')
        if (args.some((a) => /dangerously|bypassPermissions|acceptEdits/.test(a))) throw new ReadOnlyViolation('Bypass de permissões do Claude Code é proibido', 'cmd.claude-bypass')
        // Extra readable dirs may only be Agentic Toolkit's own data (maps, annotations)
        args.forEach((a, i) => {
          if (a === '--add-dir') assertWritableTarget(args[i + 1] ?? '', protectedRoots)
        })
        return
      }
      case 'openspec':
        return this.validateOpenSpec(args, opts)
      case 'claude-docs':
        return this.validateClaudeDocs(args, opts)
      default:
        throw new ReadOnlyViolation(`Programa não permitido: ${cmd}`, 'cmd.not-allowed')
    }
  }

  /**
   * OpenSpec CLI, read-only verbs only. Anything that writes (init, update, archive,
   * change, config, store...) is refused: the dashboard never changes a repository.
   */
  private validateOpenSpec(args: string[], opts: RunOptions) {
    const entry = opts.executable ?? ''
    if (!/[\\/]@fission-ai[\\/]openspec[\\/]bin[\\/]openspec\.js$/.test(entry)) throw new ReadOnlyViolation('Executável do OpenSpec não reconhecido', 'cmd.openspec-entry')
    const verb = args[0]
    if (verb === 'init') {
      // Install runs only in a staging folder inside Agentic Toolkit's data dir: the files are
      // checked and copied by RepoWriter, the CLI never writes into the Magento repository
      if (args.join(' ') !== 'init --tools claude .') throw new ReadOnlyViolation('Instalação aceita apenas "init --tools claude ."', 'cmd.openspec-init-args')
      if (!isInside(DATA_DIR, path.resolve(opts.cwd ?? ''))) throw new ReadOnlyViolation('O init só roda na pasta de preparação do Agentic Toolkit', 'cmd.openspec-init-cwd')
      return
    }
    if (!OPENSPEC_READ_VERBS.includes(verb)) throw new ReadOnlyViolation(`OpenSpec "${verb}" escreve no projeto e não é permitido aqui`, 'cmd.openspec-verb')
    if (verb === 'validate' && args.some((a) => a.startsWith('--') && !OPENSPEC_VALIDATE_FLAGS.includes(a))) {
      throw new ReadOnlyViolation('Flag de validação não permitida', 'cmd.openspec-flag')
    }
    if (args.some((a) => a === '--store' || a.startsWith('--store='))) throw new ReadOnlyViolation('--store aponta para outro repositório: não permitido', 'cmd.openspec-store')
    if (!opts.cwd) throw new ReadOnlyViolation('OpenSpec precisa de um diretório de trabalho', 'cmd.openspec-cwd')
  }

  private validateClaudeDocs(args: string[], opts: RunOptions) {
    const listAfter = (flag: string) => {
      const i = args.indexOf(flag)
      return i < 0 ? null : (args[i + 1] ?? '').split(/[ ,]+/).filter(Boolean)
    }
    const tools = listAfter('--tools')
    if (!tools || tools.some((t) => !CLAUDE_DOCS_BUILTINS.includes(t))) throw new ReadOnlyViolation(`Publicação no Claude Docs só pode usar ${CLAUDE_DOCS_BUILTINS.join(', ')}`, 'cmd.claude-docs-tools')
    const allowed = listAfter('--allowedTools')
    if (!allowed || allowed.some((t) => !CLAUDE_DOCS_TOOLS.includes(t))) throw new ReadOnlyViolation('Publicação no Claude Docs só pode liberar o conector do Claude Docs', 'cmd.claude-docs-tools')
    const denied = listAfter('--disallowedTools') ?? []
    if (CLAUDE_DOCS_DENIED.some((t) => !denied.includes(t))) throw new ReadOnlyViolation('Publicação no Claude Docs precisa negar leitura de código, escrita e exclusão', 'cmd.claude-docs-tools')
    if (listAfter('--setting-sources')?.join(',') !== 'user') throw new ReadOnlyViolation('Claude Code precisa de --setting-sources user', 'cmd.claude-settings')
    if (args.some((a) => /dangerously|bypassPermissions|acceptEdits|^--add-dir$/.test(a))) throw new ReadOnlyViolation('Publicação no Claude Docs não pode ampliar acesso nem pular permissões', 'cmd.claude-bypass')
    // No code in reach: it runs from a folder inside Agentic Toolkit's data dir
    if (!opts.cwd) throw new ReadOnlyViolation('Publicação no Claude Docs precisa de um diretório de trabalho', 'cmd.claude-docs-cwd')
    assertWritableTarget(opts.cwd, opts.protectedRoots ?? [])
  }

  private validateGit(args: string[], opts: RunOptions) {
    // git -C <dir> <sub> ... : -C must point inside the data dir for anything that writes
    let i = 0
    let workDir = opts.cwd
    while (args[i] === '-C' || args[i] === '-c') {
      if (args[i] === '-C') workDir = args[i + 1]
      if (args[i] === '-c' && /^(core\.(hooksPath|sshCommand|fsmonitor)|protocol\.(file|ext)\.allow=always)/.test(args[i + 1])) {
        throw new ReadOnlyViolation(`Configuração git não permitida: ${args[i + 1]}`, 'cmd.git-config')
      }
      i += 2
    }
    const sub = args[i]
    if (!GIT_ALLOWED.has(sub)) throw new ReadOnlyViolation(`git ${sub} não é permitido (somente leitura)`, 'cmd.git-subcommand')
    const rest = args.slice(i + 1)
    for (const a of rest) {
      if (GIT_FORBIDDEN_FLAGS.some((re) => re.test(a))) throw new ReadOnlyViolation(`Flag git não permitida: ${a}`, 'cmd.git-flag')
    }

    if (sub === 'remote' && !(rest[0] === 'get-url' || (rest[0] === 'set-url' && rest[1] === '--push'))) {
      throw new ReadOnlyViolation('git remote só pode ler a URL ou desativar o push', 'cmd.git-remote')
    }
    if (sub === 'branch' && rest.some((a) => !/^(--show-current|-a|-r|--list)$/.test(a))) {
      throw new ReadOnlyViolation('git branch só pode listar', 'cmd.git-branch')
    }
    // Commands that write to a working tree only run in Agentic Toolkit's own clones
    if (['clone', 'fetch', 'sparse-checkout', 'checkout'].includes(sub) || (sub === 'remote' && rest[0] === 'set-url')) {
      const target = sub === 'clone' ? rest.filter((a) => !a.startsWith('-')).pop() : workDir
      if (!target) throw new ReadOnlyViolation(`git ${sub} sem destino explícito`, 'cmd.git-target')
      assertWritableTarget(path.resolve(opts.cwd ?? '.', target), opts.protectedRoots ?? [])
    }
    if (sub === 'clone') {
      const url = rest.filter((a) => !a.startsWith('-')).slice(-2)[0] ?? ''
      if (!/^(https:\/\/|ssh:\/\/|git@[\w.-]+:)/.test(url)) throw new ReadOnlyViolation(`URL de repositório não permitida: ${url}`, 'cmd.git-url')
    }
  }

  run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
    this.validate(cmd, args, opts)
    return new Promise((resolve, reject) => {
      // The OpenSpec CLI is a Node script: run it with this Node, never through a shell
      const target = cmd === 'openspec' ? process.execPath : (opts.executable ?? (cmd === 'node' ? process.execPath : cmd === 'claude-docs' ? 'claude' : cmd))
      const argv = cmd === 'openspec' ? [opts.executable ?? '', ...args] : args
      const child = spawn(target, argv, {
        cwd: opts.cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...opts.env },
        shell: false,
        windowsHide: true,
      })
      if (opts.stdin !== undefined) child.stdin.end(opts.stdin)
      else child.stdin.end()
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? 10 * 60_000)
      const abort = () => child.kill()
      if (opts.signal?.aborted) abort()
      opts.signal?.addEventListener('abort', abort, { once: true })
      // A line can arrive split across chunks: only whole lines go to onLine
      const partial = { out: '', err: '' }
      const feed = (chunk: Buffer, sink: 'out' | 'err') => {
        const text = chunk.toString()
        if (sink === 'out') stdout += text
        else stderr += text
        if (!opts.onLine) return
        const lines = (partial[sink] + text).split(/\r?\n/)
        partial[sink] = lines.pop() ?? ''
        for (const line of lines) if (line.trim()) opts.onLine(line)
      }
      child.stdout.on('data', (c) => feed(c, 'out'))
      child.stderr.on('data', (c) => feed(c, 'err'))
      const done = () => {
        clearTimeout(timer)
        opts.signal?.removeEventListener('abort', abort)
      }
      child.on('error', (err) => {
        done()
        reject(err)
      })
      child.on('close', (code) => {
        done()
        for (const rest of [partial.out, partial.err]) if (opts.onLine && rest.trim()) opts.onLine(rest)
        resolve({ code: code ?? -1, stdout, stderr })
      })
    })
  }
}
