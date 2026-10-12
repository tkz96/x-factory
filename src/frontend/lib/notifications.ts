// src/frontend/lib/notifications.ts — Client notifications built from the app-wide
// event stream (#264, spec #241). No notifications table exists: every notification is
// derived here from status events and the snapshot.
//
// Identity: a notification is the global id of the event that triggered it, so a second
// plan on the same run is a new notification. A Needs-you notification is active only
// while its triggering event is still the run's current Needs-you event; a Finished
// notification never resolves. Read state is keyed by that id and saved in browser
// storage when storage works, and kept in memory otherwise.

import type {
  AppEventEnvelope,
  EventsSnapshot,
  Run,
  RunStatus,
  StatusEventPayload,
} from "../../shared/types.js";
import { NEEDS_YOU_STATUSES, runStatusUi } from "./run-status-ui.js";

export type NotificationGroup = "Needs you" | "Finished";

export interface AppNotification {
  /** The triggering event's global id: the notification's identity and read key. */
  id: number;
  runId: string;
  ticketId: string;
  ticketTitle: string;
  projectName: string;
  status: RunStatus;
  group: NotificationGroup;
  text: string;
  /** Why the run failed or stopped, in one sentence, when the event carries it. */
  detail: string | null;
  time: string;
}

/** A run as the toolbar activity area sees it. Held in memory only. */
export interface TrackedRun {
  runId: string;
  ticketId: string;
  ticketTitle: string;
  projectName: string;
  status: RunStatus;
}

export interface NotificationState {
  /** Every notification received, ascending by id, without duplicates. */
  items: AppNotification[];
  /** The triggering event id of each run's current Needs-you status. */
  triggers: ReadonlyMap<string, number>;
  /** Every run the stream or snapshot has described, keyed by run id. */
  runs: ReadonlyMap<string, TrackedRun>;
}

/** Notifications kept in memory; the oldest fall away past this. */
const MAX_ITEMS = 200;

type EnvelopeLike = Pick<
  AppEventEnvelope,
  "id" | "runId" | "type" | "payload" | "time" | "ticket" | "project"
>;

/** The one mapping from a stream event to a notification, or to nothing. */
export function notificationFromEvent(
  envelope: EnvelopeLike,
): AppNotification | null {
  if (envelope.type === "pr_merged") {
    return {
      id: envelope.id,
      runId: envelope.runId,
      ticketId: envelope.ticket.id,
      ticketTitle: envelope.ticket.title,
      projectName: envelope.project.name,
      status: "pr_created",
      group: "Finished",
      text: "Merged",
      detail: null,
      time: envelope.time,
    };
  }
  if (envelope.type !== "status") return null;
  const payload = envelope.payload as StatusEventPayload;
  const kind = runStatusUi(payload.status).notification;
  if (!kind) return null;
  const detail =
    payload.status === "failed"
      ? (payload.failure?.message ?? payload.reason ?? null)
      : (payload.reason ?? null);
  return {
    id: envelope.id,
    runId: envelope.runId,
    ticketId: envelope.ticket.id,
    ticketTitle: envelope.ticket.title,
    projectName: envelope.project.name,
    status: payload.status,
    group: kind.group,
    text: kind.text,
    detail,
    time: envelope.time,
  };
}

export function emptyNotificationState(): NotificationState {
  return { items: [], triggers: new Map(), runs: new Map() };
}

function trackRun(
  runs: Map<string, TrackedRun>,
  runId: string,
  ticket: { id: string; title: string },
  projectName: string,
  status: RunStatus,
) {
  runs.set(runId, {
    runId,
    ticketId: ticket.id,
    ticketTitle: ticket.title,
    projectName,
    status,
  });
}

function withItems(
  current: AppNotification[],
  incoming: AppNotification[],
): AppNotification[] {
  const byId = new Map(current.map((n) => [n.id, n]));
  for (const n of incoming) byId.set(n.id, n);
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-MAX_ITEMS);
}

/** Folds the snapshot in: current runs, Needs-you triggers and Finished history. */
export function seedNotificationState(
  state: NotificationState,
  snapshot: EventsSnapshot,
): NotificationState {
  const runs = new Map(state.runs);
  for (const r of snapshot.runs as Run[]) {
    trackRun(runs, r.id, r.ticket, r.project.name, r.status);
  }
  const triggers = new Map(state.triggers);
  for (const e of snapshot.needsYou) {
    triggers.set(e.runId, e.id);
  }
  const incoming = [...snapshot.needsYou, ...snapshot.finished]
    .map(notificationFromEvent)
    .filter((n): n is AppNotification => n !== null);
  return { items: withItems(state.items, incoming), triggers, runs };
}

/** Applies one live stream event. Idempotent: a repeated id changes nothing new. */
export function applyNotificationEnvelope(
  state: NotificationState,
  envelope: EnvelopeLike,
): NotificationState {
  if (envelope.type === "pr_merged") {
    const notification = notificationFromEvent(envelope);
    const items = notification
      ? withItems(state.items, [notification])
      : state.items;
    return { items, triggers: state.triggers, runs: state.runs };
  }
  if (envelope.type !== "status") return state;
  const payload = envelope.payload as StatusEventPayload;
  const runs = new Map(state.runs);
  trackRun(
    runs,
    envelope.runId,
    envelope.ticket,
    envelope.project.name,
    payload.status,
  );
  const triggers = new Map(state.triggers);
  if (NEEDS_YOU_STATUSES.has(payload.status)) {
    triggers.set(envelope.runId, envelope.id);
  } else {
    triggers.delete(envelope.runId);
  }
  const notification = notificationFromEvent(envelope);
  const items = notification
    ? withItems(state.items, [notification])
    : state.items;
  return { items, triggers, runs };
}

/** Notifications the list shows: every Finished one, and each run's current Needs-you one. Newest first. */
export function visibleNotifications(
  state: NotificationState,
): AppNotification[] {
  return state.items
    .filter(
      (n) => n.group === "Finished" || state.triggers.get(n.runId) === n.id,
    )
    .sort((a, b) => b.id - a.id);
}

/** Runs in a Needs-you status. Badges count runs, never notifications. */
export function needsYouCount(state: NotificationState): number {
  let count = 0;
  for (const run of state.runs.values()) {
    if (NEEDS_YOU_STATUSES.has(run.status)) count += 1;
  }
  return count;
}

/** Runs in a Running status, for the toolbar activity area. */
export function activeRunsOf(state: NotificationState): TrackedRun[] {
  return [...state.runs.values()].filter(
    (run) => runStatusUi(run.status).filter === "Running",
  );
}

// ─── Read state ──────────────────────────────────────────────────────────────

export const READ_STATE_STORAGE_KEY = "x-factory.notifications.read";

/** Read ids remembered in storage; the oldest fall away past this. */
const MAX_REMEMBERED_READ = 500;

export interface NotificationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Browser local storage, or null when the browser refuses access to it. */
export function browserStorage(): NotificationStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Read ids from storage. Any failure yields an empty set, never an exception. */
export function loadReadIds(storage: NotificationStorage | null): Set<number> {
  try {
    const raw = storage?.getItem(READ_STATE_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is number => typeof v === "number"));
  } catch {
    return new Set();
  }
}

/** Saves read ids. A failed write is ignored; the in-memory set still holds them. */
export function saveReadIds(
  storage: NotificationStorage | null,
  ids: ReadonlySet<number>,
): void {
  try {
    const kept = [...ids].slice(-MAX_REMEMBERED_READ);
    storage?.setItem(READ_STATE_STORAGE_KEY, JSON.stringify(kept));
  } catch {
    // Storage is optional: the session keeps its read state in memory.
  }
}
