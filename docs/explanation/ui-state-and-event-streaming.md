# Explanation: UI State Management and Real-Time Event Streaming

This document explains the architecture for real-time telemetry streaming, event delivery, and user interface state synchronization in X-Factory.

## Event Distribution Architecture

X-Factory streams execution telemetry from background workers to browser clients through Server-Sent Events (SSE).
The architecture decouples the event producer (the worker) from event consumers (browser clients) through an in-memory event bus and a durable database table.

```diagram:event-distribution
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
2. **Live Subscription**: The server registers the client with `SSERegistry` and continuously polls durable SQLite events (and flushes on commits), streaming newly appended events to the open SSE connection in real time.

This dual-path design solves the race condition where a user opens or refreshes a browser tab while a run is in progress.
The user receives the full execution history first, followed immediately by live updates.

Finished runs use the same endpoint rather than a REST events endpoint. The replay already carries the full history, so a second read path would only duplicate it. The client subscribes to a finished run in replay-only mode: the server closes the stream after the history, and the client closes it on error instead of letting `EventSource` reconnect and replay the same history forever.

## Frontend State Synchronization

The frontend single page application uses TanStack Query to manage server state in the browser.

### The run-state module

`src/frontend/lib/run-state.ts` owns how a run's live state reaches the cache. Components read it through `useRunDetail`, and nothing else parses wire events.

- **Event log.** Each run's events live in the query cache under `["run-events", runId]`, outside the `["runs", ...]` prefix so that run invalidation never drops them. An event is inserted in id order, and an event whose id is already present is ignored. A reconnect that replays history therefore changes nothing.
- **Reducer.** `reduceRun(run, event)` is pure and exhaustive over the shared event union. A status event is applied only when the transition matrix allows it from the current status, so replayed history never moves a run backwards.
- **Subscriber.** `subscribeRunEvents` feeds a transport (`EventSource` in production, a fake in tests) into the log and the reducer. Follow-up invalidations of the run are coalesced over a 100 ms window. Stopping the subscriber flushes a pending invalidation at once, because the replacement stream may not re-apply the same events.
- **Subscription plan.** `runStreamPlan` returns nothing until the snapshot is loaded, then a replay-only subscription for a finished run and a live one otherwise.

### Direct Cache Updates
When the client receives an event through the SSE stream, the application updates the local query cache directly.
This mechanism updates the user interface immediately with zero full-page flickering.

### Declarative Polling Fallback
Network proxies can terminate silent SSE connections.
To maintain resilience against dropped connections, the client uses declarative polling policies:
- An active run polls the run endpoint every 2 seconds, whatever the state of its stream (`ACTIVE_RUN_POLL_INTERVAL_MS` in `query-policies.ts`).
- A finished run never polls. Its history comes from the replay.
- The runs list has no interval. It refetches when its data is stale (15 seconds) and on window focus.
- Diagnostics have no interval either. They refetch when stale (10 seconds) and on window focus.

This layered approach guarantees that the user interface always reflects true system state.

## Onboarding: the five-step wizard and its render-graph model

Onboarding is a five-step modal wizard (`Basics → Connect → Repositories →
Inspection → Review`) built on the provider contract. The invariants that
matter to the rest of the UI:

- **Two mandatory, decoupled connections.** The Connect step renders an issue
  tracker card and a git host card, each configured from that provider's own
  declarative schema (descriptors, not hand-written fields). Any provider may
  serve either role; a provider serving both is ONE connection carrying both
  roles in the creation payload, and the fast path is a single Quick-URL paste
  that the SERVER resolves through the provider that owns the URL format
  (`POST /api/providers/parse-url`) — the wizard knows no URL shape.
- **Everything downstream is derived at render time.** Step validity, the
  staleness of a selection or a resolution, and the Review gate are pure
  functions of the reducer's plain state (`repositoryRules`, `inspectionRules`,
  `reviewRules`). Nothing is stored that can be derived, and nothing is synced
  through an effect.
- **An input change is a new query key, never an imperative invalidation.**
  Discovery and verification identity are digests of the inputs that produced
  them, so the render graph re-keys and re-fetches on its own. The wizard never
  reaches for `invalidateQueries` to express "the inputs changed"; this is
  asserted, not assumed (`docs/reference/state-coverage.md` §Onboarding
  smoothness).
- **Evidence that is no longer current is never silent.** A restored draft drops
  every verification result and every resolved identity, results produced from
  superseded inputs keep their place on screen under an out-of-date badge, and
  the Review gate refuses to create anything while any downstream value is not
  current. There is no dismissal path — a reason clears only by re-verifying or
  re-inspecting.
- **Secrets live in memory for minutes.** They are held in wizard state, never
  written to the localStorage draft, sent exactly once in the creation request,
  and persisted to per-project env storage through ordered writes
  (`docs/reference/provider-api.md` §Ordered writes). The draft a reload restores
  is sanitized by key, so a credential cannot survive a reload in any nesting.
  Nothing else reads them: the presentation-only connection-identity read
  (`POST /api/providers/describe`, §Provider-owned connection identity) is
  secret-free by construction — a surface projects the connection through the
  manifest's own `secret` declarations before asking, and the route refuses a
  request that carries a declared secret value.
- **Success closes the flow.** Creation completes the wizard: the draft is
  cleared, the project appears through the query cache, and nothing asks the user
  to re-enter what they just submitted.

The interaction contract behind these rules — no remount when one card's
verification completes, no re-fetch when a repository row is selected, stale
badges that clear only on a newer result, and no duplicate requests when the
user navigates backwards — is recorded with its enforcing test in
`docs/reference/state-coverage.md` §Onboarding smoothness. Three end-to-end
provider journeys (GitHub-only, Azure dual-role, Jira tracker-only) drive the
real wizard against a real server, so the contract is proved against the
shipped stack rather than a fixture-shaped stand-in.

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
