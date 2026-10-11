// test/run-page-polish.test.tsx — The run page as the user reads it (#262 follow-up): the plan is
// Markdown, the log count is a labelled badge, Send is a named, icon-bearing control with a clear
// disabled state, and the step labels are readable.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, within } from "@testing-library/react";
import { RunInspector } from "../src/frontend/components/runs/RunInspector.js";
import { RunNowHeader } from "../src/frontend/components/runs/RunNowHeader.js";
import { runNow } from "../src/frontend/lib/run-now.js";
import type { Run, RunStatus } from "../src/shared/types.js";

afterEach(cleanup);
afterAll(async () => {
  await unregisterHappyDom();
});

function makeRun(status: RunStatus, overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    project: { id: "p", name: "P" },
    ticket: { id: "T-1", title: "A ticket", url: "", acceptanceCriteria: [] },
    plan: "",
    branch: "factory/t-1",
    status,
    startedAt: "2026-09-20T12:00:00.000Z",
    finishedAt: null,
    updatedAt: "2026-09-20T12:00:00.000Z",
    implementationContext: null,
    verification: null,
    review: null,
    artifacts: [],
    diff: null,
    pullRequest: null,
    repairAttempts: 0,
    artifactsDir: "/tmp/a",
    worktreePath: "/tmp/w",
    ...overrides,
  } as Run;
}

describe("the plan reads as Markdown", () => {
  it("renders headings and bold text, not the raw Markdown syntax", () => {
    const plan = "## Plan\n\n1. Add a toggle.\n\n**Files:** `src/settings.tsx`";
    const run = makeRun("awaiting_plan_approval", { plan });
    const { container } = render(
      <RunNowHeader run={run} now={runNow(run, [])} />,
    );
    const panel = container.querySelector(".run-now-plan") as HTMLElement;
    expect(within(panel).getByRole("heading", { name: "Plan" })).toBeTruthy();
    expect(panel.querySelector("strong")?.textContent).toBe("Files:");
    expect(panel.textContent).not.toContain("##");
    expect(panel.textContent).not.toContain("**");
  });
});

describe("the log count is a labelled badge beside the heading", () => {
  it("names the count in words and keeps it out of the heading's text", () => {
    const events = [
      {
        id: 1,
        type: "status",
        timestamp: "2026-09-20T12:00:00.000Z",
        payload: { status: "planning" },
      },
      {
        id: 2,
        type: "status",
        timestamp: "2026-09-20T12:00:01.000Z",
        payload: { status: "planning" },
      },
    ] as never;
    const { container } = render(
      <RunInspector
        run={makeRun("planning")}
        events={events}
        connected={false}
      />,
    );
    const count = within(container).getByRole("note", { name: "2 events" });
    expect(count.textContent).toBe("2");
    expect(count.closest("h3")?.textContent).toContain("Raw log");
  });

  it("says one event in the singular", () => {
    const events = [
      {
        id: 1,
        type: "status",
        timestamp: "2026-09-20T12:00:00.000Z",
        payload: { status: "planning" },
      },
    ] as never;
    const { container } = render(
      <RunInspector
        run={makeRun("planning")}
        events={events}
        connected={false}
      />,
    );
    expect(
      within(container).getByRole("note", { name: "1 event" }),
    ).toBeTruthy();
  });
});

describe("the send control", () => {
  it("is named Send and draws its icon from the sprite", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/frontend/components/runs/RunChat.tsx"),
      "utf-8",
    );
    expect(source).toContain('aria-label="Send"');
    expect(source).toContain("sprite.svg#icon-send");
    const sprite = readFileSync(
      path.join(process.cwd(), "public/assets/icons/sprite.svg"),
      "utf-8",
    );
    expect(sprite).toContain('id="icon-send"');
  });

  it("has a visible disabled state that survives forced colours", () => {
    const css = readFileSync(
      path.join(process.cwd(), "src/frontend/components/runs/RunChat.css"),
      "utf-8",
    );
    const forced = css.slice(css.indexOf("@media (forced-colors: active)"));
    expect(forced).toContain(".run-chat-send:disabled");
    expect(forced).toContain("GrayText");
  });
});

describe("the phone step labels are readable", () => {
  it("uses the caption size, not the 9 px micro token", () => {
    const css = readFileSync(
      path.join(
        process.cwd(),
        "src/frontend/components/runs/WorkflowStepper.css",
      ),
      "utf-8",
    );
    const phone = css.slice(css.indexOf("@media (max-width: 600px)"));
    expect(phone).toMatch(
      /\.step-label \{\s*font-size: var\(--text-caption-2\)/,
    );
    expect(phone).not.toContain("--text-micro");
  });
});
