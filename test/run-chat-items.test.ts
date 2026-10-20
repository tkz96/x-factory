// test/run-chat-items.test.ts — The run chat is one pure mapping from real run events to chat items (#261).
// Unknown event types are ignored, nothing is invented, and every item keeps its event's own time.

import { describe, expect, it } from "bun:test";
import { mapEventsToChatItems } from "../src/frontend/lib/run-chat-items.js";
import type { RunEvent } from "../src/shared/types.js";

const AT = "2026-09-20T12:34:56.000Z";
const LATER = "2026-09-20T12:40:00.000Z";

function ev(id: number, type: string, payload: unknown, timestamp = AT) {
  return { id, type, payload, timestamp } as unknown as RunEvent;
}

describe("mapEventsToChatItems", () => {
  it("returns nothing for no events: the chat never invents a first message", () => {
    expect(mapEventsToChatItems([])).toEqual([]);
  });

  it("ignores event types it does not know, without inventing anything", () => {
    const items = mapEventsToChatItems([
      ev(1, "steer", { text: "old steer row" }),
      ev(2, "something_new", { anything: true }),
    ]);
    expect(items).toEqual([]);
  });

  it("keeps the events' order and each event's own time", () => {
    const items = mapEventsToChatItems([
      ev(1, "status", { status: "planning" }, AT),
      ev(2, "plan_ready", { plan: "Step one" }, LATER),
    ]);
    expect(items.map((i) => i.id)).toEqual(["event-1", "event-2"]);
    expect(items.map((i) => i.at)).toEqual([AT, LATER]);
  });

  it("turns a status change into a system line with the map's plain label", () => {
    const [item] = mapEventsToChatItems([
      ev(1, "status", { status: "awaiting_plan_approval", text: "raw text" }),
    ]);
    expect(item).toMatchObject({
      kind: "status",
      label: "Review the plan",
      status: "awaiting_plan_approval",
    });
    expect(item).not.toHaveProperty("text");
  });

  it("carries a structured failure on a failed status", () => {
    const failure = {
      category: "model",
      message: "The model call failed.",
      recovery: "Check the model connection.",
    };
    const [item] = mapEventsToChatItems([
      ev(1, "status", { status: "failed", failure }),
    ]);
    expect(item).toMatchObject({ kind: "status", label: "Failed", failure });
  });

  it("maps the plan, diff summary, review activity and verification/review results", () => {
    const items = mapEventsToChatItems([
      ev(1, "plan_ready", { plan: "The plan" }),
      ev(2, "diff_summary", {
        files: [{ path: "a.ts", added: 2, removed: 1 }],
        totalAdded: 2,
        totalRemoved: 1,
      }),
      ev(3, "review_activity", { tool: "read_file", text: undefined }),
      ev(4, "review_activity", { text: "Looks fine" }),
      ev(5, "verification", {
        result: { passed: true, summary: "All tests passed" },
      }),
      ev(6, "review", { result: { passed: false, summary: "Missing a test" } }),
    ]);
    expect(items.map((i) => i.kind)).toEqual([
      "plan",
      "diff",
      "review",
      "review",
      "result",
      "result",
    ]);
    expect(items[0]).toMatchObject({ plan: "The plan" });
    expect(items[1]).toMatchObject({
      summary: { totalAdded: 2, totalRemoved: 1 },
    });
    expect(items[2]).toMatchObject({ tool: "read_file" });
    expect(items[3]).toMatchObject({ text: "Looks fine" });
    expect(items[4]).toMatchObject({
      title: "Verification",
      passed: true,
      summary: "All tests passed",
    });
    expect(items[5]).toMatchObject({
      title: "Review",
      passed: false,
      summary: "Missing a test",
    });
  });

  it("keeps the iteration on each progress line", () => {
    const [item] = mapEventsToChatItems([
      ev(1, "ralph_progress", { text: "writing the parser", iteration: 3 }),
    ]);
    expect(item).toMatchObject({
      kind: "progress",
      iteration: 3,
      text: "writing the parser",
    });
  });

  it("names the Builder and the Reviewer on agent output", () => {
    const items = mapEventsToChatItems([
      ev(1, "pi_output_chunk", { role: "pi", text: "done" }),
      ev(2, "pi_output_chunk", { role: "reviewer", text: "looks fine" }),
    ]);
    expect(items).toMatchObject([
      { kind: "output", speaker: "builder", text: "done" },
      { kind: "output", speaker: "reviewer", text: "looks fine" },
    ]);
  });

  it("maps chat turns to user and agent messages", () => {
    const items = mapEventsToChatItems([
      ev(1, "chat_user", { text: "Why this plan?" }),
      ev(2, "chat_agent", { text: "Because it is small." }),
    ]);
    expect(items).toMatchObject([
      { kind: "message", role: "user", text: "Why this plan?" },
      { kind: "message", role: "agent", text: "Because it is small." },
    ]);
  });

  it("keeps the unsandboxed warning as a warning notice", () => {
    const [item] = mapEventsToChatItems([
      ev(1, "info", {
        text: "Running without a sandbox.",
        warning: "unsandboxed",
      }),
      ev(2, "info", { text: "Plain info" }),
    ]);
    expect(item).toMatchObject({
      kind: "notice",
      warning: true,
      text: "Running without a sandbox.",
    });
  });

  it("maps stage evidence, stage start, pull request steps and errors", () => {
    const items = mapEventsToChatItems([
      ev(1, "stage_evidence", { stage: "execute", evidence: "tests passed" }),
      ev(2, "stage_started", {
        stage: "execute",
        attempt: 1,
        model: { modelId: "m", connectionName: "C", role: "coder" },
      }),
      ev(3, "pr_step", {
        step: "pr",
        url: "https://github.com/x/y/pull/1",
        text: "Pull request opened",
      }),
      ev(4, "error", { message: "Boom" }),
    ]);
    expect(items.map((i) => i.kind)).toEqual([
      "evidence",
      "stage",
      "notice",
      "error",
    ]);
    expect(items[0]).toMatchObject({ stage: "Code", text: "tests passed" });
    expect(items[1]).toMatchObject({
      text: "Coding with m via C",
    });
    expect(items[2]).toMatchObject({ url: "https://github.com/x/y/pull/1" });
    expect(items[3]).toMatchObject({ text: "Boom" });
  });
});
