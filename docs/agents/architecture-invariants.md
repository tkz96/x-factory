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
- **Lease module (`src/lease.ts`).** The one module that claims, renews, releases, expires and exhausts leases for jobs and operator commands. Its `LeasePolicy` (`DEFAULT_LEASE_POLICY`) is the only definition of lease TTLs, heartbeat intervals and the heartbeat TTL: repositories take these as arguments and have no defaults, and a test scans the source for stray literals. It uses an injected clock for every decision, so liveness, expiry and the timestamps it writes follow that clock. When a job lease expires with no attempts left, the module fails the job, closes the running stage attempt and moves the run to `recovery_required` in one transaction, at runtime and at worker startup alike (`Worker.recoverOnStartup` calls the module and has no exhaust or orphan-run logic of its own). A voluntary release gives the claim's attempt back and closes the running stage attempt, so a worker stop never spends the retry budget, and a pending job with no attempts left is exhausted the same way an expired one is. A claimed command that expired with no attempts left is marked `failed`. Do not add a second claim, expiry or exhaust path. If settling one job throws, the sweep rolls that job's transaction back, logs the failure once per `(job id, stable error identity)` per process (not on every poll tick) and carries on, so one poisoned job never stops the others being claimed or settled. The identity is the error's class (`err.name`) plus its `code` when it has one — never the message, which can embed a timestamp, counter or id that changes per attempt — and the remembered set is capped, oldest-first, so it cannot grow without bound.
- **Stage runner (`src/stage-runner.ts`).** One lifecycle for every unit of stage work, jobs and the deliver command alike: attempt start, heartbeat, execute, cancellation re-check, then the output and the workflow transition committed in one transaction, or failure. A job and a command differ only in their `StageWork` (lease source and finalization). Executors get a narrow `StageContext` (the run and project as inputs, `emit`, a bound `ledger`, an abort signal) and return a `StageOutcome`; what they want persisted goes in its `record`, which the runner commits only if the run was not stopped meanwhile. Executors hold no repositories. Do not write run fields or call a repository from an executor. The run's project comes from the projects configuration: a run naming a project that is missing from it fails the stage with `Project "<id>" is not in the projects configuration.` — there is no stand-in project, just as there is none for an unreadable config.
- **SQLite.** The only source of runtime state, in WAL mode (`PRAGMA journal_mode = WAL`) with foreign keys on (`PRAGMA foreign_keys = ON`).
- **One connection per process.** Each process opens one SQLite connection and runs migrations on it once. `src/composition-root.ts` turns that connection into the `Repositories` bundle, which the API passes to every route and run command. No module keeps a database handle of its own, so a request is always served by the connection the server opened.
- **Files on disk.** Everything lives under the data dir: `~/.x-factory`, or `X_FACTORY_DATA_DIR` if it is set. Run artifacts go in `projects/<projectId>/runs/<runId>/` and Git worktrees in `projects/<projectId>/worktrees/<runId>/`. Settings are in `settings.json` in the same dir. Always build these paths with `src/paths.ts`. SQLite stores metadata and paths, never large blobs. The projects configuration stays at `config/projects.json` in the repository, and `X_FACTORY_CONFIG_PATH` overrides it. It is an authored input, not runtime state, so it is not moved under the data dir. `XF_SETTINGS_PATH` was removed: the settings file always follows the data dir.

## State machine

Owner: [Workflow state machine and transition contracts](../reference/state-machine-matrix.md).

- The happy path is `queued` → `preparing` → `understanding` → `awaiting_understanding_approval` → `planning` → `awaiting_plan_approval` → `executing` → `awaiting_review` → `ready_for_pr` → `pr_created`. The last step happens only when a user asks for the pull request. The other states are `recovery_required`, `failed` and `stopped`.
- Only the transitions in the matrix are allowed. Each one is atomic and monotonic, and it is recorded in `runs`, `jobs`, `events` and `stage_attempts`.
- The run-status policy (matrix, terminal/active/stoppable sets, allowed actions per status, status→stage, labels) lives in `src/shared/run-status-policy.ts`; the server and the client both import it, and `test/run-status-policy.test.ts` checks it against the server's action guards.

## Database schema

Owner: [Database schema and durable entities](../reference/database-schema.md).

- Change the structure only with a new migration in `src/db/migrations/`. Then run `bun run docs:schema`. CI fails if the generated section of the doc is stale. The migrator runs each migration in an IMMEDIATE transaction that re-reads the version under the write lock, so API and worker can start together on a fresh database; `test/migration-race.test.ts` guards this.

## Frontend data flow

Owners: [UI state and event streaming](../explanation/ui-state-and-event-streaming.md) and [Async state coverage](../reference/state-coverage.md).

- The frontend uses React 19, Vite, React Router and TanStack Query.
- SSE events update the TanStack Query cache directly, so the page never refetches as a whole or flickers.
- Styling rules are in [frontend-styling.md](./frontend-styling.md).

## Providers and security

- The provider HTTP surface is provider-agnostic: no provider-specific terms cross it. [Provider API](../reference/provider-api.md) owns the contract, and `test/provider-agnostic-gate.test.ts` enforces it.
- The execution boundary and credential rules are in [Security model](../reference/security.md).
