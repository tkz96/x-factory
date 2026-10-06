// test/repository-rules.test.ts — Pure derived rules for the Repositories step
// (spec #133, ticket #144).
//
// These rules are never stored in state (#126): the application-repository
// requirement, the progression gate, and input staleness are all derived from
// the reducer's plain source state. Tested as pure functions, exhaustively.

import { describe, expect, it } from "bun:test";
import type { ProviderDescriptor } from "../src/frontend/connection/types.js";
import { connectionConfigFingerprint } from "../src/frontend/lib/connection-fingerprint.js";
import {
  canAdvanceFromRepositories,
  gitHostDiscoveryFingerprint,
  hasApplicationRepository,
  isRepositorySelectionStale,
} from "../src/frontend/wizard/state/repositoryRules.js";
import { createInitialWizardState } from "../src/frontend/wizard/state/wizardReducer.js";
import type {
  WizardRepoConfig,
  WizardSourceState,
} from "../src/frontend/wizard/types.js";

const genericGitHostDescriptor: ProviderDescriptor = {
  id: "generic-githost",
  displayName: "Generic Git Host Service",
  roles: ["gitHost"],
  iconRef: "icon-custom-git",
  capabilities: ["listRepositories", "createPullRequest"],
  configFields: [
    {
      name: "host",
      label: "Host",
      type: "url",
      required: true,
      secret: false,
    },
    {
      name: "token",
      label: "Access Token",
      type: "secret",
      required: true,
      secret: true,
    },
  ],
};

const GIT_HOST_CONFIG = { host: "https://git.example.com", token: "tok-a" };

function stateWith(options: {
  gitHost?: { providerId?: string | null; config?: Record<string, unknown> };
  selectedRepoIds?: string[];
  repoConfigs?: Record<string, WizardRepoConfig>;
  selectionFingerprint?: string | null;
}): WizardSourceState {
  const base = createInitialWizardState();
  const gitHostProviderId =
    options.gitHost?.providerId === undefined
      ? "generic-githost"
      : options.gitHost.providerId;
  // Configuration is keyed by PROVIDER (correction 2, #133): the git-host role
  // reads the entry of the provider it selected.
  const providerConfigs = {
    ...base.connect.providerConfigs,
    ...(gitHostProviderId === null
      ? {}
      : { [gitHostProviderId]: options.gitHost?.config ?? GIT_HOST_CONFIG }),
  };
  return {
    ...base,
    step: 3,
    maxStepVisited: 3,
    connect: {
      ...base.connect,
      providerConfigs,
      gitHost: { providerId: gitHostProviderId, verified: true },
    },
    repositories: {
      ...base.repositories,
      selectedRepoIds: options.selectedRepoIds ?? [],
      repoConfigs: options.repoConfigs ?? {},
      ...(options.selectionFingerprint === undefined
        ? {}
        : { selectionFingerprint: options.selectionFingerprint }),
    },
  };
}

function stateWithSelection(
  config: Record<string, unknown>,
  repos: Record<string, WizardRepoConfig>,
  fingerprintProviderId = "generic-githost",
  descriptorOrDescriptors:
    | ProviderDescriptor
    | readonly ProviderDescriptor[]
    | ReadonlySet<string> = genericGitHostDescriptor,
): WizardSourceState {
  return stateWith({
    gitHost: { providerId: fingerprintProviderId, config },
    selectedRepoIds: Object.keys(repos),
    repoConfigs: repos,
    selectionFingerprint: connectionConfigFingerprint(
      fingerprintProviderId,
      config,
      descriptorOrDescriptors,
    ),
  });
}

describe("connectionConfigFingerprint", () => {
  it("identifies a connection by provider id and config values, independent of key order", () => {
    const desc: ProviderDescriptor = {
      id: "p",
      displayName: "P",
      roles: ["gitHost"],
      iconRef: "p",
      capabilities: [],
      configFields: [
        {
          name: "host",
          label: "Host",
          type: "text",
          required: true,
          secret: false,
        },
        {
          name: "token",
          label: "Token",
          type: "secret",
          required: true,
          secret: true,
        },
      ],
    };
    const a = connectionConfigFingerprint("p", { host: "h", token: "t" }, desc);
    const b = connectionConfigFingerprint("p", { token: "t", host: "h" }, desc);
    expect(a).toBe(b);

    expect(
      connectionConfigFingerprint("p", { token: "t", host: "h" }, desc),
    ).not.toBe(
      connectionConfigFingerprint("q", { token: "t", host: "h" }, desc),
    );
    expect(
      connectionConfigFingerprint("p", { token: "t", host: "h" }, desc),
    ).toBe(connectionConfigFingerprint("p", { token: "t2", host: "h" }, desc));
    expect(
      connectionConfigFingerprint("p", { token: "t", host: "h" }, desc),
    ).not.toBe(
      connectionConfigFingerprint("p", { token: "t", host: "h2" }, desc),
    );
  });

  it("never carries a credential value — it is a non-reversible digest", () => {
    const desc: ProviderDescriptor = {
      id: "p",
      displayName: "P",
      roles: ["gitHost"],
      iconRef: "p",
      capabilities: [],
      configFields: [
        {
          name: "token",
          label: "Token",
          type: "secret",
          required: true,
          secret: true,
        },
      ],
    };
    const secret = "ghp_super_secret_pat_value";
    const fingerprint = connectionConfigFingerprint(
      "p",
      { token: secret },
      desc,
    );

    expect(fingerprint).not.toContain(secret);
    expect(fingerprint).not.toContain("ghp_");
    expect(fingerprint.length).toBeGreaterThan(0);
  });

  it("canonicalises nested objects and arrays, so equal configs always match", () => {
    const a = connectionConfigFingerprint("p", {
      project: "acme",
      scopes: ["repo", "read:org"],
      nested: { z: 1, a: { deep: true } },
    });
    const b = connectionConfigFingerprint("p", {
      nested: { a: { deep: true }, z: 1 },
      scopes: ["repo", "read:org"],
      project: "acme",
    });
    expect(a).toBe(b);

    expect(
      connectionConfigFingerprint("p", { scopes: ["repo", "read:org"] }),
    ).not.toBe(
      connectionConfigFingerprint("p", { scopes: ["read:org", "repo"] }),
    );
  });
});

describe("hasApplicationRepository", () => {
  it("is false with nothing selected", () => {
    expect(hasApplicationRepository(stateWith({}))).toBe(false);
  });

  it("is true when a repository listed under the git-host role is selected", () => {
    const state = stateWith({
      selectedRepoIds: ["repo-1"],
      repoConfigs: { "repo-1": { role: "gitHost", roles: ["gitHost"] } },
    });
    expect(hasApplicationRepository(state)).toBe(true);
  });

  it("is true for a repository listed under both the git-host and tracker roles", () => {
    const state = stateWith({
      selectedRepoIds: ["repo-1"],
      repoConfigs: {
        "repo-1": { role: "gitHost", roles: ["gitHost", "tracker"] },
      },
    });
    expect(hasApplicationRepository(state)).toBe(true);
  });

  it("is false when the only selection was listed under a non-git-host role", () => {
    const state = stateWith({
      selectedRepoIds: ["repo-1"],
      repoConfigs: { "repo-1": { role: "tracker", roles: ["tracker"] } },
    });
    expect(hasApplicationRepository(state)).toBe(false);
  });

  it("is false when a selected id has no recorded role tags at all", () => {
    expect(
      hasApplicationRepository(stateWith({ selectedRepoIds: ["ghost"] })),
    ).toBe(false);
  });

  it("is true when any one of several selections is an application repository", () => {
    const state = stateWith({
      selectedRepoIds: ["repo-tracker", "repo-app"],
      repoConfigs: {
        "repo-tracker": { role: "tracker", roles: ["tracker"] },
        "repo-app": { role: "gitHost", roles: ["gitHost"] },
      },
    });
    expect(hasApplicationRepository(state)).toBe(true);
  });

  it("falls back to the single legacy role tag when no role list was recorded", () => {
    expect(
      hasApplicationRepository(
        stateWith({
          selectedRepoIds: ["repo-1"],
          repoConfigs: { "repo-1": { role: "gitHost" } },
        }),
      ),
    ).toBe(true);

    expect(
      hasApplicationRepository(
        stateWith({
          selectedRepoIds: ["repo-1"],
          repoConfigs: { "repo-1": { role: "tracker" } },
        }),
      ),
    ).toBe(false);
  });
});

describe("isRepositorySelectionStale", () => {
  it("is false with no selection at all", () => {
    expect(
      isRepositorySelectionStale(stateWith({}), genericGitHostDescriptor),
    ).toBe(false);
  });

  it("is false when the selection was made under the current git-host connection", () => {
    const state = stateWithSelection(GIT_HOST_CONFIG, {
      "repo-1": { role: "gitHost", roles: ["gitHost"] },
    });
    expect(isRepositorySelectionStale(state, genericGitHostDescriptor)).toBe(
      false,
    );
  });

  it("is true after any connection config value changes", () => {
    const state = stateWithSelection(GIT_HOST_CONFIG, {
      "repo-1": { role: "gitHost", roles: ["gitHost"] },
    });
    const edited: WizardSourceState = {
      ...state,
      connect: {
        ...state.connect,
        providerConfigs: {
          ...state.connect.providerConfigs,
          "generic-githost": {
            ...GIT_HOST_CONFIG,
            host: "https://git-updated.example.com",
          },
        },
      },
    };
    expect(isRepositorySelectionStale(edited, genericGitHostDescriptor)).toBe(
      true,
    );
  });

  it("is false after rotating a secret token on the connection", () => {
    const state = stateWithSelection(GIT_HOST_CONFIG, {
      "repo-1": { role: "gitHost", roles: ["gitHost"] },
    });
    const rotated: WizardSourceState = {
      ...state,
      connect: {
        ...state.connect,
        providerConfigs: {
          ...state.connect.providerConfigs,
          "generic-githost": { ...GIT_HOST_CONFIG, token: "tok-b" },
        },
      },
    };
    expect(isRepositorySelectionStale(rotated, genericGitHostDescriptor)).toBe(
      false,
    );
  });

  it("is true after the git-host provider changes", () => {
    const state = stateWithSelection(GIT_HOST_CONFIG, {
      "repo-1": { role: "gitHost", roles: ["gitHost"] },
    });
    const switched: WizardSourceState = {
      ...state,
      connect: {
        ...state.connect,
        gitHost: { ...state.connect.gitHost, providerId: "another-githost" },
      },
    };
    expect(isRepositorySelectionStale(switched, genericGitHostDescriptor)).toBe(
      true,
    );
  });

  it("is true for a restored selection with no recorded provenance", () => {
    const state = stateWith({
      selectedRepoIds: ["repo-1"],
      repoConfigs: { "repo-1": { role: "gitHost", roles: ["gitHost"] } },
    });
    expect(isRepositorySelectionStale(state, genericGitHostDescriptor)).toBe(
      true,
    );
  });
});

describe("canAdvanceFromRepositories", () => {
  it("allows progression with a current application-repository selection", () => {
    const state = stateWithSelection(GIT_HOST_CONFIG, {
      "repo-1": { role: "gitHost", roles: ["gitHost"] },
    });
    expect(canAdvanceFromRepositories(state, genericGitHostDescriptor)).toBe(
      true,
    );
  });

  it("blocks progression with no selection", () => {
    expect(
      canAdvanceFromRepositories(stateWith({}), genericGitHostDescriptor),
    ).toBe(false);
  });

  it("blocks progression when only a non-application repository is selected", () => {
    const state = stateWithSelection(GIT_HOST_CONFIG, {
      "repo-1": { role: "tracker", roles: ["tracker"] },
    });
    expect(canAdvanceFromRepositories(state, genericGitHostDescriptor)).toBe(
      false,
    );
  });

  it("blocks progression when the selection went stale after a connection edit", () => {
    const state = stateWithSelection(GIT_HOST_CONFIG, {
      "repo-1": { role: "gitHost", roles: ["gitHost"] },
    });
    const edited: WizardSourceState = {
      ...state,
      connect: {
        ...state.connect,
        providerConfigs: {
          ...state.connect.providerConfigs,
          "generic-githost": {
            ...GIT_HOST_CONFIG,
            host: "https://other.example.com",
          },
        },
      },
    };
    expect(canAdvanceFromRepositories(edited, genericGitHostDescriptor)).toBe(
      false,
    );
  });
});

describe("gitHostDiscoveryFingerprint", () => {
  it("follows the git-host connection's provider id and config", () => {
    const state = stateWithSelection(GIT_HOST_CONFIG, {});
    expect(gitHostDiscoveryFingerprint(state, genericGitHostDescriptor)).toBe(
      connectionConfigFingerprint(
        "generic-githost",
        GIT_HOST_CONFIG,
        genericGitHostDescriptor,
      ),
    );
  });
});
