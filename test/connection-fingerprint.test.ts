// test/connection-fingerprint.test.ts — Unit tests for connectionConfigFingerprint (#133, #158)
// Proves that credentials never participate in query keys or staleness fingerprints,
// while relevant configuration changes produce distinct identities.

import { describe, expect, it } from "bun:test";
import type { ProviderDescriptor } from "../src/frontend/connection/types.js";
import { connectionConfigFingerprint } from "../src/frontend/lib/connection-fingerprint.js";

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

    const fp1 = connectionConfigFingerprint("github", {
      ...baseConfig,
      token: "ghp_initial_token_11111",
    });

    const fp2 = connectionConfigFingerprint("github", {
      ...baseConfig,
      token: "ghp_rotated_token_99999",
    });

    expect(fp1).toBe(fp2);

    const fpPat1 = connectionConfigFingerprint("github", {
      ...baseConfig,
      pat: "pat_alpha",
    });
    const fpPat2 = connectionConfigFingerprint("github", {
      ...baseConfig,
      pat: "pat_omega",
    });
    expect(fpPat1).toBe(fpPat2);

    const fpApi1 = connectionConfigFingerprint("github", {
      ...baseConfig,
      apiToken: "key-1",
    });
    const fpApi2 = connectionConfigFingerprint("github", {
      ...baseConfig,
      apiToken: "key-2",
    });
    expect(fpApi1).toBe(fpApi2);

    const fpPass1 = connectionConfigFingerprint("github", {
      ...baseConfig,
      password: "pass1",
    });
    const fpPass2 = connectionConfigFingerprint("github", {
      ...baseConfig,
      password: "pass2",
    });
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
