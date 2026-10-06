// test/wizard-reducer.test.ts — Pure reducer tests for the wizard state machine.

import { describe, expect, it } from "bun:test";
import { connectionConfigFingerprint } from "../src/frontend/lib/connection-fingerprint.js";
import {
  providerConfig,
  roleConfig,
} from "../src/frontend/wizard/state/connectConfig.js";
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
    const gitHostProviderId = "generic-githost";
    const gitHostConfig = { host: "https://git.example.com" };
    state = wizardReducer(state, {
      type: "SELECT_PROVIDER",
      role: "gitHost",
      providerId: gitHostProviderId,
    });
    state = wizardReducer(state, {
      type: "UPDATE_PROVIDER_CONFIG",
      providerId: gitHostProviderId,
      config: gitHostConfig,
    });
    state = wizardReducer(state, {
      type: "UPDATE_REPOSITORIES",
      patch: {
        selectedRepoIds: ["repo-1"],
        repoConfigs: { "repo-1": { role: "gitHost", roles: ["gitHost"] } },
        selectionFingerprint: connectionConfigFingerprint(
          gitHostProviderId,
          gitHostConfig,
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

  const GIT_HOST_PROVIDER_ID = "generic-githost";
  const GIT_HOST_CONFIG = { host: "https://git.example.com", token: "tok-a" };

  function withSelection(
    state: WizardSourceState,
    repoConfigs: Record<string, { role: string; roles?: string[] }>,
    fingerprint = connectionConfigFingerprint(
      GIT_HOST_PROVIDER_ID,
      GIT_HOST_CONFIG,
    ),
  ): WizardSourceState {
    // The two transitions a card makes: select a provider for its role, then
    // write the provider's configuration (correction 2, #133).
    let next = wizardReducer(state, {
      type: "SELECT_PROVIDER",
      role: "gitHost",
      providerId: GIT_HOST_PROVIDER_ID,
    });
    next = wizardReducer(next, {
      type: "UPDATE_PROVIDER_CONFIG",
      providerId: GIT_HOST_PROVIDER_ID,
      config: GIT_HOST_CONFIG,
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

// ---------------------------------------------------------------------------
// The connection configuration model (correction 2, #133).
//
// The defect these tests pin: configuration used to live on each ROLE, so a
// provider serving both roles could be configured twice, verified twice against
// two different configurations, and submitted once — carrying whichever role's
// copy the payload builder happened to pick. Configuration now lives on the
// PROVIDER (`connect.providerConfigs`, keyed by provider id), and these
// assertions read that state directly: one provider, one configuration.
describe("Connect — one configuration per provider (correction 2, #133)", () => {
  const SHARED_CONFIG = { serviceUrl: "https://dual.example", pat: "pat-a" };

  /** Both roles pointed at the same provider, its configuration on record. */
  function sharedProviderState(
    config: Record<string, unknown> = SHARED_CONFIG,
  ): WizardSourceState {
    let state = createInitialWizardState();
    state = wizardReducer(state, {
      type: "SELECT_PROVIDER",
      role: "tracker",
      providerId: "dual",
    });
    state = wizardReducer(state, {
      type: "SELECT_PROVIDER",
      role: "gitHost",
      providerId: "dual",
    });
    return wizardReducer(state, {
      type: "UPDATE_PROVIDER_CONFIG",
      providerId: "dual",
      config,
    });
  }

  /** Records a successful verification for a role, as the card's hook does. */
  function verified(
    state: WizardSourceState,
    role: "tracker" | "gitHost",
  ): WizardSourceState {
    return wizardReducer(state, {
      type: "UPDATE_CONNECT",
      patch: { [role]: { verified: true, unconfirmedCapabilities: [] } },
    });
  }

  it("holds exactly ONE configuration for a provider both roles name, and both roles read THAT one", () => {
    const state = sharedProviderState();

    expect(Object.keys(state.connect.providerConfigs)).toEqual(["dual"]);
    expect(providerConfig(state.connect, "dual")).toEqual(SHARED_CONFIG);
    // Both roles read the same record — not two equal copies of it.
    expect(roleConfig(state.connect, "tracker")).toBe(
      roleConfig(state.connect, "gitHost"),
    );
    expect(roleConfig(state.connect, "gitHost")).toEqual(SHARED_CONFIG);
    // A role stores no configuration of its own: there is no second source.
    expect(state.connect.tracker).not.toHaveProperty("config");
    expect(state.connect.gitHost).not.toHaveProperty("config");
  });

  it("clears the verification of BOTH roles when the shared configuration is written, from either role's card", () => {
    let state = verified(verified(sharedProviderState(), "tracker"), "gitHost");
    expect(state.connect.tracker.verified).toBe(true);
    expect(state.connect.gitHost.verified).toBe(true);

    // The tracker card's write (its own config with one field changed).
    state = wizardReducer(state, {
      type: "UPDATE_PROVIDER_CONFIG",
      providerId: "dual",
      config: { ...SHARED_CONFIG, serviceUrl: "https://changed.example" },
    });

    expect(state.connect.tracker.verified).toBe(false);
    expect(state.connect.gitHost.verified).toBe(false);
    expect(state.connect.tracker.unconfirmedCapabilities).toEqual([]);
    expect(state.connect.gitHost.unconfirmedCapabilities).toEqual([]);
    // The write landed on the one configuration both roles read.
    expect(roleConfig(state.connect, "tracker")).toEqual({
      serviceUrl: "https://changed.example",
      pat: "pat-a",
    });
    expect(roleConfig(state.connect, "gitHost")).toBe(
      roleConfig(state.connect, "tracker"),
    );
  });

  it("reuses the provider's existing configuration when the second role selects the same provider", () => {
    let state = createInitialWizardState();
    state = wizardReducer(state, {
      type: "SELECT_PROVIDER",
      role: "tracker",
      providerId: "dual",
    });
    state = wizardReducer(state, {
      type: "UPDATE_PROVIDER_CONFIG",
      providerId: "dual",
      config: SHARED_CONFIG,
    });
    state = verified(state, "tracker");

    state = wizardReducer(state, {
      type: "SELECT_PROVIDER",
      role: "gitHost",
      providerId: "dual",
    });

    // The credentials already entered are the provider's, not a role's, so
    // selecting it for the second role does not wipe them...
    expect(providerConfig(state.connect, "dual")).toEqual(SHARED_CONFIG);
    // ...and the tracker's verification of that configuration still stands: the
    // git host now verifies the SAME configuration for its own role.
    expect(state.connect.tracker.verified).toBe(true);
    expect(state.connect.gitHost.verified).toBe(false);
  });

  it("keeps two providers' configurations and evidence independent", () => {
    let state = createInitialWizardState();
    state = wizardReducer(state, {
      type: "SELECT_PROVIDER",
      role: "tracker",
      providerId: "generic-tracker",
    });
    state = wizardReducer(state, {
      type: "SELECT_PROVIDER",
      role: "gitHost",
      providerId: "generic-githost",
    });
    state = wizardReducer(state, {
      type: "UPDATE_PROVIDER_CONFIG",
      providerId: "generic-tracker",
      config: { endpointHost: "https://t.example" },
    });
    state = wizardReducer(state, {
      type: "UPDATE_PROVIDER_CONFIG",
      providerId: "generic-githost",
      config: { gitUrl: "https://g.example" },
    });
    state = verified(state, "tracker");
    state = verified(state, "gitHost");

    // Editing the tracker's provider moves neither the git host's
    // configuration nor its verification.
    state = wizardReducer(state, {
      type: "UPDATE_PROVIDER_CONFIG",
      providerId: "generic-tracker",
      config: { endpointHost: "https://t2.example" },
    });

    expect(state.connect.tracker.verified).toBe(false);
    expect(state.connect.gitHost.verified).toBe(true);
    expect(providerConfig(state.connect, "generic-githost")).toEqual({
      gitUrl: "https://g.example",
    });
    expect(roleConfig(state.connect, "gitHost")).toEqual({
      gitUrl: "https://g.example",
    });
  });

  it("drops the configuration of a provider no role references any more", () => {
    let state = sharedProviderState();
    expect(Object.keys(state.connect.providerConfigs)).toEqual(["dual"]);

    state = wizardReducer(state, {
      type: "SELECT_PROVIDER",
      role: "gitHost",
      providerId: "other-githost",
    });
    expect(Object.keys(state.connect.providerConfigs).sort()).toEqual([
      "dual",
      "other-githost",
    ]);

    state = wizardReducer(state, {
      type: "SELECT_PROVIDER",
      role: "tracker",
      providerId: null,
    });
    expect(Object.keys(state.connect.providerConfigs)).toEqual([
      "other-githost",
    ]);
  });

  it("applies a Quick-URL match to every role the provider serves, on the provider's ONE configuration", () => {
    let state = createInitialWizardState();
    state = wizardReducer(state, {
      type: "SELECT_PROVIDER",
      role: "tracker",
      providerId: "dual",
    });
    state = wizardReducer(state, {
      type: "UPDATE_PROVIDER_CONFIG",
      providerId: "dual",
      config: { orgUrl: "https://dev.example", project: "proj" },
    });
    state = wizardReducer(state, {
      type: "SELECT_PROVIDER",
      role: "gitHost",
      providerId: "generic-githost",
    });
    state = wizardReducer(state, {
      type: "UPDATE_PROVIDER_CONFIG",
      providerId: "generic-githost",
      config: { gitUrl: "https://g.example" },
    });
    state = verified(state, "tracker");
    state = verified(state, "gitHost");

    state = wizardReducer(state, {
      type: "APPLY_PROVIDER_MATCH",
      providerId: "dual",
      config: { project: "matched" },
      roles: ["tracker", "gitHost"],
      url: "https://dev.example/proj",
    });

    // Both roles now name the matched provider, on ONE configuration: the
    // provider's own values with the draft applied.
    expect(state.connect.tracker.providerId).toBe("dual");
    expect(state.connect.gitHost.providerId).toBe("dual");
    expect(Object.keys(state.connect.providerConfigs)).toEqual(["dual"]);
    expect(providerConfig(state.connect, "dual")).toEqual({
      orgUrl: "https://dev.example",
      project: "matched",
    });
    // The credentials on record changed, so neither role's verification stands.
    expect(state.connect.tracker.verified).toBe(false);
    expect(state.connect.gitHost.verified).toBe(false);
    expect(state.connect.quickUrl).toBe("https://dev.example/proj");
  });
});
