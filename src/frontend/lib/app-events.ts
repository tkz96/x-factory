// src/frontend/lib/app-events.ts — App-wide event stream and snapshot client module (#257, spec #241).

import type { QueryClient } from "@tanstack/react-query";
import type {
  AppEventEnvelope,
  EventsSnapshot,
  RunEvent,
  RunEventPayloadMap,
} from "../../shared/types.js";
import { patchRunCache } from "./query-client.js";
import { reduceRun } from "./run-state.js";

/** Fetches a fresh, consistent snapshot of app-wide events and current runs. */
export async function fetchEventsSnapshot(): Promise<EventsSnapshot> {
  const res = await fetch("/api/events/snapshot");
  if (!res.ok) {
    throw new Error(`Failed to fetch events snapshot: ${res.status}`);
  }
  return (await res.json()) as EventsSnapshot;
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
  source.onerror = () => handlers.onError();
  return () => source.close();
};

export interface AppEventSubscription {
  queryClient: QueryClient;
  initialCursor: number;
  transport?: AppEventTransport | undefined;
  onEvent?: ((envelope: AppEventEnvelope) => void) | undefined;
  onConnectionChange?: ((connected: boolean) => void) | undefined;
}

/**
 * Connects the app-wide event stream to TanStack Query and consumers (#257, spec #241).
 * Deduplicates received events by global id, advances the in-memory cursor, and
 * directly patches the query cache for status transitions without page flicker.
 */
export function subscribeAppEvents({
  queryClient,
  initialCursor,
  transport = defaultAppEventTransport,
  onEvent,
  onConnectionChange,
}: AppEventSubscription): () => void {
  let stopped = false;
  let close: (() => void) | null = null;
  let currentCursor = initialCursor;
  const seenEventIds = new Set<number>();

  const stop = () => {
    if (stopped) return;
    stopped = true;
    close?.();
    close = null;
    onConnectionChange?.(false);
  };

  const applyEnvelope = (envelope: AppEventEnvelope) => {
    if (seenEventIds.has(envelope.id)) return;
    seenEventIds.add(envelope.id);

    // Advance cursor in memory
    if (envelope.id > currentCursor) {
      currentCursor = envelope.id;
    }

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

    onEvent?.(envelope);
  };

  const opened = transport(currentCursor, {
    onOpen: () => {
      if (!stopped) onConnectionChange?.(true);
    },
    onMessage: (data) => {
      if (stopped) return;
      try {
        const envelope = JSON.parse(data) as AppEventEnvelope;
        if (
          envelope &&
          typeof envelope.id === "number" &&
          typeof envelope.type === "string"
        ) {
          applyEnvelope(envelope);
        }
      } catch {
        // keepalive comment or non-JSON frame
      }
    },
    onError: () => {
      if (stopped) return;
      onConnectionChange?.(false);
    },
  });

  if (stopped) opened();
  else close = opened;

  return stop;
}
