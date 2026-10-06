// test/inspection-rules.test.ts — Pure derived rules for the Inspection step
// (spec #133, ticket #146).
//
// The inspection record is never stored as a derived value: what was resolved,
// for which inputs, and whether it is still current are all derived at render
// time from the reducer's plain source state (#126). Tested as pure functions.

import { describe, expect, it } from "bun:test";
import {
  deriveInspectionStatus,
  inspectionInputsFingerprint,
  inspectionTargets,
} from "../src/frontend/wizard/state/inspectionRules.js";
import { createInitialWizardState } from "../src/frontend/wizard/state/wizardReducer.js";
import type {
  WizardInspectionState,
  WizardRepoConfig,
  WizardSourceState,
} from "../src/frontend/wizard/types.js";

const WORKSPACE = "/work/rocket";

function inputs(options: {
  workspacePath?: string;
  selectedRepoIds?: string[];
  repoConfigs?: Record<string, WizardRepoConfig>;
}) {
  return {
    workspacePath: options.workspacePath ?? WORKSPACE,
    selectedRepoIds: options.selectedRepoIds ?? ["repo-app"],
    repoConfigs: options.repoConfigs ?? {
      "repo-app": { role: "gitHost", roles: ["gitHost"] },
    },
  };
}

function stateWith(options: {
  workspacePath?: string;
  selectedRepoIds?: string[];
  repoConfigs?: Record<string, WizardRepoConfig>;
  inspection?: Partial<WizardInspectionState>;
}): WizardSourceState {
  const base = createInitialWizardState();
  return {
    ...base,
    step: 4,
    maxStepVisited: 4,
    basics: {
      ...base.basics,
      workspacePath: options.workspacePath ?? WORKSPACE,
    },
    repositories: {
      ...base.repositories,
      selectedRepoIds: options.selectedRepoIds ?? ["repo-app"],
      repoConfigs: options.repoConfigs ?? {
        "repo-app": { role: "gitHost", roles: ["gitHost"] },
      },
    },
    inspection: { acknowledged: false, ...(options.inspection ?? {}) },
  };
}

/** An inspection record resolved for `inputs`, as the step would record it. */
function recordFor(
  resolved: ReturnType<typeof inputs>,
  record: Partial<WizardInspectionState> = {},
): Partial<WizardInspectionState> {
  return {
    inputsFingerprint: inspectionInputsFingerprint(resolved),
    gitIdentity: { name: "Repo Owner", email: "owner@example.com" },
    unresolvedRepoIds: [],
    inspectedPath: WORKSPACE,
    ...record,
  };
}

describe("inspectionInputsFingerprint", () => {
  it("is stable for identical inputs and changes with ANY input that decides the identity", () => {
    const baseline = inputs({});
    const digest = inspectionInputsFingerprint(baseline);

    expect(digest).toStartWith("cfp_");
    expect(inspectionInputsFingerprint(inputs({}))).toBe(digest);

    // A different workspace root is read in a different directory.
    expect(
      inspectionInputsFingerprint(inputs({ workspacePath: "/work/other" })),
    ).not.toBe(digest);
    // A different selection, a different role tag, a different local path and
    // a different selection order are all different inspection inputs.
    expect(
      inspectionInputsFingerprint(
        inputs({ selectedRepoIds: ["repo-app", "repo-api"] }),
      ),
    ).not.toBe(digest);
    expect(
      inspectionInputsFingerprint(
        inputs({
          repoConfigs: {
            "repo-app": { role: "knowledge", roles: ["gitHost"] },
          },
        }),
      ),
    ).not.toBe(digest);
    expect(
      inspectionInputsFingerprint(
        inputs({
          repoConfigs: {
            "repo-app": {
              role: "gitHost",
              roles: ["gitHost"],
              localPath: "/work/checkouts/app",
            },
          },
        }),
      ),
    ).not.toBe(digest);
  });
});

describe("inspectionTargets", () => {
  it("groups the selection by the directory git is read in, preserving selection order", () => {
    expect(
      inspectionTargets(
        inputs({
          selectedRepoIds: ["repo-app", "repo-api"],
          repoConfigs: {
            "repo-app": { role: "gitHost" },
            "repo-api": { role: "gitHost" },
          },
        }),
      ),
    ).toEqual([{ path: WORKSPACE, repoIds: ["repo-app", "repo-api"] }]);
  });

  it("prefers a repository's own local path and keeps that repository alone there", () => {
    expect(
      inspectionTargets(
        inputs({
          selectedRepoIds: ["repo-app", "repo-api"],
          repoConfigs: {
            "repo-app": { role: "gitHost", localPath: "/checkouts/app" },
            "repo-api": { role: "gitHost" },
          },
        }),
      ),
    ).toEqual([
      { path: "/checkouts/app", repoIds: ["repo-app"] },
      { path: WORKSPACE, repoIds: ["repo-api"] },
    ]);
  });

  it("yields no target when the selection has no local path at all to read", () => {
    expect(
      inspectionTargets(
        inputs({ workspacePath: "   ", selectedRepoIds: ["repo-app"] }),
      ),
    ).toEqual([]);
    expect(inspectionTargets(inputs({ selectedRepoIds: [] }))).toEqual([]);
  });
});

describe("deriveInspectionStatus", () => {
  it("reports nothing resolved, nothing stale, before anything was inspected", () => {
    const status = deriveInspectionStatus(stateWith({}));

    expect(status.record).toBeNull();
    expect(status.identityResolved).toBe(false);
    expect(status.partial).toBe(false);
    expect(status.stale).toBe(false);
    expect(status.fingerprint).toBe(inspectionInputsFingerprint(inputs({})));
    expect(status.targets).toEqual([
      { path: WORKSPACE, repoIds: ["repo-app"] },
    ]);
  });

  it("reports a current record as resolved and not stale", () => {
    const status = deriveInspectionStatus(
      stateWith({ inspection: recordFor(inputs({})) }),
    );

    expect(status.identityResolved).toBe(true);
    expect(status.stale).toBe(false);
    expect(status.partial).toBe(false);
    expect(status.record?.gitIdentity).toEqual({
      name: "Repo Owner",
      email: "owner@example.com",
    });
  });

  it("reports the record stale when the selection or the workspace root changed after it was resolved", () => {
    const recorded = recordFor(inputs({}));

    expect(
      deriveInspectionStatus(
        stateWith({
          inspection: recorded,
          selectedRepoIds: ["repo-app", "repo-api"],
          repoConfigs: {
            "repo-app": { role: "gitHost" },
            "repo-api": { role: "gitHost" },
          },
        }),
      ).stale,
    ).toBe(true);

    expect(
      deriveInspectionStatus(
        stateWith({
          inspection: recorded,
          repoConfigs: {
            "repo-app": { role: "gitHost", localPath: "/checkouts/app" },
          },
        }),
      ).stale,
    ).toBe(true);

    expect(
      deriveInspectionStatus(
        stateWith({ inspection: recorded, workspacePath: "/work/other" }),
      ).stale,
    ).toBe(true);
  });

  it("reports a partial resolution when a selected repository resolved no identity", () => {
    const status = deriveInspectionStatus(
      stateWith({
        inspection: recordFor(inputs({}), {
          unresolvedRepoIds: ["repo-api"],
        }),
      }),
    );

    expect(status.identityResolved).toBe(true);
    expect(status.partial).toBe(true);
    expect(status.record?.unresolvedRepoIds).toEqual(["repo-api"]);
  });

  it("does not call an unresolved identity a partial resolution", () => {
    const status = deriveInspectionStatus(
      stateWith({
        inspection: {
          inputsFingerprint: inspectionInputsFingerprint(inputs({})),
          unresolvedRepoIds: ["repo-app"],
        },
      }),
    );

    expect(status.identityResolved).toBe(false);
    expect(status.partial).toBe(false);
  });

  it("does not call a record out of date when there is nothing left to inspect", () => {
    const status = deriveInspectionStatus(
      stateWith({
        inspection: recordFor(inputs({})),
        selectedRepoIds: [],
        repoConfigs: {},
      }),
    );

    expect(status.targets).toEqual([]);
    expect(status.stale).toBe(false);
  });
});
