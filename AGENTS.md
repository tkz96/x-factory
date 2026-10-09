# X-Factory: start here

This is the entry point for every coding agent working on X-Factory, whatever the tool. `CLAUDE.md` and `GEMINI.md` are symlinks to this file. It holds the rules you must never break, and tells you which document to read before each kind of work. The details live in [`docs/agents/`](./docs/agents/), which people read too.

## Before you say a change is done

Run every quality gate with one command, and fix what fails:

```bash
bun run check:all
```

How the gates and lint baselines work is in [`docs/agents/ci-checks.md`](./docs/agents/ci-checks.md).

## Never break these

1. **The API process never runs work.** `src/server.ts` handles HTTP/SSE routing, input validation and SQLite writes, then responds. It never executes workflows, starts agent sessions or runs pipeline stages.
2. **Only the worker runs stages.** `src/worker.ts` claims jobs from SQLite with a lease and runs the stage executors.
3. **SQLite is the only source of runtime state.** It runs in WAL mode with foreign keys on. Large outputs and settings go to disk under the data dir (`X_FACTORY_DATA_DIR`, default `~/.x-factory`), and every such path comes from `src/paths.ts`. SQLite stores references to them, not the blobs.
4. **Run status changes only through the state machine.** Every transition must be allowed by the matrix in `docs/reference/state-machine-matrix.md`, be atomic, and be recorded in `runs`, `jobs`, `events` and `stage_attempts`.
5. **Migrations define the database structure.** After you add one to `src/db/migrations/`, run `bun run docs:schema`.
6. **No inline styles in `.tsx` files.** Use design tokens, utility classes or a co-located `.css` file. The one exception is passing a CSS custom property.
7. **SSE events update the TanStack Query cache directly.** Do not refetch whole pages or cause the page to flicker.
8. **Documentation outranks the code graph.** Graphify shows what code exists and how it connects. The docs in `docs/reference/` and `docs/explanation/` decide how it is allowed to behave.
9. **Do not add another knowledge-graph tool.** Graphify is the only one.
10. **Never weaken a check to make it pass.** Do not skip, loosen or delete an assertion, and do not add findings to a lint baseline. Fix the cause or report it.

## Read before you act

| When you are about to… | Read |
|---|---|
| change CI, a gate or a lint baseline, or a gate fails | [`docs/agents/ci-checks.md`](./docs/agents/ci-checks.md) |
| change the server, worker, database, executors or state machine | [`docs/agents/architecture-invariants.md`](./docs/agents/architecture-invariants.md) |
| change anything under `src/frontend/` | [`docs/agents/frontend-styling.md`](./docs/agents/frontend-styling.md) and [`DESIGN.md`](./DESIGN.md) |
| audit the frontend CSS | [`docs/agents/css-audit.md`](./docs/agents/css-audit.md) |
| look up how code connects, or after you change code structure | [`docs/agents/graphify.md`](./docs/agents/graphify.md) |
| say a change that users can see is done | [`docs/agents/reticle.md`](./docs/agents/reticle.md) |
| use a domain term, or look for a spec | [`docs/agents/domain.md`](./docs/agents/domain.md) and [`CONTEXT.md`](./CONTEXT.md) |
| read, create or update a GitHub issue | [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md) |
| label or triage an issue | [`docs/agents/triage-labels.md`](./docs/agents/triage-labels.md) |
| set up a new agent tool, MCP server or skill | [`docs/agents/agent-setup.md`](./docs/agents/agent-setup.md) |

## Keeping this current

`bun run check:agent-docs` fails when one of these is true:

- a link in this file or in `docs/agents/` is broken;
- a file in `docs/agents/` is not linked from the table above;
- a script or repository path that those docs name does not exist;
- a required symlink is missing.

When you change how something works, update the document that owns it in the same change.
