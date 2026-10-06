/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import type { ProviderDescriptor } from "../src/frontend/connection/types.js";
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

const azureGithubDescriptors: ProviderDescriptor[] = [
  {
    id: "azure",
    displayName: "Azure DevOps",
    roles: ["tracker"],
    iconRef: "icon-azure",
    capabilities: [],
    configFields: [
      { name: "orgUrl", label: "Org URL", type: "url", required: true },
      { name: "project", label: "Project", type: "text", required: true },
      {
        name: "pat",
        label: "PAT",
        type: "secret",
        required: true,
        secret: true,
      },
      {
        name: "token",
        label: "Token",
        type: "secret",
        required: false,
        secret: true,
      },
      {
        name: "password",
        label: "Password",
        type: "secret",
        required: false,
        secret: true,
      },
      {
        name: "secretField",
        label: "Secret Field",
        type: "secret",
        required: false,
        secret: true,
      },
    ],
  },
  {
    id: "github",
    displayName: "GitHub",
    roles: ["gitHost"],
    iconRef: "icon-github",
    capabilities: [],
    configFields: [
      { name: "owner", label: "Owner", type: "text", required: true },
      { name: "repo", label: "Repo", type: "text", required: true },
      {
        name: "apiKey",
        label: "API Key",
        type: "secret",
        required: false,
        secret: true,
      },
    ],
  },
];

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
            gitHost: { providerId: 42 },
          },
        },
      ],
      [
        "connect.providerConfigs wrong type",
        {
          ...valid,
          connect: {
            ...valid.connect,
            providerConfigs: { github: "not-an-object" },
          },
        },
      ],
      [
        "connect.providerConfigs missing",
        {
          ...valid,
          connect: {
            quickUrl: "",
            tracker: { providerId: null },
            gitHost: { providerId: null },
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
        // ONE configuration per provider (correction 2, #133), both of which
        // carry secrets that must not survive sanitization.
        providerConfigs: {
          azure: {
            orgUrl: "https://dev.azure.com/myorg",
            project: "myproj",
            pat: "super-secret-pat-token-value-12345",
            token: "secret-token-xyz",
            password: "super-password",
            secretField: "classified",
            envKey: "AZURE_DEVOPS_PAT",
          },
          github: {
            owner: "myorg",
            repo: "myrepo",
            apiKey: "secret-api-key-999",
            credentials: { authSecret: "classified-bearer" },
          },
        },
        tracker: {
          providerId: "azure",
          verified: true,
        },
        gitHost: {
          providerId: "github",
          verified: true,
        },
      },
    };

    saveWizardDraft(state, azureGithubDescriptors);

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
    const loaded = loadWizardDraft(azureGithubDescriptors);
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    expect(loaded.connect.providerConfigs.azure?.project).toBe("myproj");
    expect(loaded.connect.providerConfigs.github?.repo).toBe("myrepo");
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
        providerConfigs: {
          azure: {
            orgUrl: "https://dev.azure.com/myorg",
            project: "myproj",
          },
          github: { owner: "myorg", repo: "myrepo" },
        },
        tracker: {
          providerId: "azure",
          verified: true,
        },
        gitHost: {
          providerId: "github",
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
        providerConfigs: {
          azure: {
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
          github: { owner: "myorg", repo: "myrepo" },
        },
        tracker: {
          providerId: "azure",
          verified: true,
        },
        gitHost: {
          providerId: "github",
          verified: true,
        },
      },
    };

    saveWizardDraft(state, azureGithubDescriptors);

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
    const loaded = loadWizardDraft(azureGithubDescriptors);
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    const endpoints = loaded.connect.providerConfigs.azure?.endpoints as Array<
      Record<string, unknown>
    >;
    expect(Array.isArray(endpoints)).toBe(true);
    expect(endpoints).toHaveLength(2);
    expect(endpoints[0]?.label).toBe("primary");
    expect(endpoints[1]?.label).toBe("failover");
    expect(
      (loaded.connect.providerConfigs.azure?.layers as Record<string, unknown>)
        ?.inner,
    ).toBeDefined();
  });

  describe("Provider-Authoritative Secret Sanitization (#133 / Task 3)", () => {
    const customDescriptor: ProviderDescriptor = {
      id: "custom-provider",
      displayName: "Custom Provider",
      roles: ["tracker", "gitHost"],
      iconRef: "icon-custom",
      capabilities: [],
      configFields: [
        { name: "endpoint", label: "Endpoint", type: "url", required: true },
        // Innocuous secret field name
        {
          name: "accessCode",
          label: "Access Code",
          type: "secret",
          required: true,
        },
        // Non-secret fields with suspicious-looking names
        {
          name: "tokenType",
          label: "Token Type",
          type: "text",
          required: false,
          secret: false,
        },
        {
          name: "authMethod",
          label: "Auth Method",
          type: "text",
          required: false,
        },
        {
          name: "keyPrefix",
          label: "Key Prefix",
          type: "text",
          required: false,
        },
      ],
    };

    it("strips innocuous secret field names (e.g. accessCode) when declared secret in provider descriptor", () => {
      const state: WizardSourceState = {
        ...createInitialWizardState(),
        connect: {
          quickUrl: "",
          providerConfigs: {
            "custom-provider": {
              endpoint: "https://api.custom.com",
              accessCode: "secret-access-code-value-12345",
            },
          },
          tracker: { providerId: "custom-provider", verified: true },
          gitHost: { providerId: null, verified: false },
        },
      };

      saveWizardDraft(state, [customDescriptor]);

      const raw = window.localStorage.getItem("xf_wizard_draft_v1") || "";
      expect(raw).not.toContain("secret-access-code-value-12345");
      expect(raw).not.toContain('"accessCode"');
      expect(raw).toContain("https://api.custom.com");

      const loaded = loadWizardDraft([customDescriptor]);
      expect(loaded).not.toBeNull();
      expect(loaded?.connect.providerConfigs["custom-provider"]?.endpoint).toBe(
        "https://api.custom.com",
      );
      expect(
        loaded?.connect.providerConfigs["custom-provider"]?.accessCode,
      ).toBeUndefined();
    });

    it("strips nested innocuous secrets at arbitrary depth based on provider metadata", () => {
      const state: WizardSourceState = {
        ...createInitialWizardState(),
        connect: {
          quickUrl: "",
          providerConfigs: {
            "custom-provider": {
              endpoint: "https://api.custom.com",
              serviceConfig: {
                accessCode: "nested-deep-secret-code-999",
                region: "us-east-1",
              },
            },
          },
          tracker: { providerId: "custom-provider", verified: true },
          gitHost: { providerId: null, verified: false },
        },
      };

      saveWizardDraft(state, [customDescriptor]);

      const raw = window.localStorage.getItem("xf_wizard_draft_v1") || "";
      expect(raw).not.toContain("nested-deep-secret-code-999");
      expect(raw).not.toContain('"accessCode"');
      expect(raw).toContain("us-east-1");

      const loaded = loadWizardDraft([customDescriptor]);
      const nested = loaded?.connect.providerConfigs["custom-provider"]
        ?.serviceConfig as Record<string, unknown>;
      expect(nested?.region).toBe("us-east-1");
      expect(nested?.accessCode).toBeUndefined();
    });

    it("sanitizes arrays containing secret-bearing objects (both innocuous and conventional secrets)", () => {
      const state: WizardSourceState = {
        ...createInitialWizardState(),
        connect: {
          quickUrl: "",
          providerConfigs: {
            "custom-provider": {
              endpoint: "https://api.custom.com",
              endpointsList: [
                {
                  id: "item-1",
                  accessCode: "array-innocuous-secret-111",
                },
                {
                  id: "item-2",
                  privateKey: "array-conventional-secret-222",
                },
              ],
            },
          },
          tracker: { providerId: "custom-provider", verified: true },
          gitHost: { providerId: null, verified: false },
        },
      };

      saveWizardDraft(state, [customDescriptor]);

      const raw = window.localStorage.getItem("xf_wizard_draft_v1") || "";
      expect(raw).not.toContain("array-innocuous-secret-111");
      expect(raw).not.toContain("array-conventional-secret-222");
      expect(raw).not.toContain('"accessCode"');
      expect(raw).not.toContain('"privateKey"');
      expect(raw).toContain('"item-1"');
      expect(raw).toContain('"item-2"');

      const loaded = loadWizardDraft([customDescriptor]);
      const list = loaded?.connect.providerConfigs["custom-provider"]
        ?.endpointsList as Array<Record<string, unknown>>;
      expect(Array.isArray(list)).toBe(true);
      expect(list).toHaveLength(2);
      expect(list[0]?.id).toBe("item-1");
      expect(list[0]?.accessCode).toBeUndefined();
      expect(list[1]?.id).toBe("item-2");
      expect(list[1]?.privateKey).toBeUndefined();
    });

    it("preserves non-secret fields with suspicious names (e.g. tokenType, authMethod, keyPrefix) when declared non-secret", () => {
      const state: WizardSourceState = {
        ...createInitialWizardState(),
        connect: {
          quickUrl: "",
          providerConfigs: {
            "custom-provider": {
              endpoint: "https://api.custom.com",
              tokenType: "Bearer",
              authMethod: "oauth2_pkce",
              keyPrefix: "pk_live_prefix_",
            },
          },
          tracker: { providerId: "custom-provider", verified: true },
          gitHost: { providerId: null, verified: false },
        },
      };

      saveWizardDraft(state, [customDescriptor]);

      const raw = window.localStorage.getItem("xf_wizard_draft_v1") || "";
      expect(raw).toContain('"tokenType":"Bearer"');
      expect(raw).toContain('"authMethod":"oauth2_pkce"');
      expect(raw).toContain('"keyPrefix":"pk_live_prefix_"');

      const loaded = loadWizardDraft([customDescriptor]);
      const config = loaded?.connect.providerConfigs["custom-provider"];
      expect(config?.tokenType).toBe("Bearer");
      expect(config?.authMethod).toBe("oauth2_pkce");
      expect(config?.keyPrefix).toBe("pk_live_prefix_");
    });

    it("strips conventional secret names (token, pat, password, secret) even if not explicitly in provider descriptor", () => {
      const minimalDescriptor: ProviderDescriptor = {
        id: "minimal-provider",
        displayName: "Minimal Provider",
        roles: ["tracker"],
        iconRef: "icon-min",
        capabilities: [],
        configFields: [
          { name: "endpoint", label: "Endpoint", type: "url", required: true },
        ],
      };

      const state: WizardSourceState = {
        ...createInitialWizardState(),
        connect: {
          quickUrl: "",
          providerConfigs: {
            "minimal-provider": {
              endpoint: "https://min.example.com",
              token: "undeclared-token-value",
              pat: "undeclared-pat-value",
              password: "undeclared-password-value",
              clientSecret: "undeclared-secret-value",
              apiKey: "undeclared-key-value",
              credential: "undeclared-credential-value",
            },
          },
          tracker: { providerId: "minimal-provider", verified: true },
          gitHost: { providerId: null, verified: false },
        },
      };

      saveWizardDraft(state, [minimalDescriptor]);

      const raw = window.localStorage.getItem("xf_wizard_draft_v1") || "";
      expect(raw).not.toContain("undeclared-token-value");
      expect(raw).not.toContain("undeclared-pat-value");
      expect(raw).not.toContain("undeclared-password-value");
      expect(raw).not.toContain("undeclared-secret-value");
      expect(raw).not.toContain("undeclared-key-value");
      expect(raw).not.toContain("undeclared-credential-value");
      expect(raw).toContain("https://min.example.com");

      const loaded = loadWizardDraft([minimalDescriptor]);
      const config = loaded?.connect.providerConfigs["minimal-provider"];
      expect(config?.endpoint).toBe("https://min.example.com");
      expect(config?.token).toBeUndefined();
      expect(config?.pat).toBeUndefined();
      expect(config?.password).toBeUndefined();
      expect(config?.clientSecret).toBeUndefined();
      expect(config?.apiKey).toBeUndefined();
      expect(config?.credential).toBeUndefined();
    });

    it("never persists envKey under any circumstances, even if declared non-secret", () => {
      const descriptorWithEnvKey: ProviderDescriptor = {
        id: "env-provider",
        displayName: "Env Provider",
        roles: ["tracker"],
        iconRef: "icon-env",
        capabilities: [],
        configFields: [
          { name: "endpoint", label: "Endpoint", type: "url", required: true },
          {
            name: "envKey",
            label: "Env Key",
            type: "text",
            required: false,
            secret: false,
          },
        ],
      };

      const state: WizardSourceState = {
        ...createInitialWizardState(),
        connect: {
          quickUrl: "",
          providerConfigs: {
            "env-provider": {
              endpoint: "https://env.example.com",
              envKey: "SENSITIVE_ENV_VAR_NAME",
            },
          },
          tracker: { providerId: "env-provider", verified: true },
          gitHost: { providerId: null, verified: false },
        },
      };

      saveWizardDraft(state, [descriptorWithEnvKey]);

      const raw = window.localStorage.getItem("xf_wizard_draft_v1") || "";
      expect(raw).not.toContain("SENSITIVE_ENV_VAR_NAME");
      expect(raw).not.toContain('"envKey"');

      const loaded = loadWizardDraft([descriptorWithEnvKey]);
      expect(
        loaded?.connect.providerConfigs["env-provider"]?.envKey,
      ).toBeUndefined();
    });

    it("fails closed when provider metadata is unavailable or missing (config omitted/dropped)", () => {
      const state: WizardSourceState = {
        ...createInitialWizardState(),
        connect: {
          quickUrl: "",
          providerConfigs: {
            "unknown-provider": {
              endpoint: "https://unknown.com",
              accessCode: "leaky-secret",
            },
          },
          tracker: { providerId: "unknown-provider", verified: true },
          gitHost: { providerId: null, verified: false },
        },
      };

      // Case 1: descriptors is undefined / omitted -> fails closed
      expect(saveWizardDraft(state, undefined)).toBe(true);
      let raw = window.localStorage.getItem("xf_wizard_draft_v1") || "";
      expect(raw).not.toContain("leaky-secret");
      let parsed = JSON.parse(raw);
      expect(
        parsed.state.connect.providerConfigs["unknown-provider"],
      ).toBeUndefined();
      expect(parsed.state.connect.providerConfigs).toEqual({});

      // Case 2: descriptors provided, but provider is not in the list -> fails closed
      const otherDescriptor: ProviderDescriptor = {
        id: "other-provider",
        displayName: "Other",
        roles: ["tracker"],
        iconRef: "icon-other",
        capabilities: [],
        configFields: [],
      };
      expect(saveWizardDraft(state, [otherDescriptor])).toBe(true);
      raw = window.localStorage.getItem("xf_wizard_draft_v1") || "";
      expect(raw).not.toContain("leaky-secret");
      parsed = JSON.parse(raw);
      expect(
        parsed.state.connect.providerConfigs["unknown-provider"],
      ).toBeUndefined();
      expect(parsed.state.connect.providerConfigs).toEqual({});

      // Case 3: loading with descriptors where provider is missing also drops it
      window.localStorage.setItem(
        "xf_wizard_draft_v1",
        JSON.stringify({
          version: WIZARD_SCHEMA_VERSION,
          savedAt: new Date().toISOString(),
          state,
        }),
      );
      const loaded = loadWizardDraft([otherDescriptor]);
      expect(
        loaded?.connect.providerConfigs["unknown-provider"],
      ).toBeUndefined();
    });

    it("fails closed when provider metadata is malformed", () => {
      const state: WizardSourceState = {
        ...createInitialWizardState(),
        connect: {
          quickUrl: "",
          providerConfigs: {
            "test-provider": {
              endpoint: "https://test.com",
              secret: "my-secret",
            },
          },
          tracker: { providerId: "test-provider", verified: true },
          gitHost: { providerId: null, verified: false },
        },
      };

      // Case 1: descriptors is not an array
      expect(
        saveWizardDraft(
          state,
          "not-an-array" as unknown as ProviderDescriptor[],
        ),
      ).toBe(true);
      let raw = window.localStorage.getItem("xf_wizard_draft_v1") || "";
      let parsed = JSON.parse(raw);
      expect(parsed.state.connect.providerConfigs).toEqual({});

      // Case 2: descriptor is not an object or missing id
      expect(
        saveWizardDraft(state, [
          null as unknown as ProviderDescriptor,
          { id: "" } as unknown as ProviderDescriptor,
        ]),
      ).toBe(true);
      raw = window.localStorage.getItem("xf_wizard_draft_v1") || "";
      parsed = JSON.parse(raw);
      expect(parsed.state.connect.providerConfigs).toEqual({});

      // Case 3: descriptor configFields is not an array
      const malformedFieldsDescriptor = {
        id: "test-provider",
        displayName: "Test",
        roles: ["tracker"],
        iconRef: "icon",
        capabilities: [],
        configFields: "not-array",
      } as unknown as ProviderDescriptor;

      expect(saveWizardDraft(state, [malformedFieldsDescriptor])).toBe(true);
      raw = window.localStorage.getItem("xf_wizard_draft_v1") || "";
      parsed = JSON.parse(raw);
      expect(parsed.state.connect.providerConfigs).toEqual({});

      // Case 4: descriptor configFields contains invalid entries (missing name)
      const malformedFieldEntryDescriptor = {
        id: "test-provider",
        displayName: "Test",
        roles: ["tracker"],
        iconRef: "icon",
        capabilities: [],
        configFields: [{ type: "secret" }],
      } as unknown as ProviderDescriptor;

      expect(saveWizardDraft(state, [malformedFieldEntryDescriptor])).toBe(
        true,
      );
      raw = window.localStorage.getItem("xf_wizard_draft_v1") || "";
      parsed = JSON.parse(raw);
      expect(parsed.state.connect.providerConfigs).toEqual({});
    });
  });
});
