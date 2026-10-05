# Explanation: Process Boundaries and System Topology

This document explains the architectural principles, process boundaries, and storage choices that govern X-Factory.

## Core Architectural Invariant

X-Factory enforces strict separation between request processing and workflow execution.
The system divides responsibilities across two independent processes on a single host:
1. The API Process (`src/server.ts`)
2. The Worker Process (`src/worker.ts`)

```diagram:process-boundaries
```

## Why the API Process Does Not Execute Workflows

Traditional web architectures sometimes execute long-running tasks in background threads inside the web server.
In an autonomous coding environment, agent sessions require extensive CPU time, memory, and disk access.
Agent sessions also interact with child processes and external tools.

If the API server executed agent sessions directly, the server would face critical operational risks:
- Long agent sessions block the event loop and degrade HTTP responsiveness.
- Memory spikes in subagents can crash the web server.
- Server restarts terminate active agent workflows and lose execution progress.

By isolating the API process, X-Factory guarantees fast HTTP responses under 15 milliseconds.
The API process accepts requests, persists durable records to SQLite, and returns immediately.
The API server remains stable even when agent sessions consume substantial system resources.

## Why SQLite in Write-Ahead Logging Mode

X-Factory uses SQLite with Write-Ahead Logging (WAL) as its authoritative persistence engine.
This choice provides distinct operational advantages over external database servers like PostgreSQL or Redis:

### 1. Local-First Simplicity
SQLite requires zero external daemon processes, network setup, or separate credential configuration.
Developers run the full production architecture locally with a single file.

### 2. High Concurrency with Non-Blocking Readers
In WAL mode, readers do not block writers, and writers do not block readers.
The API process serves concurrent read queries without waiting for active worker transactions.

### 3. Crash Recovery and Transactional Atomicity
SQLite commits changes atomically to disk.
If a worker process crashes, SQLite rolls back uncommitted transactions and preserves database integrity.

## Onboarding Sits Behind the Same Boundary

Project creation obeys the boundary rather than bending it. The wizard runs
entirely in the browser: it drafts itself to `localStorage`, holds credentials in
memory, and resolves providers by asking the API process
(`/api/providers/manifest`, `/parse-url`, `/verify`, `/repositories`). Nothing in
the browser reaches a provider directly, and no provider module is imported by
frontend code.

The API process then performs the creation as an ordered write: validate the
whole request in memory (transport shape → the provider's own config schema →
role/capability compatibility → duplicate id), write the secrets to per-project
env storage, and append the project record last as the commit point. A crash
before the record is appended leaves an orphaned env file and no project, so a
project can never exist without its secrets, and a retry converges because the
secret write is idempotent. The worker is not involved: onboarding is
persistence, not execution.

The registry is the extensibility point in both directions. Providers are
registered statically (`src/providers/registry.ts`) and injected into the HTTP
layer, which is what lets a test — or a future provider — be added without
touching the API process's routing, the wizard, or the payload contract.

## The Worker Lease Model

Multiple workers can run concurrently against the shared SQLite database.
To prevent duplicate execution of the same job, X-Factory uses database-backed lease locks:

```diagram:worker-lease-model
```

1. When a worker polls for work, the worker atomically claims a job with a 30-second lease.
2. The claiming worker records its `worker_id` and sets `lease_until = datetime('now', '+30 seconds')`.
3. While the stage executes, the worker emits heartbeats every 10 seconds to renew the lease.
4. If a worker crashes, its heartbeat stops and the lease expires.
5. Other active workers detect the expired lease, increment the attempt counter, and reclaim the job.

This mechanism provides reliable fault tolerance without requiring complex distributed lock managers.
