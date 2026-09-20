# X-Factory Production Runtime Architecture & Contracts (XFM-01 – XFM-03)

This document establishes the authoritative production-runtime architecture, process boundaries, command/query classifications, durable data models, and workflow state machine contracts for X-Factory.

---

## 1. Process Boundaries (XFM-01)

X-Factory divides execution into discrete, single-responsibility boundaries:

```text
               ┌───────────────────────┐
               │    Client Browser     │
               └──────────┬────────────┘
                          │ HTTP / SSE
                          ▼
               ┌───────────────────────┐
               │      API Process      │
               │  (src/server.ts)      │
               └──────────┬────────────┘
                          │ SQLite Transaction
                          ▼
    ┌──────────────────────────────────────────────┐
    │              SQLite Database                 │
    │  - runs (workflow truth, revision)          │
    │  - jobs (schedulable units of work, leases)  │
    └─────────────────────▲────────────────────────┘
                          │ Atomic Claim / Heartbeat
                          │
               ┌──────────┴────────────┐
               │    Worker Process     │
               │   (src/worker.ts)     │
               └──────────┬────────────┘
                          │ Process / Session
                          ▼
               ┌───────────────────────┐
               │     Pi Agent SDK      │
               │ (Coding Agent Session)│
               └───────────────────────┘
```

### Process Roles

1. **API Process (`src/server.ts`)**:
   - Owns HTTP request listening, route dispatching, and schema validation.
   - Handles commands by persisting state changes to SQLite in atomic transactions.
   - Serves query/read endpoints directly from SQLite.
   - **Crucial Invariant**: The API process **never** directly creates, runs, or manages Pi sessions or heavy workflow pipeline tasks. It returns immediate HTTP responses once durable records are committed.

2. **Worker Process (`src/worker.ts`)**:
   - An independent, dedicated Bun process.
   - Polls SQLite for pending or expired jobs.
   - Atomically claims a job using database-level locking and lease acquisition.
   - Owns execution of claimed jobs, including spawning and managing real Pi agent processes/sessions.
   - Emits periodic heartbeats to renew active leases.
   - Captures Pi outputs and transitions job/run states in SQLite upon completion or failure.
   - Remains active and listening after job completion; shuts down cleanly on `SIGINT` / `SIGTERM`.

3. **SQLite (`x-factory.db`)**:
   - The authoritative single-host source of truth for workflow state and schedulable work.
   - Operates with WAL mode (`PRAGMA journal_mode = WAL;`) and foreign keys (`PRAGMA foreign_keys = ON;`).
   - Shared between API and Worker processes through independent database connections.

4. **Filesystem**:
   - Dedicated artifact store: `.runs/<projectId>/<runId>/` containing `ticket.md`, `plan.md`, `diff.patch`, `verification.json`, etc.
   - Dedicated Git worktrees: `.worktrees/<projectId>/<runId>/`.
   - SQLite holds references to artifacts and paths; raw large file contents live on disk.

---

## 2. Command vs Query Classification (XFM-01)

Every HTTP endpoint is explicitly classified as either a **Command** (state-mutating, writes to durable storage, returns immediately) or a **Query** (read-only, fetches durable or diagnostic state):

| Endpoint | Method | Type | Description |
|---|---|---|---|
| `/api/runs` | `GET` | **Query** | Lists runs from SQLite. |
| `/api/runs/:id` | `GET` | **Query** | Fetches single run details from SQLite. |
| `/api/runs/:id/events` | `GET` | **Query** | Event stream (SSE) for run status and agent output. |
| `/api/runs` | `POST` | **Command** | Atomically creates a run and initial durable job; returns HTTP 201 immediately. |
| `/api/runs/:id/stop` | `POST` | **Command** | Requests cancellation/stop of an active run. |
| `/api/runs/:id/steer` | `POST` | **Command** | Injects guidance message to the active agent session. |
| `/api/runs/:id/pr` | `POST` | **Command** | Initiates pull request creation when run is in `ready_for_pr`. |
| `/api/projects` | `GET` | **Query** | Lists configured projects. |
| `/api/projects` | `POST` | **Command** | Creates a project configuration. |
| `/api/settings` | `GET` | **Query** | Fetches application settings. |
| `/api/settings` | `POST` | **Command** | Updates application settings. |
| `/api/health` | `GET` | **Query** | Healthcheck and uptime probe. |

---

## 3. Development Process Topology (XFM-01)

In development and local operation, both the API and Worker run locally against the shared SQLite file:

```bash
# Terminal 1: Start API Server
bun run start
# (Runs on http://localhost:3777, connects to ~/.x-factory/x-factory.db)

# Terminal 2: Start Background Worker
bun run worker
# (Independent Bun worker process, connects to ~/.x-factory/x-factory.db)
```

Configuration via environment variables:
- `X_FACTORY_DB_PATH`: Path to SQLite database (default: `~/.x-factory/x-factory.db`).
- `X_FACTORY_DATA_DIR`: Base data directory (default: `~/.x-factory`).
- `PORT`: HTTP port for API (default: `3777`).
- `ANTHROPIC_API_KEY`: API key for Pi agent sessions (Claude 3.7 Sonnet default).

---

## 4. Durable Runtime Data Model (XFM-02)

Data is strictly divided into **Durable** (persisted in SQLite tables) and **Runtime-Only** (in-memory handles that are disposable and reconstructable).

### Durable Entities (SQLite)

#### Table: `runs`
- `id` (TEXT PRIMARY KEY): Unique run identifier (e.g. `c03df9a1`).
- `project_id` (TEXT NOT NULL): Associated project ID.
- `project_name` (TEXT NOT NULL): Associated project name.
- `ticket_id` (TEXT NOT NULL): Ticket identifier (e.g. `XF-101`).
- `ticket_title` (TEXT NOT NULL): Ticket title.
- `ticket_description` (TEXT): Ticket description body.
- `ticket_acceptance_criteria` (TEXT NOT NULL): JSON-serialized array of criteria strings.
- `plan` (TEXT NOT NULL): Implementation plan markdown.
- `branch` (TEXT NOT NULL): Git branch name.
- `status` (TEXT NOT NULL): RunStatus enum.
- `started_at` (TEXT NOT NULL): ISO8601 timestamp.
- `finished_at` (TEXT): ISO8601 timestamp or NULL.
- `repair_attempts` (INTEGER NOT NULL DEFAULT 0): Count of automated verification repairs.
- `artifacts_dir` (TEXT NOT NULL): Path to disk artifacts directory.
- `worktree_path` (TEXT NOT NULL): Path to dedicated Git worktree.
- `revision` (INTEGER NOT NULL DEFAULT 1): Monotonic revision counter for optimistic concurrency.
- `implementation_context` (TEXT): JSON-serialized context from understand stage.
- `verification` (TEXT): JSON-serialized verification result.
- `review` (TEXT): JSON-serialized review result.
- `diff` (TEXT): Current Git patch summary.
- `pull_request` (TEXT): JSON-serialized PR details.
- `created_at` (TEXT NOT NULL): ISO8601 timestamp.
- `updated_at` (TEXT NOT NULL): ISO8601 timestamp.

#### Table: `jobs`
- `id` (TEXT PRIMARY KEY): Unique job identifier (e.g. `job-8f2a1b9c`).
- `run_id` (TEXT NOT NULL REFERENCES runs(id)): Associated run ID.
- `stage` (TEXT NOT NULL): Target workflow stage (`prepare`, `understand`, `implement`, etc.).
- `status` (TEXT NOT NULL): `'pending'` | `'claimed'` | `'running'` | `'completed'` | `'failed'`.
- `attempts` (INTEGER NOT NULL DEFAULT 0): Number of attempts executed.
- `max_attempts` (INTEGER NOT NULL DEFAULT 3): Bounded retry limit.
- `available_at` (TEXT NOT NULL): ISO8601 timestamp after which job can be claimed.
- `worker_id` (TEXT): Identifier of worker currently leasing the job.
- `lease_until` (TEXT): ISO8601 timestamp when current lease expires.
- `last_heartbeat_at` (TEXT): ISO8601 timestamp of most recent worker heartbeat.
- `error` (TEXT): Error message if attempt failed.
- `created_at` (TEXT NOT NULL): ISO8601 timestamp.
- `updated_at` (TEXT NOT NULL): ISO8601 timestamp.

### Runtime-Only Entities (NEVER Persisted)

The following must never be serialized or written into SQLite:
- `_session`: Live `@earendil-works/pi-coding-agent` session objects or subprocess streams.
- `_baseline`: In-memory `BaselineState` Set references.
- `_project`: Live project objects with method references.
- In-memory EventBus listeners and socket subscriber sets.
- Process handles (PIDs, stream handles).

Every Pi process or session must be fully reconstructable from durable state and disposable upon worker crash or restart.

---

## 5. Workflow State Machine Contract (XFM-03)

The finite state machine preserves canonical workflow progression:

```text
               ┌───────────────┐
               │   preparing   │
               └───────┬───────┘
                       │ (auto)
                       ▼
               ┌───────────────┐
               │ understanding │◄─────────────┐
               └───────┬───────┘              │
                       │ (auto)               │
                       ▼                      │ (repair loop)
               ┌───────────────┐              │
    ┌─────────►│ implementing  │              │
    │          └───────┬───────┘              │
    │ (repair)         │ (auto)               │
    │                  ▼                      │
    │          ┌───────────────┐              │
    └──────────┤   verifying   │              │
               └───────┬───────┘              │
                       │ (auto)               │
                       ▼                      │
               ┌───────────────┐              │
               │   reviewing   ├──────────────┘
               └───────┬───────┘
                       │ (auto)
                       ▼
               ┌───────────────┐
               │  ready_for_pr │
               └───────┬───────┘
                       │ (user action: POST /api/runs/:id/pr)
                       ▼
               ┌───────────────┐
               │  pr_created   │ (Terminal Success)
               └───────────────┘

Interrupt / Terminal Failures:
- Any active state → failed (on unrecoverable error or max retries exceeded)
- understanding | implementing → stopped (on user action: POST /api/runs/:id/stop)
```

### Transition Authority

- In the transitional slice, transitions are validated by `canTransition()` and recorded durably in SQLite.
- Moving to `pr_created` requires explicit user invocation of `POST /api/runs/:id/pr`.
- Stopping an in-flight run requires explicit user invocation of `POST /api/runs/:id/stop`.
