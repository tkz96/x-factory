// test/connection-integrity.test.ts — Post-creation connection surfacing
// (spec #133, ticket #147), pure domain seam.
//
// `deriveConnectionIntegrity` turns a project's normalized `connections`
// payload (#145) into the display descriptors every post-creation surface
// renders: the git host + tracker combo line, the degraded warnings, and the
// no-tracker INTEGRITY FAILURE (spec #133 §Wizard flow & UX: "A project found
// without a tracker at runtime is surfaced as an integrity failure with a
// repair path, not a supported mode").
//
// The derivation is provider-agnostic by construction: display names come from
// the providers manifest, required-configuration checks come from the
// manifest's own field descriptors, and the legacy `issueTracker` fallback
// looks the provider's configuration up by provider id — never by
// provider-specific branching.

import { describe, expect, it } from "bun:test";
import type { DerivedAsyncState } from "../src/frontend/components/feedback/types.js";
import {
  applyConnectionIntegrity,
  connectionDisplayValues,
  deriveConnectionIntegrity,
  resolveProviderLabel,
} from "../src/frontend/components/projects/connection-integrity.js";
import type { ProviderDescriptor } from "../src/frontend/connection/types.js";
import type { Project } from "../src/shared/types.js";

const DESCRIPTORS: ProviderDescriptor[] = [
  {
    id: "tracker-one",
    displayName: "Tracker One",
    roles: ["tracker"],
    iconRef: "icon-tracker-one",
    capabilities: ["listTickets", "verifyScopes"],
    configFields: [
      { name: "host", label: "Host", type: "url", required: true },
      { name: "email", label: "Email", type: "email", required: true },
      {
        name: "apiToken",
        label: "API Token",
        type: "secret",
        required: true,
        secret: true,
      },
      {
        name: "projectKey",
        label: "Project Key",
        type: "text",
        required: false,
      },
    ],
  },
  {
    id: "githost-one",
    displayName: "Git Host One",
    roles: ["gitHost"],
    iconRef: "icon-githost-one",
    capabilities: ["listRepositories"],
    configFields: [
      { name: "orgUrl", label: "Organization", type: "url", required: true },
      { name: "repo", label: "Repository", type: "text", required: true },
    ],
  },
  {
    id: "dual-one",
    displayName: "Dual One",
    roles: ["tracker", "gitHost"],
    iconRef: "icon-dual-one",
    capabilities: ["listTickets", "listRepositories"],
    configFields: [
      { name: "host", label: "Host", type: "url", required: true },
      {
        name: "pat",
        label: "Token",
        type: "secret",
        required: true,
        secret: true,
      },
    ],
  },
];

function makeProject(overrides: Partial<Project>): Project {
  return {
    id: "proj-1",
    name: "Rocket",
    repositoryPath: "/work/rocket",
    defaultBranch: "main",
    testCommand: "bun test",
    repositories: [],
    issueTracker: { provider: "tracker-one" },
    ...overrides,
  } as Project;
}

describe("deriveConnectionIntegrity — normalized connections", () => {
  it("reports both roles connected for a project with a tracker and a git host", () => {
    const integrity = deriveConnectionIntegrity(
      makeProject({
        connections: [
          {
            providerId: "tracker-one",
            roles: ["tracker"],
            config: {
              host: "https://tracker.example",
              email: "dev@example.com",
            },
          },
          {
            providerId: "githost-one",
            roles: ["gitHost"],
            config: { orgUrl: "https://git.example", repo: "rocket" },
          },
        ],
      }),
      DESCRIPTORS,
    );

    expect(integrity.slots.map((slot) => slot.role)).toEqual([
      "tracker",
      "gitHost",
    ]);
    expect(integrity.tracker.state).toBe("connected");
    expect(integrity.gitHost.state).toBe("connected");
    expect(integrity.hasIntegrityFailure).toBe(false);
    expect(integrity.isDegraded).toBe(false);
    expect(integrity.warnings).toEqual([]);
  });

  it("treats a missing tracker role as an integrity failure, not an empty state", () => {
    const integrity = deriveConnectionIntegrity(
      makeProject({
        connections: [
          {
            providerId: "githost-one",
            roles: ["gitHost"],
            config: { orgUrl: "https://git.example", repo: "rocket" },
          },
        ],
      }),
      DESCRIPTORS,
    );

    expect(integrity.hasIntegrityFailure).toBe(true);
    expect(integrity.tracker.state).toBe("disconnected");
    expect(integrity.tracker.providerId).toBeUndefined();
    expect(integrity.warnings.map((warning) => warning.kind)).toEqual([
      "ROLE_NOT_RECORDED",
    ]);
    expect(integrity.warnings[0]?.details).toEqual(["tracker"]);
  });

  it("degrades a connection whose required non-secret configuration is not recorded", () => {
    const integrity = deriveConnectionIntegrity(
      makeProject({
        connections: [
          {
            providerId: "tracker-one",
            roles: ["tracker"],
            config: { host: "https://tracker.example" },
          },
          {
            providerId: "githost-one",
            roles: ["gitHost"],
            config: { orgUrl: "https://git.example", repo: "rocket" },
          },
        ],
      }),
      DESCRIPTORS,
    );

    expect(integrity.tracker.state).toBe("degraded");
    expect(integrity.hasIntegrityFailure).toBe(false);
    expect(integrity.isDegraded).toBe(true);
    expect(integrity.warnings).toEqual([
      { kind: "CONFIG_INCOMPLETE", role: "tracker", details: ["Email"] },
    ]);
    // The secret field is stripped from persisted config by design (#131) and
    // is never reported as missing.
    expect(integrity.warnings[0]?.details).not.toContain("API Token");
  });

  it("reports an unregistered provider id as a warning without failing integrity", () => {
    const integrity = deriveConnectionIntegrity(
      makeProject({
        connections: [
          {
            providerId: "retired-tracker",
            roles: ["tracker"],
            config: { host: "https://tracker.example" },
          },
        ],
      }),
      DESCRIPTORS,
    );

    // Warnings are never the error tone: an unregistered provider degrades the
    // slot, it does not fail integrity.
    expect(integrity.tracker.state).toBe("degraded");
    expect(integrity.hasIntegrityFailure).toBe(false);
    expect(integrity.warnings.map((warning) => warning.kind)).toContain(
      "PROVIDER_UNKNOWN",
    );
  });

  it("never invents provider warnings before the manifest is loaded", () => {
    const integrity = deriveConnectionIntegrity(
      makeProject({
        connections: [
          { providerId: "tracker-one", roles: ["tracker"], config: {} },
        ],
      }),
      [],
    );

    expect(integrity.tracker.state).toBe("connected");
    expect(integrity.tracker.warnings).toEqual([]);
  });

  it("records one dual-role connection as satisfying both roles", () => {
    const integrity = deriveConnectionIntegrity(
      makeProject({
        connections: [
          {
            providerId: "dual-one",
            roles: ["tracker", "gitHost"],
            config: { host: "https://dual.example" },
          },
        ],
      }),
      DESCRIPTORS,
    );

    expect(integrity.tracker.state).toBe("connected");
    expect(integrity.gitHost.state).toBe("connected");
    expect(integrity.hasIntegrityFailure).toBe(false);
    expect(integrity.warnings).toEqual([]);
  });
});

describe("deriveConnectionIntegrity — legacy projects (pre-#145)", () => {
  it("derives a tracker descriptor from the legacy issueTracker record", () => {
    const integrity = deriveConnectionIntegrity(
      makeProject({
        issueTracker: {
          provider: "tracker-one",
          "tracker-one": { host: "https://legacy.example", email: "dev@x.com" },
        } as unknown as Project["issueTracker"],
      }),
      DESCRIPTORS,
    );

    expect(integrity.tracker.state).toBe("connected");
    expect(integrity.tracker.providerId).toBe("tracker-one");
    expect(integrity.tracker.config).toEqual({
      host: "https://legacy.example",
      email: "dev@x.com",
    });
    // A legacy project records no git host at all: shown as not recorded
    // rather than invented, which is a warning, never an integrity failure.
    expect(integrity.gitHost.state).toBe("disconnected");
    expect(integrity.hasIntegrityFailure).toBe(false);
    expect(integrity.isDegraded).toBe(true);
    expect(integrity.warnings.map((warning) => warning.role)).toEqual([
      "gitHost",
    ]);
  });

  it("surfaces a legacy project with no usable issueTracker as an integrity failure", () => {
    const integrity = deriveConnectionIntegrity(
      makeProject({ issueTracker: {} as Project["issueTracker"] }),
      DESCRIPTORS,
    );

    expect(integrity.hasIntegrityFailure).toBe(true);
    expect(integrity.tracker.state).toBe("disconnected");
    expect(integrity.tracker.providerId).toBeUndefined();
    expect(integrity.gitHost.state).toBe("disconnected");
  });
});

describe("resolveProviderLabel", () => {
  it("resolves the manifest display name and falls back to the provider id", () => {
    expect(resolveProviderLabel("tracker-one", DESCRIPTORS)).toBe(
      "Tracker One",
    );
    expect(resolveProviderLabel("unregistered", DESCRIPTORS)).toBe(
      "unregistered",
    );
  });
});

describe("applyConnectionIntegrity", () => {
  const base: DerivedAsyncState = {
    state: "empty",
    suppressed: [],
    error: undefined,
  };

  it("promotes an integrity failure to the primary error state", () => {
    const integrity = deriveConnectionIntegrity(
      makeProject({ connections: [] }),
      DESCRIPTORS,
    );

    expect(applyConnectionIntegrity(base, integrity)).toEqual({
      state: "error",
      suppressed: ["empty"],
      error: undefined,
    });
  });

  it("keeps the underlying asynchronous diagnostics when it promotes", () => {
    const integrity = deriveConnectionIntegrity(
      makeProject({ connections: [] }),
      DESCRIPTORS,
    );
    const failedRefresh: DerivedAsyncState = {
      state: "stale",
      suppressed: ["error"],
      error: { code: "UNKNOWN", context: "TICKETS" },
    };

    expect(applyConnectionIntegrity(failedRefresh, integrity)).toEqual({
      state: "error",
      suppressed: ["stale"],
      error: { code: "UNKNOWN", context: "TICKETS" },
    });
  });

  it("leaves the derived state untouched when integrity holds", () => {
    const integrity = deriveConnectionIntegrity(
      makeProject({
        connections: [
          {
            providerId: "tracker-one",
            roles: ["tracker"],
            config: {
              host: "https://tracker.example",
              email: "dev@example.com",
            },
          },
        ],
      }),
      DESCRIPTORS,
    );

    expect(applyConnectionIntegrity(base, integrity)).toBe(base);
  });
});

describe("connectionDisplayValues", () => {
  it("lists the connection's recorded configuration using manifest labels", () => {
    const integrity = deriveConnectionIntegrity(
      makeProject({
        connections: [
          {
            providerId: "tracker-one",
            roles: ["tracker"],
            config: {
              host: "https://tracker.example",
              email: "dev@example.com",
              projectKey: "RKT",
            },
          },
        ],
      }),
      DESCRIPTORS,
    );

    expect(
      connectionDisplayValues(integrity.tracker, DESCRIPTORS).map((entry) => [
        entry.label,
        entry.value,
      ]),
    ).toEqual([
      ["Host", "https://tracker.example"],
      ["Email", "dev@example.com"],
      ["Project Key", "RKT"],
    ]);
  });

  it("ignores secret fields and configuration the manifest does not declare", () => {
    const integrity = deriveConnectionIntegrity(
      makeProject({
        connections: [
          {
            providerId: "dual-one",
            roles: ["tracker"],
            config: { host: "https://dual.example", pat: "should-not-render" },
          },
        ],
      }),
      DESCRIPTORS,
    );

    expect(
      connectionDisplayValues(integrity.tracker, DESCRIPTORS).map(
        (entry) => entry.value,
      ),
    ).toEqual(["https://dual.example"]);
  });
});
