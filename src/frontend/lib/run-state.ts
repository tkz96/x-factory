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
  TERMINAL_RUN_STATUSES,
} from "../../shared/run-status-policy.js";
import type { Run, RunEvent, RunEventType } from "../../shared/types.js";
import {
  invalidateRun,
  invalidateRuns,
  patchRunCache,
} from "./query-client.js";
import { ACTIVE_RUN_POLL_INTERVAL_MS, queryKeys } from "./query-policies.js";
import { defaultRetryDelayMs } from "./reconnect-backoff.js";

/** Trailing delay that merges the invalidations of one burst of events into one. */
const INVALIDATION_DELAY_MS = 100;

/** Event types whose payload changes fields the reducer does not hold in full. */
const INVALIDATING_EVENT_TYPES = new Set<RunEventType>([
  "status",
  "verification",
  "review",
  "pr_merged",
  "pr_closed",
]);

// ─── Pure reducer ────────────────────────────────────────────────────────────

/** A replayed historical event older than the snapshot's updatedAt is ignored. */
function isEventStale(run: Run, event: RunEvent): boolean {
  if (run.updatedAt && event.timestamp) {
    const eventTime = new Date(event.timestamp).getTime();
    const runTime = new Date(run.updatedAt).getTime();
    if (eventTime < runTime) {
      return true;
    }
  }
  return false;
}

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
      if (isEventStale(run, event)) return run;
      if (!canTransition(run.status, status)) return run;
      const nextUpdatedAt = event.timestamp || run.updatedAt;
      return status === "pr_created"
        ? {
            ...run,
            status,
            pullRequest: pullRequest ?? null,
            updatedAt: nextUpdatedAt,
          }
        : {
            ...run,
            status,
            updatedAt: nextUpdatedAt,
          };
    }
    case "verification": {
      if (isEventStale(run, event)) return run;
      const { result } = event.payload;
      return {
        ...run,
        verification: result,
        repairAttempts: result.repairAttempt,
        ...(result.diff ? { diff: result.diff } : {}),
      };
    }
    case "review":
      if (isEventStale(run, event)) return run;
      return { ...run, review: event.payload.result };
    case "pr_merged":
      return {
        ...run,
        pullRequestOutcome: {
          status: "merged",
          state: "merged",
          url: event.payload.url,
          mergedAt: event.payload.mergedAt,
          mergedBy: event.payload.mergedBy,
        },
      };
    case "pr_closed":
      return {
        ...run,
        pullRequestOutcome: {
          status: "closed",
          state: "closed",
          url: event.payload.url,
          closedAt: event.payload.closedAt,
        },
      };
    case "stage_started": {
      // The model a step of a stage attempt runs on (#279), shown live; a
      // replay of the same step is not added twice.
      const { stage, attempt, model } = event.payload;
      const step = event.payload.step ?? stage;
      const known = (run.stageModels ?? []).some(
        (m) => m.stage === stage && m.attempt === attempt && m.step === step,
      );
      if (known) return run;
      return {
        ...run,
        stageModels: [
          ...(run.stageModels ?? []),
          { ...model, stage, step, attempt, startedAt: event.timestamp },
        ],
      };
    }
    case "stage_evidence":
    case "pr_step":
    case "chat_user":
    case "chat_agent":
    case "user_feedback":
    case "pi_output_chunk":
    case "ralph_progress":
    // #256 events carry their own surfaces; the chat timeline (a later ticket) renders them.
    case "plan_ready":
    case "diff_summary":
    case "review_activity":
    case "info":
    case "error":
      return run;
    default: {
      // Compile-time exhaustiveness: a new union member must be handled above. At runtime an
      // unknown type (a leftover row from an old database) leaves the run unchanged.
      const exhaustive: never = event;
      void exhaustive;
      return run;
    }
  }
}

/** Inserts an event into an id-ordered log. A duplicate returns the same array. */
export function insertRunEvent(
  log: readonly RunEvent[],
  event: RunEvent,
): readonly RunEvent[] {
  if (log.length === 0) return [event];
  const last = log[log.length - 1];
  if (!last) return [event];
  if (event.id > last.id) {
    return [...log, event];
  }
  if (event.id === last.id) return log;
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

/** The `refetchInterval` of a run detail query: the polling fallback, whatever the stream is doing. */
export function runRefetchInterval(query: {
  state: { data: Run | undefined };
}): number | false {
  return runPollIntervalMs(query.state.data);
}

/**
 * What the run's live stream should be: null until the snapshot is loaded, then
 * replay-only for a finished run (its history is shown, then the stream closes).
 */
export function runStreamPlan(
  run: Run | undefined,
): { replayOnly: boolean } | null {
  if (!run) return null;
  return { replayOnly: TERMINAL_RUN_STATUSES.has(run.status) };
}

/** Writes a run returned by a mutation and marks the runs list stale. */
export function cacheRunAfterMutation(
  queryClient: QueryClient,
  run: Run,
): void {
  queryClient.setQueryData(queryKeys.run(run.id), run);
  void invalidateRuns(queryClient);
}

/** Refreshes a run after a mutation whose response does not carry the run. */
export function refreshRunAfterMutation(
  queryClient: QueryClient,
  runId: string,
): void {
  void invalidateRun(runId, queryClient);
  void invalidateRuns(queryClient);
}

// ─── Transport seam ──────────────────────────────────────────────────────────

export interface RunEventTransportHandlers {
  onOpen(): void;
  onMessage(data: string): void;
  /**
   * `permanent` is true when the browser has given up on the connection (a non-200
   * response, or a reconnect that failed), so nothing will retry it. False means the
   * browser is retrying by itself.
   */
  onError(permanent: boolean): void;
}

/** Opens a live stream of one run's events after `cursor` (0 for all) and returns the function that closes it. */
export type RunEventTransport = (
  runId: string,
  cursor: number,
  handlers: RunEventTransportHandlers,
) => () => void;

/** EventSource.CLOSED: the browser has stopped trying to reconnect. */
const EVENT_SOURCE_CLOSED = 2;

/** Production transport: the browser's EventSource on the run's SSE endpoint. */
export const eventSourceTransport: RunEventTransport = (
  runId,
  cursor,
  handlers,
) => {
  // A new EventSource cannot set Last-Event-ID, so a reopened stream names its cursor in the query.
  const query = cursor > 0 ? `?last_event_id=${cursor}` : "";
  const source = new EventSource(
    `/api/runs/${encodeURIComponent(runId)}/events${query}`,
  );
  source.onopen = () => handlers.onOpen();
  source.onmessage = (event) => handlers.onMessage(event.data);
  source.onerror = () =>
    handlers.onError(source.readyState === EVENT_SOURCE_CLOSED);
  return () => source.close();
};

// ─── Subscriber ──────────────────────────────────────────────────────────────

/** The timer functions the subscriber uses for reconnect delays; a test substitutes its own. */
export interface RetryTimers {
  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(id: ReturnType<typeof setTimeout>): void;
}

const systemTimers: RetryTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};

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
  /** Called when reconnecting state changes: true when disconnected and retrying, false when connected or when stream ends normally (#317). */
  onReconnectingChange?: ((reconnecting: boolean) => void) | undefined;
  /** Delay before the reopen after a permanent failure, by attempt (0-based). */
  retryDelayMs?: ((attempt: number) => number) | undefined;
  timers?: RetryTimers | undefined;
}

/** The id of the newest event applied to the run's log, or 0 when there is none. */
function lastAppliedId(queryClient: QueryClient, runId: string): number {
  const log = queryClient.getQueryData<RunEvent[]>(queryKeys.runEvents(runId));
  return log?.at(-1)?.id ?? 0;
}

const pendingInvalidations = new WeakMap<
  QueryClient,
  Map<string, ReturnType<typeof setTimeout>>
>();

/** Clears the pending invalidation for a run and returns whether there was one. */
function takePendingInvalidation(
  queryClient: QueryClient,
  runId: string,
): boolean {
  const pending = pendingInvalidations.get(queryClient);
  const timer = pending?.get(runId);
  if (!pending || timer === undefined) return false;
  clearTimeout(timer);
  pending.delete(runId);
  return true;
}

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

/**
 * Connects a run's events to the query cache. Returns the function that stops it.
 *
 * Recovery contract: when the browser gives up on a live stream (a permanent failure),
 * the stream is reopened after a backoff from the last event applied to the cache, so
 * the events missed meanwhile arrive in order. A transient error is left to the browser,
 * which retries by itself. A replay-only stream just stops on error.
 */
export function subscribeRunEvents({
  queryClient,
  runId,
  replayOnly,
  transport = eventSourceTransport,
  onConnectionChange,
  onReconnectingChange,
  retryDelayMs = defaultRetryDelayMs,
  timers = systemTimers,
}: RunEventSubscription): () => void {
  let stopped = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  // Drops the open connection, if there is one.
  let dropOpen: (() => void) | null = null;

  const isTerminalRun = (): boolean => {
    if (replayOnly) return true;
    const currentRun = queryClient.getQueryData<Run>(queryKeys.run(runId));
    return Boolean(currentRun && TERMINAL_RUN_STATUSES.has(currentRun.status));
  };

  const scheduleReconnect = () => {
    if (isTerminalRun()) {
      stop();
      return;
    }
    onReconnectingChange?.(true);
    const delay = retryDelayMs(attempt);
    attempt += 1;
    retryTimer = timers.setTimeout(() => {
      retryTimer = null;
      if (isTerminalRun()) {
        stop();
        return;
      }
      connect(lastAppliedId(queryClient, runId));
    }, delay);
  };

  const connect = (cursor: number): void => {
    if (stopped) return;
    let active = true;
    let release: (() => void) | null = null;
    const drop = () => {
      if (!active) return;
      active = false;
      if (dropOpen === drop) dropOpen = null;
      release?.();
      release = null;
    };
    dropOpen = drop;

    const handlers: RunEventTransportHandlers = {
      onOpen: () => {
        if (!active || stopped) return;
        attempt = 0;
        onConnectionChange?.(true);
        onReconnectingChange?.(false);
      },
      onMessage: (data) => {
        if (!active || stopped) return;
        applyWireMessage(queryClient, runId, data);
      },
      onError: (permanent) => {
        if (!active || stopped) return;
        onConnectionChange?.(false);
        if (isTerminalRun()) {
          stop();
          return;
        }
        onReconnectingChange?.(true);
        if (!permanent) return; // the browser is retrying by itself
        drop();
        scheduleReconnect();
      },
    };

    release = transport(runId, cursor, handlers);
    // A handler may have dropped the connection before the transport returned.
    if (!active) {
      release();
      release = null;
    }
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (retryTimer !== null) {
      timers.clearTimeout(retryTimer);
      retryTimer = null;
    }
    // Flush a pending invalidation rather than drop it: the replacement stream
    // may not re-apply the same events, so nothing else would refresh the run.
    if (takePendingInvalidation(queryClient, runId)) {
      void invalidateRun(runId, queryClient);
    }
    dropOpen?.();
    dropOpen = null;
    onConnectionChange?.(false);
    onReconnectingChange?.(false);
  };

  connect(lastAppliedId(queryClient, runId));
  return stop;
}
