// test/run-stages.test.ts — The run's six stages: items group under the stage they belong to, with the
// start, end, took and state of each stage (spec "Item -> stage assignment", "Stage timing", "Stage status").

import { describe, expect, it } from "bun:test";
import { mapEventsToChatItems } from "../src/frontend/lib/run-chat-items.js";
import {
  formatTook,
  groupItemsByStage,
  stagesDoneCount,
} from "../src/frontend/lib/run-stages.js";
import {
  STAGE_LABELS,
  STAGE_ORDER,
} from "../src/frontend/lib/workflow-stages.js";
import type { RunEvent, RunStatus } from "../src/shared/types.js";

const T0 = Date.parse("2026-10-12T10:00:00.000Z");
/** An ISO time `minutes` after the run started. */
function at(minutes: number): string {
  return new Date(T0 + minutes * 60_000).toISOString();
}

function ev(id: number, type: string, payload: unknown, minutes: number) {
  return { id, type, payload, timestamp: at(minutes) } as unknown as RunEvent;
}

function status(id: number, status: RunStatus, minutes: number) {
  return ev(id, "status", { status }, minutes);
}

const MODEL = { modelId: "m-1", connectionName: "Test" };

function run(status: RunStatus) {
  return { status };
}

function groupsFor(status: RunStatus, events: RunEvent[]) {
  return groupItemsByStage(mapEventsToChatItems(events), run(status), events);
}

describe("STAGE_ORDER and STAGE_LABELS", () => {
  it("reads the six stages in order with the stepper's labels", () => {
    expect(STAGE_ORDER).toEqual([
      "prepare",
      "understand",
      "plan",
      "execute",
      "review",
      "deliver",
    ]);
    expect(STAGE_ORDER.map((stage) => STAGE_LABELS[stage])).toEqual([
      "Prepare",
      "Understand",
      "Plan",
      "Code",
      "Review",
      "Deliver",
    ]);
  });
});

describe("groupItemsByStage: assignment", () => {
  it("returns all six stages in order, even for an empty run", () => {
    const groups = groupsFor("queued", []);
    expect(groups.map((g) => g.stage)).toEqual([...STAGE_ORDER]);
    expect(groups.every((g) => g.items.length === 0)).toBe(true);
    expect(groups.every((g) => g.startedAt === null && g.tookMs === null)).toBe(
      true,
    );
  });

  it("puts items before any stage into prepare", () => {
    const events = [
      ev(1, "chat_user", { text: "hello" }, 0),
      status(2, "preparing", 1),
    ];
    const groups = groupsFor("preparing", events);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(["event-1", "event-2"]);
  });

  it("assigns status items to their stage and other items to the current stage", () => {
    const events = [
      status(1, "preparing", 0),
      status(2, "understanding", 10),
      ev(3, "chat_agent", { text: "reading" }, 12),
      status(4, "planning", 20),
      ev(5, "plan_ready", { plan: "Step one" }, 25),
      status(6, "executing", 30),
      ev(
        7,
        "stage_started",
        { stage: "execute", attempt: 1, model: MODEL },
        31,
      ),
      ev(8, "pi_output_chunk", { role: "pi", text: "writing" }, 40),
    ];
    const groups = groupsFor("executing", events);
    const ids = groups.map((g) => g.items.map((i) => i.id));
    expect(ids).toEqual([
      ["event-1"],
      ["event-2", "event-3"],
      ["event-4", "event-5"],
      ["event-6", "event-7", "event-8"],
      [],
      [],
    ]);
  });

  it("moves the stage when a stage_started names one", () => {
    const events = [
      status(1, "executing", 0),
      ev(2, "stage_started", { stage: "review", attempt: 1, model: MODEL }, 5),
      ev(3, "pi_output_chunk", { role: "reviewer", text: "checking" }, 6),
    ];
    const groups = groupsFor("awaiting_review", events);
    expect(groups[3]?.items.map((i) => i.id)).toEqual(["event-1"]);
    expect(groups[4]?.items.map((i) => i.id)).toEqual(["event-2", "event-3"]);
  });

  it("moves the notices that announce a stage into that stage", () => {
    const events = [
      status(1, "executing", 0),
      ev(2, "info", { text: "Preparing workspace" }, 1),
      ev(3, "stage_started", { stage: "execute", attempt: 1, model: MODEL }, 2),
      ev(4, "diff_summary", { files: [], totalAdded: 0, totalRemoved: 0 }, 3),
      ev(5, "info", { text: "Conducting automated code review" }, 4),
      ev(
        6,
        "stage_started",
        { stage: "execute", step: "review", attempt: 1, model: MODEL },
        5,
      ),
    ];
    const groups = groupsFor("awaiting_review", events);
    expect(groups[3]?.items.map((i) => i.id)).toEqual([
      "event-1",
      "event-2",
      "event-3",
      "event-4",
    ]);
    expect(groups[4]?.items.map((i) => i.id)).toEqual(["event-5", "event-6"]);
  });

  it("keeps the previous stage on a status with no stage", () => {
    const events = [
      status(1, "planning", 0),
      status(2, "recovery_required", 5),
      ev(3, "chat_agent", { text: "recovering" }, 6),
    ];
    const groups = groupsFor("recovery_required", events);
    expect(groups[2]?.items.map((i) => i.id)).toEqual([
      "event-1",
      "event-2",
      "event-3",
    ]);
    expect(groups[3]?.items).toEqual([]);
  });
});

describe("groupItemsByStage: timing and state", () => {
  it("gives finished stages a start, an end and a took, and the current stage none", () => {
    const events = [
      status(1, "preparing", 0),
      status(2, "understanding", 10),
      status(3, "planning", 20),
      ev(4, "plan_ready", { plan: "Step one" }, 25),
      status(5, "executing", 30),
      ev(6, "pi_output_chunk", { role: "pi", text: "writing" }, 40),
    ];
    const groups = groupsFor("executing", events);

    expect(groups[0]).toMatchObject({
      state: "done",
      startedAt: at(0),
      endedAt: at(10),
      tookMs: 10 * 60_000,
    });
    expect(groups[1]).toMatchObject({
      state: "done",
      startedAt: at(10),
      endedAt: at(20),
      tookMs: 10 * 60_000,
    });
    expect(groups[2]).toMatchObject({
      state: "done",
      startedAt: at(20),
      endedAt: at(30),
      tookMs: 10 * 60_000,
    });
    expect(groups[3]).toMatchObject({
      state: "current",
      startedAt: at(30),
      endedAt: null,
      tookMs: null,
    });
    expect(groups[4]).toMatchObject({
      state: "upcoming",
      startedAt: null,
      endedAt: null,
      tookMs: null,
    });
    expect(groups[5]?.state).toBe("upcoming");
  });

  it("marks a done stage's end from the next stage that has items, skipping empty ones", () => {
    const events = [
      status(1, "preparing", 0),
      status(2, "planning", 4),
      status(3, "executing", 9),
    ];
    const groups = groupsFor("executing", events);
    // Understand has no items, so prepare ends where plan starts.
    expect(groups[0]).toMatchObject({ state: "done", tookMs: 4 * 60_000 });
    expect(groups[1]).toMatchObject({
      state: "done",
      startedAt: null,
      tookMs: null,
    });
    expect(groups[2]).toMatchObject({ state: "done", tookMs: 5 * 60_000 });
  });

  it("counts done stages", () => {
    const events = [
      status(1, "executing", 0),
      status(2, "awaiting_review", 10),
    ];
    const groups = groupsFor("awaiting_review", events);
    expect(stagesDoneCount(groups)).toBe(4);
  });

  it("shows an awaiting-review run on the review stage, waiting for the reader", () => {
    const events = [
      status(1, "executing", 0),
      status(2, "awaiting_review", 10),
      ev(3, "diff_summary", { files: 2, added: 5, removed: 1 }, 11),
    ];
    const groups = groupsFor("awaiting_review", events);
    expect(groups.map((g) => g.state)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "current",
      "upcoming",
    ]);
    expect(groups[3]).toMatchObject({
      tookMs: 10 * 60_000,
      endedAt: at(10),
    });
    expect(groups[4]).toMatchObject({
      startedAt: at(10),
      endedAt: null,
      tookMs: null,
    });
    expect(stagesDoneCount(groups)).toBe(4);
  });

  it("marks the stage a failed run was in as failed, and times it to the last event", () => {
    const events = [
      status(1, "preparing", 0),
      status(2, "understanding", 1),
      status(3, "planning", 2),
      status(4, "executing", 3),
      ev(5, "error", { message: "The model call failed." }, 4),
      status(6, "failed", 5),
    ];
    const groups = groupsFor("failed", events);
    expect(groups.map((g) => g.state)).toEqual([
      "done",
      "done",
      "done",
      "failed",
      "upcoming",
      "upcoming",
    ]);
    expect(groups[3]).toMatchObject({
      startedAt: at(3),
      endedAt: at(5),
      tookMs: 2 * 60_000,
    });
    expect(groups[3]?.items.map((i) => i.id)).toEqual([
      "event-4",
      "event-5",
      "event-6",
    ]);
  });

  it("marks the stage a stopped run was in as stopped, and times it to the last event", () => {
    const events = [
      status(1, "preparing", 0),
      status(2, "planning", 1),
      status(3, "stopped", 3),
    ];
    const groups = groupsFor("stopped", events);
    expect(groups.map((g) => g.state)).toEqual([
      "done",
      "done",
      "stopped",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
    expect(groups[2]).toMatchObject({
      startedAt: at(1),
      endedAt: at(3),
      tookMs: 2 * 60_000,
    });
    expect(groups[0]).toMatchObject({ tookMs: 1 * 60_000 });
  });

  it("marks every stage done and gives each a took for a delivered run", () => {
    const events = [
      status(1, "executing", 0),
      status(2, "ready_for_pr", 10),
      status(3, "pr_created", 12),
    ];
    const groups = groupsFor("pr_created", events);
    expect(groups.every((g) => g.state === "done")).toBe(true);
    expect(stagesDoneCount(groups)).toBe(6);
    expect(groups[5]).toMatchObject({ startedAt: at(10), endedAt: at(12) });
  });
});

describe("stage_started items", () => {
  it("carries the stage it names", () => {
    const [item] = mapEventsToChatItems([
      ev(1, "stage_started", { stage: "execute", attempt: 1, model: MODEL }, 0),
    ]);
    expect(item).toMatchObject({ kind: "stage", stage: "execute" });
  });
});

describe("formatTook", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatTook(0)).toBe("0s");
    expect(formatTook(-5)).toBe("0s");
    expect(formatTook(12_000)).toBe("12s");
    expect(formatTook(59_999)).toBe("59s");
    expect(formatTook(64_000)).toBe("1m 4s");
    expect(formatTook(3_720_000)).toBe("1h 2m");
  });
});

describe("where a run stands when the review runs inside execute", () => {
  const reviewStart = (id: number, minutes: number) =>
    ev(
      id,
      "stage_started",
      { stage: "execute", step: "review", attempt: 1, model: MODEL },
      minutes,
    );

  it("makes Review the current stage while the reviewer works, though the status says executing", () => {
    const events = [
      status(1, "executing", 0),
      reviewStart(2, 5),
      ev(3, "review_activity", { tool: "read", text: "Running tool read" }, 6),
    ];
    const groups = groupsFor("executing", events);
    expect(groups.find((g) => g.stage === "execute")?.state).toBe("done");
    expect(groups.find((g) => g.stage === "review")?.state).toBe("current");
  });

  it("marks Review failed when the run fails during the review", () => {
    const events = [
      status(1, "executing", 0),
      reviewStart(2, 5),
      status(3, "failed", 7),
    ];
    const groups = groupsFor("failed", events);
    expect(groups.find((g) => g.stage === "execute")?.state).toBe("done");
    expect(groups.find((g) => g.stage === "review")?.state).toBe("failed");
  });

  it("still follows a status that is ahead of the items", () => {
    const groups = groupsFor("awaiting_review", [status(1, "executing", 0)]);
    expect(groups.find((g) => g.stage === "review")?.state).toBe("current");
  });
});
