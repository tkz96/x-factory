# How to Verify Worker Leases and Agent Sessions

This guide shows you how to verify that an independent background worker claims a durable SQLite job and starts an agent session.
You will inspect terminal logs, query SQLite database records, and monitor Server-Sent Events.

## Prerequisites

Before you begin this procedure, ensure that you have:
- Bun runtime (version 1.4.0 or newer).
- A clean working directory with installed dependencies (`bun install`).
- A project with a model connection that passed **Check Connection** in **Settings › Models**, and a model chosen for the **Builder** and **Reviewer** roles. A run refuses to start without them (`409`), and a stage fails with the connection's own reason instead of starting a session.

## Step 1: Start the API Server

1. Open your first terminal.
2. Start the API server:

```bash
bun run start
```

3. Confirm that the terminal displays:

```text
X-Factory running at http://localhost:3777
```

## Step 2: Start the Independent Worker Process

1. Open a second terminal.
2. Start the worker process:

```bash
bun run worker
```

3. Verify that the worker terminal displays the startup log:

```text
Worker started. Polling for pending jobs and commands...
```

## Step 3: Submit a Test Run

1. Open a third terminal.
2. Submit a run request for a configured project:

```bash
curl -X POST http://127.0.0.1:3777/api/runs \
  -H "Content-Type: application/json" \
  -d '{"projectId": "converso", "ticketId": "SMOKE-1", "ticketTitle": "Smoke Test", "plan": "Verify worker execution", "acceptanceCriteria": "The worker runs the prepare stage."}'
```

3. Confirm that the API returns HTTP status `201 Created` with the new run as a JSON body.
4. Note the run's `id` value. You will use this value as `<runId>` in the next steps.

If the API answers `409`, a model role is not ready. Fix it in **Settings › Models**, then try again.

## Step 4: Verify Worker Execution Logs

1. Observe the output in the worker terminal.
2. The worker claims the job without a claim line. It writes one structured JSON line when a stage commits:

```text
{"job_id":"<jobId>","run_id":"<runId>","stage":"prepare","attempt":1,"duration_ms":12,"result":"success","message":"Stage 'prepare' completed successfully","timestamp":"2026-10-13T00:00:00.000Z","worker_id":"<workerId>"}
```

3. Beside it, the worker prints one plain line. Each plain line starts with the timestamp and the worker id:

```text
[2026-10-13T00:00:00.000Z] [Worker <workerId>] Stage completed successfully: id=<jobId>, stage=prepare
```

4. Confirm that the run advances. The run's `status` event carries the transition:

```text
Stage 'prepare' completed. Transitioning to 'understanding'.
```

A stage that cannot reach its model records the connection's own reason in the `stage_attempts` row's `error` column and moves the run to `failed`. The raw provider text never crosses the boundary.

## Step 5: Verify SQLite Database State

1. Query the durable records from your third terminal:

```bash
bun -e "
import { createDatabase } from './src/db/connection.js';
import { getDatabasePath } from './src/paths.js';
const db = createDatabase({ path: getDatabasePath() });
console.log('Run:', db.query('SELECT id, status, revision FROM runs WHERE id = ?').get('<runId>'));
console.log('Jobs:', db.query('SELECT id, stage, status, attempts, worker_id FROM jobs WHERE run_id = ?').all('<runId>'));
console.log('Attempts:', db.query('SELECT stage, attempt, status, error FROM stage_attempts WHERE run_id = ?').all('<runId>'));
db.close();
"
```

2. Confirm that the query output satisfies these conditions:
- The `runs` table contains the specified run with an updated `revision` value.
- The `jobs` table records `worker_id` and non-zero attempts.
- The `stage_attempts` table records the stage execution attempt.

## Step 6: Verify Server-Sent Events

1. Inspect the real-time event stream for the run:

```bash
curl -N http://127.0.0.1:3777/api/runs/<runId>/events
```

2. Confirm that the server sends `data:` lines carrying `stage_started`, `status`, or `error` events.
3. Confirm that the server emits periodic `: keep-alive` comment frames.

## Step 7: Verify Clean Worker Shutdown

1. Navigate to the worker terminal.
2. Send a termination signal by pressing `Ctrl+C`.
3. Verify that the worker displays the shutdown lines:

```text
Received SIGINT. Gracefully stopping worker...
[2026-10-13T00:00:00.000Z] [Worker <workerId>] Stopping worker cleanly...
[2026-10-13T00:00:00.000Z] [Worker <workerId>] Worker stopped.
```

The worker also writes one structured line at the end: `"result":"shutdown"` with the message `Worker stopped cleanly`.
