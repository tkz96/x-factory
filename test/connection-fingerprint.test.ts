// test/connection-fingerprint.test.ts — Unit tests for connectionConfigFingerprint (#133, #158)
// Proves that credentials never participate in query keys or staleness fingerprints,
// while relevant configuration changes produce distinct identities.

import { describe, expect, it } from "bun:test";
import type { ProviderDescriptor } from "../src/frontend/connection/types.js";
import { connectionConfigFingerprint } from "../src/frontend/lib/connection-fingerprint.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import {
  gitHostDiscoveryFingerprint,
  isRepositorySelectionStale,
} from "../src/frontend/wizard/state/repositoryRules.js";
import { createInitialWizardState } from "../src/frontend/wizard/state/wizardReducer.js";
import type { WizardSourceState } from "../src/frontend/wizard/types.js";

const githubDescriptor: ProviderDescriptor = {
  id: "github",
  displayName: "GitHub",
  roles: ["gitHost", "tracker"],
  iconRef: "github",
  capabilities: ["listRepositories"],
  configFields: [
    { name: "host", label: "Host", type: "url", required: true, secret: false },
    {
      name: "project",
      label: "Project",
      type: "text",
      required: true,
      secret: false,
    },
    {
      name: "repo",
      label: "Repo",
      type: "text",
      required: true,
      secret: false,
    },
    {
      name: "token",
      label: "Token",
      type: "secret",
      required: false,
      secret: true,
    },
    {
      name: "pat",
      label: "PAT",
      type: "secret",
      required: false,
      secret: true,
    },
    {
      name: "apiToken",
      label: "API Token",
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
  ],
};

const customProviderDescriptor: ProviderDescriptor = {
  id: "custom-provider",
  displayName: "Custom Provider",
  roles: ["gitHost", "tracker"],
  iconRef: "custom-icon",
  capabilities: ["describeConnection"],
  configFields: [
    {
      name: "host",
      label: "Host URL",
      type: "url",
      required: true,
      secret: false,
    },
    {
      name: "project",
      label: "Project",
      type: "text",
      required: true,
      secret: false,
    },
    {
      name: "tokenType",
      label: "Token Type",
      type: "text",
      required: false,
      secret: false, // Suspicious name matching /token/, but declared non-secret
    },
    {
      name: "accessCode",
      label: "Access Code",
      type: "secret",
      required: true,
      secret: true, // Innocuous name not matching /token|pat|secret|password|credential/, but declared secret
    },
    {
      name: "apiToken",
      label: "API Token",
      type: "secret",
      required: true,
      secret: true,
    },
  ],
};

describe("connectionConfigFingerprint secret isolation", () => {
  it("produces the EXACT SAME fingerprint when changing a secret field (token, pat, apiToken, password)", () => {
    const baseConfig = {
      host: "https://api.github.com",
      project: "my-project",
      repo: "my-repo",
    };

    const fp1 = connectionConfigFingerprint(
      "github",
      {
        ...baseConfig,
        token: "ghp_initial_token_11111",
      },
      githubDescriptor,
    );

    const fp2 = connectionConfigFingerprint(
      "github",
      {
        ...baseConfig,
        token: "ghp_rotated_token_99999",
      },
      githubDescriptor,
    );

    expect(fp1).toBe(fp2);

    const fpPat1 = connectionConfigFingerprint(
      "github",
      {
        ...baseConfig,
        pat: "pat_alpha",
      },
      githubDescriptor,
    );
    const fpPat2 = connectionConfigFingerprint(
      "github",
      {
        ...baseConfig,
        pat: "pat_omega",
      },
      githubDescriptor,
    );
    expect(fpPat1).toBe(fpPat2);

    const fpApi1 = connectionConfigFingerprint(
      "github",
      {
        ...baseConfig,
        apiToken: "key-1",
      },
      githubDescriptor,
    );
    const fpApi2 = connectionConfigFingerprint(
      "github",
      {
        ...baseConfig,
        apiToken: "key-2",
      },
      githubDescriptor,
    );
    expect(fpApi1).toBe(fpApi2);

    const fpPass1 = connectionConfigFingerprint(
      "github",
      {
        ...baseConfig,
        password: "pass1",
      },
      githubDescriptor,
    );
    const fpPass2 = connectionConfigFingerprint(
      "github",
      {
        ...baseConfig,
        password: "pass2",
      },
      githubDescriptor,
    );
    expect(fpPass1).toBe(fpPass2);
  });

  it("produces the EXACT SAME fingerprint when changing an innocuous secret field declared in ProviderDescriptor", () => {
    const config1 = {
      host: "https://custom.service.internal",
      project: "acme",
      accessCode: "access-code-alpha",
    };

    const config2 = {
      host: "https://custom.service.internal",
      project: "acme",
      accessCode: "access-code-beta",
    };

    // When descriptor is provided, accessCode is recognized as secret and stripped
    const fpWithDesc1 = connectionConfigFingerprint(
      "custom-provider",
      config1,
      customProviderDescriptor,
    );
    const fpWithDesc2 = connectionConfigFingerprint(
      "custom-provider",
      config2,
      customProviderDescriptor,
    );

    expect(fpWithDesc1).toBe(fpWithDesc2);

    // Also works when descriptor list is provided
    const fpWithList1 = connectionConfigFingerprint(
      "custom-provider",
      config1,
      [customProviderDescriptor],
    );
    const fpWithList2 = connectionConfigFingerprint(
      "custom-provider",
      config2,
      [customProviderDescriptor],
    );
    expect(fpWithList1).toBe(fpWithList2);
    expect(fpWithList1).toBe(fpWithDesc1);

    // Also works when ReadonlySet of secret names is provided
    const secretSet = new Set(["accessCode"]);
    const fpWithSet1 = connectionConfigFingerprint(
      "custom-provider",
      config1,
      secretSet,
    );
    const fpWithSet2 = connectionConfigFingerprint(
      "custom-provider",
      config2,
      secretSet,
    );
    expect(fpWithSet1).toBe(fpWithSet2);
  });

  it("produces DIFFERENT fingerprints when changing non-secret fields (host, project, repo)", () => {
    const base = {
      host: "https://git.example.com",
      project: "web-app",
      repo: "core",
      token: "secret-token",
    };

    const fpBase = connectionConfigFingerprint("git", base);

    const fpDiffHost = connectionConfigFingerprint("git", {
      ...base,
      host: "https://git2.example.com",
    });
    expect(fpBase).not.toBe(fpDiffHost);

    const fpDiffProject = connectionConfigFingerprint("git", {
      ...base,
      project: "mobile-app",
    });
    expect(fpBase).not.toBe(fpDiffProject);

    const fpDiffRepo = connectionConfigFingerprint("git", {
      ...base,
      repo: "client",
    });
    expect(fpBase).not.toBe(fpDiffRepo);
  });

  it("participates in fingerprint when a non-secret field has a suspicious name (tokenType) declared non-secret", () => {
    const configA = {
      host: "https://custom.service.internal",
      project: "acme",
      tokenType: "Bearer",
    };

    const configB = {
      host: "https://custom.service.internal",
      project: "acme",
      tokenType: "Basic",
    };

    // With descriptor declaring tokenType as non-secret:
    const fpA = connectionConfigFingerprint(
      "custom-provider",
      configA,
      customProviderDescriptor,
    );
    const fpB = connectionConfigFingerprint(
      "custom-provider",
      configB,
      customProviderDescriptor,
    );

    // Because tokenType is preserved as non-secret, changing it changes the fingerprint!
    expect(fpA).not.toBe(fpB);
  });

  it("unconditionally strips envKey and env_key fields regardless of value or descriptor", () => {
    const base = {
      host: "https://github.com",
      owner: "acme",
    };

    const fpWithoutEnv = connectionConfigFingerprint("github", base);

    const fpWithEnvKey1 = connectionConfigFingerprint("github", {
      ...base,
      envKey: "GH_TOKEN_PROD",
    });

    const fpWithEnvKey2 = connectionConfigFingerprint("github", {
      ...base,
      envKey: "GH_TOKEN_STAGING",
    });

    const fpWithEnvSnake = connectionConfigFingerprint("github", {
      ...base,
      env_key: "SOME_KEY",
    });

    expect(fpWithoutEnv).toBe(fpWithEnvKey1);
    expect(fpWithEnvKey1).toBe(fpWithEnvKey2);
    expect(fpWithEnvKey1).toBe(fpWithEnvSnake);
  });

  it("always formats as cfp_<high><low> hex string", () => {
    const fp = connectionConfigFingerprint("test-provider", {
      host: "https://example.com",
    });

    expect(fp).toMatch(/^cfp_[0-9a-f]{16}$/);
  });
});

describe("schema-authoritative query identity and secret isolation (#133 blocker)", () => {
  const providerDescriptorA: ProviderDescriptor = {
    id: "provider-a",
    displayName: "Provider A",
    roles: ["gitHost"],
    iconRef: "icon-a",
    capabilities: ["listRepositories"],
    configFields: [
      {
        name: "host",
        label: "Host",
        type: "url",
        required: true,
        secret: false,
      },
      {
        name: "project",
        label: "Project",
        type: "text",
        required: true,
        secret: false,
      },
      {
        name: "tokenType",
        label: "Token Type",
        type: "text",
        required: false,
        secret: false,
      },
      {
        name: "accessCode",
        label: "Access Code",
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
    ],
  };

  const providerDescriptorB: ProviderDescriptor = {
    id: "provider-b",
    displayName: "Provider B",
    roles: ["gitHost"],
    iconRef: "icon-b",
    capabilities: ["listRepositories"],
    configFields: [
      {
        name: "host",
        label: "Host",
        type: "url",
        required: true,
        secret: false,
      },
      {
        name: "project",
        label: "Project",
        type: "text",
        required: true,
        secret: false,
      },
      {
        name: "accessCode",
        label: "Access Code",
        type: "secret",
        required: true,
        secret: true,
      },
    ],
  };

  it("Same non-secret configuration + different secret => same fingerprint", () => {
    const config1 = {
      host: "https://git.example.com",
      project: "core-repo",
      accessCode: "secret-code-alpha",
      token: "secret-token-111",
    };
    const config2 = {
      host: "https://git.example.com",
      project: "core-repo",
      accessCode: "secret-code-beta",
      token: "secret-token-999",
    };

    const fp1 = connectionConfigFingerprint(
      "provider-a",
      config1,
      providerDescriptorA,
    );
    const fp2 = connectionConfigFingerprint(
      "provider-a",
      config2,
      providerDescriptorA,
    );

    expect(fp1).toBe(fp2);
  });

  it("Different non-secret configuration => different fingerprint", () => {
    const config1 = {
      host: "https://git-1.example.com",
      project: "core-repo",
      accessCode: "secret-code-alpha",
    };
    const config2 = {
      host: "https://git-2.example.com",
      project: "core-repo",
      accessCode: "secret-code-alpha",
    };

    const fp1 = connectionConfigFingerprint(
      "provider-a",
      config1,
      providerDescriptorA,
    );
    const fp2 = connectionConfigFingerprint(
      "provider-a",
      config2,
      providerDescriptorA,
    );

    expect(fp1).not.toBe(fp2);
  });

  it("Different provider => different fingerprint", () => {
    const config = {
      host: "https://git.example.com",
      project: "core-repo",
      accessCode: "secret-code-alpha",
    };

    const fpA = connectionConfigFingerprint(
      "provider-a",
      config,
      providerDescriptorA,
    );
    const fpB = connectionConfigFingerprint(
      "provider-b",
      config,
      providerDescriptorB,
    );

    expect(fpA).not.toBe(fpB);
  });

  it("Reordered config keys => same fingerprint", () => {
    const config1 = {
      host: "https://git.example.com",
      project: "core-repo",
      tokenType: "Bearer",
      accessCode: "secret-code",
    };
    const config2 = {
      accessCode: "secret-code",
      tokenType: "Bearer",
      project: "core-repo",
      host: "https://git.example.com",
    };

    const fp1 = connectionConfigFingerprint(
      "provider-a",
      config1,
      providerDescriptorA,
    );
    const fp2 = connectionConfigFingerprint(
      "provider-a",
      config2,
      providerDescriptorA,
    );

    expect(fp1).toBe(fp2);
  });

  it("A secret named accessCode is excluded when the descriptor declares it secret", () => {
    const base = {
      host: "https://git.example.com",
      project: "core-repo",
    };
    const configWithSecret1 = {
      ...base,
      accessCode: "ultra-secret-key-1",
    };
    const configWithSecret2 = {
      ...base,
      accessCode: "ultra-secret-key-2",
    };

    const fpBase = connectionConfigFingerprint(
      "provider-a",
      base,
      providerDescriptorA,
    );
    const fp1 = connectionConfigFingerprint(
      "provider-a",
      configWithSecret1,
      providerDescriptorA,
    );
    const fp2 = connectionConfigFingerprint(
      "provider-a",
      configWithSecret2,
      providerDescriptorA,
    );

    expect(fp1).toBe(fp2);
    expect(fp1).toBe(fpBase);
  });

  it("A suspicious-looking field declared non-secret remains part of the fingerprint", () => {
    const config1 = {
      host: "https://git.example.com",
      project: "core-repo",
      tokenType: "Bearer",
    };
    const config2 = {
      host: "https://git.example.com",
      project: "core-repo",
      tokenType: "Basic",
    };

    const fp1 = connectionConfigFingerprint(
      "provider-a",
      config1,
      providerDescriptorA,
    );
    const fp2 = connectionConfigFingerprint(
      "provider-a",
      config2,
      providerDescriptorA,
    );

    expect(fp1).not.toBe(fp2);
  });

  it("The serialized TanStack Query key contains no credential value", () => {
    const rawConfig = {
      host: "https://git.example.com",
      project: "core-repo",
      accessCode: "SECRET_ACCESS_CODE_98765",
      token: "SECRET_TOKEN_VALUE_43210",
    };

    const qKey = queryKeys.providerRepositories(
      "provider-a",
      rawConfig,
      providerDescriptorA,
      1,
    );

    const serialized = JSON.stringify(qKey);
    expect(serialized).not.toContain("SECRET_ACCESS_CODE_98765");
    expect(serialized).not.toContain("SECRET_TOKEN_VALUE_43210");
  });

  it("Changing the provider config generation produces a different discovery query key even though the fingerprint remains unchanged", () => {
    const rawConfig = {
      host: "https://git.example.com",
      project: "core-repo",
      accessCode: "secret-code",
    };

    const qKeyGen1 = queryKeys.providerRepositories(
      "provider-a",
      rawConfig,
      providerDescriptorA,
      1,
    );
    const qKeyGen2 = queryKeys.providerRepositories(
      "provider-a",
      rawConfig,
      providerDescriptorA,
      2,
    );

    // Fingerprints match
    expect(qKeyGen1[2]).toBe(qKeyGen2[2]);
    // Query keys differ
    expect(qKeyGen1).not.toEqual(qKeyGen2);
    expect(qKeyGen1[3]).toBe(1);
    expect(qKeyGen2[3]).toBe(2);
  });

  it("Repository selection staleness uses the same descriptor-aware fingerprint as discovery", () => {
    const initialConfig = {
      host: "https://git.example.com",
      project: "core-repo",
      accessCode: "initial-secret",
    };

    const base = createInitialWizardState();
    const state: WizardSourceState = {
      ...base,
      step: 3,
      connect: {
        ...base.connect,
        providerConfigs: {
          "provider-a": initialConfig,
        },
        gitHost: {
          providerId: "provider-a",
          verified: true,
        },
      },
      repositories: {
        ...base.repositories,
        selectedRepoIds: ["repo-1"],
        repoConfigs: {
          "repo-1": { role: "gitHost", roles: ["gitHost"] },
        },
        selectionFingerprint: gitHostDiscoveryFingerprint(
          {
            ...base,
            connect: {
              ...base.connect,
              providerConfigs: { "provider-a": initialConfig },
              gitHost: { providerId: "provider-a", verified: true },
            },
          },
          providerDescriptorA,
        ),
      },
    };

    // Current selection is not stale
    expect(isRepositorySelectionStale(state, providerDescriptorA)).toBe(false);

    // Rotating the secret does NOT make selection stale
    const rotatedState: WizardSourceState = {
      ...state,
      connect: {
        ...state.connect,
        providerConfigs: {
          "provider-a": {
            ...initialConfig,
            accessCode: "rotated-secret",
          },
        },
      },
    };
    expect(isRepositorySelectionStale(rotatedState, providerDescriptorA)).toBe(
      false,
    );

    // Changing a non-secret field DOES make selection stale
    const editedState: WizardSourceState = {
      ...state,
      connect: {
        ...state.connect,
        providerConfigs: {
          "provider-a": {
            ...initialConfig,
            host: "https://git-edited.example.com",
          },
        },
      },
    };
    expect(isRepositorySelectionStale(editedState, providerDescriptorA)).toBe(
      true,
    );
  });
});
