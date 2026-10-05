/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { createInitialWizardState } from "../src/frontend/wizard/state/wizardReducer.js";
import {
  clearWizardDraft,
  loadWizardDraft,
  saveWizardDraft,
} from "../src/frontend/wizard/storage.js";
import {
  WIZARD_SCHEMA_VERSION,
  type WizardSourceState,
} from "../src/frontend/wizard/types.js";

describe("Wizard Client Drafts & Storage (Client-only, Safe-Discard, Zero Secrets)", () => {
  afterAll(async () => {
    await unregisterHappyDom();
  });
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists a versioned draft envelope with timestamp and state", () => {
    const state = createInitialWizardState();
    state.basics.name = "My Project";
    state.basics.id = "my-project";
    state.step = 2;
    state.maxStepVisited = 2;

    const saved = saveWizardDraft(state);
    expect(saved).toBe(true);

    const raw = window.localStorage.getItem("xf_wizard_draft_v1");
    expect(raw).not.toBeNull();

    const parsed = JSON.parse(raw || "{}");
    expect(parsed.version).toBe(WIZARD_SCHEMA_VERSION);
    expect(typeof parsed.savedAt).toBe("string");
    expect(parsed.state.basics.name).toBe("My Project");
    expect(parsed.state.basics.id).toBe("my-project");
    expect(parsed.state.step).toBe(2);
  });

  it("loads a valid saved draft successfully", () => {
    const state = createInitialWizardState();
    state.basics.name = "Restored Project";
    state.basics.id = "restored-project";
    state.basics.workspacePath = "/workspace/path";
    saveWizardDraft(state);

    const loaded = loadWizardDraft();
    expect(loaded).not.toBeNull();
    expect(loaded?.basics.name).toBe("Restored Project");
    expect(loaded?.basics.id).toBe("restored-project");
    expect(loaded?.basics.workspacePath).toBe("/workspace/path");
  });

  it("safely discards drafts referencing a stale or incompatible schema version", () => {
    // Write an envelope with a stale schema version (e.g. 0 or 999)
    const staleEnvelope = {
      version: 999,
      savedAt: new Date().toISOString(),
      state: createInitialWizardState(),
    };
    window.localStorage.setItem(
      "xf_wizard_draft_v1",
      JSON.stringify(staleEnvelope),
    );

    const loaded = loadWizardDraft();
    expect(loaded).toBeNull();

    // Key must have been discarded safely from localStorage
    expect(window.localStorage.getItem("xf_wizard_draft_v1")).toBeNull();
  });

  it("safely discards corrupted or unparseable JSON without throwing", () => {
    window.localStorage.setItem("xf_wizard_draft_v1", "{ not-valid-json ]");

    const loaded = loadWizardDraft();
    expect(loaded).toBeNull();
    expect(window.localStorage.getItem("xf_wizard_draft_v1")).toBeNull();
  });

  it("safely discards envelopes with missing or malformed state", () => {
    window.localStorage.setItem(
      "xf_wizard_draft_v1",
      JSON.stringify({ version: WIZARD_SCHEMA_VERSION, state: null }),
    );

    const loaded = loadWizardDraft();
    expect(loaded).toBeNull();
    expect(window.localStorage.getItem("xf_wizard_draft_v1")).toBeNull();
  });

  it("discards drafts whose nested sections are structurally malformed", () => {
    const valid = createInitialWizardState();
    const malformedStates: Array<[string, unknown]> = [
      ["connect section missing", { ...valid, connect: null }],
      [
        "connect.tracker missing",
        { ...valid, connect: { ...valid.connect, tracker: null } },
      ],
      [
        "connect.gitHost.providerId wrong type",
        {
          ...valid,
          connect: {
            ...valid.connect,
            gitHost: { providerId: 42, config: {} },
          },
        },
      ],
      [
        "connect.tracker.config wrong type",
        {
          ...valid,
          connect: {
            ...valid.connect,
            tracker: { providerId: "github", config: "not-an-object" },
          },
        },
      ],
      ["repositories section missing", { ...valid, repositories: undefined }],
      [
        "repositories.selectedRepoIds wrong type",
        {
          ...valid,
          repositories: { ...valid.repositories, selectedRepoIds: "repo-1" },
        },
      ],
      [
        "repositories.selectedRepoIds holds non-strings",
        {
          ...valid,
          repositories: {
            ...valid.repositories,
            selectedRepoIds: [1, 2],
          },
        },
      ],
      [
        "basics.name wrong type",
        { ...valid, basics: { ...valid.basics, name: 42 } },
      ],
      ["basics missing", { ...valid, basics: undefined }],
      ["step out of range", { ...valid, step: 9 }],
      ["step not a number", { ...valid, step: "two" }],
      [
        "step beyond maxStepVisited (5 > 1)",
        { ...valid, step: 5, maxStepVisited: 1 },
      ],
      [
        "step beyond maxStepVisited (3 > 2)",
        { ...valid, step: 3, maxStepVisited: 2 },
      ],
      ["maxStepVisited out of range", { ...valid, maxStepVisited: 0 }],
      [
        "connect.tracker.verified wrong type",
        {
          ...valid,
          connect: {
            ...valid.connect,
            tracker: { ...valid.connect.tracker, verified: "yes" },
          },
        },
      ],
      [
        "connect.gitHost.verified wrong type",
        {
          ...valid,
          connect: {
            ...valid.connect,
            gitHost: { ...valid.connect.gitHost, verified: 1 },
          },
        },
      ],
      [
        "repoConfigs value is not an object",
        {
          ...valid,
          repositories: {
            ...valid.repositories,
            repoConfigs: { "repo-1": 123 },
          },
        },
      ],
      [
        "repoConfigs value missing role",
        {
          ...valid,
          repositories: {
            ...valid.repositories,
            repoConfigs: { "repo-1": { localPath: "/work/repo-1" } },
          },
        },
      ],
      [
        "repoConfigs value has wrong localPath type",
        {
          ...valid,
          repositories: {
            ...valid.repositories,
            repoConfigs: { "repo-1": { role: "primary", localPath: 42 } },
          },
        },
      ],
      [
        "repoConfigs value has wrong primary type",
        {
          ...valid,
          repositories: {
            ...valid.repositories,
            repoConfigs: { "repo-1": { role: "primary", primary: "true" } },
          },
        },
      ],
      [
        "inspection.acknowledged wrong type",
        { ...valid, inspection: { acknowledged: "yes" } },
      ],
    ];

    for (const [label, state] of malformedStates) {
      window.localStorage.setItem(
        "xf_wizard_draft_v1",
        JSON.stringify({
          version: WIZARD_SCHEMA_VERSION,
          savedAt: new Date().toISOString(),
          state,
        }),
      );

      expect(loadWizardDraft(), `should discard draft: ${label}`).toBeNull();
      expect(
        window.localStorage.getItem("xf_wizard_draft_v1"),
        `should remove stored draft: ${label}`,
      ).toBeNull();
    }
  });

  it("clears the draft on clearWizardDraft()", () => {
    const state = createInitialWizardState();
    saveWizardDraft(state);
    expect(window.localStorage.getItem("xf_wizard_draft_v1")).not.toBeNull();

    clearWizardDraft();
    expect(window.localStorage.getItem("xf_wizard_draft_v1")).toBeNull();
  });

  it("CRITICAL SECURITY INVARIANT: never writes secrets or envKey to the draft", () => {
    const state: WizardSourceState = {
      ...createInitialWizardState(),
      connect: {
        quickUrl: "https://dev.azure.com/myorg/myproj",
        tracker: {
          providerId: "azure",
          config: {
            orgUrl: "https://dev.azure.com/myorg",
            project: "myproj",
            pat: "super-secret-pat-token-value-12345",
            token: "secret-token-xyz",
            password: "super-password",
            secretField: "classified",
            envKey: "AZURE_DEVOPS_PAT",
          },
          verified: true,
        },
        gitHost: {
          providerId: "github",
          config: {
            owner: "myorg",
            repo: "myrepo",
            apiKey: "secret-api-key-999",
            credentials: { authSecret: "classified-bearer" },
          },
          verified: true,
        },
      },
    };

    saveWizardDraft(state);

    const raw = window.localStorage.getItem("xf_wizard_draft_v1") || "";
    expect(raw).toBeDefined();

    // Ensure raw JSON contains ZERO trace of secrets, PATs, tokens, passwords, or envKey
    expect(raw).not.toContain("super-secret-pat-token-value-12345");
    expect(raw).not.toContain("secret-token-xyz");
    expect(raw).not.toContain("super-password");
    expect(raw).not.toContain("secret-api-key-999");
    expect(raw).not.toContain("classified-bearer");
    expect(raw).not.toContain("AZURE_DEVOPS_PAT");
    expect(raw).not.toContain('"pat"');
    expect(raw).not.toContain('"token"');
    expect(raw).not.toContain('"password"');
    expect(raw).not.toContain('"apiKey"');
    expect(raw).not.toContain('"envKey"');

    // Non-secret fields must still survive
    const loaded = loadWizardDraft();
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    expect(loaded.connect.tracker.config.project).toBe("myproj");
    expect(loaded.connect.gitHost.config.repo).toBe("myrepo");
    // Verification flags must be restored as unverified/stale per #130 stale rule
    expect(loaded.connect.tracker.verified).toBe(false);
    expect(loaded.connect.gitHost.verified).toBe(false);
  });

  it("accepts a draft whose optional nested structures are well-formed", () => {
    const state: WizardSourceState = {
      ...createInitialWizardState(),
      step: 3,
      maxStepVisited: 4,
      connect: {
        quickUrl: "https://dev.azure.com/myorg/myproj",
        tracker: {
          providerId: "azure",
          config: { orgUrl: "https://dev.azure.com/myorg", project: "myproj" },
          verified: true,
        },
        gitHost: {
          providerId: "github",
          config: { owner: "myorg", repo: "myrepo" },
          verified: false,
        },
      },
      repositories: {
        selectedRepoIds: ["repo-1", "repo-2"],
        primaryRepoId: "repo-1",
        repoConfigs: {
          "repo-1": {
            role: "primary",
            localPath: "/work/repo-1",
            primary: true,
          },
          "repo-2": { role: "secondary" },
        },
      },
    };

    expect(saveWizardDraft(state)).toBe(true);

    const loaded = loadWizardDraft();
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    expect(loaded.step).toBe(3);
    expect(loaded.maxStepVisited).toBe(4);
    // Verified flags are intentionally reset to stale on restore (#130 rule)
    expect(loaded.connect.tracker.verified).toBe(false);
    expect(loaded.repositories.selectedRepoIds).toEqual(["repo-1", "repo-2"]);
    expect(loaded.repositories.primaryRepoId).toBe("repo-1");
    expect(loaded.repositories.repoConfigs["repo-1"]).toEqual({
      role: "primary",
      localPath: "/work/repo-1",
      primary: true,
    });
    expect(loaded.repositories.repoConfigs["repo-2"]).toEqual({
      role: "secondary",
    });
  });

  it("SECURITY: strips secrets nested inside arrays and deep objects", () => {
    const state: WizardSourceState = {
      ...createInitialWizardState(),
      connect: {
        quickUrl: "https://dev.azure.com/myorg/myproj",
        tracker: {
          providerId: "azure",
          config: {
            orgUrl: "https://dev.azure.com/myorg",
            // Sensitive-looking keys nested inside an ARRAY of objects
            endpoints: [
              {
                signingKey: "zz-nested-signing-material-42",
                label: "primary",
              },
              { clientSecret: "zz-nested-client-secret-42", label: "failover" },
            ],
            // ...and inside a deeper object
            layers: {
              inner: { privateCredential: "zz-deep-credential-42" },
            },
          },
          verified: true,
        },
        gitHost: {
          providerId: "github",
          config: { owner: "myorg", repo: "myrepo" },
          verified: true,
        },
      },
    };

    saveWizardDraft(state);

    const raw = window.localStorage.getItem("xf_wizard_draft_v1") || "";

    // No secret VALUE survives, at any depth
    expect(raw).not.toContain("zz-nested-signing-material-42");
    expect(raw).not.toContain("zz-nested-client-secret-42");
    expect(raw).not.toContain("zz-deep-credential-42");
    // No secret KEY survives either
    expect(raw).not.toContain("signingKey");
    expect(raw).not.toContain("clientSecret");
    expect(raw).not.toContain("privateCredential");

    // The surrounding non-secret structure (incl. the array itself) survives
    const loaded = loadWizardDraft();
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    const endpoints = loaded.connect.tracker.config.endpoints as Array<
      Record<string, unknown>
    >;
    expect(Array.isArray(endpoints)).toBe(true);
    expect(endpoints).toHaveLength(2);
    expect(endpoints[0]?.label).toBe("primary");
    expect(endpoints[1]?.label).toBe("failover");
    expect(
      (loaded.connect.tracker.config.layers as Record<string, unknown>)?.inner,
    ).toBeDefined();
  });

  it("validates degradedAccepted in connection role state (boolean/absent accepted, string/number rejected)", () => {
    const valid = createInitialWizardState();
    valid.connect.tracker.degradedAccepted = true;
    valid.connect.gitHost.degradedAccepted = false;
    expect(saveWizardDraft(valid)).toBe(true);
    expect(loadWizardDraft()).not.toBeNull();

    // Absent degradedAccepted is also valid
    const absent = createInitialWizardState();
    delete (absent.connect.tracker as unknown as Record<string, unknown>)
      .degradedAccepted;
    expect(saveWizardDraft(absent)).toBe(true);
    expect(loadWizardDraft()).not.toBeNull();

    // String degradedAccepted is rejected
    const malformedString = createInitialWizardState();
    (
      malformedString.connect.tracker as unknown as Record<string, unknown>
    ).degradedAccepted = "true";
    window.localStorage.setItem(
      "xf_wizard_draft_v1",
      JSON.stringify({
        version: WIZARD_SCHEMA_VERSION,
        savedAt: new Date().toISOString(),
        state: malformedString,
      }),
    );
    expect(loadWizardDraft()).toBeNull();

    // Number degradedAccepted is rejected
    const malformedNumber = createInitialWizardState();
    (
      malformedNumber.connect.gitHost as unknown as Record<string, unknown>
    ).degradedAccepted = 1;
    window.localStorage.setItem(
      "xf_wizard_draft_v1",
      JSON.stringify({
        version: WIZARD_SCHEMA_VERSION,
        savedAt: new Date().toISOString(),
        state: malformedNumber,
      }),
    );
    expect(loadWizardDraft()).toBeNull();
  });
});
