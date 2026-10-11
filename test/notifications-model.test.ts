// test/notifications-model.test.ts — Event → notification mapping, resolution,
// dedupe and read state (#264, spec #241). Pure functions and a storage seam only.

import { describe, expect, it } from "bun:test";
import { formatRelativeTime } from "../src/frontend/lib/format-timestamp.js";
import {
  applyNotificationEnvelope,
  browserStorage,
  emptyNotificationState,
  loadReadIds,
  type NotificationStorage,
  needsYouCount,
  notificationFromEvent,
  READ_STATE_STORAGE_KEY,
  saveReadIds,
  seedNotificationState,
  visibleNotifications,
} from "../src/frontend/lib/notifications.js";
import type {
  AppEventEnvelope,
  EventsSnapshot,
  Run,
  RunStatus,
} from "../src/shared/types.js";

const TICKET = { id: "T-1", title: "Add export", acceptanceCriteria: [] };
const PROJECT = { id: "demo", name: "Demo App" };

function envelope(
  id: number,
  runId: string,
  status: RunStatus,
  payload: Record<string, unknown> = {},
): AppEventEnvelope {
  return {
    id,
    runId,
    sequence: id,
    type: "status",
    payload: { status, ...payload },
    time: "2026-10-11T00:00:00.000Z",
    ticket: { ...TICKET, id: `T-${runId}` },
    project: PROJECT,
  } as unknown as AppEventEnvelope;
}

function run(id: string, status: RunStatus): Run {
  return {
    id,
    project: PROJECT,
    ticket: { ...TICKET, id: `T-${id}` },
    status,
    updatedAt: "2026-10-11T00:00:00.000Z",
  } as unknown as Run;
}

function snapshot(
  partial: Partial<EventsSnapshot> & { runs: Run[] },
): EventsSnapshot {
  return { cursor: 0, needsYou: [], finished: [], ...partial };
}

describe("notificationFromEvent (#264)", () => {
  it("maps each Needs-you status to its kind, with the event's global id as identity", () => {
    expect(
      notificationFromEvent(
        envelope(7, "r1", "awaiting_understanding_approval"),
      ),
    ).toMatchObject({
      id: 7,
      group: "Needs you",
      text: "Understanding ready",
    });
    expect(
      notificationFromEvent(envelope(8, "r1", "awaiting_plan_approval")),
    ).toMatchObject({
      id: 8,
      group: "Needs you",
      text: "Plan ready",
    });
    expect(
      notificationFromEvent(envelope(9, "r1", "awaiting_review")),
    ).toMatchObject({
      text: "Changes ready",
    });
    expect(
      notificationFromEvent(envelope(10, "r1", "ready_for_pr")),
    ).toMatchObject({
      text: "Ready for a pull request",
    });
    expect(
      notificationFromEvent(envelope(11, "r1", "recovery_required")),
    ).toMatchObject({
      text: "Needs recovery",
    });
  });

  it("maps the Finished outcomes, carrying the failure reason and the stop reason", () => {
    expect(
      notificationFromEvent(envelope(12, "r1", "pr_created")),
    ).toMatchObject({
      group: "Finished",
      text: "Pull request opened",
      detail: null,
    });
    expect(
      notificationFromEvent(
        envelope(13, "r1", "failed", {
          failure: {
            category: "unknown",
            message: "The model timed out.",
            recovery: "Retry.",
          },
        }),
      ),
    ).toMatchObject({
      group: "Finished",
      text: "Run failed",
      detail: "The model timed out.",
    });
    expect(
      notificationFromEvent(
        envelope(14, "r1", "stopped", { reason: "Stopped by operator" }),
      ),
    ).toMatchObject({
      group: "Finished",
      text: "Run stopped",
      detail: "Stopped by operator",
    });
  });

  it("maps nothing for statuses with no notification and for non-status events", () => {
    expect(notificationFromEvent(envelope(15, "r1", "executing"))).toBeNull();
    const info = {
      ...envelope(16, "r1", "planning"),
      type: "info",
      payload: { text: "x" },
    };
    expect(
      notificationFromEvent(info as unknown as AppEventEnvelope),
    ).toBeNull();
  });
});

describe("notification state (#264)", () => {
  it("a second plan on the same run is a new notification, and the old one resolves", () => {
    let state = emptyNotificationState();
    state = applyNotificationEnvelope(
      state,
      envelope(20, "r1", "awaiting_plan_approval"),
    );
    state = applyNotificationEnvelope(state, envelope(21, "r1", "planning"));
    state = applyNotificationEnvelope(
      state,
      envelope(22, "r1", "awaiting_plan_approval"),
    );

    const shown = visibleNotifications(state).map((n) => n.id);
    expect(shown).toEqual([22]);
    expect(needsYouCount(state)).toBe(1);
  });

  it("resolves Needs-you notifications when the run leaves the Needs-you status", () => {
    let state = emptyNotificationState();
    state = applyNotificationEnvelope(
      state,
      envelope(30, "r1", "awaiting_review"),
    );
    expect(visibleNotifications(state)).toHaveLength(1);
    state = applyNotificationEnvelope(state, envelope(31, "r1", "executing"));
    expect(visibleNotifications(state)).toHaveLength(0);
    expect(needsYouCount(state)).toBe(0);
  });

  it("drops a duplicate event by its global id", () => {
    let state = emptyNotificationState();
    const event = envelope(40, "r1", "ready_for_pr");
    state = applyNotificationEnvelope(state, event);
    const again = applyNotificationEnvelope(state, event);
    expect(visibleNotifications(again)).toHaveLength(1);
  });

  it("keeps Finished notifications after the run ends", () => {
    let state = emptyNotificationState();
    state = applyNotificationEnvelope(
      state,
      envelope(50, "r1", "awaiting_plan_approval"),
    );
    state = applyNotificationEnvelope(
      state,
      envelope(51, "r1", "failed", { failure: { message: "Boom" } }),
    );
    const shown = visibleNotifications(state).map((n) => n.text);
    expect(shown).toEqual(["Run failed"]);
  });

  it("counts runs in a Needs-you status, not notifications", () => {
    const state = seedNotificationState(
      emptyNotificationState(),
      snapshot({
        cursor: 60,
        runs: [
          run("r1", "awaiting_plan_approval"),
          run("r2", "awaiting_review"),
          run("r3", "executing"),
        ],
        needsYou: [
          envelope(55, "r1", "awaiting_plan_approval"),
          envelope(56, "r2", "awaiting_review"),
        ],
      }),
    );
    expect(needsYouCount(state)).toBe(2);
    expect(visibleNotifications(state)).toHaveLength(2);
  });

  it("seeds Finished history from the snapshot without duplicating live events", () => {
    const finished = envelope(70, "r1", "pr_created");
    let state = seedNotificationState(
      emptyNotificationState(),
      snapshot({
        cursor: 70,
        runs: [run("r1", "pr_created")],
        finished: [finished],
      }),
    );
    state = applyNotificationEnvelope(state, finished);
    expect(visibleNotifications(state)).toHaveLength(1);
  });
});

describe("read state storage (#264)", () => {
  function memoryStorage(): NotificationStorage & {
    data: Map<string, string>;
  } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
    };
  }

  it("saves read ids and loads them back after a reload", () => {
    const storage = memoryStorage();
    saveReadIds(storage, new Set([3, 9]));
    expect(storage.data.get(READ_STATE_STORAGE_KEY)).toBe("[3,9]");
    expect([...loadReadIds(storage)].sort()).toEqual([3, 9]);
  });

  it("ignores a corrupt stored value", () => {
    const storage = memoryStorage();
    storage.setItem(READ_STATE_STORAGE_KEY, "{not json");
    expect(loadReadIds(storage).size).toBe(0);
  });

  it("never throws when storage throws on every call", () => {
    const broken: NotificationStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(loadReadIds(broken).size).toBe(0);
    expect(() => saveReadIds(broken, new Set([1]))).not.toThrow();
    expect(() => saveReadIds(null, new Set([1]))).not.toThrow();
    expect(loadReadIds(null).size).toBe(0);
  });

  it("reports no browser storage when the global accessor throws", () => {
    const original = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    );
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    try {
      expect(browserStorage()).toBeNull();
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

describe("relative time (#264)", () => {
  it("reads recent instants as relative and older ones as the full timestamp", () => {
    const now = Date.parse("2026-10-11T12:00:00.000Z");
    expect(formatRelativeTime("2026-10-11T11:59:30.000Z", now)).toBe(
      "Just now",
    );
    expect(formatRelativeTime("2026-10-11T11:55:00.000Z", now)).toBe(
      "5 min ago",
    );
    expect(formatRelativeTime("2026-10-11T09:00:00.000Z", now)).toBe("3 h ago");
    expect(formatRelativeTime("not a date", now)).toBe("not a date");
    expect(formatRelativeTime("2026-10-01T09:00:00.000Z", now)).toContain(
      "2026-10-01",
    );
  });
});
