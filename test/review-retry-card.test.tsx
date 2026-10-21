/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { checkpointBarEntries } from "../src/frontend/components/runs/RunCheckpointBar.js";
import { RunDecisionCard } from "../src/frontend/components/runs/RunDecisionCard.js";
import { runNow } from "../src/frontend/lib/run-now.js";
import type { Run, RunEvent } from "../src/shared/types.js";

afterEach(() => {
  cleanup();
});
afterAll(async () => {
  await unregisterHappyDom();
});

const AT = "2026-10-21T10:00:00.000Z";
const MODEL_ERROR = "The reviewer model is overloaded.";

const run = {
  id: "run-retry-card",
  project: { id: "p", name: "P" },
  ticket: { id: "T-9", title: "A ticket", url: "", acceptanceCriteria: [] },
  plan: "",
  branch: "factory/t-9",
  status: "review_retry_required",
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
} as unknown as Run;

const events = [
  {
    id: 1,
    type: "status",
    payload: { status: "review_retry_required", reason: MODEL_ERROR },
    timestamp: AT,
  },
] as unknown as RunEvent[];

describe("the decision card of a run whose review needs a retry", () => {
  it("shows the last model error and the code-kept sentence", () => {
    const facts = runNow(run, events);
    const { container } = render(
      <RunDecisionCard
        run={run}
        facts={facts}
        pending={null}
        conflict={false}
        reworkReady={false}
        onAction={() => {}}
      />,
    );
    const card = container.querySelector(".run-decision") as HTMLElement;
    expect(within(card).getByText(MODEL_ERROR)).toBeTruthy();
    expect(within(card).getByText(/code is not changed/)).toBeTruthy();
  });

  it("offers one primary Retry review button and Abandon, and no other primary", () => {
    const { container } = render(
      <RunDecisionCard
        run={run}
        facts={runNow(run, events)}
        pending={null}
        conflict={false}
        reworkReady={false}
        onAction={() => {}}
      />,
    );
    const card = container.querySelector(".run-decision") as HTMLElement;
    const retry = within(card).getByRole("button", { name: "Retry Review" });
    expect(retry.hasAttribute("data-primary-action")).toBe(true);
    expect(
      within(card).getByRole("button", { name: "Abandon Run" }),
    ).toBeTruthy();
    expect(card.querySelectorAll("[data-primary-action]").length).toBe(1);
  });

  it("sends retry-review when the button is pressed", () => {
    const onAction = mock(() => {});
    const { container } = render(
      <RunDecisionCard
        run={run}
        facts={runNow(run, events)}
        pending={null}
        conflict={false}
        reworkReady={false}
        onAction={onAction}
      />,
    );
    const card = container.querySelector(".run-decision") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Retry Review" }));
    expect(onAction).toHaveBeenCalledWith("retry-review");
  });

  it("the bar entries are Retry review then Abandon, with no Stop in the bar", () => {
    expect(checkpointBarEntries("review_retry_required")).toEqual([
      { action: "retry-review", label: "Retry Review" },
      { action: "abandon", label: "Abandon Run" },
    ]);
  });
});
