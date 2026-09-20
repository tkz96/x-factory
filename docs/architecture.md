# X-Factory Comprehensive System Architecture (XFM-77)

This document provides the definitive architectural specification of **X-Factory**, a local-first multi-process autonomous software engineering factory. It details the runtime process topology, SQLite persistence and concurrency controls, event streaming architecture, deterministic workflow state machine, and React 19 user interface.

---

## 1. System Overview & Process Topology

X-Factory decouples web serving, persistent storage, and autonomous agent orchestration across discrete process boundaries on a single host.

```text
┌────────────────────────────────────────────────────────────────────────┐
│                          Client Browser (SPA)                          │
│     React 19 + TypeScript + Apple HIG Design Tokens + Vite Bundler      │
│     - Runs View (SSE logs & live status)                               │
│     - Projects View (creation & legacy import)                         │
│     - Settings & Diagnostics View (heartbeats, queues, health)         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP (REST) / SSE (Events)
                                    │ [X-Request-ID Header Propagation]
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        API Server (src/server.ts)                      │
│     Native Bun HTTP Server                                             │
│     - Request routing & strict Zod input validation                   │
│     - Health & readiness probes (/api/health, /api/ready)              │
│     - Diagnostics & worker registry (/api/diagnostics)                 │
│     - Coordinated graceful shutdown & connection draining             │
│     - INVARIANT: Zero background agent or pipeline execution           │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │ Writes / Reads                 │ SSE Broadcast
                    │ Atomic Transactions            ▼
                    │                     ┌──────────────────────────────┐
                    │                     │ RunEventBus (src/events.ts)  │
                    │                     │ In-memory event dispatcher   │
                    │                     └──────────────┬───────────────┘
                    ▼                                    │
┌──────────────────────────────────────────────────┐     │
│             SQLite Database (WAL Mode)           │     │
│   ~/.x-factory/x-factory.db                      │     │
│   - runs: durable run state & revision counter   │     │
│   - jobs: schedulable work units & lease locks   │     │
│   - stage_attempts: execution telemetry          │     │
│   - events: durable event log for SSE replay     │     │
│   - operation_ledger: double-action idempotency  │     │
│   - schema_migrations: versioned v1-v6 DDL       │     │
└───────────────────▲──────────────────────────────┘     │
                    │ Atomic Lease Claiming              │
                    │ Heartbeat & Completion             │
                    ▼                                    │
┌──────────────────────────────────────────────────┐     │
│               Worker Process (src/worker.ts)     │     │
│     Autonomous Background Execution Loop         │     │
│     - Job claim polling (lease timeout: 30s)     │     │
│     - Lease renewal heartbeats (interval: 10s)   │     │
│     - Stale job reclamation & automatic retries  │     │
│     - Stage executors (Prepare, Implement,       │     │
│       Verify, Deliver)                           │     │
│     - Emits stage telemetry to RunEventBus ──────┼─────┘
└───────────────────┬──────────────────────────────┘
                    │ Spawns & Drives
                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      Pi Coding Agent SDK Session                       │
│     Autonomous Code Generation & Self-Correction                       │
│     - Dedicated Git worktree: .worktrees/<projectId>/<runId>           │
│     - Dedicated artifact directory: .runs/<projectId>/<runId>          │
│     - Interactive steering & abort signal hooks                        │
└────────────────────────────────────────────────────────────────────────┘
```

### Process Roles & Boundaries

| Component | Entrypoint | Primary Responsibility | Invariant |
|---|---|---|---|
| **API Process** | `src/server.ts` | Serves SPA, handles HTTP REST APIs, routes SSE streams, validates incoming payloads, commits durable runs/jobs. | **Never executes workflows directly**. Sub-second responses. |
| **Worker Process** | `src/worker.ts` | Polls SQLite for pending jobs, claims leases, invokes stage executors, drives Pi Agent sessions, records heartbeats. | Autonomous single-job claim per worker, recovers stale leases. |
| **Database** | `src/db/connection.ts` | SQLite database in WAL mode with immediate transactions and foreign keys enabled. | Single source of truth. Revision-guarded concurrency. |
| **Event Bus** | `src/events.ts` | Decoupled pub/sub event distribution connecting worker execution to API SSE clients. | Supports replay from durable `events` table and clean drain. |

---

## 2. Persistence & Concurrency Architecture

### SQLite WAL Configuration
Every database connection is initialized with:
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
```

### Schema & Migrations (`src/db/migrator.ts`)
Migrations run automatically on boot through linear version gates:
- **v1**: Core tables (`runs`, `jobs`, `events`).
- **v2**: Git worktree and artifact directory tracking.
- **v3**: `stage_attempts` for detailed execution duration, exit codes, and errors.
- **v4**: Optimistic locking `revision` integer on `runs` table.
- **v5**: Lease management (`worker_id`, `lease_until`, `last_heartbeat_at`) on `jobs` table.
- **v6**: `operation_ledger` table for deterministic duplicate-action idempotency keys.

### Lease Management & Stale Job Reclamation
```text
  [Job: Pending] ──(Worker Claims with 30s Lease)──► [Job: Claimed]
                                                            │
                                        ┌───────────────────┴───────────────────┐
                                        ▼                                       ▼
                             (Heartbeat Every 10s)                    (Worker Crashes/Stalls)
                             Lease Extended +30s                      Lease Expires (>30s)
                                        │                                       │
                                        ▼                                       ▼
                             [Job: Completed]                         [Stale Job Reclaimed]
                             Transitions to Next Stage                Increment Attempt; Retry
```
- If a worker crashes or hangs, any worker polling via `claimNextJob()` detects `lease_until < datetime('now')` and re-queues the job up to `max_attempts` (default 3), transitioning unrecoverable jobs to `failed`.

### Optimistic Concurrency Control
All mutations to `runs` require the current `revision`:
```sql
UPDATE runs 
SET status = ?, plan = ?, revision = revision + 1, updated_at = datetime('now')
WHERE id = ? AND revision = ?;
```
If another process updated the record concurrently, the update returns 0 affected rows and throws a `ConcurrencyError`, preventing silent overwrites.

---

## 3. Workflow State Machine

Runs advance through a strictly enforced finite state machine (`src/state-machine.ts`):

```text
    ┌──────────────┐
    │  preparing   │
    └──────┬───────┘
           ▼
    ┌──────────────┐
    │   planning   │
    └──────┬───────┘
           ▼
    ┌──────────────┐
    │ implementing │ ◄────────┐ (Steer Guidance)
    └──────┬───────┘          │
           ├──────────────────┘
           ▼
    ┌──────────────┐
    │  verifying   │ ──(Tests Fail; Retry Attempts Remaining)──► implementing
    └──────┬───────┘
           ▼ (Tests Pass)
    ┌──────────────┐
    │ ready_for_pr │
    └──────┬───────┘
           ▼ (Deliver Command)
    ┌──────────────┐
    │  pr_created  │ [Terminal Success]
    └──────────────┘

    [Any Active Stage] ──(User Stop Action)────► stopped [Terminal]
    [Any Active Stage] ──(Unrecoverable Error)─► failed  [Terminal]
```

### Valid Transitions Matrix
| From | Allowed Target States |
|---|---|
| `preparing` | `planning`, `failed`, `stopped` |
| `planning` | `implementing`, `failed`, `stopped` |
| `implementing` | `verifying`, `implementing` (steer), `failed`, `stopped` |
| `verifying` | `ready_for_pr`, `implementing` (retry), `failed`, `stopped` |
| `ready_for_pr` | `pr_created`, `failed`, `stopped` |
| `pr_created` | None (Terminal) |
| `failed` | None (Terminal) |
| `stopped` | None (Terminal) |

---

## 4. Event Streaming & Real-Time Telemetry

### Unified RunEventBus & SSE Delivery
Real-time progress is streamed to browser clients using Server-Sent Events (SSE) via `GET /api/runs/:id/events`:
1. **Client Connects**: The API issues `text/event-stream` headers with `Cache-Control: no-cache` and `Connection: keep-alive`.
2. **Historical Replay**: The API queries `EventRepository.getEvents(runId)` and immediately flushes all historical events so reconnected clients recover full context without missing messages.
3. **Live Streaming**: The API registers a listener on `defaultEventBus.subscribe(runId, listener)`. As the worker process executes stages, it publishes:
   - `stage_start`, `stage_complete`
   - `tool_call`, `tool_result`
   - `agent_thought`, `agent_message`
   - `stage_evidence`
   - `status`, `error`
4. **Heartbeat Pings**: Keepalive comments `: keepalive\n\n` are emitted periodically to prevent NAT or browser socket timeouts.
5. **Clean Unsubscribe**: Client disconnects cleanly invoke the unsubscriber, preventing memory leaks.

### Graceful Shutdown Drain Window (`src/server.ts`)
On `SIGINT` or `SIGTERM`:
1. The server flags `isShuttingDown = true`.
2. New non-health HTTP requests immediately receive `503 Service Unavailable`.
3. `defaultEventBus.closeAll("Server is shutting down for deployment")` broadcasts a `{ type: "server_shutdown" }` event to all open SSE streams, prompting frontends to pause reconnect attempts.
4. Active in-flight requests are allowed a configurable drain window (default 10 seconds) to complete before socket termination.

---

## 5. Correlation & Diagnostics Architecture

Cross-process diagnostic observability (`XFM-70`, `XFM-73`) links all log lines and database mutations:
- **`X-Request-ID`**: Propagated from frontend `api-client.ts` through HTTP headers into `extractRequestId()`. If omitted, the server generates a unique `req_<randomUUID>` prefix.
- **Structured JSON Logging**:
  ```json
  {
    "timestamp": "2026-09-20T23:25:00.000Z",
    "level": "info",
    "message": "Stage transition recorded",
    "request_id": "req_a1b2c3d4",
    "run_id": "run-8f9e2a1b",
    "job_id": "job-01928374",
    "stage": "implement",
    "worker_id": "worker-local-1",
    "attempt": 1
  }
  ```
- **Diagnostics API (`GET /api/diagnostics`)**: Exposes database file size, WAL size, run status breakdowns, job queue metrics (pending, claimed, completed, failed, stale), active worker heartbeats, and memory RSS.

---

## 6. Frontend Architecture (React 19 SPA)

### Technology Stack
- **Framework**: React 19 with strict TypeScript typing.
- **Bundler**: Vite with optimized chunks (`dist/public/`).
- **Icons**: Lucide React.
- **Styling**: Vanilla CSS utilizing modern tokens inspired by Apple Human Interface Guidelines:
  - Curated semantic color palettes (`--bg-primary`, `--accent-blue`, `--accent-green`, `--card-border`).
  - Native typography (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto`).
  - Subtle micro-animations, glassmorphic headers (`backdrop-filter: blur(16px)`), responsive layouts.

### Component Structure
- `App.tsx`: Navigation bar, system status indicator, route switcher.
- `RunsView.tsx`: Active/historical run cards, multi-stage progress track, live SSE output terminal, steering prompt input.
- `ProjectsView.tsx`: Project onboarding form, repository validation, legacy importer wizard.
- `SettingsView.tsx`: Configuration editor, token validation, runtime diagnostics dashboard with real-time refresh.

### Query Management & Resilience
- `query-policies.ts`: Defines declarative stale-while-revalidate and polling policies:
  - Active runs: Poll every 2 seconds.
  - Idle runs: Poll every 15 seconds.
  - Diagnostics: Poll every 5 seconds when diagnostics tab is active.
- `useQueries.ts`: Custom hook providing resilient caching, automatic request deduplication, and exponential backoff retry on network failure.
