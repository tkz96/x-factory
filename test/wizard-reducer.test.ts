// test/wizard-reducer.test.ts — Pure reducer tests for the wizard state machine.

import { describe, expect, it } from "bun:test";
import { connectionConfigFingerprint } from "../src/frontend/lib/connection-fingerprint.js";
import {
  createInitialWizardState,
  wizardReducer,
} from "../src/frontend/wizard/state/wizardReducer.js";
import type { WizardSourceState } from "../src/frontend/wizard/types.js";

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

    // Step 3 requires an application repository before it may advance (#144).
    const gitHostConnection = {
      providerId: "generic-githost",
      config: { host: "https://git.example.com" },
    };
    state = wizardReducer(state, {
      type: "UPDATE_CONNECT",
      patch: { gitHost: gitHostConnection },
    });
    state = wizardReducer(state, {
      type: "UPDATE_REPOSITORIES",
      patch: {
        selectedRepoIds: ["repo-1"],
        repoConfigs: { "repo-1": { role: "gitHost", roles: ["gitHost"] } },
        selectionFingerprint: connectionConfigFingerprint(
          gitHostConnection.providerId,
          gitHostConnection.config,
        ),
      },
    });

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

describe("Wizard Reducer — step 3 progression guard (#144)", () => {
  function stateAtStepThree(): WizardSourceState {
    let state = createInitialWizardState();
    state = wizardReducer(state, { type: "NEXT_STEP" });
    state = wizardReducer(state, { type: "NEXT_STEP" });
    return state;
  }

  const gitHost = {
    providerId: "generic-githost",
    config: { host: "https://git.example.com", token: "tok-a" },
  };

  function withSelection(
    state: WizardSourceState,
    repoConfigs: Record<string, { role: string; roles?: string[] }>,
    fingerprint = connectionConfigFingerprint(
      gitHost.providerId,
      gitHost.config,
    ),
  ): WizardSourceState {
    let next = wizardReducer(state, {
      type: "UPDATE_CONNECT",
      patch: { gitHost },
    });
    next = wizardReducer(next, {
      type: "UPDATE_REPOSITORIES",
      patch: {
        selectedRepoIds: Object.keys(repoConfigs),
        repoConfigs,
        selectionFingerprint: fingerprint,
      },
    });
    return next;
  }

  it("refuses NEXT_STEP past step 3 with no repository selected", () => {
    const state = stateAtStepThree();
    const advanced = wizardReducer(state, { type: "NEXT_STEP" });

    expect(advanced.step).toBe(3);
    expect(advanced.maxStepVisited).toBe(3);
  });

  it("refuses NEXT_STEP past step 3 when only a non-application repository is selected", () => {
    const state = withSelection(stateAtStepThree(), {
      "repo-1": { role: "tracker", roles: ["tracker"] },
    });
    expect(wizardReducer(state, { type: "NEXT_STEP" }).step).toBe(3);
  });

  it("refuses NEXT_STEP past step 3 when the selection is stale for the current connection", () => {
    const state = withSelection(
      stateAtStepThree(),
      { "repo-1": { role: "gitHost", roles: ["gitHost"] } },
      "cfp_recorded_from_another_connection",
    );
    expect(wizardReducer(state, { type: "NEXT_STEP" }).step).toBe(3);
  });

  it("advances past step 3 with a current application-repository selection", () => {
    const state = withSelection(stateAtStepThree(), {
      "repo-1": { role: "gitHost", roles: ["gitHost"] },
    });
    const advanced = wizardReducer(state, { type: "NEXT_STEP" });

    expect(advanced.step).toBe(4);
    expect(advanced.maxStepVisited).toBe(4);
  });

  it("leaves the guard inert on other steps", () => {
    let state = createInitialWizardState();
    // Step 1 → 2 and 2 → 3 proceed without any repository data.
    state = wizardReducer(state, { type: "NEXT_STEP" });
    expect(state.step).toBe(2);
    state = wizardReducer(state, { type: "NEXT_STEP" });
    expect(state.step).toBe(3);
  });
});
