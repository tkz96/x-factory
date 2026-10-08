# Agent tool setup

Read this when you set up a new agent tool, MCP server or skill for this repository. Any agent tool can work on X-Factory. Each one must reach the same entry point, [`AGENTS.md`](../../AGENTS.md), and must not get a second copy of the rules.

## How each tool finds the entry point

| Tool | Reads | How |
|---|---|---|
| Codex, Cursor, GitHub Copilot | `AGENTS.md` | Natively |
| Claude Code | `CLAUDE.md` | Symlink to `AGENTS.md` |
| Gemini CLI, Antigravity | `GEMINI.md` | Symlink to `AGENTS.md`. Antigravity prefers `GEMINI.md` when it exists, and reads `AGENTS.md` otherwise. |

`bun run check:agent-docs` fails if a symlink is missing or points somewhere else. If a new tool reads another file name, add a symlink to `AGENTS.md` and add it to the symlink list in `scripts/check-agent-docs.ts`. Do not add tool-specific rule folders, such as the `rules` folders that Antigravity and Cursor support: put the content in `docs/agents/` and link it from `AGENTS.md`.

## Skills

Skills live in `.agents/skills/`, which is the shared convention. Claude Code reads `.claude/skills/`, which is a symlink to `.agents/skills/`. Add a new skill to `.agents/skills/` only.

## MCP servers

Do not commit MCP config with machine-specific paths. Each tool keeps its MCP servers in its own config, so set them up per machine. Every capability that an MCP server gives must also work through a CLI, so that agents without MCP are not blocked:

- Graphify: see [graphify.md](./graphify.md).
- Reticle: registered globally by `npx @reticlehq/server init`. See [reticle.md](./reticle.md).

## Writing instructions that every tool can follow

Write instructions as a shell command to run or a file to read. Do not write tool-specific shortcuts, such as "invoke the skill" or a slash command, in `AGENTS.md` or `docs/agents/`. If one tool has a useful shortcut, mention it here, next to the command it replaces.

## Checking that a tool reads the entry point

Ask the tool, in a non-interactive run from the repository root, which instruction files it loaded, which command runs every gate, and what `src/server.ts` must never do. For example, with Antigravity:

```bash
agy --mode plan -p "Without running tools: 1) which project instruction files did you load? 2) which command runs every quality gate? 3) what must src/server.ts never do?"
```

The answers must be `AGENTS.md` (or its symlink), `bun run check:all`, and "never run workflows, agent sessions or pipeline stages".
