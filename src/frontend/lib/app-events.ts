// src/frontend/lib/app-events.ts — App-wide event stream and snapshot client module (#257, spec #241).

import type { QueryClient } from "@tanstack/react-query";
import type {
  AppEventEnvelope,
  EventsSnapshot,
  Run,
  RunEvent,
  RunEventPayloadMap,
} from "../../shared/types.js";
import { api } from "./api-client.js";
import { patchRunCache } from "./query-client.js";
import { queryKeys } from "./query-policies.js";
import { reduceRun } from "./run-state.js";

/** Fetches a fresh, consistent snapshot of app-wide events and current runs. */
export async function fetchEventsSnapshot(): Promise<EventsSnapshot> {
  const res = await fetch("/api/events/snapshot");
  if (!res.ok) {
    throw new Error(`Failed to fetch events snapshot: ${res.status}`);
  }
  return (await res.json()) as EventsSnapshot;
}

const adopting = new Set<string>();

/**
 * A run created elsewhere (another tab, the CLI) is not in the cached list, so the
 * list patch cannot show it (#259). Fetch just that run and insert it; never the list.
 */
function adoptUnknownRun(queryClient: QueryClient, runId: string): void {
  const list = queryClient.getQueryData<Run[]>(queryKeys.runs());
  if (!list || list.some((r) => r.id === runId) || adopting.has(runId)) return;
  adopting.add(runId);
  api
    .getRun(runId)
    .then((run) => {
      queryClient.setQueryData<Run>(queryKeys.run(runId), run);
      queryClient.setQueryData<Run[] | undefined>(queryKeys.runs(), (old) =>
        !old || old.some((r) => r.id === runId) ? old : [run, ...old],
      );
    })
    .catch(() => {
      // Not fetched now: the next event for this run tries again.
    })
    .finally(() => adopting.delete(runId));
}

export interface AppEventTransportHandlers {
  onOpen(): void;
  onMessage(data: string): void;
  onError(): void;
}

/** Opens an app-wide live stream from a cursor and returns the function that closes it. */
export type AppEventTransport = (
  cursor: number,
  handlers: AppEventTransportHandlers,
) => () => void;

/** Production transport: the browser's EventSource on /api/events?last_event_id=... */
export const defaultAppEventTransport: AppEventTransport = (
  cursor,
  handlers,
) => {
  const source = new EventSource(
    `/api/events?last_event_id=${encodeURIComponent(cursor)}`,
  );
  source.onopen = () => handlers.onOpen();
  source.onmessage = (event) => handlers.onMessage(event.data);
  // The client reopens with its own processed cursor, so the browser's automatic
  // reconnect (which would reuse this URL and its stale cursor) is switched off.
  source.onerror = () => {
    source.close();
    handlers.onError();
  };
  return () => source.close();
};

/** How an applied event reached the client (#265). */
export interface AppEventDelivery {
  /**
   * True when the event was created after this connection was requested, so it is
   * new rather than a backlog replayed on connect or resume. Desktop banners fire
   * only for live events.
   */
  live: boolean;
}

export interface AppEventSubscription {
  queryClient: QueryClient;
  initialCursor: number;
  transport?: AppEventTransport | undefined;
  onEvent?:
    | ((envelope: AppEventEnvelope, delivery: AppEventDelivery) => void)
    | undefined;
  onConnectionChange?: ((connected: boolean) => void) | undefined;
  /** Delay before reconnect attempt n (0-based). Defaults to exponential backoff. */
  retryDelayMs?: ((attempt: number) => number) | undefined;
}

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;

/** Exponential backoff: 1s, 2s, 4s … capped at 30s. */
export function defaultRetryDelayMs(attempt: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
}

/**
 * Connects the app-wide event stream to TanStack Query and consumers (#257, spec #241).
 *
 * Recovery contract: a dropped connection is closed and a new one opens after a
 * backoff, from the cursor of the last event this client has fully applied. The
 * cursor moves only after an event is applied; a failed apply closes the connection
 * so the event is replayed. Received events are deduplicated by global id.
 */
export function subscribeAppEvents({
  queryClient,
  initialCursor,
  transport = defaultAppEventTransport,
  onEvent,
  onConnectionChange,
  retryDelayMs = defaultRetryDelayMs,
}: AppEventSubscription): () => void {
  let stopped = false;
  let currentCursor = initialCursor;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let dropCurrent: (() => void) | null = null;
  const seenEventIds = new Set<number>();

  const applyEnvelope = (
    envelope: AppEventEnvelope,
    delivery: AppEventDelivery,
  ) => {
    if (seenEventIds.has(envelope.id)) return;

    // Direct cache update: patch run cache for status events (#257)
    if (envelope.type === "status") {
      const runEvent: RunEvent<"status"> = {
        id: envelope.sequence,
        type: "status",
        payload: envelope.payload as RunEventPayloadMap["status"],
        timestamp: envelope.time,
      };
      patchRunCache(
        envelope.runId,
        (previous) => (previous ? reduceRun(previous, runEvent) : previous),
        queryClient,
      );
    }

    adoptUnknownRun(queryClient, envelope.runId);

    onEvent?.(envelope, delivery);

    // Only now is the event applied: remember it and move the cursor.
    seenEventIds.add(envelope.id);
    if (envelope.id > currentCursor) {
      currentCursor = envelope.id;
    }
  };

  const connect = (): void => {
    if (stopped) return;
    // Events created from this moment on are live; anything older is backlog.
    const requestedAt = Date.now();
    let live = true;
    let close: (() => void) | null = null;

    const drop = () => {
      if (!live) return;
      live = false;
      const closeFn = close;
      close = null;
      if (dropCurrent === drop) dropCurrent = null;
      closeFn?.();
    };
    dropCurrent = drop;

    const scheduleReconnect = () => {
      drop();
      onConnectionChange?.(false);
      if (stopped) return;
      const delay = retryDelayMs(attempt);
      attempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
    };

    const returnedClose = transport(currentCursor, {
      onOpen: () => {
        if (!live || stopped) return;
        attempt = 0;
        onConnectionChange?.(true);
      },
      onMessage: (data) => {
        if (!live || stopped) return;
        let envelope: AppEventEnvelope;
        try {
          envelope = JSON.parse(data) as AppEventEnvelope;
        } catch {
          return; // keepalive comment or non-JSON frame
        }
        if (
          !envelope ||
          typeof envelope.id !== "number" ||
          typeof envelope.type !== "string"
        ) {
          return;
        }
        try {
          applyEnvelope(envelope, {
            live: Date.parse(envelope.time) >= requestedAt,
          });
        } catch {
          // Not applied: the cursor stays put, so the connection is replaced and
          // this event comes again.
          scheduleReconnect();
        }
      },
      onError: () => {
        if (!live || stopped) return;
        scheduleReconnect();
      },
    });

    close = returnedClose;
    // A handler may have dropped the connection before the transport returned.
    if (!live) {
      close();
      close = null;
    }
  };

  connect();

  return () => {
    if (stopped) return;
    stopped = true;
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
    dropCurrent?.();
    dropCurrent = null;
    onConnectionChange?.(false);
  };
}
