// test/run-page-loading-state.test.tsx — Loading state and empty current stage (#313, spec #312).
// User stories 1–2:
// 1. As a reader who opens a run, I want a spinner where the timeline will be, and the stages
//    in their final place, so the page does not jump when the history arrives.
// 2. As a reader of a run with no events yet, I want the current stage to say what the run waits for
//    (for example "Waiting for a worker"), not a large empty block.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RunChat } from "../src/frontend/components/runs/RunChat.js";
import { RunDetailsProvider } from "../src/frontend/components/runs/RunDetailsContext.js";
import type { Run, RunStatus } from "../src/shared/types.js";

afterEach(() => {
  cleanup();
});
afterAll(async () => {
  await unregisterHappyDom();
});

const AT = "2026-10-30T10:00:00.000Z";

function makeRun(status: RunStatus, overrides: Partial<Run> = {}): Run {
  return {
    id: "run-loading-1",
    project: { id: "p-1", name: "Project" },
    ticket: {
      id: "T-100",
      title: "Loading state ticket",
      url: "https://ticket/100",
      acceptanceCriteria: [],
    },
    plan: "",
    branch: "factory/ticket-100",
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
  };
}

function renderChat(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      <RunDetailsProvider isPhone={false}>{ui}</RunDetailsProvider>
    </MemoryRouter>,
  );
}

describe("Run page loading state (#313)", () => {
  it("user story 1: shows a spinner where the timeline will be, stages in place, no empty state above", () => {
    const run = makeRun("understanding");
    const { container } = renderChat(
      <RunChat run={run} events={[]} eventsLoaded={false} />,
    );

    // 1. Stages are rendered in their final place from the start (6 stages)
    const stageList = container.querySelector(".run-stage-list");
    expect(stageList).toBeTruthy();
    const stages = container.querySelectorAll(".run-stage");
    expect(stages).toHaveLength(6);

    // 2. The large EmptyState above the stages is gone
    expect(container.textContent).not.toContain(
      "Waiting for the first update…",
    );

    // 3. Inside the current stage (understanding), there is a Spinner
    const currentStage = container.querySelector(
      '.run-stage[data-state="current"]',
    );
    expect(currentStage).toBeTruthy();
    const spinner = currentStage?.querySelector(".ui-wait");
    expect(spinner).toBeTruthy();
    expect(
      within(currentStage as HTMLElement).getByRole("status"),
    ).toBeTruthy();
  });

  it("user story 2: an empty current stage says what the run waits for (Waiting for a worker)", () => {
    const run = makeRun("understanding", { waitingForWorker: true });
    const { container } = renderChat(
      <RunChat run={run} events={[]} eventsLoaded={true} />,
    );

    // No large block above the stages
    expect(container.textContent).not.toContain(
      "Waiting for the first update…",
    );

    // The current stage note says "Waiting for a worker"
    const currentStage = container.querySelector(
      '.run-stage[data-state="current"]',
    );
    expect(currentStage).toBeTruthy();
    expect(
      within(currentStage as HTMLElement).getByText("Waiting for a worker"),
    ).toBeTruthy();
  });

  it("user story 2: a queued run waiting to start says what it waits for", () => {
    const run = makeRun("queued", { waitingForWorker: false });
    const { container } = renderChat(
      <RunChat run={run} events={[]} eventsLoaded={true} />,
    );

    expect(container.textContent).not.toContain(
      "Waiting for the first update…",
    );

    const currentStage = container.querySelector(
      '.run-stage[data-state="current"]',
    );
    expect(currentStage).toBeTruthy();
    expect(
      within(currentStage as HTMLElement).getByText("Waiting to start"),
    ).toBeTruthy();
  });
});
