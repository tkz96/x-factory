// test/review-payload.test.ts — The creation payload builder (spec #133,
// #131/#145, ticket #146).
//
// The payload is the one place the wizard commits its state, so its shape is
// asserted here against the SERVER's own schema — the authority on what
// `POST /api/projects` accepts — plus the two groupings the UI cannot produce
// on its own: a dual-role provider appearing on ONE connection, and a
// repository role tag that is not a repository role never being sent as one.

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
  tracker?: { providerId: string; config: Record<string, unknown> };
  gitHost?: { providerId: string; config: Record<string, unknown> };
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
      tracker: {
        providerId: options.tracker?.providerId ?? "generic-tracker",
        config: options.tracker?.config ?? {
          endpointHost: "https://t.example",
        },
        verified: true,
      },
      gitHost: {
        providerId: options.gitHost?.providerId ?? "generic-githost",
        config: options.gitHost?.config ?? {
          gitUrl: "https://git.example.com",
        },
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

  it("sends ONE connection for a provider serving both roles, with the git host's config", () => {
    const payload = buildCreationPayload(
      stateWith({
        tracker: { providerId: "dual", config: { serviceUrl: "https://d" } },
        gitHost: { providerId: "dual", config: { serviceUrl: "https://d" } },
      }),
      DISCOVERED,
      IDENTITY,
    );

    expect(payload.connections).toEqual([
      {
        providerId: "dual",
        roles: ["tracker", "gitHost"],
        config: { serviceUrl: "https://d" },
      },
    ]);
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
