# How to Verify Worker Leases and Agent Sessions

This guide shows you how to verify that an independent background worker claims a durable SQLite job and starts an agent session.
You will inspect terminal logs, query SQLite database records, and monitor Server-Sent Events.

## Prerequisites

Before you begin this procedure, ensure that you have:
- Bun runtime (version 1.2.3 or newer).
- A clean working directory with installed dependencies (`bun install`).
- Optional: `ANTHROPIC_API_KEY` set in your environment. If you omit the key, the agent session starts, validates configuration, and emits an authentication notice.

## Step 1: Start the API Server

1. Open your first terminal.
2. Start the API server:

```bash
bun run start
```

3. Confirm that the terminal displays:

```text
X-Factory server running at http://localhost:3777
```

## Step 2: Start the Independent Worker Process

1. Open a second terminal.
2. Start the worker process:

```bash
bun run worker
```

3. Verify that the worker terminal displays the startup log:

```text
Database verified at schema version 6.
Worker started. Polling for pending jobs...
```

## Step 3: Submit a Test Run

1. Open a third terminal.
2. Submit a run request for a configured project:

```bash
curl -X POST http://localhost:3777/api/runs \
  -H "Content-Type: application/json" \
  -d '{"projectId": "converso", "ticketId": "SMOKE-1", "ticketTitle": "Smoke Test", "plan": "Verify real Pi process execution"}'
```

3. Confirm that the API returns HTTP status `201 Created` with a JSON payload:

```json
{
  "id": "<runId>",
  "project": { "id": "converso", "name": "Converso" },
  "status": "preparing",
  "ticket": { "id": "SMOKE-1", "title": "Smoke Test" },
  "revision": 1
}
```

4. Note the returned `id` value. You will use this value as `<runId>` in the next steps.

## Step 4: Verify Worker Execution Logs

1. Observe the output in the worker terminal.
2. Verify that the worker claims the job:

```text
Claimed job job-... for stage prepare
```

3. Verify that the worker transitions the run:

```text
Stage prepare completed. Next stage: understand
```

4. If `ANTHROPIC_API_KEY` is not present, confirm that the worker logs report the missing key:

```text
Pi execution failed: AuthenticationError: 401 invalid x-api-key
```

This error confirms that the worker invoked the real agent process.

## Step 5: Verify SQLite Database State

1. Query the durable records from your third terminal:

```bash
bun -e "
import { createDatabase } from './src/db/connection.js';
import { getDbPath } from './src/paths.js';
const db = createDatabase({ path: getDbPath() });
console.log('Run:', db.query('SELECT id, status, revision FROM runs WHERE id = ?').get('<runId>'));
console.log('Jobs:', db.query('SELECT id, stage, status, attempts, worker_id FROM jobs WHERE run_id = ?').all('<runId>'));
console.log('Attempts:', db.query('SELECT stage, exit_code, error FROM stage_attempts WHERE run_id = ?').all('<runId>'));
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
curl -N http://localhost:3777/api/runs/<runId>/events
```

2. Confirm that the server sends `data:` lines containing `stage_start`, `status`, or `error` events.
3. Confirm that the server emits periodic `: keepalive` comments.

## Step 7: Verify Clean Worker Shutdown

1. Navigate to the worker terminal.
2. Send a termination signal by pressing `Ctrl+C`.
3. Verify that the worker displays a graceful shutdown message:

```text
Worker received termination signal. Cleaning up...
Worker stopped cleanly.
```
