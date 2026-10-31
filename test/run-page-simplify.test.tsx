// test/run-page-simplify.test.tsx — The run page says things once (spec #312, "Simplification"): the plan
// block has no empty toolbar row, Run details hides empty sections and sums its evidence, Deliver names
// the pull request once, zero counts are muted, and the iteration number is shown once.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { MarkdownBlock } from "../src/frontend/components/MarkdownBlock.js";
import { RunChat } from "../src/frontend/components/runs/RunChat.js";
import { RunInspector } from "../src/frontend/components/runs/RunInspector.js";
import { RunNowHeader } from "../src/frontend/components/runs/RunNowHeader.js";
import { runNow } from "../src/frontend/lib/run-now.js";
import type { Run, RunEvent, RunStatus } from "../src/shared/types.js";

const realMatchMedia = window.matchMedia;
afterEach(() => {
  cleanup();
  window.matchMedia = realMatchMedia;
});
afterAll(async () => {
  await unregisterHappyDom();
});

const AT = "2026-10-20T10:00:00.000Z";

function makeRun(status: RunStatus, overrides: Partial<Run> = {}): Run {
  return {
    id: "run-s",
    project: { id: "p", name: "P" },
    ticket: { id: "T-1", title: "A ticket", url: "", acceptanceCriteria: [] },
    plan: "",
    branch: "factory/t-1",
    status,
    startedAt: AT,
    finishedAt: null,
    updatedAt: AT,
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

function event(
  id: number,
  type: string,
  payload: Record<string, unknown>,
): RunEvent {
  return {
    id,
    type,
    payload,
    timestamp: `2026-10-20T10:00:${String(id).padStart(2, "0")}.000Z`,
  } as unknown as RunEvent;
}

function phone() {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

const PLAN = "## Steps\n\n1. One\n2. Two";

describe("the plan block", () => {
  it("carries its label in the header row with the tools", () => {
    const run = makeRun("awaiting_plan_approval", { plan: PLAN });
    const { container } = render(
      <RunNowHeader run={run} now={runNow(run, [])} />,
    );
    const header = container.querySelector(
      ".run-now-plan .md-block-header",
    ) as HTMLElement;
    expect(within(header).getByText("Plan")).toBeTruthy();
    expect(header.querySelector(".md-block-tools")).toBeTruthy();
  });

  it("folds a foldable block at phone width and opens it with Show All", () => {
    phone();
    const { getByRole, queryByRole } = render(
      <MarkdownBlock content={PLAN} foldable />,
    );
    const show = getByRole("button", { name: "Show All" });
    expect(show.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(show);
    expect(queryByRole("button", { name: "Show All" })).toBeNull();
    expect(getByRole("button", { name: "Show Less" })).toBeTruthy();
  });

  it("has no Show All control above phone width", () => {
    const { queryByRole } = render(<MarkdownBlock content={PLAN} foldable />);
    expect(queryByRole("button", { name: "Show All" })).toBeNull();
  });
});

describe("Run details", () => {
  const headings = (container: HTMLElement) =>
    within(container)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);

  it("hides the sections that have nothing to show", () => {
    const { container } = render(
      <RunInspector run={makeRun("executing")} events={[]} connected={false} />,
    );
    expect(headings(container)).toEqual(["Run", "Ticket", "Evidence"]);
  });

  it("shows Files, Models and Ticket once they have content", () => {
    const { container } = render(
      <RunInspector
        run={makeRun("executing", {
          diff: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-x\n+y\n",
          ticket: {
            id: "T-1",
            title: "A",
            url: "",
            description: "Do the thing.",
            acceptanceCriteria: [],
          },
        })}
        events={[]}
        connected={false}
      />,
    );
    expect(headings(container)).toEqual(["Run", "Ticket", "Files", "Evidence"]);
  });

  it("sums the evidence in one row that opens to the criteria", () => {
    const { container } = render(
      <RunInspector
        run={makeRun("awaiting_review", {
          verification: { passed: true } as Run["verification"],
          review: {
            passed: true,
            summary: "",
            criteriaChecked: [
              { criterion: "Must verify", status: "pass" },
              { criterion: "Must review", status: "pass" },
            ],
          } as unknown as Run["review"],
        })}
        events={[]}
        connected={false}
      />,
    );
    const summary = container.querySelector(
      "details.run-inspector-evidence > summary",
    ) as HTMLElement;
    expect(summary.textContent).toContain("4 of 4 passed");
    expect(
      (
        container.querySelector("details.run-inspector-evidence") as HTMLElement
      ).hasAttribute("open"),
    ).toBe(false);
  });

  it("sets a zero count in the secondary color and monospace on identifiers only", () => {
    const { container } = render(
      <RunInspector
        run={makeRun("executing", {
          diff: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1 @@\n+y\n",
        })}
        events={[]}
        connected={false}
      />,
    );
    const zero = within(container).getByText("−0");
    expect(zero.classList.contains("run-inspector-zero")).toBe(true);
    const mono = (label: string) =>
      within(container)
        .getByText(label)
        .closest(".run-inspector-row")
        ?.querySelector("dd")
        ?.classList.contains("run-inspector-value--mono");
    expect(mono("Branch")).toBe(true);
    expect(mono("Started")).toBe(false);
  });
});

describe("the run chat", () => {
  it("does not count the stages done in the header", () => {
    const { container } = render(
      <RunChat run={makeRun("executing")} events={[]} />,
    );
    expect(container.querySelector(".run-chat-progress-count")).toBeNull();
  });

  it("names the pull request once in Deliver", () => {
    const run = makeRun("pr_created", {
      pullRequest: {
        url: "https://example.test/o/r/pull/7",
        branch: "b",
        baseBranch: "main",
        title: "T",
      },
    });
    const events = [
      event(1, "status", { status: "ready_for_pr", text: "" }),
      event(2, "pr_step", {
        step: "created",
        url: "https://example.test/o/r/pull/7",
      }),
      event(3, "stage_evidence", {
        stage: "deliver",
        evidence: "Opened https://example.test/o/r/pull/7",
      }),
      event(4, "status", { status: "pr_created", text: "" }),
    ];
    const { container } = render(<RunChat run={run} events={events} />);
    expect(within(container).queryByText("Pull request link")).toBeNull();
    expect(container.textContent).not.toContain("Opened https://example.test");
    expect(
      within(container).getAllByRole("link", { name: /Open Pull Request/ })
        .length,
    ).toBe(1);
  });

  it("shows an iteration number once for a run of lines in the same iteration", () => {
    const events = [
      event(1, "status", { status: "executing", text: "" }),
      event(2, "ralph_progress", { iteration: 2, text: "Read the file" }),
      event(3, "ralph_progress", { iteration: 2, text: "Edited the file" }),
      event(4, "ralph_progress", { iteration: 3, text: "Ran the tests" }),
    ];
    const { container } = render(
      <RunChat run={makeRun("executing")} events={events} />,
    );
    // The three lines fold into one group, which renders its rows once opened.
    const group = container.querySelector<HTMLElement>(
      ".run-chat-group .run-disclosure",
    );
    if (group) fireEvent.click(group);
    expect(within(container).getAllByText("Iteration 2").length).toBe(1);
    expect(within(container).getAllByText("Iteration 3").length).toBe(1);
  });
});
