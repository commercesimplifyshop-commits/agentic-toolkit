/**
 * The Agentic Toolkit tools a change can be linked to. Claude reads TOOL_CATALOG in the prompts that
 * suggest tools for a change and that revise its text. Keep this in sync with
 * .claude/skills/agentic-toolkit-tools/SKILL.md and add a kind here only together with its creator
 * in links.assist.service.ts.
 */
export const TOOL_KINDS = ['diagram', 'board'] as const
export type ToolKind = (typeof TOOL_KINDS)[number]

export const TOOL_CATALOG = `Ferramentas do Agentic Toolkit que uma mudança pode usar. Todas ficam na instalação e são vinculadas à mudança:

- diagram: diagrama de arquitetura gerado pelo Claude a partir do código. Use quando a mudança cria ou altera componentes, integrações, serviços, filas, bancos ou o fluxo de execução. Tipos aceitos em "type":
  - c4-context: pessoas, o sistema e sistemas externos
  - c4-container: aplicações, serviços, filas e bancos
  - c4-component: módulos dentro de um contêiner
  - flow: fluxo passo a passo com decisões
  - uml-sequence: troca de mensagens entre componentes numa operação
  - uml-class: classes e relacionamentos de um módulo
  - er: entidades e relacionamentos de dados
  Em "request", escreva o que o diagrama deve mostrar, em uma ou duas frases.
- board: quadro branco para rascunho livre (esboço de tela, ideia, anotação). Use só quando a mudança precisar de um espaço para desenhar que não seja um diagrama. Em "name", dê um título curto.

Regras:
- Sugira só o que a mudança realmente precisa. Mudança pequena, de texto ou de teste costuma não precisar de nenhuma ferramenta.
- Não sugira o mesmo tipo de diagrama duas vezes para a mesma mudança.
- Nunca invente tipos que não estão nesta lista.`
