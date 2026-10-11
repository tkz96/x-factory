# App-wide Events API

The read-only HTTP surface the UI uses for cross-run state: a consistent snapshot, and a live stream of the events that change it (spec #241, #257). The OpenAPI document (`src/http/openapi.ts`, served at `/api/openapi.json`) lists the same two routes. The reasoning behind the design is in [UI state and event streaming](../explanation/ui-state-and-event-streaming.md). The per-run stream, `GET /api/runs/:id/events`, is a different endpoint and is not described here.

```
GET /api/events/snapshot
GET /api/events?last_event_id=<cursor>
```

Both are served by the API process and only read SQLite.

## GET /api/events/snapshot

Returns JSON in one SQLite read transaction:

| Field | Meaning |
|---|---|
| `cursor` | The highest global `run_events.id` the snapshot includes. |
| `runs` | Every run with its current status. |
| `needsYou` | For each run in a Needs-you status, the event that moved it there. No age limit. |
| `finished` | Finished events (`pr_created`, `failed`, `stopped`) at or below `cursor`, last 7 days, at most 100, ascending. |

## GET /api/events

An SSE stream (`text/event-stream`) of the `status` and `pr_step` events of every run.

**Frames.** Each event is `id: <global run_events.id>` followed by `data: <AppEventEnvelope as JSON>`. The envelope is `id`, `runId`, `sequence` (the per-run number), `type`, `payload`, `time`, `ticket` and `project`.

**Cursor rules.** The server delivers every event with an id strictly above the cursor.

- The cursor comes from the `last_event_id` query parameter and the `Last-Event-ID` header. There is no other alias.
- When both are valid, the lower one wins.
- Only non-negative integers are valid. A malformed or negative value counts as absent.
- With no valid cursor the server answers `400` and tells the client to take a snapshot. The usual cursor is the snapshot's `cursor`, which leaves no gap between the two calls.
- Delivery is at least once. Clients drop an event whose id they have already applied.

**Replay.** A cursor behind the head is replayed first, in ascending id order, read from SQLite in pages of 500 until the stream has caught up. Live events follow without a gap or a duplicate.

**Polling.** The API process runs one shared poller for all connections (`src/http/app-event-hub.ts`). It reads new events from SQLite every 300 ms and hands them to every open stream. It starts with the first connection and stops with the last.

**Keepalive.** A `: keep-alive` comment frame every 15 seconds, so proxies do not close a quiet connection.

**Errors.** When the poll or a write to a connection fails, the error is logged on the server and the affected streams are closed. `EventSource` reconnects with its last id.

**Shutdown.** Every open stream is closed when the API process shuts down.
