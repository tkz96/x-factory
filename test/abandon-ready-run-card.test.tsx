/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { RunDecisionCard } from "../src/frontend/components/runs/RunDecisionCard.js";
import { runNow } from "../src/frontend/lib/run-now.js";
import type { Run } from "../src/shared/types.js";

afterEach(() => {
  cleanup();
});
afterAll(async () => {
  await unregisterHappyDom();
});

const run = {
  id: "run-ready-card",
  project: { id: "p", name: "P" },
  ticket: { id: "RD-2", title: "Ready", url: "", acceptanceCriteria: [] },
  plan: "",
  branch: "factory/rd-2",
  status: "ready_for_pr",
  startedAt: "2026-10-21T10:00:00.000Z",
  finishedAt: null,
  updatedAt: "2026-10-21T10:00:00.000Z",
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

describe("the decision card of a ready run", () => {
  it("offers Create Pull Request and Abandon Run, and Abandon sends abandon", () => {
    const onAction = mock(() => {});
    const { container } = render(
      <RunDecisionCard
        run={run}
        facts={runNow(run, [])}
        pending={null}
        conflict={false}
        reworkReady={false}
        onAction={onAction}
      />,
    );
    const card = container.querySelector(".run-decision") as HTMLElement;
    expect(
      within(card).getByRole("button", { name: "Create Pull Request" }),
    ).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Abandon Run" }));
    expect(onAction).toHaveBeenCalledWith("abandon");
  });
});
