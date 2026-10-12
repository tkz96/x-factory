// test/run-step-indicator.test.tsx — The step indicator reads Prepare → Understand → Plan → Code →
// Review → Deliver and marks where the run is (#262).

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import { WorkflowStepper } from "../src/frontend/components/runs/WorkflowStepper.js";
import type { RunStatus } from "../src/shared/types.js";

afterEach(cleanup);
afterAll(async () => {
  await unregisterHappyDom();
});

const STEPS = ["Prepare", "Understand", "Plan", "Code", "Review", "Deliver"];

function stepsFor(status: RunStatus) {
  const { container } = render(<WorkflowStepper status={status} />);
  const nav = within(container).getByRole("navigation", {
    name: "Workflow progress",
  });
  const steps = Array.from(nav.querySelectorAll<HTMLElement>(".step"));
  return steps.map((el) => ({
    label: el.querySelector(".step-label")?.textContent,
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
});
