# Tutorial: Run Your First Agent Workflow

This tutorial teaches you how to start X-Factory and execute your first workflow run.
You will start the API server, start the worker process, and trigger a run.
You will complete this tutorial in approximately 5 minutes.

## Prerequisites

Before you start, make sure that you have these tools installed:
- Bun runtime (version 1.2.3 or newer)
- Git command line interface

## Step 1: Install Dependencies

Open a terminal.
Run this command to install the project dependencies:

```bash
bun install
```

Wait until the installation process completes.

## Step 2: Start the API Server

Start the API server in your first terminal:

```bash
bun run start
```

Verify that the terminal displays this message:

```text
X-Factory server running at http://localhost:3777
```

Keep this terminal window open.

## Step 3: Start the Background Worker

Open a second terminal window.
Navigate to your project root directory.
Start the background worker process:

```bash
bun run worker
```

Verify that the worker terminal displays these messages:

```text
Database verified at schema version 6.
Worker started. Polling for pending jobs...
```

Keep this second terminal window open.

## Step 4: Open the User Interface

Open your web browser.
Navigate to this URL:

```text
http://localhost:3777
```

Verify that the browser displays the X-Factory user interface.

## Step 5: Submit a New Run

Submit a test run from a third terminal:

```bash
curl -X POST http://localhost:3777/api/runs \
  -H "Content-Type: application/json" \
  -d '{"projectId": "converso", "ticketId": "DEMO-1", "ticketTitle": "First Run", "plan": "Verify basic execution"}'
```

Verify that the terminal displays a JSON response with status `201 Created`:

```json
{
  "id": "<runId>",
  "status": "preparing",
  "ticket": { "id": "DEMO-1", "title": "First Run" },
  "revision": 1
}
```

## Step 6: Observe the Workflow Execution

Return to the second terminal window.
Observe the worker terminal output.
The worker claims the job and executes the workflow stages:
1. The worker claims the job.
2. The worker updates the run status to preparing.
3. The worker advances the run through the workflow stages.

Open your browser window at `http://localhost:3777`.
Observe the live status card for your run.
The status card updates in real time.

You have successfully completed your first X-Factory run.
