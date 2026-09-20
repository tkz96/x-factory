# Manual Pi Integration Smoke Test (XFM-25C)

This document describes the repeatable manual procedure for verifying that a real Pi agent session starts from a durable SQLite job claimed by an independent background worker.

---

## 1. Prerequisites

- Bun runtime installed (`bun --version >= 1.2`).
- A clean working directory with dependencies installed (`bun install`).
- Optional: `ANTHROPIC_API_KEY` set in your environment if testing model inference. If omitted, the real Pi SDK will start up, validate the configuration, and emit a clear authentication error notice, which is sufficient to prove real process/session execution without mocks.

---

## 2. Procedure

### Step 1: Start the API Server
In a terminal, start the API server:
```bash
bun run start
```
By default, the server binds to port `3777` (or `PORT=3777 bun run start` for custom ports) and runs database migrations on startup.
Verify the output:
```text
X-Factory server running at http://localhost:3777
```

### Step 2: Start the Background Worker
In a second terminal, start the independent worker process:
```bash
bun run worker
```
Expected output:
```text
[<timestamp>] [Worker worker-...] Database verified at schema version 6 (6 migrations applied).
[<timestamp>] [Worker worker-...] Worker started. Polling for pending jobs...
```

### Step 3: Trigger a Durable Run
In a third terminal, submit a run request using any configured project (e.g., `converso` with a dummy ticket):
```bash
curl -X POST http://localhost:3777/api/runs \
  -H "Content-Type: application/json" \
  -d '{"projectId": "converso", "ticketId": "SMOKE-1", "ticketTitle": "Smoke Test", "plan": "Verify real Pi process execution"}'
```

Expected HTTP Response (`201 Created`):
```json
{
  "id": "<runId>",
  "project": { "id": "converso", "name": "Converso" },
  "status": "preparing",
  "ticket": { "id": "SMOKE-1", "title": "Smoke Test" },
  "revision": 1
}
```

### Step 4: Verify Worker and Pi Output
Within the poll interval (1–2 seconds), observe the worker terminal.

**Expected Worker Log Output**:
```text
{"timestamp":"...","worker_id":"worker-...","job_id":"job-...","run_id":"<runId>","stage":"parse_issue","attempt":1,"result":"claimed","message":"Job claimed"}
[Worker ...] Starting real Pi session for run_id=<runId>...
[Worker ...] Pi process/session initialized successfully for run_id=<runId>
[Worker ...] Sending dummy prompt to Pi session for ticket SMOKE-1...
[Worker ...] Pi prompt cycle completed successfully.
[Worker ...] Stopping Pi session for run_id=<runId>...
[Worker ...] Pi shutdown complete for run_id=<runId>
{"timestamp":"...","worker_id":"worker-...","job_id":"job-...","run_id":"<runId>","stage":"parse_issue","attempt":1,"result":"success","duration_ms":...,"message":"Job completed"}
```

### Step 5: Verify SQLite Final State
Check the run and job status in the SQLite database:
```bash
bun -e '
import { Database } from "bun:sqlite";
import { getDatabasePath } from "./src/paths.ts";
const db = new Database(getDatabasePath());
console.log("Run:", db.prepare("SELECT id, status, revision FROM runs ORDER BY created_at DESC LIMIT 1").get());
console.log("Job:", db.prepare("SELECT id, status, attempts, locked_by FROM jobs ORDER BY created_at DESC LIMIT 1").get());
'
```
Expected output:
```text
Run: { id: '<runId>', status: 'queued', revision: 1 }
Job: { id: 'job-...', status: 'completed', attempts: 1, locked_by: null }
```

---

## 3. Manual Stop Procedure

To shut down cleanly:
1. In the Worker terminal: press `Ctrl+C` (`SIGINT`).
   - The worker stops polling immediately.
   - Any in-flight Pi session is cleanly aborted.
   - Any active job leases are released back to `pending`.
   - Output: `Worker stopped cleanly.`
2. In the API Server terminal: press `Ctrl+C`.

---

## 4. Troubleshooting & Common Failure Messages

- **`No API key found for the selected model`**:
  - **Status**: Normal when `ANTHROPIC_API_KEY` is not exported.
  - **Meaning**: The real `@earendil-works/pi-coding-agent` SDK initialized, parsed configuration, and validated API credentials. This verifies genuine integration without mocks.
- **`SQLITE_BUSY: database is locked`**:
  - SQLite busy timeout defaults to `5000ms`. Ensure `PRAGMA journal_mode = WAL` is active and that no external SQLite browser has locked the file exclusively.
- **`Run not found for job ...`**:
  - Indicates `runs` table and `jobs` table were out of sync. Runs must always be created in the same transaction as the initial job.
