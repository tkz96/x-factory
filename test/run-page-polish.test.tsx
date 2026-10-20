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

describe("the run now header displays pull request outcomes", () => {
  it("renders 'Merged' with link and relative time when merged", () => {
    const run = makeRun("pr_created", {
      pullRequest: {
        url: "https://github.com/o/r/pull/10",
        number: 10,
        title: "T-1",
        branch: "factory/t-1",
        baseBranch: "main",
      } as Run["pullRequest"],
      pullRequestOutcome: {
        status: "merged",
        url: "https://github.com/o/r/pull/10",
        mergedAt: "2026-09-20T12:05:00.000Z",
      },
    });
    const { container } = render(
      <RunNowHeader run={run} now={runNow(run, [])} />,
    );
    expect(container.textContent).toContain("Merged");
    const link = container.querySelector(".run-now-link") as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.href).toBe("https://github.com/o/r/pull/10");
  });

  it("renders 'Closed without merging' with time when closed", () => {
    const run = makeRun("pr_created", {
      pullRequestOutcome: {
        status: "closed",
        url: "https://github.com/o/r/pull/10",
        closedAt: "2026-09-20T12:10:00.000Z",
      },
    });
    const { container } = render(
      <RunNowHeader run={run} now={runNow(run, [])} />,
    );
    expect(container.textContent).toContain("Closed without merging");
  });
});

describe("the raw log count sits on the footer button", () => {
  it("names the count in words on the Raw log button", () => {
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
    const button = within(container).getByRole("button", { name: /Raw log/ });
    expect(button.querySelector(".run-inspector-count")?.textContent).toBe(
      "2 events",
    );
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
    const button = within(container).getByRole("button", { name: /Raw log/ });
    expect(button.textContent).toContain("1 event");
    expect(button.textContent).not.toContain("1 events");
  });
});

describe("the send control", () => {
  it("is named Send and draws its icon from the sprite", () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        "src/frontend/components/runs/RunChatComposer.tsx",
      ),
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
