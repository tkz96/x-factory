# X-Factory Agent Guidelines & Architectural Authority

This document defines the working contracts, architectural authority, and toolchain setup for AI coding agents operating on the X-Factory codebase.

---

## 1. Architectural Authority & Source of Truth

The system hierarchy and division of responsibility is strictly defined as follows:

```text
          AGENTS.md
              +
       docs/README.md
 (docs/reference + explanation)
              +
         Graphify MCP
              ↓
        Coding Agent
```

### The Core Principle
> **Graphify handles code relationships. Documentation handles architectural intent.**

1. **Authoritative Sources of Truth for Architecture**:
   - [`AGENTS.md`](file:///Users/talhazuberi/x-factory/AGENTS.md) (this document): Operational guidelines, coding standards, and agent rules.
   - [`docs/README.md`](file:///Users/talhazuberi/x-factory/docs/README.md): Central index for the Diátaxis documentation framework.
   - [`docs/reference/database-schema.md`](file:///Users/talhazuberi/x-factory/docs/reference/database-schema.md) & [`docs/reference/state-machine-matrix.md`](file:///Users/talhazuberi/x-factory/docs/reference/state-machine-matrix.md): Authoritative contracts for durable SQLite schemas, job lifecycle, and finite state machine transitions.
   - [`docs/explanation/process-boundaries-and-topology.md`](file:///Users/talhazuberi/x-factory/docs/explanation/process-boundaries-and-topology.md) & [`docs/explanation/ui-state-and-event-streaming.md`](file:///Users/talhazuberi/x-factory/docs/explanation/ui-state-and-event-streaming.md): Deep-dive documentation on multi-process topology, optimistic locking, event streaming, and the React UI architecture.
   - [`DESIGN.md`](file:///Users/talhazuberi/x-factory/DESIGN.md): Apple Human Interface Guidelines (HIG) specification for layout, typography, colors, and components.

2. **Graphify MCP (Code Relationships & Traversal)**:
   - Graphify serves as the graph query engine over the codebase's Abstract Syntax Tree (AST), symbol hierarchy, and dependency relationships (`graphify-out/graph.json`).
   - Use Graphify MCP tools (`query_graph`, `get_node`, `get_neighbors`, `shortest_path`, `god_nodes`, `get_community`, `graph_stats`) or the `graphify` CLI to explore how modules, classes, and functions are connected.
   - **Rule**: Graph queries reveal *what code exists and how it connects*. Documentation determines *how code is permitted to behave*. In any conflict between an inferred graph connection and the architectural contracts in `docs/reference/` and `docs/explanation/`, the documentation wins unconditionally.

3. **Knowledge-Graph Tool Restriction**:
   - Graphify MCP is the dedicated knowledge-graph provider for this repository.
   - **Do not add another knowledge-graph tool** (such as CodeGraph, understand-dashboard, or custom graph extractors) at this time.

---

## 2. Core Architectural Invariants

Every coding agent must respect and preserve these architectural invariants:

### A. Process Boundaries & Execution Chain
- **API Process (`src/server.ts`)**: Strictly handles HTTP/SSE routing, input validation, and SQLite persistence. It **never** directly executes workflows, spawns Pi agent sessions, or executes heavy pipeline stages. Commands write to SQLite and return HTTP responses immediately.
- **Worker Process (`src/worker.ts`)**: An independent, dedicated Bun process. It polls SQLite, atomically claims jobs with leases (`claimed` state), executes pipeline stages via isolated executors, and updates state upon completion.
- **SQLite (`x-factory.db`)**: Single source of truth for runtime state, operating in WAL mode (`PRAGMA journal_mode = WAL;`) with foreign keys enabled (`PRAGMA foreign_keys = ON;`).
- **Filesystem Artifacts**: File artifacts live under `.runs/<projectId>/<runId>/` and Git worktrees under `.worktrees/<projectId>/<runId>/`. SQLite stores metadata and disk references, not raw large blobs.

### B. Finite State Machine (FSM)
- The $11 \times 11$ workflow transition matrix must be strictly observed (`pending` $\rightarrow$ `preparing` $\rightarrow$ `understanding` $\rightarrow$ `planning` $\rightarrow$ `implementing` $\rightarrow$ `verifying` $\rightarrow$ `ready_for_pr` $\rightarrow$ `completed`, with terminal/exception states `reviewing`, `recovery_required`, `failed`, `aborted`).
- Transitions must be atomic, monotonic, and recorded in `runs`, `jobs`, `events`, and `stage_attempts`.

### C. Frontend Architecture & Styling Invariants
- Built with React 19, Vite, React Router, and TanStack Query.
- Visual styling follows Apple HIG layout conventions with CSS tokens and Lucide/Sprite SVG icons.
- **Modular CSS Architecture**: Design system is strictly layered under `src/frontend/styles/` (`tokens.css` → `base.css` → `shared/*.css` → `utilities.css`), imported centrally via `src/frontend/styles/index.css`.
- **Zero Inline Styles (`style={{...}}`) Invariant**: Inline styles in `.tsx` files are strictly banned. All styling must use design tokens, utility classes, or co-located component stylesheets (`./MyComponent.css`). Automated gate: `bun run test:frontend-smoke`.
- **Rule Authority**: Governed by `.agents/rules/frontend-styling.md`.
- Server-Sent Events (SSE) update the TanStack Query cache directly with zero full-page flickering.

---

## 3. Quality Gates & Verification Standards

Any code changes must pass all repo verification gates before completion:

1. **TypeScript Typecheck**:
   - Backend: `bun run typecheck` (`tsc --noEmit`)
   - Frontend: `bun run typecheck:frontend` (`tsc --project tsconfig.frontend.json --noEmit`)
2. **Linting & Formatting**:
   - `bun run lint` (`biome check .`)
3. **Tests & Coverage**:
   - `bun test` (all tests passing, minimum 80% line and function coverage; current codebase maintains $> 97%$)
   - Smoke & Integration: `bun run test:frontend-smoke`, `bun run test:integration`, `bun run test:integration:production`
4. **Architectural & Health Checks**:
   - `bunx fallow dupes` (target: 0 clone groups)
   - `bun run check:fallow` (target: maintainability $\ge 90$, 0 boundary violations)
   - `bun run check:cycles` (target: 0 circular dependencies via `dpdm`)
   - `bun run check:knip` (target: 0 broken or unused exports/dependencies)

---

## 4. Graphify Operations

- **Graph Storage**: Output resides in `graphify-out/` and is ignored by git (`.gitignore`).
- **MCP Connection**: Configured in `.agents/mcp_config.json` and `~/.gemini/config/mcp_config.json` using `/Users/talhazuberi/.local/bin/graphify-mcp`.
- **Incremental Updates**: After making structural code changes in a session, run:
  ```bash
  graphify update .
  ```
  Or to re-extract the AST across all code and schema files:
  ```bash
  graphify extract . --code-only --mode deep
  ```

<!-- reticle:begin (managed by `reticle init` — edit outside these markers) -->
## Verifying with Reticle

This app is instrumented by **Reticle**, an in-app verification layer exposed as `reticle_*` MCP tools and the `npx @reticlehq/server` CLI (always through npx: Reticle's server is not installed into this project). Verifying is part of "done", not an optional extra.

**Verify when you have changed something a user can see or do.** A component, a form, a route, a request, a piece of state that reaches the screen. Do it BEFORE telling the user it is complete. Reading the diff proves nothing and unit tests do not run the app.

**Do not reach for Reticle when the change cannot show up in the running app.** It costs tool calls and the user's patience, and a verdict over an unrelated flow proves nothing about what you changed. Skip it for: documentation, comments, tests, build config, CI, dependency bumps with no user-facing effect, backend or CLI work with no UI surface, and any change to a project that is not a running web app. Say in one line that you skipped verification and why, rather than silently not doing it.

**How to verify:**

- Drive the flow with `reticle_act_and_wait({ ref, action, until })`. It names the consequence you expect BEFORE the action, which is the difference between a check and a rationalisation.
- Batch a multi-step journey (a login, a form) into one `reticle_act { steps: [...] }` rather than one round trip per field.
- Read the surrounding evidence with `reticle_look { action: "page" | "state" }` and `reticle_observe { action: "network" | "console" }`.
- **Only `reticle_act_and_wait` and `reticle_assert` produce a verdict.** `reticle_act` and everything else move or read the app and prove nothing, so a session ending without one of those two has no result however many tools it used.
- Covered flows: `npx @reticlehq/server gate` reports which recorded flows the changed files affect and whether they still pass.

**Setting Reticle up? You are mid-sequence — do not stop until a verdict exists.** The whole of it
is: instrument the app → get a dev server running → open the app in a browser → drive one flow →
report the verdict. Every step is yours to do, and none of them needs the user. Stopping short leaves an app that
looks installed and can verify nothing, which is the commonest way this goes wrong. `/reticle`
carries the recovery ladder; never report the install as finished without a verdict to point at.

**Nothing connected? Get the app running.**

**A dev server already running when `reticle init` ran does not have Reticle in its bundle.** It read the build config at boot; `init` edited it afterwards. It serves the old bundle and no session appears. In order:

1. **A dev server was already running?** Restart it, then hard-reload the tab. "Something is listening" does not mean the right bundle is served.
2. **Nothing was running?** Start it in the BACKGROUND and say so in one line. `reticle_session { action: "list" }` gives you this project's own dev command in `next_action`; use that, never compose one. Started after `init`, it needs no restart.

Stopping to ask is how a verification turn ends with nothing verified.

Four guards, none optional:

1. **Never run two at once.** One dev server on the app's port. Restarting a stale one means stopping it first, not starting a second alongside it.
2. **Never guess the command.** It comes from `package.json` scripts. No recognisable dev script means say so and stop, not invent one.
3. **Never kill anything you did not start**, and never a daemon or a port holder. The one exception is the restart above, and say in one line that you did it.
4. **The permission prompt belongs to your host.** Never bypass, suppress or auto-approve it, and take a refusal as the answer.

A dev server that is already running does not pick up an edited build config or a newly created plugin file — restart it and hard-reload the tab. And if a server IS listening and still nothing connects, the cause is the SDK not loading in the page, not a missing dev server; do not tell the user to start one they are already running.

**Finish `src/reticle-dev.ts` before you claim setup is done.** `init` writes it and cannot always fill it in: a store that needs an argument only reading the code supplies (Jotai atoms, an XState actor, a TanStack `queryClient`) is left as a commented `registerStore` line. A file that registers nothing looks exactly like a finished one, and `reticle_look { action: "state" }` then returns empty forever — which is indistinguishable from an app that has nothing to report, so it reads as success. Uncomment the line, complete it, and prove it by driving one flow and seeing your keys come back. If `init` told you to restart your client, this is the job waiting for you on the other side of that restart.

**Verify each feature as you finish it, not all of them at the end.** Asked for four, build one, drive it, get a verdict, then start the second. A red verdict after four builds has four suspects; after one it has none.

**Capture what a change is FOR while you are building it, not afterwards.** The business outcome a change is meant to produce is known only while the change is being made. Pass `intent` when a flow is saved, so the saved flow carries the reason it exists. A flow without one replays for months and then reports "step 3 failed" instead of what stopped being true for a user.

**Honesty, which is the whole point:**

- **`verified: "unknown"` is not a pass.** It means Reticle drove the app and could not tell what happened; `verifiedReason` says which clause decided that. Report it as unknown, never as working.
- **`verified: "no-fault"` is not a pass either.** It means nothing was DECLARED to prove: the page settled and no channel complained, but you asserted nothing, so there is no verification. You get it whenever `until` is omitted. Name a consequence the action changes — a signal, a request, a route, or store state — and call again.
- **Never weaken a check to make it green.** Downgrading, skipping or deleting an assertion is a finding, not a fix.
- **If Reticle cannot run** (no daemon, or this is not a running web app), say so. Do not skip verification silently.
- **Setup is not finished until one real flow has been driven and produced a verdict.** `init` exiting 0, the tools appearing, and a session being listed are all things that happen before anything has been verified.

**The `/reticle` skill runs this whole loop for you** — detect, connect, drive one flow, report. If your client does not have it, install it once: `/plugin marketplace add reticlehq/reticle` then `/plugin install reticle@reticlehq` in Claude Code, or `npx skills add reticlehq/reticle` anywhere the skills CLI works.

**A tool you need is missing?** Call `reticle_tools` before assuming it: this surface merges several families behind an `action`, so what looks absent is usually one argument away. It is the verify loop and nothing else on purpose, and a daemon started with `RETICLE_ADVERTISE_ALL_TOOLS=1` advertises the wider set — it reads that at startup, so it takes effect on the next one.

**Report Reticle's own defects with `reticle_session { action: "feedback" }` the moment you notice**, then carry on with your task. You are the user Reticle is built for and the only one who can say what it cost you, and that knowledge is gone when your context is.

📄 **The rest is in [RETICLE.md](./RETICLE.md): what to do when the tools are missing, when a result carries `version_skew` or `update_available`, when `reticle_look { action: "state" }` comes back empty, and how to write a feedback report that can be acted on. Read it when you hit one of those, not before.**
<!-- reticle:end -->
