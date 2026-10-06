// test/review-payload.test.ts — The creation payload builder (spec #133,
// #131/#145, ticket #146; correction 2).
//
// The payload is the one place the wizard commits its state, so its shape is
// asserted here against the SERVER's own schema — the authority on what
// `POST /api/projects` accepts — plus the three things the UI cannot produce on
// its own: a dual-role provider appearing on ONE connection, the connection's
// configuration being the PROVIDER's single authoritative configuration rather
// than any one role's copy of it, and a repository role tag that is not a
// repository role never being sent as one.
//
// There is no source-role selection to assert any more: the builder reads
// `connect.providerConfigs` by provider id, so the configuration a role
// verified and the configuration submitted are the same record by
// construction.

import { describe, expect, it } from "bun:test";
import { ConnectionsProjectInputSchema } from "../src/config-schema.js";
import { createInitialWizardState } from "../src/frontend/wizard/state/wizardReducer.js";
import {
  buildCreationPayload,
  type DiscoveredRepositoryDetail,
} from "../src/frontend/wizard/steps/reviewPayload.js";
import type { WizardSourceState } from "../src/frontend/wizard/types.js";

const IDENTITY = { name: "Repo Owner", email: "owner@example.com" };
const DISCOVERED: DiscoveredRepositoryDetail[] = [
  {
    id: "repo-app",
    name: "rocket-app",
    remote: "https://git.example.com/acme/rocket-app.git",
    defaultBranch: "main",
  },
];

function stateWith(options: {
  tracker?: { providerId: string };
  gitHost?: { providerId: string };
  /** The authoritative configuration of each selected provider. */
  configs?: Record<string, Record<string, unknown>>;
  repoRole?: { role: string; roles: string[]; localPath?: string };
}): WizardSourceState {
  const base = createInitialWizardState();
  return {
    ...base,
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
      providerConfigs: {
        "generic-tracker": { endpointHost: "https://t.example" },
        "generic-githost": { gitUrl: "https://git.example.com" },
        ...(options.configs ?? {}),
      },
      tracker: {
        providerId: options.tracker?.providerId ?? "generic-tracker",
        verified: true,
      },
      gitHost: {
        providerId: options.gitHost?.providerId ?? "generic-githost",
        verified: true,
      },
    },
    repositories: {
      selectedRepoIds: ["repo-app"],
      primaryRepoId: "repo-app",
      repoConfigs: {
        "repo-app": options.repoRole ?? {
          role: "gitHost",
          roles: ["gitHost"],
        },
      },
      selectionFingerprint: "cfp_recorded",
    },
  };
}

describe("buildCreationPayload", () => {
  it("carries the project-level fields, the in-memory connection config and the primary repository", () => {
    const payload = buildCreationPayload(stateWith({}), DISCOVERED, IDENTITY);

    expect(payload).toEqual({
      id: "rocket",
      name: "Rocket",
      description: undefined,
      workspacePath: "/work/rocket",
      gitIdentity: IDENTITY,
      connections: [
        {
          providerId: "generic-tracker",
          roles: ["tracker"],
          config: { endpointHost: "https://t.example" },
        },
        {
          providerId: "generic-githost",
          roles: ["gitHost"],
          config: { gitUrl: "https://git.example.com" },
        },
      ],
      repositories: [
        {
          id: "repo-app",
          name: "rocket-app",
          remote: "https://git.example.com/acme/rocket-app.git",
          defaultBranch: "main",
          localPath: undefined,
          role: undefined,
          primary: true,
        },
      ],
    });
    expect(ConnectionsProjectInputSchema.safeParse(payload).success).toBe(true);
  });

  it("sends ONE connection for a provider serving both roles, carrying BOTH roles and the provider's ONE configuration", () => {
    const state = stateWith({
      tracker: { providerId: "dual" },
      gitHost: { providerId: "dual" },
      configs: { dual: { serviceUrl: "https://d", pat: "pat-synthetic" } },
    });
    const payload = buildCreationPayload(state, DISCOVERED, IDENTITY);

    expect(payload.connections).toEqual([
      {
        providerId: "dual",
        roles: ["tracker", "gitHost"],
        config: { serviceUrl: "https://d", pat: "pat-synthetic" },
      },
    ]);
    // The submitted configuration IS the single configuration on record for
    // that provider — the same record both roles verified, not a copy of one
    // role's view of it (correction 2, #133).
    expect(payload.connections[0]?.config).toBe(
      state.connect.providerConfigs.dual,
    );
    expect(ConnectionsProjectInputSchema.safeParse(payload).success).toBe(true);
  });

  it("keeps two providers' configurations independent, and never invents a role a provider was not selected under", () => {
    // `generic-tracker` is offered for the tracker role only (the manifest's
    // role-filtered select cannot choose it as a git host), so the payload must
    // carry it with its OWN configuration and the tracker role alone.
    const state = stateWith({
      configs: {
        "generic-tracker": {
          endpointHost: "https://t.example",
          pat: "t-secret",
        },
        "generic-githost": { gitUrl: "https://git.example.com" },
      },
    });
    const payload = buildCreationPayload(state, DISCOVERED, IDENTITY);

    expect(payload.connections).toEqual([
      {
        providerId: "generic-tracker",
        roles: ["tracker"],
        config: { endpointHost: "https://t.example", pat: "t-secret" },
      },
      {
        providerId: "generic-githost",
        roles: ["gitHost"],
        config: { gitUrl: "https://git.example.com" },
      },
    ]);
    // Editing one provider's configuration cannot move the other's: the two
    // payload entries are exactly the two state records.
    expect(payload.connections[0]?.config).toBe(
      state.connect.providerConfigs["generic-tracker"],
    );
    expect(payload.connections[1]?.config).toBe(
      state.connect.providerConfigs["generic-githost"],
    );
    expect(ConnectionsProjectInputSchema.safeParse(payload).success).toBe(true);
  });

  it("passes a repository role tag that the contract knows, and never a connection role", () => {
    const known = buildCreationPayload(
      stateWith({ repoRole: { role: "backend", roles: ["gitHost"] } }),
      DISCOVERED,
      IDENTITY,
    );
    expect(known.repositories[0]?.role).toBe("backend");
    expect(ConnectionsProjectInputSchema.safeParse(known).success).toBe(true);

    // "gitHost" is a CONNECTION role: the contract's `role` is a repository
    // role, and sending the connection tag would be rejected by the transport.
    const connectionRole = buildCreationPayload(
      stateWith({ repoRole: { role: "gitHost", roles: ["gitHost"] } }),
      DISCOVERED,
      IDENTITY,
    );
    expect(connectionRole.repositories[0]?.role).toBeUndefined();
    expect(
      ConnectionsProjectInputSchema.safeParse(connectionRole).success,
    ).toBe(true);
  });
});
