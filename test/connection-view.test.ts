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
  CREATION_REQUIRED_ROLES,
  deriveConnectionView,
  draftComboSlots,
} from "../src/frontend/components/connections/connection-view.js";
import { deriveConnectionIntegrity } from "../src/frontend/components/projects/connection-integrity.js";
import type { ProviderDescriptor } from "../src/frontend/connection/types.js";
import { PROJECT_CONNECTION_ROLES, type Project } from "../src/shared/types.js";

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

    expect(PROJECT_CONNECTION_ROLES.map((role) => view[role])).toEqual([
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

    expect(PROJECT_CONNECTION_ROLES.map((role) => view[role])).toEqual([
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

    expect(PROJECT_CONNECTION_ROLES.map((role) => view[role])).toEqual([
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

    expect(PROJECT_CONNECTION_ROLES.map((role) => draft[role].role)).toEqual([
      "tracker",
      "gitHost",
    ]);
    expect(draft.tracker.state).toBe("connected");
    expect(recorded.tracker.state).toBe("connected");
    expect(draft.gitHost.state).toBe("disconnected");
    expect(recorded.gitHost.state).toBe("disconnected");
  });

  it("maps a draft to the combo line's slots with providerId null, never undefined", () => {
    const slots = draftComboSlots({
      kind: "draft",
      evidence: {
        tracker: { providerId: null },
        gitHost: { providerId: "githost-one", verified: true },
      },
    });

    expect(slots).toEqual([
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

  it("is the ONLY derivation: the Review step reaches it through draftComboSlots, the post-creation integrity calls it directly", () => {
    // A structural guard at the same seam: if either surface grows its own
    // derivation again, this fails even where output-equivalence tests pass.
    const read = (relativePath: string) =>
      readFileSync(join(import.meta.dir, "..", relativePath), "utf8");

    const reviewStep = read("src/frontend/wizard/steps/ReviewStep.tsx");
    expect(reviewStep).toContain("draftComboSlots(");
    // The derive → render-order → line-vocabulary chain stays hidden behind
    // that one function (#176): the step itself touches none of it directly.
    expect(reviewStep).not.toContain("deriveConnectionView(");
    expect(reviewStep).not.toContain("connectionViewSlots(");
    expect(reviewStep).not.toContain("connectionComboSlots(");
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

  it("is the ONE three-state rule: exactly one frontend module returns connected/degraded/disconnected", () => {
    // #176 MUST-FIX 1: the connected/degraded/disconnected rule may be encoded
    // in exactly ONE module — the function BOTH the draft branch and the
    // recorded branch call. The rule's own literal `return "disconnected"` in a
    // second module fails this scan, whatever that second copy claims.
    const filesWithRule: string[] = [];
    const frontendRoot = join(import.meta.dir, "..", "src", "frontend");
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (
          /\.(ts|tsx)$/.test(entry.name) &&
          readFileSync(path, "utf8").includes('return "disconnected"')
        ) {
          filesWithRule.push(path.slice(frontendRoot.length + 1));
        }
      }
    };
    walk(frontendRoot);

    expect(filesWithRule.sort()).toEqual([
      "components/connections/connection-state.ts",
    ]);
  });

  it("maps BOTH inputs through one truth table: usable→connected, usable+warnings→degraded, unusable→disconnected (warnings and all)", () => {
    // The one rule's literal truth table, fed from each of the two inputs —
    // so either branch drifting from the rule breaks this at the seam.
    const draft = deriveConnectionView({
      kind: "draft",
      evidence: {
        // Unusable, but carrying unconfirmed warnings: disconnected wins.
        tracker: {
          providerId: null,
          verified: false,
          unconfirmedCapabilities: ["listTickets"],
        },
        gitHost: {
          providerId: "githost-one",
          verified: true,
          unconfirmedCapabilities: [],
        },
      },
    });
    expect(draft.tracker.state).toBe("disconnected");
    expect(draft.gitHost.state).toBe("connected");

    const recorded = deriveConnectionView(
      {
        kind: "recorded",
        project: makeProject({
          connections: [
            {
              providerId: "githost-one",
              roles: ["gitHost"],
              config: { orgUrl: "https://g.example", repo: "rocket" },
            },
          ],
        }),
      },
      DESCRIPTORS,
    );
    // No tracker connection recorded at all, yet its role carries a
    // ROLE_NOT_RECORDED warning: disconnected still wins over warnings.
    expect(recorded.tracker.state).toBe("disconnected");
    expect(recorded.tracker.warnings.map((w) => w.kind)).toEqual([
      "ROLE_NOT_RECORDED",
    ]);
    expect(recorded.gitHost.state).toBe("connected");
  });

  it("draftComboSlots hides the Review step's chain behind one call, with the same literals", () => {
    // The whole chain the Review step used to nest — derive the view, take
    // THE list's slots in render order, map to the line's vocabulary — is one
    // function on the one module (#176 SHOULD 2).
    const slots = draftComboSlots(
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
        providerConfigs: { "tracker-one": { host: "https://t.example" } },
      },
      DESCRIPTORS,
    );

    expect(slots).toEqual([
      { role: "tracker", state: "connected", providerId: "tracker-one" },
      { role: "gitHost", state: "degraded", providerId: "githost-one" },
    ]);
  });

  it("names the Review line's requirement as 'required at creation': one exported constant, the all-roles value", () => {
    // The Review line passes "required at creation" to `comboTone`, not the
    // incidental list of roles a line can render (#176 SHOULD 3).
    expect(CREATION_REQUIRED_ROLES).toEqual(["tracker", "gitHost"]);
    expect(CREATION_REQUIRED_ROLES).toBe(PROJECT_CONNECTION_ROLES);

    const reviewStep = readFileSync(
      join(import.meta.dir, "..", "src/frontend/wizard/steps/ReviewStep.tsx"),
      "utf8",
    );
    expect(reviewStep).toContain(
      "comboTone(comboSlots, CREATION_REQUIRED_ROLES)",
    );
    expect(reviewStep).not.toContain("PROJECT_CONNECTION_ROLES");
  });
});
