// test/run-decision-card.test.tsx — At the review checkpoint the decision card shows the Reviewer's
// summary, its findings (errors first) and each criterion's verdict, labelled as the Reviewer's
// judgement (Finding 12). Other checkpoints do not show a review.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import { RunDecisionCard } from "../src/frontend/components/runs/RunDecisionCard.js";
import { runNow } from "../src/frontend/lib/run-now.js";
import type {
  ReviewResult,
  Run,
  RunEvent,
  RunStatus,
} from "../src/shared/types.js";

afterEach(() => {
  cleanup();
});
afterAll(async () => {
  await unregisterHappyDom();
});

const AT = "2026-09-20T12:00:00.000Z";

function makeRun(status: RunStatus, overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    project: { id: "p", name: "P" },
    ticket: {
      id: "T-1",
      title: "A ticket",
      url: "https://t",
      acceptanceCriteria: [],
    },
    plan: "",
    branch: "b",
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

const REVIEW: ReviewResult = {
  passed: false,
  summary:
    "Review failed: 1 blocking errors, 1 unmet criteria, 0 not assessed.",
  findings: [
    { severity: "info", message: "The new name follows the file style" },
    { severity: "warning", message: "The helper has no doc comment" },
    { severity: "error", message: "The audit log still prints the password" },
  ],
  criteriaChecked: [
    {
      criterion: "Sanitize passwords from audit payload",
      status: "fail",
      notes: "password still logged in audit.ts:40",
    },
    { criterion: "Do not modify user IDs", status: "pass" },
  ],
};

function renderCard(run: Run) {
  return render(
    <RunDecisionCard
      run={run}
      facts={runNow(run, [])}
      pending={null}
      conflict={false}
      reworkReady={false}
      onAction={() => {}}
    />,
  );
}

describe("the decision card at the review checkpoint", () => {
  it("shows the review summary and says the criteria verdicts are the Reviewer's judgement", () => {
    const { container } = renderCard(
      makeRun("awaiting_review", { review: REVIEW }),
    );
    const card = within(container);
    expect(card.getByText(REVIEW.summary)).toBeTruthy();
    expect(card.getByText("Reviewer judgement")).toBeTruthy();
    expect(
      card.getByText("Sanitize passwords from audit payload"),
    ).toBeTruthy();
    expect(card.getByText("password still logged in audit.ts:40")).toBeTruthy();
    expect(card.getByText("Fail")).toBeTruthy();
    expect(card.getByText("Pass")).toBeTruthy();
  });

  it("lists the findings with their severity, errors first", () => {
    const { container } = renderCard(
      makeRun("awaiting_review", { review: REVIEW }),
    );
    const items = within(container)
      .getAllByRole("listitem")
      .map((item) => item.textContent ?? "");
    const findings = items.filter(
      (text) =>
        text.includes("follows the file style") ||
        text.includes("doc comment") ||
        text.includes("still prints"),
    );
    expect(findings).toEqual([
      expect.stringContaining("still prints the password"),
      expect.stringContaining("has no doc comment"),
      expect.stringContaining("follows the file style"),
    ]);
    expect(findings[0]).toContain("Error");
    expect(findings[1]).toContain("Warning");
    expect(findings[2]).toContain("Info");
  });

  it("does not show a review at a checkpoint where the run has none", () => {
    const { container } = renderCard(
      makeRun("awaiting_review", { review: null }),
    );
    expect(within(container).queryByText("Reviewer judgement")).toBeNull();
  });

  it("does not show the review at another checkpoint", () => {
    const { container } = renderCard(
      makeRun("awaiting_plan_approval", { review: REVIEW }),
    );
    expect(within(container).queryByText("Reviewer judgement")).toBeNull();
    expect(within(container).queryByText(REVIEW.summary)).toBeNull();
  });
});

function renderTerminal(
  run: Run,
  events: RunEvent[] = [],
  failedStage: string | null = null,
) {
  return render(
    <RunDecisionCard
      run={run}
      facts={runNow(run, events)}
      failedStage={failedStage}
      pending={null}
      conflict={false}
      reworkReady={false}
      onAction={() => {}}
    />,
  );
}

function statusEvent(
  status: RunStatus,
  payload: Record<string, unknown> = {},
  timestamp = AT,
): RunEvent {
  return {
    id: 1,
    type: "status",
    payload: { status, ...payload },
    timestamp,
  } as unknown as RunEvent;
}

describe("the terminal card", () => {
  it("states a failure once: its category, the failing stage, the message and the recovery, with Start New Run", () => {
    const failure = {
      category: "model",
      message: "The model call failed.",
      recovery: "Check the model connection in Settings.",
    };
    const { container } = renderTerminal(
      makeRun("failed"),
      [statusEvent("failed", { failure })],
      "Code",
    );
    const card = within(container);
    expect(card.getByText("Model failure")).toBeTruthy();
    expect(card.getByText(/Code/)).toBeTruthy();
    expect(card.getAllByText(failure.message)).toHaveLength(1);
    expect(card.getByText(failure.recovery)).toBeTruthy();
    expect(card.getByRole("button", { name: "Start New Run" })).toBeTruthy();
    expect(container.querySelector(".run-now-failure")).toBeNull();
    // Calm: the default card, not the orange decision style.
    expect(container.querySelector(".ui-card--default")).not.toBeNull();
  });

  it("says who stopped a stopped run and when, with Start New Run", () => {
    const { container } = renderTerminal(makeRun("stopped"), [
      statusEvent("stopped", { text: "Run stopped by user." }),
    ]);
    const card = within(container);
    expect(card.getByText(/Stopped by you/)).toBeTruthy();
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe(AT);
    expect(card.getByRole("button", { name: "Start New Run" })).toBeTruthy();
  });

  it("names the outcome of a merged pull request and links to it", () => {
    const run = makeRun("pr_created", {
      pullRequest: { url: "https://gh/pr/1" } as Run["pullRequest"],
      pullRequestOutcome: {
        status: "merged",
        state: "merged",
        url: "https://gh/pr/1",
        mergedAt: AT,
      } as Run["pullRequestOutcome"],
    });
    const { container } = renderTerminal(run);
    const card = within(container);
    expect(card.getByText("Merged")).toBeTruthy();
    expect(
      card
        .getByRole("link", { name: /Open Pull Request/ })
        .getAttribute("href"),
    ).toBe("https://gh/pr/1");
  });

  it("calls an open pull request open", () => {
    const run = makeRun("pr_created", {
      pullRequest: { url: "https://gh/pr/1" } as Run["pullRequest"],
    });
    const { container } = renderTerminal(run);
    expect(within(container).getByText("Pull request open")).toBeTruthy();
  });
});
