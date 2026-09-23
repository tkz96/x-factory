# Reference: Database Schema and Durable Entities

This document specifies the SQLite database schema, table definitions, connection parameters, and entity contracts for X-Factory.

## Database Location and Engine

X-Factory persists state to a local SQLite database file.
The default database file location is `~/.x-factory/x-factory.db`.
Environment variable `X_FACTORY_DB_PATH` overrides the file path.

## Connection Parameters

Every connection initializes SQLite with these configuration parameters:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
```

## Schema Migrations

The database applies migrations sequentially on startup through `src/db/migrator.ts`:
- **v1**: Creates initial tables for `runs`, `jobs`, and `events`.
- **v2**: Adds columns for Git worktrees and artifact directories.
- **v3**: Adds `stage_attempts` for execution telemetry.
- **v4**: Adds optimistic locking `revision` counter to `runs`.
- **v5**: Adds lease management columns (`worker_id`, `lease_until`, `last_heartbeat_at`) to `jobs`.
- **v6**: Adds `operation_ledger` table for idempotent request processing.

## Table Definitions

### Table: `runs`

The `runs` table stores the persistent state of each workflow execution.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | Unique identifier for the run. |
| `project_id` | TEXT | NOT NULL | Identifier of the associated project. |
| `project_name` | TEXT | NOT NULL | Display name of the project. |
| `ticket_id` | TEXT | NOT NULL | Identifier of the issue tracker ticket. |
| `ticket_title` | TEXT | NOT NULL | Title of the ticket. |
| `ticket_description` | TEXT | NULL | Body text of the ticket. |
| `ticket_acceptance_criteria` | TEXT | NOT NULL | JSON array of acceptance criteria strings. |
| `plan` | TEXT | NOT NULL | Markdown representation of implementation plan. |
| `branch` | TEXT | NOT NULL | Git branch name created for the run. |
| `status` | TEXT | NOT NULL | Current state from the workflow state machine. |
| `started_at` | TEXT | NOT NULL | ISO8601 timestamp of run creation. |
| `finished_at` | TEXT | NULL | ISO8601 timestamp of run termination. |
| `repair_attempts` | INTEGER | NOT NULL DEFAULT 0 | Count of automated repair cycles executed. |
| `artifacts_dir` | TEXT | NOT NULL | Absolute file system path to run artifacts. |
| `worktree_path` | TEXT | NOT NULL | Absolute file system path to the dedicated Git worktree. |
| `revision` | INTEGER | NOT NULL DEFAULT 1 | Monotonic revision counter for concurrency control. |
| `implementation_context` | TEXT | NULL | JSON payload from the understand stage. |
| `verification` | TEXT | NULL | JSON payload from the verify stage. |
| `review` | TEXT | NULL | JSON payload from the review stage. |
| `diff` | TEXT | NULL | Summary of the Git diff. |
| `pull_request` | TEXT | NULL | JSON payload containing pull request details. |
| `created_at` | TEXT | NOT NULL | ISO8601 creation timestamp. |
| `updated_at` | TEXT | NOT NULL | ISO8601 last update timestamp. |

### Table: `jobs`

The `jobs` table records schedulable units of work claimed by worker processes.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | Unique identifier for the job. |
| `run_id` | TEXT | NOT NULL REFERENCES runs(id) | Associated run identifier. |
| `stage` | TEXT | NOT NULL | Target workflow stage name. |
| `status` | TEXT | NOT NULL | Job status (`pending`, `claimed`, `completed`, `failed`). |
| `attempts` | INTEGER | NOT NULL DEFAULT 0 | Count of execution attempts. |
| `max_attempts` | INTEGER | NOT NULL DEFAULT 3 | Upper threshold for retry attempts. |
| `available_at` | TEXT | NOT NULL | ISO8601 timestamp after which workers can claim the job. |
| `worker_id` | TEXT | NULL | Identifier of the worker process holding the active lease. |
| `lease_until` | TEXT | NULL | ISO8601 timestamp of lease expiration. |
| `last_heartbeat_at` | TEXT | NULL | ISO8601 timestamp of the most recent worker heartbeat. |
| `error` | TEXT | NULL | Error message from the most recent attempt failure. |
| `created_at` | TEXT | NOT NULL | ISO8601 creation timestamp. |
| `updated_at` | TEXT | NOT NULL | ISO8601 last update timestamp. |

### Table: `stage_attempts`

The `stage_attempts` table records execution telemetry for each stage attempt.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | Unique attempt identifier. |
| `run_id` | TEXT | NOT NULL REFERENCES runs(id) | Associated run identifier. |
| `stage` | TEXT | NOT NULL | Workflow stage name. |
| `attempt` | INTEGER | NOT NULL | Attempt index for the stage. |
| `started_at` | TEXT | NOT NULL | ISO8601 start timestamp. |
| `finished_at` | TEXT | NULL | ISO8601 completion timestamp. |
| `exit_code` | INTEGER | NULL | Process exit code from the stage executor. |
| `error` | TEXT | NULL | Error details if the stage failed. |

### Table: `events`

The `events` table records durable events for real-time streaming and historical replay.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Monotonic event sequence identifier. |
| `run_id` | TEXT | NOT NULL REFERENCES runs(id) | Associated run identifier. |
| `event_type` | TEXT | NOT NULL | Event classification name. |
| `payload` | TEXT | NOT NULL | JSON-serialized event content. |
| `created_at` | TEXT | NOT NULL | ISO8601 timestamp. |

### Table: `operation_ledger`

The `operation_ledger` table enforces idempotency across mutating API commands.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | Ledger entry identifier. |
| `operation_type` | TEXT | NOT NULL | Operation classification name. |
| `idempotency_key` | TEXT | NOT NULL | Unique idempotency key supplied by client or request context. |
| `response_code` | INTEGER | NOT NULL | HTTP status code returned for the operation. |
| `response_payload` | TEXT | NOT NULL | Cached JSON response body. |
| `created_at` | TEXT | NOT NULL | ISO8601 timestamp. |

A unique constraint applies across `(operation_type, idempotency_key)`.

## Runtime-Only Entities

The system prohibits serialization of these runtime entities into SQLite:
- Live agent session handles and subprocess streams.
- In-memory event bus subscribers and listener functions.
- In-memory baseline project state objects.
- Operating system process identifiers (PIDs).
