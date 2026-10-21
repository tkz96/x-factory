// test/run-checkpoint-bar.test.tsx — The checkpoint bar and the now header, as the user meets them (#262).
// Actions come only from the shared policy through the status map; the bar owns no workflow of its own.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { RunCheckpointBar } from "../src/frontend/components/runs/RunCheckpointBar.js";
import { RunDecisionCard } from "../src/frontend/components/runs/RunDecisionCard.js";
import { RunNowHeader } from "../src/frontend/components/runs/RunNowHeader.js";
import { runNow } from "../src/frontend/lib/run-now.js";
import { runStatusUi } from "../src/frontend/lib/run-status-ui.js";
import { allowedActionsFor } from "../src/shared/run-status-policy.js";
import type { Run, RunStatus } from "../src/shared/types.js";

afterEach(cleanup);
afterAll(async () => {
  await unregisterHappyDom();
});

const ALL_STATUSES: RunStatus[] = [
  "queued",
  "preparing",
  "understanding",
  "awaiting_understanding_approval",
  "planning",
  "awaiting_plan_approval",
  "executing",
  "awaiting_review",
  "ready_for_pr",
  "pr_created",
  "recovery_required",
  "failed",
  "stopped",
];

const NOT_ON_THE_BAR = new Set(["stop", "chat"]);

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

function barButtons(container: HTMLElement): HTMLButtonElement[] {
  const bar = within(container).getByRole("region", { name: "Checkpoint" });
  return Array.from(bar.querySelectorAll("button"));
}

describe("the checkpoint bar offers exactly the actions the status allows", () => {
  for (const status of ALL_STATUSES) {
    it(`${status}: the bar's buttons are the policy's run actions and the ticket command`, () => {
      const { container } = render(
        <RunCheckpointBar
          status={status}
          pending={null}
          conflict={false}
          onAction={() => {}}
        />,
      );
      const ui = runStatusUi(status);
      const expected: string[] = ui.actions
        .filter(({ action, label }) => !NOT_ON_THE_BAR.has(action) && label)
        .map(({ label }) => label as string);
      if (ui.ticketCommand) expected.push(ui.ticketCommand);
      if (expected.length === 0) {
        // A status with nothing to offer shows no bar at all.
        expect(container.querySelector(".run-checkpoint-bar")).toBeNull();
        return;
      }
      const labels = barButtons(container).map((b) => b.textContent);
      expect(labels).toEqual(expected);
    });
  }

  it("never offers Stop Run or chat on the bar, and matches the policy for every status", () => {
    for (const status of ALL_STATUSES) {
      const policy = allowedActionsFor(status).filter(
        (a) => !NOT_ON_THE_BAR.has(a),
      );
      const shown = runStatusUi(status).actions.map((a) => a.action);
      expect(shown.filter((a) => !NOT_ON_THE_BAR.has(a))).toEqual(policy);
    }
  });

  it("offers Start New Run only on terminal runs, as a ticket command", () => {
    for (const status of ["pr_created", "failed", "stopped"] as const) {
      const { container, unmount } = render(
        <RunCheckpointBar
          status={status}
          pending={null}
          conflict={false}
          onAction={() => {}}
        />,
      );
      expect(
        within(container).getByRole("button", { name: "Start New Run" }),
      ).toBeTruthy();
      unmount();
    }
    const { container } = render(
      <RunCheckpointBar
        status="executing"
        pending={null}
        conflict={false}
        onAction={() => {}}
      />,
    );
    expect(container.textContent).not.toContain("Start New Run");
  });

  it("offers Resume Run and Abandon Run when the run needs recovery", () => {
    const { container } = render(
      <RunCheckpointBar
        status="recovery_required"
        pending={null}
        conflict={false}
        onAction={() => {}}
      />,
    );
    expect(barButtons(container).map((b) => b.textContent)).toEqual([
      "Resume Run",
      "Abandon Run",
    ]);
  });
});

describe("a decision card has one primary action", () => {
  for (const status of ALL_STATUSES) {
    for (const reworkReady of [false, true]) {
      it(`${status}${reworkReady ? " with the rework written" : ""}: at most one primary button`, () => {
        const run = makeRun(status);
        const { container } = render(
          <RunDecisionCard
            run={run}
            facts={runNow(run, [])}
            pending={null}
            conflict={false}
            reworkReady={reworkReady}
            onAction={() => {}}
          />,
        );
        const primaries = Array.from(
          container.querySelectorAll(".ui-button--primary"),
        ).map((b) => b.textContent);
        expect(primaries.length).toBeLessThanOrEqual(1);
      });
    }
  }

  it("awaiting review: Approve Changes is the primary action and Confirm Rework is secondary", () => {
    const run = makeRun("awaiting_review");
    const { container } = render(
      <RunDecisionCard
        run={run}
        facts={runNow(run, [])}
        pending={null}
        conflict={false}
        reworkReady
        onAction={() => {}}
      />,
    );
    const approve = within(container).getByRole("button", {
      name: "Approve Changes",
    });
    const confirm = within(container).getByRole("button", {
      name: "Confirm Rework",
    });
    expect(approve.className).toContain("ui-button--primary");
    expect(confirm.className).toContain("ui-button--secondary");
    expect(confirm.className).not.toContain("ui-button--primary");
  });
});

describe("pressing a checkpoint action", () => {
  it("reports the action it was pressed for", () => {
    const actions: string[] = [];
    const onAction = (action: string) => actions.push(action);
    const { container } = render(
      <RunCheckpointBar
        status="awaiting_plan_approval"
        pending={null}
        conflict={false}
        onAction={onAction}
      />,
    );
    fireEvent.click(
      within(container).getByRole("button", { name: "Approve Plan" }),
    );
    expect(actions).toContain("approve");
    fireEvent.click(
      within(container).getByRole("button", { name: "Request Changes" }),
    );
    expect(actions.at(-1)).toBe("restart");
  });

  it("shows the pending label on the pressed action and disables its siblings", () => {
    const { container } = render(
      <RunCheckpointBar
        status="awaiting_plan_approval"
        pending="approve"
        conflict={false}
        onAction={() => {}}
      />,
    );
    const approving = within(container).getByRole("button", {
      name: "Approving…",
    });
    expect((approving as HTMLButtonElement).disabled).toBe(true);
    const requestChanges = within(container).getByRole("button", {
      name: "Request Changes",
    });
    expect((requestChanges as HTMLButtonElement).disabled).toBe(true);
  });

  it("says the run already moved on when the action raced with it", () => {
    const { container } = render(
      <RunCheckpointBar
        status="awaiting_plan_approval"
        pending={null}
        conflict
        onAction={() => {}}
      />,
    );
    expect(container.textContent).toContain(
      "This run already moved on. Showing the latest.",
    );
    const alert = within(container).getByRole("alert");
    expect(alert.textContent).toContain("already moved on");
  });

  it("opens a new run for a terminal ticket through the start-new-run command", () => {
    const actions: string[] = [];
    const onAction = (action: string) => actions.push(action);
    const { container } = render(
      <RunCheckpointBar
        status="failed"
        pending={null}
        conflict={false}
        onAction={onAction}
      />,
    );
    fireEvent.click(
      within(container).getByRole("button", { name: "Start New Run" }),
    );
    expect(actions).toContain("start-new-run");
  });
});

describe("the now header says what the run is doing, with its facts", () => {
  it("shows the plan awaiting approval, with the approval sentence", () => {
    const run = makeRun("awaiting_plan_approval", {
      plan: "1. Read the parser.",
    });
    const { container } = render(
      <RunNowHeader run={run} now={runNow(run, [])} />,
    );
    expect(
      within(container).getByRole("heading", {
        level: 2,
        name: "Review the plan",
      }).textContent,
    ).toBe("Review the plan");
    // The plan renders as a numbered list: the item text is there, the Markdown marker is not.
    expect(container.textContent).toContain("Read the parser.");
    expect(container.textContent).not.toContain("1. Read");
  });

  it("summarises the changes awaiting review", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1,2 @@",
      "-old",
      "+new",
      "+more",
    ].join("\n");
    const run = makeRun("awaiting_review", { diff });
    const { container } = render(
      <RunNowHeader run={run} now={runNow(run, [])} />,
    );
    expect(container.textContent).toContain("1 file");
    expect(container.textContent).toContain("+2");
    expect(container.textContent).toContain("−1");
  });

  it("links the pull request once it is open", () => {
    const run = makeRun("pr_created", {
      pullRequest: {
        url: "https://github.com/o/r/pull/9",
        number: 9,
        title: "T-1",
        branch: "factory/t-1",
        baseBranch: "main",
      } as Run["pullRequest"],
    });
    const { container } = render(
      <RunNowHeader run={run} now={runNow(run, [])} />,
    );
    const link = within(container).getByRole("link", { name: /pull request/i });
    expect(link.getAttribute("href")).toBe("https://github.com/o/r/pull/9");
  });

  it("explains a failed run and how to recover", () => {
    const run = makeRun("failed");
    const now = runNow(run, [
      {
        id: 5,
        type: "status",
        timestamp: "2026-09-20T12:00:00.000Z",
        payload: {
          status: "failed",
          failure: {
            category: "model",
            message: "The model call failed.",
            recovery: "Check the model connection, then start a new run.",
          },
        },
      } as never,
    ]);
    const { container } = render(<RunNowHeader run={run} now={now} />);
    expect(container.textContent).toContain("The model call failed.");
    expect(container.textContent).toContain("Check the model connection");
  });
});
