// test/run-now.test.ts — What the run page's "now" header says, from the run and its real events (#262).

import { describe, expect, it } from "bun:test";
import { runNow } from "../src/frontend/lib/run-now.js";
import type { Run, RunEvent, RunStatus } from "../src/shared/types.js";

const AT = "2026-09-20T12:00:00.000Z";

function makeRun(status: RunStatus, overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
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

function ev(id: number, type: string, payload: unknown): RunEvent {
  return { id, type, payload, timestamp: AT } as unknown as RunEvent;
}

const DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,3 @@",
  " keep",
  "-old",
  "+new",
  "+more",
  "",
].join("\n");

describe("the now header says what the run is doing", () => {
  it("uses the status map's plain title and sentence for every status", () => {
    const now = runNow(makeRun("executing"), []);
    expect(now.title).toBe("Writing code");
    expect(now.sentence.length).toBeGreaterThan(0);
    expect(now.sentence).not.toMatch(
      /What it's|Diff summary and|Current iteration/,
    );
  });

  it("shows the plan from the plan-ready event when the plan awaits approval", () => {
    const now = runNow(
      makeRun("awaiting_plan_approval", { plan: "old plan" }),
      [ev(1, "plan_ready", { plan: "1. Read the parser.\n2. Add the field." })],
    );
    expect(now.plan).toBe("1. Read the parser.\n2. Add the field.");
  });

  it("falls back to the run's own plan text when no plan event exists", () => {
    const now = runNow(
      makeRun("awaiting_plan_approval", { plan: "stored plan" }),
      [],
    );
    expect(now.plan).toBe("stored plan");
  });

  it("shows no plan on a status that does not ask for one", () => {
    const now = runNow(makeRun("executing", { plan: "stored plan" }), []);
    expect(now.plan).toBeNull();
  });

  it("summarises the diff when changes await review", () => {
    const now = runNow(makeRun("awaiting_review", { diff: DIFF }), []);
    expect(now.diff).toEqual({
      files: [{ path: "src/a.ts", added: 2, removed: 1 }],
      totalAdded: 2,
      totalRemoved: 1,
    });
  });

  it("links the pull request once it exists", () => {
    const now = runNow(
      makeRun("pr_created", {
        pullRequest: {
          url: "https://github.com/o/r/pull/9",
          number: 9,
          title: "T-1",
          branch: "factory/t-1",
          baseBranch: "main",
        } as Run["pullRequest"],
      }),
      [],
    );
    expect(now.pullRequestUrl).toBe("https://github.com/o/r/pull/9");
  });

  it("updates title and outcome when pull request is merged", () => {
    const now = runNow(
      makeRun("pr_created", {
        pullRequestOutcome: {
          status: "merged",
          url: "https://github.com/o/r/pull/9",
          mergedAt: "2026-09-20T12:30:00.000Z",
          mergedBy: "octocat",
        },
      }),
      [],
    );
    expect(now.title).toBe("Merged");
    expect(now.sentence).toBe("The pull request was merged.");
    expect(now.pullRequestOutcome?.status).toBe("merged");
    expect(now.pullRequestOutcome?.mergedBy).toBe("octocat");
  });

  it("updates title and outcome when pull request is closed without merging", () => {
    const now = runNow(
      makeRun("pr_created", {
        pullRequestOutcome: {
          status: "closed",
          url: "https://github.com/o/r/pull/9",
          closedAt: "2026-09-20T12:30:00.000Z",
        },
      }),
      [],
    );
    expect(now.title).toBe("Closed without merging");
    expect(now.sentence).toBe("The pull request was closed without merging.");
    expect(now.pullRequestOutcome?.status).toBe("closed");
  });

  it("explains a failed run with its structured reason and recovery", () => {
    const now = runNow(makeRun("failed"), [
      ev(3, "status", {
        status: "failed",
        text: "raw stack trace",
        failure: {
          category: "verification",
          message: "The change did not pass deterministic verification.",
          recovery: "Read the failing tests, then restart the run.",
        },
      }),
    ]);
    expect(now.failure).toEqual({
      category: "verification",
      message: "The change did not pass deterministic verification.",
      recovery: "Read the failing tests, then restart the run.",
    });
  });

  it("tells a run that needs recovery what went wrong and what Resume Run does", () => {
    const now = runNow(makeRun("recovery_required"), [
      ev(4, "status", {
        status: "recovery_required",
        reason: "The daily budget was reached.",
      }),
    ]);
    expect(now.failure?.message).toBe("The daily budget was reached.");
    expect(now.failure?.recovery).toMatch(/Resume Run/);
  });

  it("gives no failure detail to a run that has not failed", () => {
    expect(runNow(makeRun("executing"), []).failure).toBeNull();
  });

  it("says the run waits for a worker, not that it is writing code, while its job is unclaimed", () => {
    const now = runNow(makeRun("executing", { waitingForWorker: true }), []);
    expect(now.title).toBe("Waiting for the worker");
    expect(now.sentence).toMatch(/worker/);
    expect(now.title).not.toBe("Writing code");
  });

  it("keeps the stage title once a worker holds the job", () => {
    const now = runNow(makeRun("preparing", { waitingForWorker: false }), []);
    expect(now.title).toBe("Preparing the workspace");
  });

  it("keeps Waiting to start for a queued run, which already waits for a slot", () => {
    const now = runNow(makeRun("queued", { waitingForWorker: true }), []);
    expect(now.title).toBe("Waiting to start");
  });
});
