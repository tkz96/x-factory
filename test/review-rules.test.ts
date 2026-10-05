// test/review-rules.test.ts — Pure derived rules for the Review step
// (spec #133, ticket #146).
//
// `isReviewReady` is derived at render time from the reducer's plain source
// state (#126): it is never stored, and there is no dismissal path — only
// re-verification and re-inspection clear a blocked reason. Tested as pure
// functions so the submit gate cannot drift from the reason the UI explains.

import { describe, expect, it } from "bun:test";
import { connectionConfigFingerprint } from "../src/frontend/lib/connection-fingerprint.js";
import { inspectionInputsFingerprint } from "../src/frontend/wizard/state/inspectionRules.js";
import {
  isReviewReady,
  type ReviewBlockedReason,
  reviewBlockedReasons,
} from "../src/frontend/wizard/state/reviewRules.js";
import { createInitialWizardState } from "../src/frontend/wizard/state/wizardReducer.js";
import type {
  WizardConnectionRoleState,
  WizardInspectionState,
  WizardRepoConfig,
  WizardSourceState,
} from "../src/frontend/wizard/types.js";

const WORKSPACE = "/work/rocket";
const GIT_HOST_CONFIG = { gitUrl: "https://git.example.com" };
const APPLICATION_REPO: Record<string, WizardRepoConfig> = {
  "repo-app": { role: "gitHost", roles: ["gitHost"] },
};

function verified(
  overrides: Partial<WizardConnectionRoleState> = {},
): WizardConnectionRoleState {
  return {
    providerId: "generic-githost",
    config: GIT_HOST_CONFIG,
    verified: true,
    degradedAccepted: false,
    unconfirmedCapabilities: [],
    ...overrides,
  };
}

function inspectionFor(
  overrides: Partial<WizardInspectionState> = {},
): WizardInspectionState {
  return {
    acknowledged: false,
    inputsFingerprint: inspectionInputsFingerprint({
      workspacePath: WORKSPACE,
      selectedRepoIds: ["repo-app"],
      repoConfigs: APPLICATION_REPO,
    }),
    gitIdentity: { name: "Repo Owner", email: "owner@example.com" },
    unresolvedRepoIds: [],
    inspectedPath: WORKSPACE,
    ...overrides,
  };
}

function readyState(): WizardSourceState {
  const base = createInitialWizardState();
  return {
    ...base,
    step: 5,
    maxStepVisited: 5,
    basics: { ...base.basics, workspacePath: WORKSPACE },
    connect: {
      ...base.connect,
      tracker: verified({ providerId: "generic-tracker", config: {} }),
      gitHost: verified(),
    },
    repositories: {
      selectedRepoIds: ["repo-app"],
      primaryRepoId: "repo-app",
      repoConfigs: APPLICATION_REPO,
      selectionFingerprint: connectionConfigFingerprint(
        "generic-githost",
        GIT_HOST_CONFIG,
      ),
    },
    inspection: inspectionFor(),
  };
}

function stateWith(
  patch: Partial<Pick<WizardSourceState, "connect" | "repositories">> & {
    inspection?: Partial<WizardInspectionState>;
  },
): WizardSourceState {
  const ready = readyState();
  return {
    ...ready,
    ...(patch.connect ? { connect: patch.connect } : {}),
    ...(patch.repositories ? { repositories: patch.repositories } : {}),
    inspection: patch.inspection
      ? { ...ready.inspection, ...patch.inspection }
      : ready.inspection,
  };
}

describe("isReviewReady", () => {
  it("is true only when both connections are usable, the selection is an application selection under the current connection, and the identity is resolved for those inputs", () => {
    expect(isReviewReady(readyState())).toBe(true);
    expect(reviewBlockedReasons(readyState())).toEqual([]);
  });

  it("accepts a degraded connection only once its warnings are explicitly accepted", () => {
    const degraded = stateWith({
      connect: {
        quickUrl: "",
        tracker: verified({
          providerId: "generic-tracker",
          config: {},
          unconfirmedCapabilities: ["listTickets"],
        }),
        gitHost: verified({ degradedAccepted: true }),
      },
    });

    expect(reviewBlockedReasons(degraded)).toEqual([
      "trackerDegradedUnaccepted",
    ]);
    expect(isReviewReady(degraded)).toBe(false);

    const accepted = stateWith({
      connect: {
        quickUrl: "",
        tracker: verified({
          providerId: "generic-tracker",
          config: {},
          degradedAccepted: true,
          unconfirmedCapabilities: ["listTickets"],
        }),
        gitHost: verified({ degradedAccepted: true }),
      },
    });

    expect(isReviewReady(accepted)).toBe(true);
  });

  it("blocks an unverified or unselected connection, naming the role", () => {
    expect(
      reviewBlockedReasons(
        stateWith({
          connect: {
            quickUrl: "",
            tracker: verified({ providerId: null, verified: false }),
            gitHost: verified(),
          },
        }),
      ),
    ).toEqual(["trackerUnverified"]);

    expect(
      reviewBlockedReasons(
        stateWith({
          connect: {
            quickUrl: "",
            tracker: verified({ providerId: "generic-tracker", config: {} }),
            gitHost: verified({ verified: false }),
          },
        }),
      ),
    ).toEqual(["gitHostUnverified"]);
  });

  it("blocks a selection with no application repository, or one made under a connection that has since changed", () => {
    expect(
      reviewBlockedReasons(
        stateWith({
          repositories: {
            ...readyState().repositories,
            selectedRepoIds: [],
            primaryRepoId: null,
            repoConfigs: {},
            selectionFingerprint: null,
          },
        }),
      ),
    ).toEqual(["noApplicationRepository", "inspectionStale"]);

    // Same repository, selected under a different git-host configuration: the
    // SELECTION is out of date. The identity was still read from the same
    // directory for the same repositories, so its inputs are unchanged — the
    // selection reason alone blocks the submit.
    const reconnected = stateWith({
      connect: {
        quickUrl: "",
        tracker: verified({ providerId: "generic-tracker", config: {} }),
        gitHost: verified({
          config: { gitUrl: "https://other.example.com" },
        }),
      },
    });
    expect(reviewBlockedReasons(reconnected)).toEqual(["selectionStale"]);
    expect(isReviewReady(reconnected)).toBe(false);
  });

  it("blocks until the identity was inspected for the CURRENT inputs, and says which of the two it is", () => {
    expect(
      reviewBlockedReasons(
        stateWith({
          inspection: {
            inputsFingerprint: null,
            gitIdentity: undefined,
            unresolvedRepoIds: [],
            inspectedPath: undefined,
          },
        }),
      ),
    ).toEqual(["inspectionMissing", "identityUnresolved"]);

    // Resolved, then the workspace root moved: the record is out of date.
    expect(
      reviewBlockedReasons(
        stateWith({
          inspection: inspectionFor({
            inputsFingerprint: inspectionInputsFingerprint({
              workspacePath: "/work/other",
              selectedRepoIds: ["repo-app"],
              repoConfigs: APPLICATION_REPO,
            }),
          }),
        }),
      ),
    ).toEqual(["inspectionStale"]);
  });

  it("blocks an unresolved identity and an identity resolved for only some repositories", () => {
    expect(
      reviewBlockedReasons(
        stateWith({
          inspection: {
            gitIdentity: undefined,
            unresolvedRepoIds: ["repo-app"],
          },
        }),
      ),
    ).toEqual(["identityUnresolved"]);

    expect(
      reviewBlockedReasons(
        stateWith({ inspection: { unresolvedRepoIds: ["repo-api"] } }),
      ),
    ).toEqual(["identityPartial"]);
  });

  it("lists every reason at once, in a stable order, so the explanation is complete", () => {
    const blocked = stateWith({
      connect: {
        quickUrl: "",
        tracker: verified({ providerId: null, verified: false }),
        gitHost: verified({ verified: false }),
      },
      repositories: {
        ...readyState().repositories,
        selectedRepoIds: [],
        primaryRepoId: null,
        repoConfigs: {},
        selectionFingerprint: null,
      },
      inspection: {
        inputsFingerprint: null,
        gitIdentity: undefined,
        unresolvedRepoIds: [],
        inspectedPath: undefined,
      },
    });

    const reasons: ReviewBlockedReason[] = reviewBlockedReasons(blocked);
    expect(reasons).toEqual([
      "trackerUnverified",
      "gitHostUnverified",
      "noApplicationRepository",
      "inspectionMissing",
      "identityUnresolved",
    ]);
    expect(isReviewReady(blocked)).toBe(false);
  });
});
