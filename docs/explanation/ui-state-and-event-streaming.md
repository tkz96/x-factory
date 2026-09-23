# Explanation: UI State Management and Real-Time Event Streaming

This document explains the architecture for real-time telemetry streaming, event delivery, and user interface state synchronization in X-Factory.

## Event Distribution Architecture

X-Factory streams execution telemetry from background workers to browser clients through Server-Sent Events (SSE).
The architecture decouples the event producer (the worker) from event consumers (browser clients) through an in-memory event bus and a durable database table.

```text
┌──────────────────────┐          ┌──────────────────────┐
│    Worker Process    │          │     API Process      │
│   (src/worker.ts)    │          │   (src/server.ts)    │
└──────────┬───────────┘          └──────────▲───────────┘
           │                                 │
           │ 1. Emit Telemetry Event         │ 3. Dispatch Event
           ▼                                 │
┌────────────────────────────────────────────┴───────────┐
│               RunEventBus (src/events.ts)              │
│               In-Memory Event Dispatcher               │
└──────────────────────┬─────────────────────────────────┘
                       │
                       │ 2. Persist Event
                       ▼
┌────────────────────────────────────────────────────────┐
│               SQLite events Table                      │
│               (Durable Historical Record)              │
└────────────────────────────────────────────────────────┘
```

## Why Server-Sent Events Instead of WebSockets

X-Factory uses Server-Sent Events (SSE) for real-time telemetry rather than bidirectional WebSockets.
This design choice provides several practical advantages:

### 1. Unidirectional Telemetry Flow
Workflow telemetry flows in one direction: from the executing worker to the monitoring user.
WebSockets provide bidirectional communication, but X-Factory sends user commands over standard HTTP POST endpoints.
Standard REST endpoints provide clear HTTP status codes, structured validation, and simpler error handling.

### 2. Native Browser Reconnection
Browsers provide built-in reconnection logic for Server-Sent Events through the standard `EventSource` interface.
If a network hiccup interrupts the connection, the browser reconnects automatically without custom retry libraries.

### 3. HTTP Infrastructure Compatibility
SSE operates over standard HTTP connections.
Standard load balancers, proxies, and firewalls handle SSE streams without special protocol upgrade configurations.

## Historical Event Replay

When a client connects to `GET /api/runs/:id/events`, the server executes two sequential operations:
1. **Historical Flush**: The server queries the durable `events` table for all past events associated with the run identifier. The server immediately flushes these events to the client stream.
2. **Live Subscription**: The server attaches a listener to `RunEventBus`. As the worker publishes new events, the event bus pushes them to the open stream in real time.

This dual-path design solves the race condition where a user opens or refreshes a browser tab while a run is in progress.
The user receives the full execution history first, followed immediately by live updates.

## Frontend State Synchronization

The frontend single page application uses TanStack Query to manage server state in the browser.

### Direct Cache Updates
When the client receives an event through the SSE stream, the application updates the local query cache directly.
This mechanism updates the user interface immediately with zero full-page flickering.

### Declarative Polling Fallback
Network proxies can terminate silent SSE connections.
To maintain resilience against dropped connections, the client uses declarative polling policies:
- Active runs poll the runs API endpoint every 2 seconds.
- Idle runs poll every 15 seconds.
- Diagnostics poll every 5 seconds when the diagnostics tab is visible.

This layered approach guarantees that the user interface always reflects true system state.

## Optimistic Concurrency Control

Multiple browser tabs or background processes can attempt to modify a run simultaneously.
To prevent race conditions and accidental data overwrites, X-Factory enforces optimistic concurrency control.

Every run record in SQLite includes a monotonic `revision` integer.
When the user submits an update, the update query includes the expected revision:

```sql
UPDATE runs 
SET status = ?, plan = ?, revision = revision + 1, updated_at = datetime('now')
WHERE id = ? AND revision = ?;
```

If another process modified the run between the read and the write, SQLite updates zero rows.
The server detects zero affected rows, rolls back the transaction, and returns an HTTP concurrency error.
This invariant guarantees that outdated user actions never overwrite newer state changes.
