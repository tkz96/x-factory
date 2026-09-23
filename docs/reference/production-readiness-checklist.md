# Reference: Production Readiness Checklist and Evaluation Criteria

This document specifies the technical criteria and verification standards for X-Factory production deployments.

## The Twelve Production Pillars

Every production deployment must satisfy the requirements across twelve architectural pillars.

### 1. Architecture and Process Boundaries
- The API process (`src/server.ts`) and Worker process (`src/worker.ts`) execute independently.
- The API process never executes agent sessions, Git checkouts, or workflow stages directly.
- The API process commits records to SQLite and returns HTTP responses in less than 15 milliseconds.
- Automated tests verify zero workflow stage executor calls inside HTTP request handlers.

### 2. Data Durability and Integrity
- All workflow state, jobs, telemetry, and events persist to SQLite (`x-factory.db`).
- SQLite operates in Write-Ahead Logging (WAL) mode with foreign keys enabled.
- Automatic database migrations apply sequentially from `v1` through `v6` on application startup.
- In-memory data stores are prohibited for persistent state.

### 3. Concurrency and Locking
- State mutations require optimistic locking checks using a monotonic `revision` column.
- Concurrent updates with stale revisions fail immediately with a concurrency error.
- Workers claim schedulable jobs using 30-second leases.
- Workers transmit heartbeats every 10 seconds to renew active leases.
- Workers automatically reclaim abandoned jobs when lease timestamps expire.

### 4. Idempotency and Duplicate Action Safety
- The `operation_ledger` table enforces single-execution semantics through unique keys.
- Duplicate user actions on stop, steer, or pull request creation endpoints return cached responses without side effects.

### 5. Observability, Correlation, and Diagnostics
- The system propagates the `X-Request-ID` header from clients to server handlers and log entries.
- Structured JSON log entries include `request_id`, `run_id`, `job_id`, `stage`, and `worker_id`.
- The `GET /api/diagnostics` endpoint provides metrics for database file sizes, queue depths, and worker health.
- The `GET /api/ready` endpoint validates database accessibility and disk health.

### 6. Graceful Degradation and Shutdown
- The API server handles `SIGINT` and `SIGTERM` signals with a coordinated shutdown procedure.
- The server provides a 10-second drain window for active requests.
- The server emits a shutdown event to all Server-Sent Events streams before connection termination.
- New non-health requests receive HTTP status `503 Service Unavailable` during shutdown.

### 7. Disaster Recovery and Backups
- The backup engine creates non-blocking SQLite snapshots using native `VACUUM INTO`.
- Automated procedures verify backup integrity with `PRAGMA integrity_check` before confirmation.
- Recovery Time Objective (RTO) remains under 60 seconds.
- Recovery Point Objective (RPO) remains under 6 hours.

### 8. Security and Input Validation
- All HTTP endpoints validate input structures using strict Zod schemas.
- Route parameters, ticket identifiers, and Git branch names undergo sanitization.
- Path validation utilities prevent path traversal attacks outside configured root directories.
- Secret tokens remain confined to environment variables and configuration files.

### 9. Performance and Resource Hygiene
- Git worktrees reside in isolated directories under `.worktrees/<projectId>/<runId>/`.
- The application detects and logs orphaned worktrees during startup.
- Database indexes cover `runs(status)`, `jobs(status, available_at)`, and `events(run_id)`.
- The production JavaScript client bundle remains under 500 kilobytes uncompressed.

### 10. Error Handling and Failure Recovery
- A formal state machine governs workflow execution.
- Unhandled errors transition runs to `failed` and record execution telemetry in `stage_attempts`.
- Abort signals cleanly terminate external processes and release file system locks.

### 11. Testing and Quality Assurance
- Automated tests maintain at least 80% line coverage across all packages.
- Backend and frontend TypeScript checks produce zero type errors.
- Code linting and formatting checks produce zero errors and zero warnings.

### 12. Frontend Production Asset Delivery
- The Single Page Application builds into static production assets in `dist/public/`.
- The API server serves static assets with valid content-type headers.
- The server redirects client-side routes to `index.html`.
