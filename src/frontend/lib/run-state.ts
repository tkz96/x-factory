// src/frontend/lib/run-state.ts — Client run-state module (#191).
//
// One module owns how a run's live state reaches the browser:
//   - a per-run event log, kept in the query cache under `queryKeys.runEvents`,
//     deduplicated by event id and kept in id order;
//   - a pure (run, event) → run reducer that covers every member of the shared
//     RunEvent union, and never moves status against the transition matrix;
//   - a subscriber that feeds a transport (EventSource in production) into the
//     log and the reducer, and coalesces the follow-up invalidations.
// Components read from the query cache through `useRunDetail`; they never parse
// wire events themselves.

import type { QueryClient } from "@tanstack/react-query";
import {
  ACTIVE_RUN_STATUSES,
  canTransition,
} from "../../shared/run-status-policy.js";
import type { Run, RunEvent, RunEventType } from "../../shared/types.js";
import { invalidateRun, patchRunCache } from "./query-client.js";
import { queryKeys } from "./query-policies.js";

/** The documented polling fallback for an active run (docs/explanation/ui-state-and-event-streaming.md). */
export const ACTIVE_RUN_POLL_INTERVAL_MS = 2000;

/** Trailing delay that merges the invalidations of one burst of events into one. */
const INVALIDATION_DELAY_MS = 100;

/** Event types whose payload changes fields the reducer does not hold in full. */
const INVALIDATING_EVENT_TYPES = new Set<RunEventType>([
  "status",
  "verification",
  "review",
]);

// ─── Pure reducer ────────────────────────────────────────────────────────────

/**
 * Applies one event to a run snapshot. A status event is applied only when the
 * transition matrix allows it from the current status, so replayed history can
 * never move a run backwards.
 */
export function reduceRun(run: Run, event: RunEvent): Run {
  switch (event.type) {
    case "status": {
      const { status, pullRequest } = event.payload;
      if (status === run.status) {
        return status === "pr_created" && pullRequest
          ? { ...run, pullRequest }
          : run;
      }
      if (!canTransition(run.status, status)) return run;
      return status === "pr_created"
        ? { ...run, status, pullRequest: pullRequest ?? null }
        : { ...run, status };
    }
    case "verification": {
      const { result } = event.payload;
      return {
        ...run,
        verification: result,
        repairAttempts: result.repairAttempt,
        ...(result.diff ? { diff: result.diff } : {}),
      };
    }
    case "review":
      return { ...run, review: event.payload.result };
    case "stage_evidence":
    case "pr_step":
    case "chat_user":
    case "chat_agent":
    case "user_feedback":
    case "pi_output_chunk":
    case "ralph_progress":
    case "steer":
    case "info":
    case "error":
      return run;
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}

/** Inserts an event into an id-ordered log. A duplicate returns the same array. */
export function insertRunEvent(
  log: readonly RunEvent[],
  event: RunEvent,
): readonly RunEvent[] {
  if (log.some((existing) => existing.id === event.id)) return log;
  const index = log.findIndex((existing) => existing.id > event.id);
  return index === -1
    ? [...log, event]
    : [...log.slice(0, index), event, ...log.slice(index)];
}

/** Polling fallback: an active run refreshes every 2 seconds, a finished run never. */
export function runPollIntervalMs(run: Run | undefined): number | false {
  return run && ACTIVE_RUN_STATUSES.has(run.status)
    ? ACTIVE_RUN_POLL_INTERVAL_MS
    : false;
}

// ─── Transport seam ──────────────────────────────────────────────────────────

export interface RunEventTransportHandlers {
  onOpen(): void;
  onMessage(data: string): void;
  onError(): void;
}

/** Opens a live stream of one run's events and returns the function that closes it. */
export type RunEventTransport = (
  runId: string,
  handlers: RunEventTransportHandlers,
) => () => void;

/** Production transport: the browser's EventSource on the run's SSE endpoint. */
export const eventSourceTransport: RunEventTransport = (runId, handlers) => {
  const source = new EventSource(
    `/api/runs/${encodeURIComponent(runId)}/events`,
  );
  source.onopen = () => handlers.onOpen();
  source.onmessage = (event) => handlers.onMessage(event.data);
  source.onerror = () => handlers.onError();
  return () => source.close();
};

// ─── Subscriber ──────────────────────────────────────────────────────────────

export interface RunEventSubscription {
  queryClient: QueryClient;
  runId: string;
  /**
   * True for a finished run. The server replays its history and then closes the
   * stream, so the subscriber closes it on error instead of letting EventSource
   * reconnect and replay the same history forever.
   */
  replayOnly: boolean;
  transport?: RunEventTransport | undefined;
  onConnectionChange?: ((connected: boolean) => void) | undefined;
}

const pendingInvalidations = new WeakMap<
  QueryClient,
  Map<string, ReturnType<typeof setTimeout>>
>();

function scheduleRunInvalidation(queryClient: QueryClient, runId: string) {
  let pending = pendingInvalidations.get(queryClient);
  if (!pending) {
    pending = new Map();
    pendingInvalidations.set(queryClient, pending);
  }
  if (pending.has(runId)) return;
  pending.set(
    runId,
    setTimeout(() => {
      pending?.delete(runId);
      void invalidateRun(runId, queryClient);
    }, INVALIDATION_DELAY_MS),
  );
}

function applyWireMessage(
  queryClient: QueryClient,
  runId: string,
  data: string,
): void {
  let event: RunEvent;
  try {
    event = JSON.parse(data) as RunEvent;
  } catch {
    return; // keepalive comment or non-JSON frame
  }
  if (
    !event ||
    typeof event.id !== "number" ||
    typeof event.type !== "string"
  ) {
    return;
  }

  const logKey = queryKeys.runEvents(runId);
  const log = queryClient.getQueryData<RunEvent[]>(logKey) ?? [];
  const next = insertRunEvent(log, event);
  if (next === log) return; // already applied
  queryClient.setQueryData(logKey, next);

  patchRunCache(
    runId,
    (previous) => (previous ? reduceRun(previous, event) : previous),
    queryClient,
  );
  if (INVALIDATING_EVENT_TYPES.has(event.type)) {
    scheduleRunInvalidation(queryClient, runId);
  }
}

/** Connects a run's events to the query cache. Returns the function that stops it. */
export function subscribeRunEvents({
  queryClient,
  runId,
  replayOnly,
  transport = eventSourceTransport,
  onConnectionChange,
}: RunEventSubscription): () => void {
  let stopped = false;
  let close: (() => void) | null = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    close?.();
    close = null;
    onConnectionChange?.(false);
  };

  const opened = transport(runId, {
    onOpen: () => {
      if (!stopped) onConnectionChange?.(true);
    },
    onMessage: (data) => {
      if (!stopped) applyWireMessage(queryClient, runId, data);
    },
    onError: () => {
      if (stopped) return;
      onConnectionChange?.(false);
      if (replayOnly) stop();
    },
  });
  // A replay-only stream can fail while the transport is still opening.
  if (stopped) opened();
  else close = opened;

  return stop;
}
