---
name: agentic-toolkit-tools
description: Which Agentic Toolkit tools (diagrams, boards) a change needs, how to create them, and how they link back to the OpenSpec change. Use when changing proposals, the links module, or adding a new tool to Agentic Toolkit.
---

# Agentic Toolkit tools and links

A change (OpenSpec `openspec/changes/<name>/`) can be linked to tools that live in Agentic Toolkit's data dir (`~/.agentic-toolkit/techs/<tecnologia>/workspaces/<id>/`), never in the repository. The link table is `links.json` in that same dir.

## Which tool for which need

| Need in the change | Tool | How it is made |
|---|---|---|
| Components, integrations, services, queues, databases | `diagram` with `c4-container` (or `c4-context`/`c4-component`) | `DiagramGeneratorService` draws it from the code |
| Execution order, decisions | `diagram` with `flow` | same |
| Messages between components in one operation | `diagram` with `uml-sequence` | same |
| Classes of a module | `diagram` with `uml-class` | same |
| Entities and relations of data | `diagram` with `er` | same |
| Free sketch, screen layout, idea | `board` | blank Excalidraw board, title given |

Do not link a tool a small change does not need. Text, test or config changes usually need none.

## How the link works

1. Claude (or the engineer) creates the tool: `POST /workspaces/:id/diagrams/generate` or `POST /workspaces/:id/boards`.
2. The tool is linked with `POST /workspaces/:id/links` `{change, kind, refId}`, or automatically by `links/links-assist.service.ts` (`create`), which passes a callback to the diagram job so the link is added when the diagram is saved.
3. The change workspace (`/w/:id/openspec/change/:name`, tab "Ferramentas") lists the links. The tool itself shows "Usado em" with the change names (`UsedBy` component).
4. Deleting a diagram or board removes its links (`removeRef` in the controllers). Deleting a change removes its links (`removeChange` in `OpenSpecAuthoringService.deleteChange`).

## Rules when Claude edits a proposal

- `OpenSpecAuthoringService.revise` returns `{ text, tools }`. Nothing is saved there. The engineer sees a diff and applies it; applying saves the file and then creates the `tools` through `POST /links/create`.
- Claude suggests at most 3 tools per run (`MAX_PLANS`). Unknown kinds or diagram types are dropped by `sanitizePlans`, never created.
- Claude reads the code (Read, Grep, Glob only), never edits, and never runs a shell.

## Adding a new tool kind

The kind must be registered in all of these places. A test (`apps/api/test/links.spec.ts`) fails if the catalog and `TOOL_KINDS` disagree.

1. `apps/api/src/links/tool-catalog.ts`: add the kind to `TOOL_KINDS` and a `- <kind>:` line in `TOOL_CATALOG`, so Claude knows when to use it.
2. `apps/api/src/links/tool-plan.ts`: accept the new kind in `sanitizePlans`, with the fields it needs.
3. `apps/api/src/links/links-assist.service.ts`: create it in `create`.
4. `apps/api/src/links/links.controller.ts`: include its titles in `list` and in `add`.
5. `apps/api/src/readonly/actions.ts`: `requireLinkBody` already accepts `diagram` and `board`; extend it for the new kind, and register its own actions.
6. Delete: call `links.removeRef(id, '<kind>', refId)` in its delete controller.
7. Web: show `UsedBy` in its page; add its entry to `toolHref` in `apps/web/src/shell/links/ToolLinks.tsx`.
8. Update this file's table.
