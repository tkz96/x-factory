// test/wizard-reducer.test.ts — Pure reducer tests for the wizard state machine.

import { describe, expect, it } from "bun:test";
import {
  createInitialWizardState,
  wizardReducer,
} from "../src/frontend/wizard/state/wizardReducer.js";

describe("Wizard Reducer (Pure FSM & State Integrity)", () => {
  it("initializes with Basics step and empty workspace path (S3 defect fixed)", () => {
    const state = createInitialWizardState();

    expect(state.step).toBe(1);
    expect(state.maxStepVisited).toBe(1);
    expect(state.basics.name).toBe("");
    expect(state.basics.id).toBe("");
    expect(state.basics.description).toBe("");
    // S3 fix: no hardcoded default workspace path
    expect(state.basics.workspacePath).toBe("");
    expect(state.basics.workspacePath).not.toContain("talhazuberi");
  });

  it("updates Basics fields cleanly", () => {
    let state = createInitialWizardState();

    state = wizardReducer(state, {
      type: "UPDATE_BASICS",
      patch: { name: "Apollo", id: "apollo" },
    });

    expect(state.basics.name).toBe("Apollo");
    expect(state.basics.id).toBe("apollo");
    expect(state.basics.workspacePath).toBe("");

    state = wizardReducer(state, {
      type: "UPDATE_BASICS",
      patch: { workspacePath: "/custom/path" },
    });

    expect(state.basics.workspacePath).toBe("/custom/path");
  });

  it("advances step monotonically and updates maxStepVisited", () => {
    let state = createInitialWizardState();

    state = wizardReducer(state, { type: "NEXT_STEP" });
    expect(state.step).toBe(2);
    expect(state.maxStepVisited).toBe(2);

    state = wizardReducer(state, { type: "NEXT_STEP" });
    expect(state.step).toBe(3);
    expect(state.maxStepVisited).toBe(3);

    state = wizardReducer(state, { type: "NEXT_STEP" });
    expect(state.step).toBe(4);
    expect(state.maxStepVisited).toBe(4);

    state = wizardReducer(state, { type: "NEXT_STEP" });
    expect(state.step).toBe(5);
    expect(state.maxStepVisited).toBe(5);

    // Clamped at Step 5
    state = wizardReducer(state, { type: "NEXT_STEP" });
    expect(state.step).toBe(5);
    expect(state.maxStepVisited).toBe(5);
  });

  it("navigates backward without corrupting or resetting previously valid state", () => {
    let state = createInitialWizardState();

    state = wizardReducer(state, {
      type: "UPDATE_BASICS",
      patch: { name: "Zeus", id: "zeus", workspacePath: "/path/zeus" },
    });
    state = wizardReducer(state, { type: "NEXT_STEP" });
    expect(state.step).toBe(2);

    // Navigate back to Step 1
    state = wizardReducer(state, { type: "PREV_STEP" });
    expect(state.step).toBe(1);
    expect(state.maxStepVisited).toBe(2);

    // State remains fully intact
    expect(state.basics.name).toBe("Zeus");
    expect(state.basics.id).toBe("zeus");
    expect(state.basics.workspacePath).toBe("/path/zeus");

    // Clamped at Step 1
    state = wizardReducer(state, { type: "PREV_STEP" });
    expect(state.step).toBe(1);
  });

  it("blocks skipping ahead to unvisited steps (SET_STEP bounds check)", () => {
    let state = createInitialWizardState();
    expect(state.maxStepVisited).toBe(1);

    // Attempt to skip to step 3 or 5
    state = wizardReducer(state, { type: "SET_STEP", step: 3 });
    expect(state.step).toBe(1);

    state = wizardReducer(state, { type: "SET_STEP", step: 5 });
    expect(state.step).toBe(1);

    // Advance to step 3 normally
    state = wizardReducer(state, { type: "NEXT_STEP" });
    state = wizardReducer(state, { type: "NEXT_STEP" });
    expect(state.step).toBe(3);
    expect(state.maxStepVisited).toBe(3);

    // Can jump back to step 1
    state = wizardReducer(state, { type: "SET_STEP", step: 1 });
    expect(state.step).toBe(1);

    // Can jump forward to step 3 because maxStepVisited is 3
    state = wizardReducer(state, { type: "SET_STEP", step: 3 });
    expect(state.step).toBe(3);

    // Still cannot jump to step 4
    state = wizardReducer(state, { type: "SET_STEP", step: 4 });
    expect(state.step).toBe(3);
  });

  it("resets state completely on RESET_STATE", () => {
    let state = createInitialWizardState();
    state = wizardReducer(state, {
      type: "UPDATE_BASICS",
      patch: { name: "Hermes", id: "hermes" },
    });
    state = wizardReducer(state, { type: "NEXT_STEP" });
    state = wizardReducer(state, { type: "NEXT_STEP" });

    state = wizardReducer(state, { type: "RESET_STATE" });
    expect(state.step).toBe(1);
    expect(state.maxStepVisited).toBe(1);
    expect(state.basics.name).toBe("");
    expect(state.basics.id).toBe("");
  });

  it("restores draft state on RESTORE_DRAFT", () => {
    const initialState = createInitialWizardState();
    const draftState = {
      ...initialState,
      step: 2 as const,
      maxStepVisited: 2 as const,
      basics: {
        name: "Restored",
        id: "restored",
        description: "Draft desc",
        workspacePath: "/restored/path",
      },
    };

    const state = wizardReducer(initialState, {
      type: "RESTORE_DRAFT",
      state: draftState,
    });

    expect(state.step).toBe(2);
    expect(state.maxStepVisited).toBe(2);
    expect(state.basics.name).toBe("Restored");
    expect(state.basics.description).toBe("Draft desc");
  });
});
