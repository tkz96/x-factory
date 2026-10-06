// test/connection-identity.test.ts — The `describeConnection` capability
// (spec #133 story 34), provider-owned and unit-tested per provider.
//
// #133 asks the combo line to show useful provider-owned identity where it is
// available — `"Tracker: Jira (site.acme.net) · Git host: GitHub (owner/repo)"`.
// The identity is a PROVIDER's statement about its own configuration, so each
// provider composes its own form here; everything generic (the route, the hook,
// the combo line) only formats the string it was handed.
//
// Two properties are asserted for every provider, because they are the
// properties that make the capability safe to publish:
//   1. a configuration that identifies nothing yields `null` (never "");
//   2. a secret field NEVER reaches the identity — a distinctive marker typed
//      into the secret field is absent from the identity string.
//
// These are unit tests over the provider modules; the route that publishes the
// identity is exercised in test/provider-describe-api.test.ts.

import { describe, expect, it } from "bun:test";
import { azureProvider } from "../src/providers/azure-module.js";
import { hasCapability } from "../src/providers/contract.js";
import { githubProvider } from "../src/providers/github-module.js";
import { jiraProvider } from "../src/providers/jira-module.js";
import { getProviderCapabilities } from "../src/providers/serializer.js";
import { stubProvider } from "./fixtures/stub-provider.js";

/** Distinctive synthetic markers — never real credentials. */
const GITHUB_TOKEN_MARKER = "ghp_marker_github_secret_2f7c";
const AZURE_PAT_MARKER = "pat_marker_azure_secret_9d31";
const JIRA_TOKEN_MARKER = "atl_marker_jira_secret_5ab4";
const JIRA_EMAIL_MARKER = "marker-person@example.invalid";

describe("describeConnection — GitHub", () => {
  it("composes owner/repo from the two identity fields", () => {
    expect(
      githubProvider.describeConnection?.({
        token: GITHUB_TOKEN_MARKER,
        repoOwner: "octo-org",
        repository: "rocket",
      }),
    ).toBe("octo-org/rocket");
  });

  it("uses whichever half is recorded, and null when neither is", () => {
    expect(
      githubProvider.describeConnection?.({
        token: GITHUB_TOKEN_MARKER,
        repoOwner: "octo-org",
      }),
    ).toBe("octo-org");
    expect(
      githubProvider.describeConnection?.({
        token: GITHUB_TOKEN_MARKER,
        repository: "rocket",
      }),
    ).toBe("rocket");
    expect(
      githubProvider.describeConnection?.({ token: GITHUB_TOKEN_MARKER }),
    ).toBeNull();
    expect(githubProvider.describeConnection?.({})).toBeNull();
  });

  it("ignores empty and non-string values rather than rendering them", () => {
    expect(
      githubProvider.describeConnection?.({
        repoOwner: "   ",
        repository: "rocket",
      }),
    ).toBe("rocket");
    expect(githubProvider.describeConnection?.({ repository: 42 })).toBeNull();
  });

  it("never includes the token", () => {
    const identity = githubProvider.describeConnection?.({
      token: GITHUB_TOKEN_MARKER,
      repoOwner: "octo-org",
      repository: "rocket",
    });
    expect(identity).not.toContain(GITHUB_TOKEN_MARKER);
    expect(identity).not.toContain("ghp_");
  });

  it("declares the capability it implements", () => {
    expect(hasCapability(githubProvider, "describeConnection")).toBe(true);
    expect(getProviderCapabilities(githubProvider)).toContain(
      "describeConnection",
    );
  });
});

describe("describeConnection — Azure DevOps", () => {
  it("composes organization/Project with the organization taken from orgUrl", () => {
    expect(
      azureProvider.describeConnection?.({
        orgUrl: "https://dev.azure.com/acme",
        project: "MyProject",
        pat: AZURE_PAT_MARKER,
      }),
    ).toBe("acme/MyProject");
  });

  it("resolves the legacy visualstudio.com organization form", () => {
    expect(
      azureProvider.describeConnection?.({
        orgUrl: "https://acme.visualstudio.com",
        project: "MyProject",
      }),
    ).toBe("acme/MyProject");
  });

  it("keeps any other orgUrl readable, scheme stripped", () => {
    expect(
      azureProvider.describeConnection?.({
        orgUrl: "https://azure.example/org",
        project: "MyProject",
      }),
    ).toBe("azure.example/org/MyProject");
  });

  it("uses whichever part is recorded, and null when neither is", () => {
    expect(
      azureProvider.describeConnection?.({
        orgUrl: "https://dev.azure.com/acme",
      }),
    ).toBe("acme");
    expect(azureProvider.describeConnection?.({ project: "MyProject" })).toBe(
      "MyProject",
    );
    expect(
      azureProvider.describeConnection?.({ pat: AZURE_PAT_MARKER }),
    ).toBeNull();
    expect(azureProvider.describeConnection?.({})).toBeNull();
  });

  it("never includes the PAT", () => {
    const identity = azureProvider.describeConnection?.({
      orgUrl: "https://dev.azure.com/acme",
      project: "MyProject",
      pat: AZURE_PAT_MARKER,
    });
    expect(identity).not.toContain(AZURE_PAT_MARKER);
  });

  it("declares the capability it implements", () => {
    expect(hasCapability(azureProvider, "describeConnection")).toBe(true);
    expect(getProviderCapabilities(azureProvider)).toContain(
      "describeConnection",
    );
  });
});

describe("describeConnection — Jira Cloud", () => {
  it("composes host/project with the scheme stripped", () => {
    expect(
      jiraProvider.describeConnection?.({
        host: "https://acme.atlassian.net",
        email: JIRA_EMAIL_MARKER,
        apiToken: JIRA_TOKEN_MARKER,
        project: "ROCK",
      }),
    ).toBe("acme.atlassian.net/ROCK");
  });

  it("is the host alone when no project is scoped, and null without a host", () => {
    expect(
      jiraProvider.describeConnection?.({
        host: "https://acme.atlassian.net/",
        apiToken: JIRA_TOKEN_MARKER,
      }),
    ).toBe("acme.atlassian.net");
    // The host is the anchor: a project key without a site identifies nothing.
    expect(
      jiraProvider.describeConnection?.({
        project: "ROCK",
        apiToken: JIRA_TOKEN_MARKER,
      }),
    ).toBeNull();
    expect(
      jiraProvider.describeConnection?.({ apiToken: JIRA_TOKEN_MARKER }),
    ).toBeNull();
    expect(jiraProvider.describeConnection?.({})).toBeNull();
  });

  it("never includes the API token, and never the email (PII is not identity)", () => {
    const identity = jiraProvider.describeConnection?.({
      host: "https://acme.atlassian.net",
      email: JIRA_EMAIL_MARKER,
      apiToken: JIRA_TOKEN_MARKER,
      project: "ROCK",
    });
    expect(identity).not.toContain(JIRA_TOKEN_MARKER);
    expect(identity).not.toContain(JIRA_EMAIL_MARKER);
    expect(identity).not.toContain("marker-person");
  });

  it("declares the capability it implements", () => {
    expect(hasCapability(jiraProvider, "describeConnection")).toBe(true);
    expect(getProviderCapabilities(jiraProvider)).toContain(
      "describeConnection",
    );
  });
});

describe("describeConnection — capability detection", () => {
  it("is absent on a provider that does not implement it", () => {
    expect(hasCapability(stubProvider, "describeConnection")).toBe(false);
    expect(getProviderCapabilities(stubProvider)).not.toContain(
      "describeConnection",
    );
  });

  it("never throws on a malformed configuration", () => {
    for (const provider of [githubProvider, azureProvider, jiraProvider]) {
      expect(() => provider.describeConnection?.({})).not.toThrow();
      expect(() =>
        provider.describeConnection?.({
          host: 7,
          orgUrl: null,
          repoOwner: [],
          repository: {},
        }),
      ).not.toThrow();
    }
  });
});
