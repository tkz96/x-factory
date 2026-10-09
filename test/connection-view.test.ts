// test/connection-view.test.ts — #176: ONE frontend module derives connection
// state from the two inputs that exist — the wizard's DRAFT and a project's
// RECORDED connections — over THE one role list.
//
// The seam is `deriveConnectionView` in
// `src/frontend/components/connections/connection-view.ts`: feed it each input
// and assert the slots a user's combo line renders, with literal expectations.
// The final case binds the recorded view into the post-creation
// `deriveConnectionIntegrity`, so a future split of the two derivations breaks
// this file.

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  connectionComboSlots,
  connectionViewSlots,
  deriveConnectionView,
} from "../src/frontend/components/connections/connection-view.js";
import { deriveConnectionIntegrity } from "../src/frontend/components/projects/connection-integrity.js";
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

describe("deriveConnectionView — draft and recorded through the same module", () => {
  it("derives the wizard draft's slots: verified → connected, degraded evidence → degraded", () => {
    const view = deriveConnectionView(
      {
        kind: "draft",
        evidence: {
          tracker: {
            providerId: "tracker-one",
            verified: true,
            unconfirmedCapabilities: [],
          },
          gitHost: {
            providerId: "githost-one",
            verified: true,
            unconfirmedCapabilities: ["listRepositories"],
          },
        },
        providerConfigs: {
          "tracker-one": {
            host: "https://t.example",
            email: "dev@example.com",
          },
          "githost-one": { orgUrl: "https://g.example" },
        },
      },
      DESCRIPTORS,
    );

    expect(connectionViewSlots(view)).toEqual([
      {
        role: "tracker",
        state: "connected",
        providerId: "tracker-one",
        config: {
          host: "https://t.example",
          email: "dev@example.com",
        },
        capabilities: ["listTickets", "verifyScopes"],
        warnings: [],
      },
      {
        role: "gitHost",
        state: "degraded",
        providerId: "githost-one",
        config: { orgUrl: "https://g.example" },
        capabilities: ["listRepositories"],
        warnings: [],
      },
    ]);
  });

  it("derives an unselected or unverified draft role as disconnected, naming no provider state", () => {
    const view = deriveConnectionView({
      kind: "draft",
      evidence: {
        tracker: { providerId: null, verified: false },
        gitHost: { providerId: "githost-one", verified: false },
      },
    });

    expect(connectionViewSlots(view)).toEqual([
      {
        role: "tracker",
        state: "disconnected",
        providerId: undefined,
        config: {},
        capabilities: [],
        warnings: [],
      },
      {
        role: "gitHost",
        state: "disconnected",
        providerId: "githost-one",
        config: {},
        capabilities: [],
        warnings: [],
      },
    ]);
  });

  it("derives a recorded project's slots: recorded → connected, incomplete config → degraded with its field labels, unrecorded role → disconnected", () => {
    const view = deriveConnectionView(
      {
        kind: "recorded",
        project: makeProject({
          connections: [
            {
              providerId: "tracker-one",
              roles: ["tracker"],
              config: {
                host: "https://t.example",
                email: "dev@example.com",
              },
            },
            {
              providerId: "githost-one",
              roles: ["gitHost"],
              config: { orgUrl: "https://g.example" },
            },
          ],
        }),
      },
      DESCRIPTORS,
    );

    expect(connectionViewSlots(view)).toEqual([
      {
        role: "tracker",
        state: "connected",
        providerId: "tracker-one",
        config: {
          host: "https://t.example",
          email: "dev@example.com",
        },
        capabilities: ["listTickets", "verifyScopes"],
        warnings: [],
      },
      {
        role: "gitHost",
        state: "degraded",
        providerId: "githost-one",
        config: { orgUrl: "https://g.example" },
        capabilities: ["listRepositories"],
        warnings: [
          {
            kind: "CONFIG_INCOMPLETE",
            role: "gitHost",
            details: ["Repository"],
          },
        ],
      },
    ]);
  });

  it("reports equivalent wiring identically from either input, in THE one role list's order", () => {
    // Same underlying wiring, two inputs: the states a user sees cannot depend
    // on which of the two producers fed the line.
    const draft = deriveConnectionView({
      kind: "draft",
      evidence: {
        tracker: {
          providerId: "tracker-one",
          verified: true,
          unconfirmedCapabilities: [],
        },
        gitHost: { providerId: null, verified: false },
      },
    });
    const recorded = deriveConnectionView(
      {
        kind: "recorded",
        project: makeProject({
          connections: [
            {
              providerId: "tracker-one",
              roles: ["tracker"],
              config: {
                host: "https://t.example",
                email: "dev@example.com",
              },
            },
          ],
        }),
      },
      DESCRIPTORS,
    );

    expect(connectionViewSlots(draft).map((slot) => slot.role)).toEqual([
      "tracker",
      "gitHost",
    ]);
    expect(draft.tracker.state).toBe("connected");
    expect(recorded.tracker.state).toBe("connected");
    expect(draft.gitHost.state).toBe("disconnected");
    expect(recorded.gitHost.state).toBe("disconnected");
  });

  it("maps a view to the combo line's slots with providerId null, never undefined", () => {
    const view = deriveConnectionView({
      kind: "draft",
      evidence: {
        tracker: { providerId: null },
        gitHost: { providerId: "githost-one", verified: true },
      },
    });

    expect(connectionComboSlots(connectionViewSlots(view))).toEqual([
      { role: "tracker", state: "disconnected", providerId: null },
      { role: "gitHost", state: "connected", providerId: "githost-one" },
    ]);
  });

  it("feeds the recorded view into the post-creation integrity unchanged", () => {
    const project = makeProject({
      connections: [
        {
          providerId: "tracker-one",
          roles: ["tracker"],
          config: { host: "https://t.example" },
        },
      ],
    });
    const integrity = deriveConnectionIntegrity(project, DESCRIPTORS);

    expect(integrity.tracker.state).toBe("degraded");
    expect(integrity.gitHost.state).toBe("disconnected");
    expect(integrity.hasIntegrityFailure).toBe(false);
    expect(integrity.isDegraded).toBe(true);
    expect(integrity.warnings).toEqual([
      {
        kind: "CONFIG_INCOMPLETE",
        role: "tracker",
        details: ["Email"],
      },
      {
        kind: "ROLE_NOT_RECORDED",
        role: "gitHost",
        details: ["gitHost"],
      },
    ]);
  });

  it("is the ONLY derivation: both the wizard's Review step and the post-creation integrity call it", () => {
    // A structural guard at the same seam: if either surface grows its own
    // derivation again, this fails even where output-equivalence tests pass.
    const read = (relativePath: string) =>
      readFileSync(join(import.meta.dir, "..", relativePath), "utf8");

    expect(read("src/frontend/wizard/steps/ReviewStep.tsx")).toContain(
      "deriveConnectionView(",
    );
    expect(
      read("src/frontend/components/projects/connection-integrity.ts"),
    ).toContain("deriveConnectionView(");
    // The retired per-role draft producer must not come back anywhere.
    const offenders: string[] = [];
    const frontendRoot = join(import.meta.dir, "..", "src", "frontend");
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          if (readFileSync(path, "utf8").includes("comboSlotFromEvidence")) {
            offenders.push(path.slice(frontendRoot.length + 1));
          }
        }
      }
    };
    walk(frontendRoot);
    expect(offenders).toEqual([]);
  });
});
