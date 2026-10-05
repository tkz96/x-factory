// test/wizard-draft-inspection.test.ts — The inspection section of a persisted
// draft at its trust boundary (spec #133, tickets #142/#146).
//
// The draft is untrusted input: the validator must accept the inspection shape
// the wizard writes, and a malformed one must discard the whole draft rather
// than restore a half-believed record. Whatever is accepted is then sanitized:
// verification results and the resolved identity are never restored, so a
// reloaded wizard is stale-blocked by construction.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import {
  clearWizardDraft,
  loadWizardDraft,
  saveWizardDraft,
} from "../src/frontend/wizard/storage.js";
import type { WizardSourceState } from "../src/frontend/wizard/types.js";

const DRAFT_KEY = "xf_wizard_draft_v1";

function stepFiveState(): WizardSourceState {
  return {
    step: 5,
    maxStepVisited: 5,
    basics: {
      name: "Rocket",
      id: "rocket",
      description: "",
      workspacePath: "/work/rocket",
    },
    connect: {
      quickUrl: "",
      tracker: {
        providerId: "generic-tracker",
        config: {},
        verified: true,
      },
      gitHost: {
        providerId: "generic-githost",
        config: { gitUrl: "https://git.example.com", token: "tok-secret" },
        verified: true,
      },
    },
    repositories: {
      selectedRepoIds: ["repo-app"],
      primaryRepoId: "repo-app",
      repoConfigs: { "repo-app": { role: "gitHost", roles: ["gitHost"] } },
      selectionFingerprint: "cfp_recorded",
    },
    inspection: {
      acknowledged: true,
      gitIdentity: { name: "Repo Owner", email: "owner@example.com" },
      unresolvedRepoIds: [],
      inspectedPath: "/work/rocket",
      inputsFingerprint: "cfp_inspected",
    },
    review: { confirmed: true },
  };
}

/** Writes a raw envelope, bypassing the sanitiser, to craft an untrusted draft. */
function writeRawEnvelope(state: unknown): void {
  window.localStorage.setItem(
    DRAFT_KEY,
    JSON.stringify({ version: 1, savedAt: new Date().toISOString(), state }),
  );
}

describe("Persisted draft — inspection section", () => {
  beforeEach(() => {
    clearWizardDraft();
  });

  afterEach(() => {
    clearWizardDraft();
  });

  afterAll(async () => {
    await unregisterHappyDom();
  });

  it("drops the resolved identity and the verification results on save, so a restored draft is stale-blocked", () => {
    saveWizardDraft(stepFiveState());

    const raw = window.localStorage.getItem(DRAFT_KEY) ?? "";
    // Nothing secret and no verification evidence reaches the draft.
    expect(raw).not.toContain("tok-secret");
    const persisted = JSON.parse(raw) as { state: WizardSourceState };
    expect(persisted.state.inspection.gitIdentity).toBeUndefined();
    expect(persisted.state.inspection.inputsFingerprint).toBeUndefined();
    expect(persisted.state.connect.gitHost.verified).toBe(false);

    const restored = loadWizardDraft();
    expect(restored?.inspection.gitIdentity).toBeUndefined();
    expect(restored?.inspection.inputsFingerprint).toBeUndefined();
    expect(restored?.connect.gitHost.verified).toBe(false);
    // The project-level inputs the user typed are still there.
    expect(restored?.repositories.selectedRepoIds).toEqual(["repo-app"]);
    expect(restored?.basics.workspacePath).toBe("/work/rocket");
  });

  it("accepts a well-formed inspection record from storage, then sanitizes it away", () => {
    writeRawEnvelope(stepFiveState());

    const restored = loadWizardDraft();

    expect(restored).not.toBeNull();
    expect(restored?.inspection.acknowledged).toBe(false);
    expect(restored?.inspection.gitIdentity).toBeUndefined();
  });

  it("discards a draft whose inspection record is malformed instead of half-restoring it", () => {
    writeRawEnvelope({
      ...stepFiveState(),
      inspection: {
        acknowledged: true,
        gitIdentity: { name: 42, email: "owner@example.com" },
      },
    });

    expect(loadWizardDraft()).toBeNull();
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("discards a draft whose unresolved-repository list is malformed", () => {
    writeRawEnvelope({
      ...stepFiveState(),
      inspection: { acknowledged: false, unresolvedRepoIds: ["repo-app", 7] },
    });

    expect(loadWizardDraft()).toBeNull();
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});
