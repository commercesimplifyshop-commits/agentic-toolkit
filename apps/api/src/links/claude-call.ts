import { BadRequestException } from '@nestjs/common'
import { CLAUDE_DENIED_TOOLS, type CommandRunner } from '../readonly/command-runner.service'

/**
 * One Claude Code call that can only read the installation (Read, Grep, Glob; no edits,
 * no shell, no MCP). It returns the text of the answer; the caller decides what to do with it.
 */
export async function askClaudeReadonly(runner: CommandRunner, bin: string, root: string, system: string, prompt: string): Promise<string> {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--tools',
    'Read,Grep,Glob',
    '--allowedTools',
    'Read,Grep,Glob',
    '--disallowedTools',
    CLAUDE_DENIED_TOOLS.join(','),
    '--setting-sources',
    'user',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--append-system-prompt',
    system,
  ]
  const res = await runner.run('claude', args, { executable: bin, cwd: root, stdin: prompt, timeoutMs: 5 * 60_000, protectedRoots: [root] })
  let parsed: { result?: string; is_error?: boolean } = {}
  try {
    parsed = JSON.parse(res.stdout)
  } catch {
    throw new BadRequestException(`Claude Code falhou: ${(res.stderr || res.stdout).slice(0, 300)}`)
  }
  if (parsed.is_error) throw new BadRequestException(`Claude Code: ${(parsed.result ?? 'erro').slice(0, 300)}`)
  return parsed.result ?? ''
}
