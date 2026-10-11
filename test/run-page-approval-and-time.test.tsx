// test/run-page-approval-and-time.test.tsx — Run page shows approval prompts only where the policy allows `approve`,
// and renders one shared timestamp everywhere (#242).

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { ActivitySidebar } from "../src/frontend/components/runs/ActivitySidebar.js";
import { RunChat } from "../src/frontend/components/runs/RunChat.js";
import { formatTimestamp } from "../src/frontend/lib/format-timestamp.js";
import {
  canRunAction,
  TRANSITIONS,
} from "../src/shared/run-status-policy.js";
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
    expect(formatTimestamp(INSTANT, "Asia/Karachi")).toBe("2026-09-20 17:34:56");
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
