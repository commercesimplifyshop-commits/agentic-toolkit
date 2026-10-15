import { Injectable } from '@nestjs/common'
import fs from 'node:fs'
import path from 'node:path'
import { CommandRunner } from '../readonly/command-runner.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import type { Card } from './refine.service'

const CARD_ID = /^[a-f0-9]{10}$/
/** A link to a card in this app: /w/<workspace>/refinamento/<card> */
const CARD_LINK = /\/w\/([a-z0-9-]{3,64})\/refinamento\/([a-f0-9]{10})\b/g
/** A card cited by id: "#f9ddb1177c", "card f9ddb1177c", "tarefa f9ddb1177c" */
const CARD_MENTION = /(?:#|\bcard\s+|\btarefa\s+)([a-f0-9]{10})\b/gi
const MAX_LINKED = 5

export interface LinkedTask {
  id: string
  title: string
  status: Card['status']
  branch?: string
}

/** What a question gets about the tasks it refers to */
export interface TaskMaterial {
  /** Folder with the index of every task and one file per task, for Claude to read and search */
  dir: string
  /** The linked tasks, in full, to put in the prompt */
  blocks: string
  /** Worktrees of the linked tasks: the code they developed lives there */
  worktrees: string[]
  linked: LinkedTask[]
  /** Links to cards of another workspace, which this question cannot see */
  elsewhere: string[]
}

const cut = (s: string | undefined, max: number) => (!s ? '' : s.length > max ? `${s.slice(0, max)}\n[…cortado]` : s)

/**
 * The refinement cards as context for "Pergunte ao código": a card linked or cited in a question
 * goes into the prompt in full (with what changed in its branch), and an index of every card lets
 * Claude find one by name when asked to.
 */
@Injectable()
export class TaskContextService {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly runner: CommandRunner,
  ) {}

  private cardsDir(id: string) {
    return path.join(this.workspaces.dataDirOf(id), 'refine')
  }

  private read(id: string, cardId: string): Card | null {
    if (!CARD_ID.test(cardId)) return null
    try {
      return JSON.parse(fs.readFileSync(path.join(this.cardsDir(id), `${cardId}.json`), 'utf8')) as Card
    } catch {
      return null
    }
  }

  private all(id: string): Card[] {
    try {
      return fs
        .readdirSync(this.cardsDir(id))
        .filter((f) => f.endsWith('.json'))
        .map((f) => this.read(id, f.slice(0, -5)))
        .filter((c): c is Card => Boolean(c))
        .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
    } catch {
      return []
    }
  }

  /** Cards the text links to or cites, plus the ones chosen on screen */
  resolve(id: string, text: string, chosen: string[] = []) {
    const ids: string[] = []
    const elsewhere: string[] = []
    for (const m of text.matchAll(CARD_LINK)) {
      if (m[1] === id) ids.push(m[2])
      else elsewhere.push(m[0])
    }
    for (const m of text.matchAll(CARD_MENTION)) ids.push(m[1].toLowerCase())
    ids.push(...chosen.filter((c) => CARD_ID.test(c)))
    const cards = [...new Set(ids)]
      .map((c) => this.read(id, c))
      .filter((c): c is Card => Boolean(c))
      .slice(0, MAX_LINKED)
    return { cards, elsewhere: [...new Set(elsewhere)] }
  }

  /** Files the task changed: commits on its branch since the base, and what is not committed yet */
  private async changes(card: Card) {
    const wt = card.git?.path
    if (!wt || !fs.existsSync(wt)) return []
    const git = async (args: string[]) => {
      const r = await this.runner.run('git', args, { cwd: wt, timeoutMs: 20_000 }).catch(() => null)
      return r && r.code === 0 ? r.stdout : ''
    }
    const files = new Map<string, string>()
    if (card.git?.base) {
      for (const line of (await git(['diff', '--name-status', `${card.git.base}...HEAD`])).split('\n')) {
        const [st, ...rest] = line.trim().split(/\s+/)
        if (st && rest.length) files.set(rest.at(-1)!, st[0] === 'A' ? 'criado' : st[0] === 'D' ? 'removido' : 'alterado')
      }
    }
    for (const line of (await git(['status', '--porcelain', '--untracked-files=all'])).split('\n')) {
      if (line.trim()) files.set(line.slice(3).split(' -> ').pop()!.replace(/^"|"$/g, ''), 'não commitado')
    }
    return [...files].slice(0, 80).map(([f, st]) => `${f} (${st})`)
  }

  /** One task as Markdown: everything a question about it needs */
  private async describe(id: string, card: Card) {
    const r = card.refinement
    const dev = card.dev
    const changes = await this.changes(card)
    return [
      `# Tarefa ${card.id}: ${card.title}`,
      `Status: ${card.status}. Link: /w/${id}/refinamento/${card.id}`,
      card.git ? `Branch: ${card.git.branch}${card.git.base ? ` (a partir de ${card.git.base})` : ''}. Worktree (onde está o código desta tarefa): ${card.git.path}` : 'Ainda sem branch nem worktree.',
      r ? `## Descrição de negócio\n${cut(r.business, 4000)}` : '',
      r ? `## Descrição técnica\n${cut(r.technical, 10_000)}` : '',
      r ? `## Plano\n${r.plan.map((p, i) => `${i + 1}. ${dev && i < dev.done ? '[feito] ' : ''}${p}`).join('\n')}` : '',
      r?.acceptance.length ? `## Critérios de aceite\n${r.acceptance.map((a) => `- ${a}`).join('\n')}` : '',
      r?.observations.length ? `## Pontos de observação\n${r.observations.map((o) => `- ${o}`).join('\n')}` : '',
      r?.platformSteps?.length ? `## Passos no Business Manager\n${r.platformSteps.map((o) => `- ${o}`).join('\n')}` : '',
      !r ? `## Conversa de refinamento (ainda sem card)\n${cut(card.messages.map((m) => `${m.role === 'user' ? 'Usuário' : 'Claude'}: ${m.content}`).join('\n\n'), 6000)}` : '',
      dev ? `## Desenvolvimento\nStatus: ${dev.status}, ${dev.done}/${dev.total} passos.${dev.error ? ` Erro: ${dev.error}` : ''}` : '',
      dev?.summary ? `### Resumo do desenvolvimento\n${cut(dev.summary, 6000)}` : '',
      changes.length ? `## Arquivos que a branch mudou\n${changes.map((c) => `- ${c}`).join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  /**
   * Writes the index and the files of the tasks where Claude can read them, and returns the
   * linked ones for the prompt. The folder is the app's own; the project is never touched.
   */
  async prepare(id: string, text: string, chosen: string[] = []): Promise<TaskMaterial> {
    const dir = path.join(this.workspaces.dataDirOf(id), 'ask-context')
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    const cards = this.all(id)
    fs.writeFileSync(
      path.join(dir, 'tarefas.md'),
      [
        '# Tarefas do Refinamento',
        '',
        'Uma linha por tarefa: id | título | status | branch. Os detalhes de cada uma ficam em <id>.md nesta pasta.',
        '',
        ...cards.map((c) => `- ${c.id} | ${c.title} | ${c.status} | ${c.git?.branch ?? '—'}`),
      ].join('\n'),
    )
    await Promise.all(cards.slice(0, 200).map(async (c) => fs.writeFileSync(path.join(dir, `${c.id}.md`), await this.describe(id, c))))

    const { cards: linked, elsewhere } = this.resolve(id, text, chosen)
    const blocks = linked.length
      ? ['Tarefas vinculadas a esta pergunta (do Refinamento deste projeto):', ...(await Promise.all(linked.map((c) => this.describe(id, c))))].join('\n\n---\n\n')
      : ''
    return {
      dir,
      blocks,
      worktrees: linked.map((c) => c.git?.path).filter((p): p is string => Boolean(p && fs.existsSync(p))),
      linked: linked.map((c) => ({ id: c.id, title: c.title, status: c.status, branch: c.git?.branch })),
      elsewhere,
    }
  }

  /** The guide Claude gets about the tasks folder */
  guide(material: TaskMaterial) {
    return [
      `Tarefas do Refinamento deste projeto: o índice está em ${path.join(material.dir, 'tarefas.md')} e cada tarefa em ${material.dir}${path.sep}<id>.md (descrição de negócio e técnica, plano, critérios, status do desenvolvimento, branch, worktree e arquivos alterados).`,
      'Quando o usuário falar de uma tarefa, card, demanda ou branch (pelo nome, por um trecho ou pedindo para você buscar), procure no índice com Grep e leia o arquivo da tarefa antes de responder.',
      'O código desenvolvido numa tarefa fica no worktree dela, não na pasta principal do projeto. Para ver o que a tarefa fez, leia os arquivos listados em "Arquivos que a branch mudou" dentro do worktree.',
    ].join('\n')
  }
}
