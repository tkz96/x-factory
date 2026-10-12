// test/run-step-indicator.test.tsx — The step indicator reads Prepare → Understand → Plan → Code →
// Review → Deliver and marks where the run is (#262).

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import { WorkflowStepper } from "../src/frontend/components/runs/WorkflowStepper.js";
import type { RunEvent, RunStatus } from "../src/shared/types.js";

afterEach(cleanup);
afterAll(async () => {
  await unregisterHappyDom();
});

const STEPS = ["Prepare", "Understand", "Plan", "Code", "Review", "Deliver"];

function statusEvent(id: number, status: RunStatus): RunEvent {
  return {
    id,
    type: "status",
    payload: { status, text: status },
    timestamp: "2026-10-12T05:54:00.000Z",
  } as unknown as RunEvent;
}

function stepsFor(status: RunStatus, events?: RunEvent[]) {
  const { container } = render(
    <WorkflowStepper
      status={status}
      startedAt="2026-10-12T05:50:00.000Z"
      {...(events ? { events } : {})}
    />,
  );
  const nav = within(container).getByRole("navigation", {
    name: "Workflow progress",
  });
  const steps = Array.from(nav.querySelectorAll<HTMLElement>(".step"));
  return steps.map((el) => ({
    label: el.querySelector(".step-label")?.textContent,
    evidence: el.querySelector(".step-evidence")?.textContent,
    state:
      ["active", "completed", "failed"].find((c) => el.classList.contains(c)) ??
      "pending",
  }));
}

describe("the step indicator", () => {
  it("names the six steps in order", () => {
    expect(stepsFor("executing").map((s) => s.label)).toEqual(STEPS);
  });

  it("marks the step the run is on, with the steps before it done", () => {
    const steps = stepsFor("awaiting_review");
    expect(steps.map((s) => s.state)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
      "active",
      "pending",
    ]);
  });

  it("marks every step done once the pull request is open", () => {
    expect(stepsFor("pr_created").every((s) => s.state === "completed")).toBe(
      true,
    );
  });

  it("at a checkpoint says the run is waiting for you, with no running clock", () => {
    const steps = stepsFor("awaiting_understanding_approval");
    const understand = steps[1];
    expect(understand?.state).toBe("active");
    expect(understand?.evidence).toBe("Waiting for you");
    expect(stepsFor("awaiting_plan_approval")[2]?.evidence).toBe(
      "Waiting for you",
    );
  });

  it("while the run works, the active step says what it is doing and for how long", () => {
    const understand = stepsFor("understanding")[1];
    expect(understand?.evidence).toMatch(/^Reading the ticket · \d/);
  });

  it("marks the step a failed run stopped at as failed", () => {
    const steps = stepsFor("failed", [
      statusEvent(1, "preparing"),
      statusEvent(2, "understanding"),
      statusEvent(3, "failed"),
    ]);
    expect(steps.map((s) => s.state)).toEqual([
      "completed",
      "failed",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    expect(steps[1]?.evidence).toBe("Failed");
  });

  it("marks no step failed when a failed run left no stage behind", () => {
    const steps = stepsFor("failed", []);
    expect(steps.some((s) => s.state === "failed")).toBe(false);
  });
});
