// test/run-page-approval-and-time.test.tsx — The run chat offers approval only where the policy allows it,
// takes its words from the one status map, and shows one time for one event (#242, #261).

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import { RunChat } from "../src/frontend/components/runs/RunChat.js";
import { RunInspector } from "../src/frontend/components/runs/RunInspector.js";
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

function buttonNames(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("button")).map(
    (b) => b.textContent ?? "",
  );
}

describe("run chat approval prompts follow the shared policy", () => {
  for (const status of ALL_STATUSES) {
    it(`${status}: approval is offered only if approve is allowed`, () => {
      const { container } = render(
        <RunChat run={makeRun(status)} events={[]} />,
      );
      const approvals = buttonNames(container).filter((b) =>
        /^Approve/.test(b),
      );
      if (canRunAction(status, "approve")) {
        expect(approvals.length).toBe(1);
      } else {
        expect(approvals).toEqual([]);
        expect(container.textContent).not.toMatch(
          /approve to move|approve to continue/i,
        );
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
      const header = container.querySelector(".run-now");
      expect(within(header as HTMLElement).getByText(ui.header)).toBeTruthy();
      expect(container.textContent).toContain(ui.now);
      const input = within(container).getByRole("textbox") as HTMLInputElement;
      // At a gate the map's own words guide the reader; on a run that cannot
      // take a message the box says what it is for, never the status line the
      // header already shows (F6).
      expect(input.placeholder).toBe(
        canRunAction(status, "chat") ? ui.placeholder : "Message the Builder…",
      );
      expect(container.textContent).not.toMatch(
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
          ["approve", "requeue", "restart"].includes(a.action),
        )
        .map((a) => a.label)
        .filter((label): label is string => label !== null);
      const group = within(container).getByRole("region", {
        name: "Checkpoint",
      });
      expect(
        Array.from(group.querySelectorAll("button")).map((b) => b.textContent),
      ).toEqual(expected);
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

  it("offers the CONTEXT.md words on review, and Stop Run is not in the chat (#262)", () => {
    const { container } = render(
      <RunChat run={makeRun("awaiting_review")} events={[]} />,
    );
    const buttons = buttonNames(container);
    expect(buttons).toContain("Approve Changes");
    expect(buttons).toContain("Request Changes");
    expect(buttons).not.toContain("Stop Run");
  });
});

describe("no approval text without an approve action (#242)", () => {
  it("recovery_required names the status and offers nothing to approve", () => {
    const { container } = render(
      <RunChat run={makeRun("recovery_required")} events={[]} />,
    );
    expect(container.textContent).not.toMatch(/approve/i);
    expect(container.textContent).toContain("Needs recovery");
  });
});

describe("a run-state line carries its own event's time (#242)", () => {
  it("the plan shows when the plan arrived, not the run's start", () => {
    const planAt = "2026-11-01T09:00:00.000Z";
    const events: RunEvent[] = [
      {
        id: 1,
        timestamp: planAt,
        type: "plan_ready",
        payload: { plan: "the plan" },
      } as RunEvent,
    ];
    const { container } = render(
      <RunChat run={makeRun("awaiting_plan_approval")} events={events} />,
    );
    const plan = within(container).getByRole("article", { name: "Plan" });
    const time = plan.querySelector("time");
    expect(time?.getAttribute("datetime")).toBe(planAt);
    expect(time?.getAttribute("title")).toBe(formatTimestamp(planAt));
  });
});

describe("one event shows one time across the run page", () => {
  it("the chat's status line and the activity log show the same exact time", () => {
    const events: RunEvent[] = [
      {
        id: 1,
        timestamp: INSTANT,
        type: "status",
        payload: { status: "planning", text: "Moving on" },
      } as RunEvent,
    ];
    const chat = render(<RunChat run={makeRun("planning")} events={events} />);
    const log = render(
      <RunInspector run={makeRun("planning")} events={events} connected />,
    );
    const expected = formatTimestamp(INSTANT);
    const chatTime = chat.container.querySelector(
      `time[datetime="${INSTANT}"]`,
    );
    expect(chatTime?.textContent).toBe(expected);
    expect(within(log.container).getByText(expected)).toBeTruthy();
  });
});
