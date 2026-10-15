import type { CommandRunner, RunOptions, RunResult } from '../readonly/command-runner.service'
import type { SkillSession } from './skills.service'

/** Adds the Skill tool to a comma-separated tool list */
const addSkillTool = (list: string) => (list.split(',').includes('Skill') ? list : `${list},Skill`)

/**
 * The arguments of a Claude Code call with the session's skills: the Skill tool, the plugin folder
 * and a line in the system prompt telling Claude which skills to load. Without skills, unchanged.
 */
export function withSkills(args: string[], session: SkillSession | null): string[] {
  if (!session?.skills.length) return args
  const out = [...args]
  for (const flag of ['--tools', '--allowedTools']) {
    const i = out.indexOf(flag)
    if (i >= 0 && out[i + 1]) out[i + 1] = addSkillTool(out[i + 1])
  }
  const guide = [
    '',
    'Skills do Agentic Toolkit para esta tarefa. Antes de responder ou implementar, carregue com a ferramenta Skill as que se aplicam ao pedido e siga o que elas dizem:',
    ...session.skills.map((s) => `- ${s.name}: ${s.title}`),
    'Prefira estas skills às demais que estiverem disponíveis.',
  ].join('\n')
  const p = out.indexOf('--append-system-prompt')
  if (p >= 0 && out[p + 1] !== undefined) out[p + 1] = `${out[p + 1]}\n${guide}`
  else out.push('--append-system-prompt', guide.trim())
  out.push('--plugin-dir', session.pluginDir)
  return out
}

/** Skill names in one stream-json event (a Skill tool call), in order */
export function skillsInEvent(line: string | Record<string, unknown>): string[] {
  let ev: Record<string, unknown>
  try {
    ev = typeof line === 'string' ? JSON.parse(line) : line
  } catch {
    return []
  }
  if (ev?.type !== 'assistant') return []
  const blocks = ((ev.message as { content?: unknown[] })?.content ?? []) as { type?: string; name?: string; input?: { skill?: unknown } }[]
  return blocks.filter((b) => b.type === 'tool_use' && b.name === 'Skill' && typeof b.input?.skill === 'string').map((b) => String(b.input!.skill))
}

/**
 * Runs a Claude Code call that asked for `--output-format json` as stream-json instead, to see the
 * skills it loads. The result comes back the same way: stdout holds the final result object.
 */
export async function runClaudeWatchingSkills(runner: CommandRunner, args: string[], opts: RunOptions, onSkill: (name: string) => void): Promise<RunResult & { skills: string[] }> {
  const streamed = [...args]
  const i = streamed.indexOf('--output-format')
  if (i >= 0) streamed[i + 1] = 'stream-json'
  if (!streamed.includes('--verbose')) streamed.push('--verbose')
  const skills: string[] = []
  let result = ''
  const res = await runner.run('claude', streamed, {
    ...opts,
    onLine: (line) => {
      opts.onLine?.(line)
      for (const name of skillsInEvent(line)) {
        skills.push(name)
        onSkill(name)
      }
      if (line.startsWith('{"type":"result"')) result = line
      else if (!result && line.includes('"type":"result"')) {
        try {
          if ((JSON.parse(line) as { type?: string }).type === 'result') result = line
        } catch {
          // not a whole event
        }
      }
    },
  })
  return { ...res, stdout: result || res.stdout, skills }
}
