# Architecture invariants

Read this before you change the server, the worker, the database, a stage executor or the state machine. `AGENTS.md` lists each rule in one line. This page says where each rule comes from and which document owns the details. If this page and an owning document disagree, the owning document is correct, so fix this page.

## Which source wins

| Question | Source of truth |
|---|---|
| How code is allowed to behave | `docs/reference/` and `docs/explanation/` |
| Database tables, columns and constraints | The SQL migrations in `src/db/migrations/`. The structural section of `docs/reference/database-schema.md` is generated from them. |
| The intent and invariants behind the schema | The prose of `docs/reference/database-schema.md` |
| What code exists and how it connects | The Graphify graph (see [graphify.md](./graphify.md)) |
| Domain terms | [`CONTEXT.md`](../../CONTEXT.md) |
| Visual design | [`DESIGN.md`](../../DESIGN.md) |

If a connection that the graph suggests conflicts with the docs, the docs win.

## Process boundaries

Owner: [Process boundaries and system topology](../explanation/process-boundaries-and-topology.md).

- **API process (`src/server.ts`).** Handles HTTP and SSE routing, validates input and writes to SQLite. A command writes its intent to SQLite and returns at once. The API process never executes workflows, starts agent sessions or runs pipeline stages. That keeps the API responsive, and a crash in a stage cannot take the API down.
- **Worker process (`src/worker.ts`).** A separate Bun process. It polls SQLite, claims a job atomically with a lease, runs the stage through its executor in `src/executors/`, and records the result. While it works, it renews the lease. If a worker dies, its lease expires and another worker can claim the job.
- **SQLite.** The only source of runtime state, in WAL mode (`PRAGMA journal_mode = WAL`) with foreign keys on (`PRAGMA foreign_keys = ON`).
- **Files on disk.** Everything lives under the data dir: `~/.x-factory`, or `X_FACTORY_DATA_DIR` if it is set. Run artifacts go in `projects/<projectId>/runs/<runId>/` and Git worktrees in `projects/<projectId>/worktrees/<runId>/`. Always build these paths with `src/paths.ts`. SQLite stores metadata and paths, never large blobs.

## State machine

Owner: [Workflow state machine and transition contracts](../reference/state-machine-matrix.md).

- The happy path is `queued` → `preparing` → `understanding` → `awaiting_understanding_approval` → `planning` → `awaiting_plan_approval` → `executing` → `awaiting_review` → `ready_for_pr` → `pr_created`. The last step happens only when a user asks for the pull request. The other states are `recovery_required`, `failed` and `stopped`.
- Only the transitions in the matrix are allowed. Each one is atomic and monotonic, and it is recorded in `runs`, `jobs`, `events` and `stage_attempts`.

## Database schema

Owner: [Database schema and durable entities](../reference/database-schema.md).

- Change the structure only with a new migration in `src/db/migrations/`. Then run `bun run docs:schema`. CI fails if the generated section of the doc is stale.

## Frontend data flow

Owners: [UI state and event streaming](../explanation/ui-state-and-event-streaming.md) and [Async state coverage](../reference/state-coverage.md).

- The frontend uses React 19, Vite, React Router and TanStack Query.
- SSE events update the TanStack Query cache directly, so the page never refetches as a whole or flickers.
- Styling rules are in [frontend-styling.md](./frontend-styling.md).

## Providers and security

- The provider HTTP surface is provider-agnostic: no provider-specific terms cross it. [Provider API](../reference/provider-api.md) owns the contract, and `test/provider-agnostic-gate.test.ts` enforces it.
- The execution boundary and credential rules are in [Security model](../reference/security.md).
