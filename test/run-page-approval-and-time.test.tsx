// test/run-page-approval-and-time.test.tsx — Run page shows approval prompts only where the policy allows `approve`,
// and renders one shared timestamp everywhere (#242).

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ActivitySidebar } from "../src/frontend/components/runs/ActivitySidebar.js";
import { RunChat } from "../src/frontend/components/runs/RunChat.js";
import { formatTimestamp } from "../src/frontend/lib/format-timestamp.js";
import { runStatusUi } from "../src/frontend/lib/run-status-ui.js";
import { canRunAction, TRANSITIONS } from "../src/shared/run-status-policy.js";
import type { Run, RunEvent, RunStatus } from "../src/shared/types.js";

afterEach(cleanup);
afterAll(async () => {
  await unregisterHappyDom();
});

const ALL_STATUSES = Object.keys(TRANSITIONS) as RunStatus[];
const INSTANT = "2026-09-20T12:34:56.000Z";

function makeRun(status: RunStatus): Run {
  return {
    id: "run-1",
    project: { id: "p", name: "P" },
    ticket: {
      id: "T-1",
      title: "A ticket",
      url: "https://t",
      acceptanceCriteria: [],
    },
    plan: "the plan",
    branch: "b",
    status,
    startedAt: INSTANT,
    finishedAt: null,
    updatedAt: INSTANT,
    implementationContext: null,
    verification: null,
    review: null,
    artifacts: [],
    diff: null,
    pullRequest: null,
    repairAttempts: 0,
    artifactsDir: "/tmp/a",
    worktreePath: "/tmp/w",
  } as Run;
}

describe("run chat approval prompts follow the shared policy", () => {
  for (const status of ALL_STATUSES) {
    it(`${status}: renders a message, and approval only if approve is allowed`, () => {
      const { container } = render(
        <RunChat run={makeRun(status)} events={[]} />,
      );
      const text = container.textContent ?? "";
      const buttons = Array.from(container.querySelectorAll("button")).map(
        (b) => b.textContent ?? "",
      );
      expect(container.querySelectorAll(".imsg-agent").length).toBeGreaterThan(
        0,
      );
      if (canRunAction(status, "approve")) {
        expect(buttons.some((b) => /^Approve/.test(b))).toBe(true);
      } else {
        expect(buttons.some((b) => /approve/i.test(b))).toBe(false);
        expect(text).not.toMatch(/approve to move|approve to continue/i);
        expect(text).not.toContain("Does this analysis match");
      }
    });
  }
});

describe("formatTimestamp", () => {
  it("formats a fixed instant in the given zone", () => {
    expect(formatTimestamp(INSTANT, "UTC")).toBe("2026-09-20 12:34:56");
    expect(formatTimestamp(INSTANT, "Asia/Karachi")).toBe(
      "2026-09-20 17:34:56",
    );
    expect(formatTimestamp(INSTANT, "America/New_York")).toBe(
      "2026-09-20 08:34:56",
    );
  });

  it("uses the local time zone by default", () => {
    const d = new Date(INSTANT);
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(formatTimestamp(INSTANT)).toBe(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    );
  });

  it("returns unparseable input unchanged", () => {
    expect(formatTimestamp("not a date")).toBe("not a date");
  });
});

describe("run chat words come from the one status map (#253)", () => {
  for (const status of ALL_STATUSES) {
    it(`${status}: the header, subtitle and placeholder come from the map`, () => {
      const ui = runStatusUi(status);
      const { container } = render(
        <RunChat run={makeRun(status)} events={[]} />,
      );
      const text = container.textContent ?? "";
      expect(
        container.querySelector(".run-chat-meta strong")?.textContent,
      ).toBe(ui.header);
      expect(text).toContain(ui.now);
      const input = container.querySelector(
        "#input-understanding-chat",
      ) as HTMLInputElement;
      expect(input.placeholder).toBe(ui.placeholder);
      // No local cascade survives: no phase label, no gate jargon, no "agent".
      expect(text).not.toMatch(
        /Phase:|Approval gate|Waiting for agent|Context Synthesis|Agent Workspace/,
      );
    });
  }

  it("labels each gate's buttons from the map, not from local copy", () => {
    const gates: RunStatus[] = [
      "awaiting_understanding_approval",
      "awaiting_plan_approval",
      "awaiting_review",
    ];
    for (const status of gates) {
      const { container, unmount } = render(
        <RunChat run={makeRun(status)} events={[]} />,
      );
      const expected = runStatusUi(status)
        .actions.filter((a) =>
          ["approve", "requeue", "restart", "stop"].includes(a.action),
        )
        .map((a) => a.label);
      const buttons = Array.from(
        container.querySelectorAll(".imsg-action-btn"),
      ).map((b) => b.textContent);
      expect({ status, buttons }).toEqual({ status, buttons: expected });
      const text = container.textContent ?? "";
      for (const old of [
        "Revise Plan",
        "Request Rework",
        "Approve & Continue",
        "Restart Analysis",
        "Approve → PR",
      ]) {
        expect(text).not.toContain(old);
      }
      unmount();
    }
  });

  it("offers the CONTEXT.md words on review", () => {
    const { container } = render(
      <RunChat run={makeRun("awaiting_review")} events={[]} />,
    );
    const buttons = Array.from(
      container.querySelectorAll(".imsg-action-btn"),
    ).map((b) => b.textContent);
    expect(buttons).toContain("Approve Changes");
    expect(buttons).toContain("Request Changes");
    expect(buttons).toContain("Stop Run");
  });
});

describe("no approval text without an approve action (#242)", () => {
  it("recovery_required says what the run needs, and nothing about approving", () => {
    const { container } = render(
      <RunChat run={makeRun("recovery_required")} events={[]} />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/approve/i);
    expect(text).not.toContain("nothing to approve");
    expect(text).toContain("Resume it to carry on");
  });
});

describe("a run-state bubble carries its own event's time (#242)", () => {
  it("the plan bubble shows when the plan arrived, not the run's start", () => {
    const planAt = "2026-11-01T09:00:00.000Z";
    const events: RunEvent[] = [
      {
        id: 1,
        timestamp: planAt,
        type: "status",
        payload: { status: "awaiting_plan_approval", text: "Plan ready" },
      } as RunEvent,
    ];
    const { container } = render(
      <RunChat run={makeRun("awaiting_plan_approval")} events={events} />,
    );
    const planRow = Array.from(
      container.querySelectorAll(".imsg-row.imsg-agent"),
    ).find(
      (row) => row.querySelector(".imsg-bubble")?.textContent === "the plan",
    );
    if (!planRow) throw new Error("plan bubble missing");
    expect(planRow.querySelector(".imsg-timestamp")?.textContent).toBe(
      formatTimestamp(planAt),
    );
    // The greeting is still the run's own start.
    const greeting = container.querySelector(".imsg-system-time");
    expect(greeting?.textContent).toBe(formatTimestamp(INSTANT));
  });
});

describe("one event shows one time across the run page", () => {
  it("chat divider and activity log render the same string", () => {
    const events: RunEvent[] = [
      {
        id: 1,
        timestamp: INSTANT,
        type: "status",
        payload: { status: "planning", text: "Moving on" },
      } as RunEvent,
    ];
    const chat = render(<RunChat run={makeRun("planning")} events={events} />);
    const pill = chat.container.querySelector(".imsg-system-time");
    const log = render(<ActivitySidebar events={events} connected />);
    const logTime = log.container.querySelector("time.chat-bubble-time");
    const expected = formatTimestamp(INSTANT);
    // The divider for the status event is the last system pill.
    const pills = Array.from(
      chat.container.querySelectorAll(".imsg-system-time"),
    ).map((e) => e.textContent);
    expect(pill).not.toBeNull();
    expect(pills).toContain(expected);
    expect(logTime?.textContent).toBe(expected);
  });
});
