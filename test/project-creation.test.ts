// test/project-creation.test.ts — Project creation from the normalized
// connections payload (#145 / parent spec #133).
//
// Highest seam: the real HTTP route with providers injected through the
// explicit static registry. Env storage and the projects config file are
// pointed at a temp dir through the documented path env overrides, so no
// real ~/.x-factory or repository state is touched. Only synthetic
// credentials are used.

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod/v4";
import { loadProjects } from "../src/config.js";
import {
  type ConnectionsProjectInput,
  missingConnectionRoleCodes,
} from "../src/config-schema.js";
import { ConflictError, SemanticValidationError } from "../src/errors.js";
import { getLocksDir, getProjectEnvPath } from "../src/paths.js";
import { loadProjectEnv, saveProjectEnv } from "../src/project-env.js";
import type {
  Provider,
  ProviderConfigFieldMeta,
} from "../src/providers/contract.js";
import { resolveProjectConnection } from "../src/providers/project-connections.js";
import { PROVIDER_REGISTRY } from "../src/providers/registry.js";
import { startServer } from "../src/server.js";
import {
  assertConnectionRoleCoverage,
  FILE_PROJECT_WRITE_STORE,
  type ProjectWriteStore,
} from "../src/services/connection-write-plan.js";
import {
  ClaimLostError,
  getCreationClaimPath,
  withCreationClaim,
} from "../src/services/creation-claim.js";
import {
  createProjectFromConnections,
  type UpdateProjectConnectionsInput,
  updateProjectConnections,
} from "../src/services/project-creation.js";
import type { Project } from "../src/types.js";
import { stubProvider } from "./fixtures/stub-provider.js";

const MARKER_JIRA_TOKEN = "synthetic-jira-token-3f9a";
const MARKER_GITHUB_TOKEN = "synthetic-github-token-7c1b";
const MARKER_STUB_TOKEN = "synthetic-stub-token-91de";

// A stub with the capabilities a tracker/git-host connection requires, so the
// role/capability gate exercises its passing path for injected providers.
const capableStubProvider: Provider = {
  ...stubProvider,
  id: "stub-capable",
  displayName: "Capable Stub",
  async listRepositories() {
    return [
      {
        id: "stub-repo",
        name: "web",
        remote: "https://stub.example/acme/web.git",
        defaultBranch: "main",
      },
    ];
  },
  async listTickets() {
    return [];
  },
  async createPullRequest() {
    return { url: "https://stub.example/acme/web/pull/1" };
  },
  async findExistingPullRequest() {
    return null;
  },
};

/** Returns a copy of a provider with the named capabilities removed. */
function withoutCapabilities(
  provider: Provider,
  names: readonly string[],
): Provider {
  const copy: Record<string, unknown> = { ...provider };
  for (const name of names) delete copy[name];
  return copy as unknown as Provider;
}

/** Serves both roles but cannot list tickets — a tracker-role mismatch. */
const noTicketsStubProvider: Provider = {
  ...withoutCapabilities(capableStubProvider, ["listTickets"]),
  id: "stub-no-tickets",
  displayName: "No Tickets Stub",
};

/** Serves both roles but cannot open/find pull requests — a git-host mismatch. */
const noPullRequestsStubProvider: Provider = {
  ...withoutCapabilities(capableStubProvider, [
    "createPullRequest",
    "findExistingPullRequest",
  ]),
  id: "stub-no-prs",
  displayName: "No Pull Requests Stub",
};

const trackerOnlyStubProvider: Provider = {
  ...capableStubProvider,
  id: "stub-tracker-only",
  displayName: "Tracker Only Stub",
  roles: ["tracker"],
};

/**
 * Declares an optional secret, so the update contract's "clear removes a
 * stored secret" path has a field that may legally be absent.
 */
const optionalSecretStubProvider: Provider = {
  ...capableStubProvider,
  id: "stub-optional-secret",
  displayName: "Optional Secret Stub",
  configSchema: z.object({
    host: z
      .string()
      .min(1)
      .meta({
        label: "Host",
        uiType: "url",
      } as ProviderConfigFieldMeta),
    apiToken: z
      .string()
      .min(1)
      .meta({
        label: "API token",
        uiType: "secret",
        secret: true,
        envKey: "STUB_API_TOKEN",
      } as ProviderConfigFieldMeta),
    backupToken: z
      .string()
      .optional()
      .meta({
        label: "Backup token",
        uiType: "secret",
        secret: true,
        envKey: "STUB_BACKUP_TOKEN",
      } as ProviderConfigFieldMeta),
    project: z
      .string()
      .min(1)
      .meta({
        label: "Project",
        uiType: "text",
      } as ProviderConfigFieldMeta),
  }),
};

const testRegistry: Map<string, Provider> = new Map<string, Provider>([
  ...PROVIDER_REGISTRY,
  [capableStubProvider.id, capableStubProvider],
  [noTicketsStubProvider.id, noTicketsStubProvider],
  [noPullRequestsStubProvider.id, noPullRequestsStubProvider],
  [trackerOnlyStubProvider.id, trackerOnlyStubProvider],
  [optionalSecretStubProvider.id, optionalSecretStubProvider],
]);

let server: ReturnType<typeof startServer>;
let baseUrl: string;
let tempDir: string;
let configPath: string;

const originalDataDir = process.env.X_FACTORY_DATA_DIR;
const originalConfigPath = process.env.X_FACTORY_CONFIG_PATH;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "xf-project-creation-"));
  process.env.X_FACTORY_DATA_DIR = path.join(tempDir, "data");
  configPath = path.join(tempDir, "config", "projects.json");
  process.env.X_FACTORY_CONFIG_PATH = configPath;
  server = startServer(0, undefined, undefined, testRegistry);
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(async () => {
  server.stop(true);
  if (originalDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
  else process.env.X_FACTORY_DATA_DIR = originalDataDir;
  if (originalConfigPath === undefined)
    delete process.env.X_FACTORY_CONFIG_PATH;
  else process.env.X_FACTORY_CONFIG_PATH = originalConfigPath;
  await rm(tempDir, { recursive: true, force: true });
});

interface ConnectionsPayload {
  id: string;
  name: string;
  workspacePath: string;
  gitIdentity?: { name: string; email: string };
  connections: Array<{
    providerId: string;
    roles: string[];
    config: Record<string, unknown>;
  }>;
  repositories: Array<Record<string, unknown>>;
}

function jiraAndGithubPayload(id: string): ConnectionsPayload {
  return {
    id,
    name: "Rocket",
    workspacePath: tempDir,
    gitIdentity: { name: "Rocket Dev", email: "dev@example.com" },
    connections: [
      {
        providerId: "jira",
        roles: ["tracker"],
        config: {
          host: "https://rocket.atlassian.net",
          email: "dev@example.com",
          apiToken: MARKER_JIRA_TOKEN,
          project: "ROCKET",
        },
      },
      {
        providerId: "github",
        roles: ["gitHost"],
        config: {
          token: MARKER_GITHUB_TOKEN,
          repoOwner: "acme",
          repository: "web",
        },
      },
    ],
    repositories: [
      {
        id: `${id}-web`,
        name: "web",
        remote: "https://github.com/acme/web.git",
        defaultBranch: "main",
        localPath: path.join(tempDir, "web"),
        role: "frontend",
        primary: true,
      },
    ],
  };
}

async function createProject(
  payload: unknown,
  base: string = baseUrl,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

async function readStoredProject(id: string): Promise<Project | undefined> {
  const raw = JSON.parse(await readFile(configPath, "utf-8")) as {
    projects: Project[];
  };
  return raw.projects.find((p) => p.id === id);
}

/**
 * A VALID payload (#133) for the store failure-injection tests: it must clear
 * the pre-write validation ladder so the ordered writes actually RUN and the
 * injected store failure is what stops them.
 */
function storeFailurePayload(id: string): ConnectionsProjectInput {
  return {
    id,
    name: "Store Failure Injection",
    workspacePath: tempDir,
    connections: [
      {
        providerId: "stub-capable",
        roles: ["tracker", "gitHost"],
        config: {
          host: "https://stub.example",
          apiToken: MARKER_STUB_TOKEN,
          project: "store-failure",
        },
      },
    ],
    repositories: [
      {
        id: `${id}-web`,
        name: "web",
        localPath: path.join(tempDir, "web"),
        role: "backend",
      },
    ],
  };
}

describe("POST /api/projects with a connections payload", () => {
  it("creates the project, keeps legacy runtime fields populated and stores a secret-free connection record", async () => {
    const projectId = `rocket-${Date.now()}-a`;
    const { status, body } = await createProject(
      jiraAndGithubPayload(projectId),
    );
    expect(status).toBe(201);

    // Identity and git identity travel at project level, never in a connection.
    expect(body.id).toBe(projectId);
    expect(body.name).toBe("Rocket");
    expect(body.gitIdentity).toEqual({
      name: "Rocket Dev",
      email: "dev@example.com",
    });

    // Connections keep their declared roles; secret fields never reach the record.
    expect(body.connections).toEqual([
      {
        providerId: "jira",
        roles: ["tracker"],
        config: {
          host: "https://rocket.atlassian.net",
          email: "dev@example.com",
          project: "ROCKET",
        },
      },
      {
        providerId: "github",
        roles: ["gitHost"],
        config: { repoOwner: "acme", repository: "web" },
      },
    ]);

    // Legacy runtime fields stay populated for queue/deliver/readiness.
    expect(body.repositoryPath).toBe(path.join(tempDir, "web"));
    expect(body.defaultBranch).toBe("main");
    expect(body.repositories).toEqual([
      {
        id: `${projectId}-web`,
        name: "web",
        remote: "https://github.com/acme/web.git",
        path: path.join(tempDir, "web"),
        defaultBranch: "main",
        role: "frontend",
      },
    ]);
    expect(body.issueTracker).toEqual({
      provider: "jira",
      connectionId: "jira",
      projectId: "ROCKET",
      jira: {
        host: "https://rocket.atlassian.net",
        email: "dev@example.com",
        project: "ROCKET",
      },
    });

    // H4: the Jira tracker config actually persists — read the record back
    // from disk, not from in-memory state.
    const stored = await readStoredProject(projectId);
    expect(stored?.connections?.[0]?.config).toEqual({
      host: "https://rocket.atlassian.net",
      email: "dev@example.com",
      project: "ROCKET",
    });
    expect(stored?.issueTracker?.jira).toEqual({
      host: "https://rocket.atlassian.net",
      email: "dev@example.com",
      project: "ROCKET",
    });
    expect(stored?.gitIdentity).toEqual({
      name: "Rocket Dev",
      email: "dev@example.com",
    });
  });

  it("writes connection secrets to per-project env storage under the provider-declared envKey (H5)", async () => {
    const projectId = `rocket-${Date.now()}-b`;
    const { status } = await createProject(jiraAndGithubPayload(projectId));
    expect(status).toBe(201);

    // Read the secret store straight from disk: no in-memory carry-over.
    const envFile = await readFile(getProjectEnvPath(projectId), "utf-8");
    expect(envFile).toContain(`JIRA_API_TOKEN=${MARKER_JIRA_TOKEN}`);
    expect(envFile).toContain(`GITHUB_TOKEN=${MARKER_GITHUB_TOKEN}`);

    const env = await loadProjectEnv(projectId);
    expect(env.JIRA_API_TOKEN).toBe(MARKER_JIRA_TOKEN);
    expect(env.GITHUB_TOKEN).toBe(MARKER_GITHUB_TOKEN);

    // The persisted secret is still usable by project provider resolution
    // after a fresh read of both artifacts (process-restart equivalence).
    const stored = await readStoredProject(projectId);
    expect(stored).toBeDefined();
    const resolved = resolveProjectConnection(
      stored as Project,
      "tracker",
      env,
    );
    expect(resolved?.provider.id).toBe("jira");
    expect(resolved?.config.host).toBe("https://rocket.atlassian.net");
    expect(resolved?.config.apiToken).toBe(MARKER_JIRA_TOKEN);
  });

  it("accepts one same-provider dual-role connection", async () => {
    const projectId = `rocket-${Date.now()}-dual`;
    const payload: ConnectionsPayload = {
      id: projectId,
      name: "Dual Role",
      workspacePath: tempDir,
      connections: [
        {
          providerId: "stub-capable",
          roles: ["tracker", "gitHost"],
          config: {
            host: "https://stub.example",
            apiToken: MARKER_STUB_TOKEN,
            project: "rocket",
          },
        },
      ],
      repositories: [
        {
          id: `${projectId}-web`,
          name: "web",
          localPath: path.join(tempDir, "web"),
          role: "backend",
          primary: true,
        },
      ],
    };

    const { status, body } = await createProject(payload);
    expect(status).toBe(201);
    expect(body.connections).toEqual([
      {
        providerId: "stub-capable",
        roles: ["tracker", "gitHost"],
        config: { host: "https://stub.example", project: "rocket" },
      },
    ]);
    expect((await loadProjectEnv(projectId)).STUB_API_TOKEN).toBe(
      MARKER_STUB_TOKEN,
    );
  });

  describe("Validation layering on POST /api/projects (connections payload)", () => {
    const baseId = () =>
      `layers-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    function minimalPayload(
      id: string,
      connection: {
        providerId?: string;
        roles?: string[];
        config?: Record<string, unknown>;
      } = {},
    ): ConnectionsPayload {
      return {
        id,
        name: "Layered",
        workspacePath: tempDir,
        connections: [
          {
            providerId: connection.providerId ?? "stub-capable",
            // The default is a VALID payload under #133: one dual-role
            // connection covers both required roles. Tests that need a
            // single-role (invalid) set override `roles` explicitly.
            roles: connection.roles ?? ["tracker", "gitHost"],
            config: connection.config ?? {
              host: "https://stub.example",
              apiToken: MARKER_STUB_TOKEN,
              project: "layered",
            },
          },
        ],
        repositories: [
          {
            id: `${id}-web`,
            name: "web",
            localPath: path.join(tempDir, "web"),
            role: "backend",
          },
        ],
      };
    }

    it("rejects transport-invalid payloads with 400", async () => {
      const id = baseId();

      // Missing connections entirely (a legacy payload cannot satisfy the
      // normalized shape either).
      const missing = await createProject({
        id,
        name: "Nope",
        repositories: [{ id: "r", name: "r", role: "backend" }],
      });
      expect(missing.status).toBe(400);

      // No repositories.
      const noRepos = await createProject({
        ...minimalPayload(id),
        repositories: [],
      });
      expect(noRepos.status).toBe(400);

      // A connection with no roles.
      const noRoles = await createProject({
        ...minimalPayload(id),
        connections: [
          {
            providerId: "stub-capable",
            roles: [],
            config: { host: "https://stub.example" },
          },
        ],
      });
      expect(noRoles.status).toBe(400);

      // Wrong types.
      const wrongTypes = await createProject({
        ...minimalPayload(id),
        connections: "not-an-array",
      });
      expect(wrongTypes.status).toBe(400);

      // Knowledge-only repositories are not application repositories.
      const knowledgeOnly = await createProject({
        ...minimalPayload(id),
        repositories: [{ id: "k", name: "knowledge", role: "knowledge" }],
      });
      expect(knowledgeOnly.status).toBe(400);
    });

    it("rejects an unknown provider with 409 UNKNOWN_PROVIDER", async () => {
      const id = baseId();
      const { status, body } = await createProject(
        minimalPayload(id, { providerId: "no-such-provider" }),
      );
      expect(status).toBe(409);
      expect(body).toEqual({ formErrors: ["UNKNOWN_PROVIDER"] });
      expect(await readStoredProject(id)).toBeUndefined();
    });

    it("rejects a provider config that fails the provider's own schema with fieldErrors codes", async () => {
      const id = baseId();
      // `apiToken` is required by the stub schema and absent here.
      const { status, body } = await createProject(
        minimalPayload(id, {
          config: { host: "https://stub.example", project: "layered" },
        }),
      );
      expect(status).toBe(409);
      expect(body).toEqual({ fieldErrors: { apiToken: "REQUIRED" } });

      // An empty required value is REQUIRED, not a stored empty secret.
      const invalid = await createProject(
        minimalPayload(baseId(), {
          config: {
            host: "https://stub.example",
            apiToken: MARKER_STUB_TOKEN,
            project: "",
          },
        }),
      );
      expect(invalid.status).toBe(409);
      expect(invalid.body).toEqual({ fieldErrors: { project: "REQUIRED" } });
      expect(await readStoredProject(id)).toBeUndefined();
    });

    it("takes the normalized path when a payload carries both a legacy issueTracker and connections", async () => {
      const id = baseId();

      // The validated union decides the path, and its normalized branch is what
      // a payload with `connections` satisfies. The supplied legacy mirror must
      // be ignored, never preferred: a hand-written issueTracker alongside real
      // connections would otherwise silently become the project's tracker view.
      const { status, body } = await createProject({
        ...minimalPayload(id),
        issueTracker: { provider: "github", connectionId: "github" },
      });
      expect(status).toBe(201);

      const issueTracker = body.issueTracker as { provider?: string };
      expect(issueTracker.provider).toBe("stub-capable");
    });

    it("rejects a payload with no tracker connection with 409 MISSING_TRACKER_CONNECTION before any write", async () => {
      const id = baseId();

      // A git-host connection and nothing else: both connections are mandatory
      // at creation (#133), so this is not a project X-Factory will hold.
      const { status, body } = await createProject({
        ...minimalPayload(id),
        connections: [
          {
            providerId: "stub-capable",
            roles: ["gitHost"],
            config: {
              host: "https://stub.example",
              apiToken: MARKER_STUB_TOKEN,
              project: "git-host-only",
            },
          },
        ],
      });

      expect(status).toBe(409);
      expect(body).toEqual({ formErrors: ["MISSING_TRACKER_CONNECTION"] });

      // Rejected before ANY write: no record, and not even the project's env
      // storage directory was created.
      expect((await loadProjects(configPath)).some((p) => p.id === id)).toBe(
        false,
      );
      await expect(stat(getProjectEnvPath(id))).rejects.toThrow();
      expect(await loadProjectEnv(id)).toEqual({});
    });

    it("rejects a payload with a tracker connection but no git host with 409 MISSING_GIT_HOST_CONNECTION", async () => {
      const id = baseId();

      // A tracker connection and nothing else: the set covers only one role, so
      // the project would exist without a usable git host — a wiring the
      // post-creation integrity surface can only report as broken.
      const { status, body } = await createProject(
        minimalPayload(id, { roles: ["tracker"] }),
      );

      // 409, never 400: the transport shape is valid, so the rejection is the
      // SEMANTIC layer's own — the payload reaches role coverage.
      expect(status).toBe(409);
      expect(body).toEqual({ formErrors: ["MISSING_GIT_HOST_CONNECTION"] });

      // Rejected before ANY write: no record, no env storage, no secret.
      expect((await loadProjects(configPath)).some((p) => p.id === id)).toBe(
        false,
      );
      await expect(stat(getProjectEnvPath(id))).rejects.toThrow();
      expect(await loadProjectEnv(id)).toEqual({});
    });

    it("persists the project when the connection set covers both roles, as two connections or as one dual-role connection", async () => {
      // (a) Two different providers, one connection per role.
      const splitId = baseId();
      const split = await createProject({
        ...minimalPayload(splitId),
        connections: [
          {
            providerId: "stub-tracker-only",
            roles: ["tracker"],
            config: {
              host: "https://stub.example",
              apiToken: MARKER_STUB_TOKEN,
              project: "split",
            },
          },
          {
            providerId: "stub-capable",
            roles: ["gitHost"],
            config: {
              host: "https://stub.example",
              apiToken: MARKER_STUB_TOKEN,
              project: "split",
            },
          },
        ],
      });
      expect(split.status).toBe(201);

      // Read the record back from disk: both connections and both roles landed.
      const splitStored = await readStoredProject(splitId);
      expect(splitStored?.connections).toEqual([
        {
          providerId: "stub-tracker-only",
          roles: ["tracker"],
          config: { host: "https://stub.example", project: "split" },
        },
        {
          providerId: "stub-capable",
          roles: ["gitHost"],
          config: { host: "https://stub.example", project: "split" },
        },
      ]);

      // (b) ONE provider carrying both roles.
      const dualId = baseId();
      const dual = await createProject(
        minimalPayload(dualId, { roles: ["tracker", "gitHost"] }),
      );
      expect(dual.status).toBe(201);

      const dualStored = await readStoredProject(dualId);
      // Exactly one connection, and it covers both roles.
      expect(dualStored?.connections).toHaveLength(1);
      expect(dualStored?.connections?.[0]?.roles).toEqual([
        "tracker",
        "gitHost",
      ]);
    });

    it("names every missing role at once, so one rejection teaches both gaps", () => {
      // Unreachable through the transport (a connection declares at least one
      // role), but the rule is a set operation over `roles`: a degenerate set
      // must name BOTH gaps rather than whichever role the gate looked for
      // first.
      expect(missingConnectionRoleCodes([])).toEqual([
        "MISSING_TRACKER_CONNECTION",
        "MISSING_GIT_HOST_CONNECTION",
      ]);
      expect(missingConnectionRoleCodes([{ roles: ["tracker"] }])).toEqual([
        "MISSING_GIT_HOST_CONNECTION",
      ]);
      expect(
        missingConnectionRoleCodes([
          { roles: ["tracker"] },
          { roles: ["gitHost"] },
        ]),
      ).toEqual([]);
      expect(
        missingConnectionRoleCodes([{ roles: ["tracker", "gitHost"] }]),
      ).toEqual([]);
    });

    it("enforces unique role ownership across connections (#133 / PR #158 Task 1)", () => {
      // (a) Exactly one owner per required role is accepted
      const validSplit = assertConnectionRoleCoverage([
        { providerId: "p1", roles: ["tracker"] },
        { providerId: "p2", roles: ["gitHost"] },
      ]);
      expect(validSplit.tracker.providerId).toBe("p1");
      expect(validSplit.gitHost.providerId).toBe("p2");

      const validDual = assertConnectionRoleCoverage([
        { providerId: "p1", roles: ["tracker", "gitHost"] },
      ]);
      expect(validDual.tracker.providerId).toBe("p1");
      expect(validDual.gitHost.providerId).toBe("p1");

      // (b) More than one owner for a required role throws INCOMPATIBLE_CONFIGURATION
      function expectIncompatible(
        connections: Array<{
          providerId: string;
          roles: ("tracker" | "gitHost")[];
        }>,
      ): void {
        try {
          assertConnectionRoleCoverage(connections);
          expect.unreachable("expected incompatible configuration error");
        } catch (err) {
          expect(err).toBeInstanceOf(SemanticValidationError);
          expect((err as SemanticValidationError).formErrors).toEqual([
            "INCOMPATIBLE_CONFIGURATION",
          ]);
        }
      }

      // Duplicate tracker (with gitHost present)
      expectIncompatible([
        { providerId: "p1", roles: ["tracker"] },
        { providerId: "p2", roles: ["tracker"] },
        { providerId: "p3", roles: ["gitHost"] },
      ]);

      // Duplicate gitHost (with tracker present)
      expectIncompatible([
        { providerId: "p1", roles: ["tracker"] },
        { providerId: "p2", roles: ["gitHost"] },
        { providerId: "p3", roles: ["gitHost"] },
      ]);

      // Dual-role connection + additional tracker connection
      expectIncompatible([
        { providerId: "p1", roles: ["tracker", "gitHost"] },
        { providerId: "p2", roles: ["tracker"] },
      ]);

      // Dual-role connection + additional gitHost connection
      expectIncompatible([
        { providerId: "p1", roles: ["tracker", "gitHost"] },
        { providerId: "p2", roles: ["gitHost"] },
      ]);

      // Multiple dual-role connections
      expectIncompatible([
        { providerId: "p1", roles: ["tracker", "gitHost"] },
        { providerId: "p2", roles: ["tracker", "gitHost"] },
      ]);

      // When gitHost is missing, missing role takes precedence
      try {
        assertConnectionRoleCoverage([
          { providerId: "p1", roles: ["tracker"] },
          { providerId: "p2", roles: ["tracker"] },
        ]);
        expect.unreachable("expected missing gitHost error");
      } catch (err) {
        expect(err).toBeInstanceOf(SemanticValidationError);
        expect((err as SemanticValidationError).formErrors).toEqual([
          "MISSING_GIT_HOST_CONNECTION",
        ]);
      }

      // When tracker is missing, missing role takes precedence
      try {
        assertConnectionRoleCoverage([
          { providerId: "p1", roles: ["gitHost"] },
          { providerId: "p2", roles: ["gitHost"] },
        ]);
        expect.unreachable("expected missing tracker error");
      } catch (err) {
        expect(err).toBeInstanceOf(SemanticValidationError);
        expect((err as SemanticValidationError).formErrors).toEqual([
          "MISSING_TRACKER_CONNECTION",
        ]);
      }
    });

    it("rejects a payload with duplicate tracker ownership with 409 INCOMPATIBLE_CONFIGURATION before any write", async () => {
      const id = baseId();
      const secretA = "synthetic-secret-tracker-a";
      const secretB = "synthetic-secret-tracker-b";

      const { status, body } = await createProject({
        ...minimalPayload(id),
        connections: [
          {
            providerId: "jira",
            roles: ["tracker"],
            config: {
              host: "https://jira.example",
              email: "dev@example.com",
              apiToken: secretA,
              project: "JIRA",
            },
          },
          {
            providerId: "stub-tracker-only",
            roles: ["tracker"],
            config: {
              host: "https://stub.example",
              apiToken: secretB,
              project: "stub",
            },
          },
          {
            providerId: "github",
            roles: ["gitHost"],
            config: {
              token: MARKER_GITHUB_TOKEN,
              repoOwner: "acme",
              repository: "web",
            },
          },
        ],
      });

      // Semantic 409 Conflict, not transport 400 Bad Request
      expect(status).toBe(409);
      expect(body).toEqual({ formErrors: ["INCOMPATIBLE_CONFIGURATION"] });

      // Pre-write rejection: no record written, no env directory/file created
      expect((await loadProjects(configPath)).some((p) => p.id === id)).toBe(
        false,
      );
      await expect(stat(getProjectEnvPath(id))).rejects.toThrow();
      expect(await loadProjectEnv(id)).toEqual({});
    });

    it("rejects a payload with duplicate gitHost ownership with 409 INCOMPATIBLE_CONFIGURATION before any write", async () => {
      const id = baseId();

      const { status, body } = await createProject({
        ...minimalPayload(id),
        connections: [
          {
            providerId: "stub-tracker-only",
            roles: ["tracker"],
            config: {
              host: "https://stub.example",
              apiToken: MARKER_STUB_TOKEN,
              project: "stub",
            },
          },
          {
            providerId: "stub-capable",
            roles: ["gitHost"],
            config: {
              host: "https://stub.example",
              apiToken: MARKER_STUB_TOKEN,
              project: "git1",
            },
          },
          {
            providerId: "github",
            roles: ["gitHost"],
            config: {
              token: MARKER_GITHUB_TOKEN,
              repoOwner: "acme",
              repository: "web",
            },
          },
        ],
      });

      expect(status).toBe(409);
      expect(body).toEqual({ formErrors: ["INCOMPATIBLE_CONFIGURATION"] });

      expect((await loadProjects(configPath)).some((p) => p.id === id)).toBe(
        false,
      );
      await expect(stat(getProjectEnvPath(id))).rejects.toThrow();
      expect(await loadProjectEnv(id)).toEqual({});
    });

    it("rejects a dual-role connection with an additional tracker connection with 409 INCOMPATIBLE_CONFIGURATION before any write", async () => {
      const id = baseId();

      const { status, body } = await createProject({
        ...minimalPayload(id),
        connections: [
          {
            providerId: "stub-capable",
            roles: ["tracker", "gitHost"],
            config: {
              host: "https://stub.example",
              apiToken: MARKER_STUB_TOKEN,
              project: "capable",
            },
          },
          {
            providerId: "jira",
            roles: ["tracker"],
            config: {
              host: "https://jira.example",
              email: "dev@example.com",
              apiToken: MARKER_JIRA_TOKEN,
              project: "JIRA",
            },
          },
        ],
      });

      expect(status).toBe(409);
      expect(body).toEqual({ formErrors: ["INCOMPATIBLE_CONFIGURATION"] });

      expect((await loadProjects(configPath)).some((p) => p.id === id)).toBe(
        false,
      );
      await expect(stat(getProjectEnvPath(id))).rejects.toThrow();
      expect(await loadProjectEnv(id)).toEqual({});
    });

    it("rejects a dual-role connection with an additional gitHost connection with 409 INCOMPATIBLE_CONFIGURATION before any write", async () => {
      const id = baseId();

      const { status, body } = await createProject({
        ...minimalPayload(id),
        connections: [
          {
            providerId: "stub-capable",
            roles: ["tracker", "gitHost"],
            config: {
              host: "https://stub.example",
              apiToken: MARKER_STUB_TOKEN,
              project: "capable",
            },
          },
          {
            providerId: "github",
            roles: ["gitHost"],
            config: {
              token: MARKER_GITHUB_TOKEN,
              repoOwner: "acme",
              repository: "web",
            },
          },
        ],
      });

      expect(status).toBe(409);
      expect(body).toEqual({ formErrors: ["INCOMPATIBLE_CONFIGURATION"] });

      expect((await loadProjects(configPath)).some((p) => p.id === id)).toBe(
        false,
      );
      await expect(stat(getProjectEnvPath(id))).rejects.toThrow();
      expect(await loadProjectEnv(id)).toEqual({});
    });

    it("rejects duplicate ownership of a required role", async () => {
      const id = baseId();

      const { status, body } = await createProject({
        ...minimalPayload(id),
        connections: [
          {
            providerId: "stub-tracker-only",
            roles: ["tracker"],
            config: {
              host: "https://stub.example",
              apiToken: MARKER_STUB_TOKEN,
              project: "duplicate-role",
            },
          },
          {
            providerId: "stub-capable",
            roles: ["tracker", "gitHost"],
            config: {
              host: "https://stub.example",
              apiToken: MARKER_STUB_TOKEN,
              project: "duplicate-role",
            },
          },
        ],
      });

      expect(status).toBe(409);
      expect(body).toEqual({
        formErrors: ["INCOMPATIBLE_CONFIGURATION"],
      });
      expect(await readStoredProject(id)).toBeUndefined();
    });

    it("rejects duplicate ownership of a required role (reverse dual-role + gitHost)", async () => {
      const id = baseId();

      const { status, body } = await createProject({
        ...minimalPayload(id),
        connections: [
          {
            providerId: "stub-capable",
            roles: ["tracker", "gitHost"],
            config: {
              host: "https://stub.example",
              apiToken: MARKER_STUB_TOKEN,
              project: "duplicate-role",
            },
          },
          {
            providerId: "github",
            roles: ["gitHost"],
            config: {
              token: MARKER_GITHUB_TOKEN,
              repoOwner: "acme",
              repository: "web",
            },
          },
        ],
      });

      expect(status).toBe(409);
      expect(body).toEqual({
        formErrors: ["INCOMPATIBLE_CONFIGURATION"],
      });
      expect(await readStoredProject(id)).toBeUndefined();
    });

    it("reports missing gitHost when gitHost is missing even if tracker is duplicated", async () => {
      const id = baseId();

      const { status, body } = await createProject({
        ...minimalPayload(id),
        connections: [
          {
            providerId: "jira",
            roles: ["tracker"],
            config: {
              host: "https://jira.example",
              email: "dev@example.com",
              apiToken: MARKER_JIRA_TOKEN,
              project: "JIRA",
            },
          },
          {
            providerId: "stub-tracker-only",
            roles: ["tracker"],
            config: {
              host: "https://stub.example",
              apiToken: MARKER_STUB_TOKEN,
              project: "stub",
            },
          },
        ],
      });

      expect(status).toBe(409);
      expect(body).toEqual({ formErrors: ["MISSING_GIT_HOST_CONNECTION"] });

      expect((await loadProjects(configPath)).some((p) => p.id === id)).toBe(
        false,
      );
      await expect(stat(getProjectEnvPath(id))).rejects.toThrow();
      expect(await loadProjectEnv(id)).toEqual({});
    });

    it("mirrors issueTracker from the tracker connection, never from the default", async () => {
      const id = baseId();

      // The tracker connection is the stub, NOT github (the default tracker
      // provider): a mirror taken from DEFAULT_ISSUE_TRACKER would read
      // `provider: "github"` and be wrong.
      const { status, body } = await createProject(minimalPayload(id));
      expect(status).toBe(201);

      const issueTracker = body.issueTracker as { provider?: string };
      expect(issueTracker.provider).toBe("stub-capable");

      const stored = await readStoredProject(id);
      expect(stored?.issueTracker?.provider as string).toBe("stub-capable");
    });

    it("rejects a role the provider cannot serve with 409 INCOMPATIBLE_CONFIGURATION", async () => {
      const { status, body } = await createProject({
        ...minimalPayload(baseId()),
        connections: [
          {
            providerId: "stub-tracker-only",
            roles: ["gitHost"],
            config: {
              host: "https://stub.example",
              apiToken: MARKER_STUB_TOKEN,
              project: "layered",
            },
          },
        ],
      });
      expect(status).toBe(409);
      expect(body).toEqual({ formErrors: ["INCOMPATIBLE_CONFIGURATION"] });
    });

    it("rejects a provider missing the capabilities its role requires", async () => {
      const config = {
        host: "https://stub.example",
        apiToken: MARKER_STUB_TOKEN,
        project: "layered",
      };

      const noTickets = await createProject({
        ...minimalPayload(baseId()),
        connections: [
          { providerId: "stub-no-tickets", roles: ["tracker"], config },
        ],
      });
      expect(noTickets.status).toBe(409);
      expect(noTickets.body).toEqual({
        formErrors: ["INCOMPATIBLE_CONFIGURATION"],
      });

      const noPrs = await createProject({
        ...minimalPayload(baseId()),
        connections: [
          { providerId: "stub-no-prs", roles: ["gitHost"], config },
        ],
      });
      expect(noPrs.status).toBe(409);
      expect(noPrs.body).toEqual({
        formErrors: ["INCOMPATIBLE_CONFIGURATION"],
      });
    });

    it("rejects two connections of the same provider (no silent merges)", async () => {
      const id = baseId();
      const config = {
        host: "https://stub.example",
        apiToken: MARKER_STUB_TOKEN,
        project: "layered",
      };

      const { status, body } = await createProject({
        ...minimalPayload(id),
        connections: [
          { providerId: "stub-capable", roles: ["tracker"], config },
          { providerId: "stub-capable", roles: ["gitHost"], config },
        ],
      });
      expect(status).toBe(409);
      expect(body).toEqual({ formErrors: ["INCOMPATIBLE_CONFIGURATION"] });
      expect(await readStoredProject(id)).toBeUndefined();
    });

    it("rejects a duplicate project id with 409 (create-only) and does not overwrite", async () => {
      const id = baseId();
      const first = await createProject(minimalPayload(id));
      expect(first.status).toBe(201);

      const second = await createProject({
        ...minimalPayload(id),
        name: "Hijacked",
        connections: [
          {
            providerId: "stub-capable",
            roles: ["tracker", "gitHost"],
            config: {
              host: "https://stub.example",
              apiToken: "synthetic-other-token-2b7e",
              project: "hijack",
            },
          },
        ],
      });
      expect(second.status).toBe(409);

      // The existing project and its secret are untouched.
      expect((await readStoredProject(id))?.name).toBe("Layered");
      expect((await loadProjectEnv(id)).STUB_API_TOKEN).toBe(MARKER_STUB_TOKEN);
    });
  });
});

describe("Shared write plan: ordered writes through the injected store (#187)", () => {
  /**
   * The shipped file-backed store with named methods replaced: failures are
   * injected THROUGH the store (#187), never by mutating `process.env` or file
   * permissions.
   */
  function storeFailingOn(
    overrides: Partial<ProjectWriteStore>,
  ): ProjectWriteStore {
    return { ...FILE_PROJECT_WRITE_STORE, ...overrides };
  }

  it("creates no project at all when the store's env write fails", async () => {
    const id = `store-failure-secret-${Date.now()}`;
    const store = storeFailingOn({
      saveProjectEnv: async () => {
        throw new Error("env store unavailable");
      },
    });

    await expect(
      createProjectFromConnections(storeFailurePayload(id), {
        registry: testRegistry,
        configPath,
        store,
      }),
    ).rejects.toThrow("env store unavailable");

    // No secret store for the project…
    await expect(stat(getProjectEnvPath(id))).rejects.toThrow();
    // …and no project record: a project never exists without its secrets.
    expect((await loadProjects(configPath)).some((p) => p.id === id)).toBe(
      false,
    );
  });

  it("leaves the secrets and no project when the store's record write fails, then converges on retry", async () => {
    const id = `store-failure-commit-${Date.now()}`;
    let recordWriteFails = true;
    const store = storeFailingOn({
      appendProjectRecord: async (record, pathArg) => {
        if (recordWriteFails) throw new Error("record store unavailable");
        return FILE_PROJECT_WRITE_STORE.appendProjectRecord(record, pathArg);
      },
    });

    await expect(
      createProjectFromConnections(storeFailurePayload(id), {
        registry: testRegistry,
        configPath,
        store,
      }),
    ).rejects.toThrow("record store unavailable");

    // Secrets landed first (idempotent, retry-safe)…
    expect((await loadProjectEnv(id)).STUB_API_TOKEN).toBe(MARKER_STUB_TOKEN);
    // …and the record did not commit.
    expect((await loadProjects(configPath)).some((p) => p.id === id)).toBe(
      false,
    );

    // A retry after the failure converges: same secret, one record.
    recordWriteFails = false;
    const saved = await createProjectFromConnections(storeFailurePayload(id), {
      registry: testRegistry,
      configPath,
      store,
    });
    expect(saved.id).toBe(id);
    const stored = (await loadProjects(configPath)).filter((p) => p.id === id);
    expect(stored).toHaveLength(1);
    expect((await loadProjectEnv(id)).STUB_API_TOKEN).toBe(MARKER_STUB_TOKEN);
  });

  it("leaves the stored record unchanged when the store's record write fails on update, then converges on retry", async () => {
    const id = `store-failure-update-${Date.now()}`;
    const project = await createProjectFromConnections(
      storeFailurePayload(id),
      {
        registry: testRegistry,
        configPath,
      },
    );
    expect(project.id).toBe(id);

    const newToken = "synthetic-update-token-5e2f";
    const input: UpdateProjectConnectionsInput = {
      name: "Store Failure Update Retried",
      connections: [
        {
          providerId: "stub-capable",
          roles: ["tracker", "gitHost"],
          config: {
            host: "https://stub.example",
            apiToken: newToken,
            project: "store-failure-update",
          },
        },
      ],
    };
    const recordBefore = (await loadProjects(configPath)).find(
      (p) => p.id === id,
    );

    // The update commit point is the store's saveProject, not the append.
    let recordWriteFails = true;
    const store = storeFailingOn({
      saveProject: async (record, pathArg) => {
        if (recordWriteFails) throw new Error("record store unavailable");
        return FILE_PROJECT_WRITE_STORE.saveProject(record, pathArg);
      },
    });

    await expect(
      updateProjectConnections(project, input, {
        registry: testRegistry,
        configPath,
        store,
      }),
    ).rejects.toThrow("record store unavailable");

    // The commit point did not change…
    expect((await loadProjects(configPath)).find((p) => p.id === id)).toEqual(
      recordBefore,
    );
    // …while the secret write ahead of it landed (ordered writes).
    expect((await loadProjectEnv(id)).STUB_API_TOKEN).toBe(newToken);

    // A retry converges: one record, the update applied, same secret.
    recordWriteFails = false;
    const saved = await updateProjectConnections(project, input, {
      registry: testRegistry,
      configPath,
      store,
    });
    expect(saved.name).toBe("Store Failure Update Retried");
    expect(
      (await loadProjects(configPath)).filter((p) => p.id === id),
    ).toHaveLength(1);
    expect((await loadProjectEnv(id)).STUB_API_TOKEN).toBe(newToken);
  });

  it("leaves the old record and the dropped connections' secrets intact when a swap's record write fails, then converges on retry", async () => {
    const id = `store-failure-swap-${Date.now()}`;
    const oldStubToken = "synthetic-swap-old-token-8f3a";
    const created = await createProjectFromConnections(
      {
        id,
        name: "Swap Failure",
        workspacePath: tempDir,
        connections: [
          {
            providerId: "stub-capable",
            roles: ["tracker", "gitHost"],
            config: {
              host: "https://stub.example",
              apiToken: oldStubToken,
              project: "swap-failure",
            },
          },
        ],
        repositories: [
          {
            id: `${id}-web`,
            name: "web",
            localPath: path.join(tempDir, "web"),
            role: "backend",
          },
        ],
      },
      { registry: testRegistry, configPath },
    );
    expect(created.id).toBe(id);
    expect((await loadProjectEnv(id)).STUB_API_TOKEN).toBe(oldStubToken);

    const recordBefore = (await loadProjects(configPath)).find(
      (p) => p.id === id,
    );

    // The swap: Jira covering the tracker role and GitHub the git-host role in
    // place of the dual-role stub — a plan whose removal pass names the dropped
    // connection's STUB_API_TOKEN.
    const jiraToken = "synthetic-swap-jira-token-5b7e";
    const githubToken = "synthetic-swap-github-token-d2c6";
    const input: UpdateProjectConnectionsInput = {
      connections: [
        {
          providerId: "jira",
          roles: ["tracker"],
          config: {
            host: "https://swap.atlassian.net",
            email: "dev@example.com",
            apiToken: jiraToken,
            project: "SWAP",
          },
        },
        {
          providerId: "github",
          roles: ["gitHost"],
          config: {
            token: githubToken,
            repoOwner: "acme",
            repository: "web",
          },
        },
      ],
    };

    // The update commit point is the store's saveProject; fail it once.
    let recordWriteFails = true;
    const store = storeFailingOn({
      saveProject: async (record, pathArg) => {
        if (recordWriteFails) throw new Error("record store unavailable");
        return FILE_PROJECT_WRITE_STORE.saveProject(record, pathArg);
      },
    });

    await expect(
      updateProjectConnections(created, input, {
        registry: testRegistry,
        configPath,
        store,
      }),
    ).rejects.toThrow("record store unavailable");

    // The old record still stands…
    expect((await loadProjects(configPath)).find((p) => p.id === id)).toEqual(
      recordBefore,
    );
    // …and so do the secrets it references: a dropped connection's env keys are
    // removed only AFTER the record commit, never before it.
    expect((await loadProjectEnv(id)).STUB_API_TOKEN).toBe(oldStubToken);
    // The replacement's secrets already landed (idempotent, retry-safe).
    const envAfterFailure = await loadProjectEnv(id);
    expect(envAfterFailure.JIRA_API_TOKEN).toBe(jiraToken);
    expect(envAfterFailure.GITHUB_TOKEN).toBe(githubToken);

    // A retry converges: the swap applies and the dropped secret leaves.
    recordWriteFails = false;
    const saved = await updateProjectConnections(created, input, {
      registry: testRegistry,
      configPath,
      store,
    });
    expect(saved.connections?.map((c) => c.providerId)).toEqual([
      "jira",
      "github",
    ]);
    expect(
      (await loadProjects(configPath)).filter((p) => p.id === id),
    ).toHaveLength(1);
    expect(await loadProjectEnv(id)).toEqual({
      JIRA_API_TOKEN: jiraToken,
      GITHUB_TOKEN: githubToken,
    });
  });
});

describe("HTTP persistence failures through the injected store (#187)", () => {
  // Armed per test and reset after each: the injected store delegates to the
  // shipped one unless a failure is armed, so only these tests are affected.
  const armed = { envWrite: false, appendRecord: false, saveRecord: false };
  let failureServer: ReturnType<typeof startServer>;
  let storeBaseUrl: string;

  beforeAll(() => {
    const store: ProjectWriteStore = {
      ...FILE_PROJECT_WRITE_STORE,
      saveProjectEnv: async (projectId, vars) => {
        if (armed.envWrite) throw new Error("env store unavailable");
        return FILE_PROJECT_WRITE_STORE.saveProjectEnv(projectId, vars);
      },
      appendProjectRecord: async (record, pathArg) => {
        if (armed.appendRecord) throw new Error("record store unavailable");
        return FILE_PROJECT_WRITE_STORE.appendProjectRecord(record, pathArg);
      },
      saveProject: async (record, pathArg) => {
        if (armed.saveRecord) throw new Error("record store unavailable");
        return FILE_PROJECT_WRITE_STORE.saveProject(record, pathArg);
      },
    };
    failureServer = startServer(0, undefined, undefined, testRegistry, store);
    storeBaseUrl = `http://localhost:${failureServer.port}`;
  });

  afterEach(() => {
    armed.envWrite = false;
    armed.appendRecord = false;
    armed.saveRecord = false;
  });

  afterAll(() => failureServer.stop(true));

  it("POST /api/projects returns 500 and creates no project and no env file when the store's env write fails", async () => {
    const id = `store-failure-http-env-${Date.now()}`;
    armed.envWrite = true;

    const { status } = await createProject(
      storeFailurePayload(id),
      storeBaseUrl,
    );
    expect(status).toBe(500);

    // No project record…
    expect((await loadProjects(configPath)).some((p) => p.id === id)).toBe(
      false,
    );
    // …and no env file: a project never exists without its secrets.
    await expect(stat(getProjectEnvPath(id))).rejects.toThrow();
  });

  it("POST /api/projects returns 500 at the commit point with secrets landed and no record, then a retry converges with 201", async () => {
    const id = `store-failure-http-commit-${Date.now()}`;
    armed.appendRecord = true;

    const first = await createProject(storeFailurePayload(id), storeBaseUrl);
    expect(first.status).toBe(500);

    // Secrets landed first (idempotent, retry-safe)…
    expect((await loadProjectEnv(id)).STUB_API_TOKEN).toBe(MARKER_STUB_TOKEN);
    // …and the record did not commit.
    expect((await loadProjects(configPath)).some((p) => p.id === id)).toBe(
      false,
    );

    // A retry after the failure converges over HTTP: same secret, one record.
    armed.appendRecord = false;
    const retry = await createProject(storeFailurePayload(id), storeBaseUrl);
    expect(retry.status).toBe(201);
    expect(
      (await loadProjects(configPath)).filter((p) => p.id === id),
    ).toHaveLength(1);
    expect((await loadProjectEnv(id)).STUB_API_TOKEN).toBe(MARKER_STUB_TOKEN);
  });

  it("PATCH /api/projects/:id returns 500 at the commit point with the stored record unchanged, then a retry converges with 200", async () => {
    const id = `store-failure-http-update-${Date.now()}`;
    const created = await createProject(storeFailurePayload(id), storeBaseUrl);
    expect(created.status).toBe(201);
    const recordBefore = (await loadProjects(configPath)).find(
      (p) => p.id === id,
    );
    expect(recordBefore).toBeDefined();

    const newToken = "synthetic-update-token-5e2f";
    const updateBody = {
      name: "Store Failure Retried",
      connections: [
        {
          providerId: "stub-capable",
          roles: ["tracker", "gitHost"],
          config: {
            host: "https://stub.example",
            apiToken: newToken,
            project: "store-failure-retry",
          },
        },
      ],
    };

    armed.saveRecord = true;
    const failed = await fetch(`${storeBaseUrl}/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updateBody),
    });
    expect(failed.status).toBe(500);

    // The record — the update's commit point — is unchanged…
    expect((await loadProjects(configPath)).find((p) => p.id === id)).toEqual(
      recordBefore,
    );
    // …while the secret write ahead of it landed (ordered writes).
    expect((await loadProjectEnv(id)).STUB_API_TOKEN).toBe(newToken);

    // A retry after the failure converges over HTTP.
    armed.saveRecord = false;
    const retry = await fetch(`${storeBaseUrl}/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updateBody),
    });
    expect(retry.status).toBe(200);
    const stored = (await loadProjects(configPath)).filter((p) => p.id === id);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.name).toBe("Store Failure Retried");
    expect((await loadProjectEnv(id)).STUB_API_TOKEN).toBe(newToken);
  });
});

describe("Concurrent creation of the same project id (#133 CORR-3)", () => {
  let raceDir: string;
  let raceConfigPath: string;
  let savedDataDir: string | undefined;
  let savedConfigPath: string | undefined;

  // Two distinguishable synthetic secrets: whichever request wins, the OTHER
  // value must be nowhere on disk afterwards.
  const MARKER_A = "winner-candidate-a";
  const MARKER_B = "winner-candidate-b";

  beforeEach(async () => {
    savedDataDir = process.env.X_FACTORY_DATA_DIR;
    savedConfigPath = process.env.X_FACTORY_CONFIG_PATH;
    raceDir = await mkdtemp(path.join(tmpdir(), "xf-creation-race-"));
    process.env.X_FACTORY_DATA_DIR = path.join(raceDir, "data");
    raceConfigPath = path.join(raceDir, "projects.json");
    process.env.X_FACTORY_CONFIG_PATH = raceConfigPath;
  });

  afterEach(async () => {
    if (savedDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
    else process.env.X_FACTORY_DATA_DIR = savedDataDir;
    if (savedConfigPath === undefined) delete process.env.X_FACTORY_CONFIG_PATH;
    else process.env.X_FACTORY_CONFIG_PATH = savedConfigPath;
    await rm(raceDir, { recursive: true, force: true });
  });

  /** One racer's payload: distinguishable by name AND by secret value. */
  function raceInput(
    id: string,
    name: string,
    marker: string,
  ): ConnectionsProjectInput {
    return {
      id,
      name,
      workspacePath: raceDir,
      connections: [
        {
          providerId: "stub-capable",
          roles: ["tracker", "gitHost"],
          config: {
            host: "https://stub.example",
            apiToken: marker,
            project: name,
          },
        },
      ],
      repositories: [
        {
          id: `${id}-web`,
          name: "web",
          localPath: path.join(raceDir, "web"),
          role: "backend",
        },
      ],
    };
  }

  /** Splits settled results, so a test can assert on each side by name. */
  async function settle<T>(
    promises: Promise<T>[],
  ): Promise<{ fulfilled: T[]; rejected: unknown[] }> {
    const results = await Promise.allSettled(promises);
    const fulfilled: T[] = [];
    const rejected: unknown[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") fulfilled.push(result.value);
      else rejected.push(result.reason);
    }
    return { fulfilled, rejected };
  }

  /** Which racer won, decided by the settled result — never by assumed order. */
  function markersFor(winnerName: string): {
    winning: string;
    losing: string;
  } {
    expect(["Race A", "Race B"]).toContain(winnerName);
    return winnerName === "Race A"
      ? { winning: MARKER_A, losing: MARKER_B }
      : { winning: MARKER_B, losing: MARKER_A };
  }

  it("lets exactly one of two concurrent creations of the same id win, and never persists the loser's secret", async () => {
    const id = `race-${Date.now()}`;

    // Both requests are STARTED before either is awaited, so both are inside
    // the creation path at once. Exactly one may win.
    const { fulfilled, rejected } = await settle([
      createProjectFromConnections(raceInput(id, "Race A", MARKER_A), {
        registry: testRegistry,
        configPath: raceConfigPath,
      }),
      createProjectFromConnections(raceInput(id, "Race B", MARKER_B), {
        registry: testRegistry,
        configPath: raceConfigPath,
      }),
    ]);

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toBeInstanceOf(ConflictError);

    // WHICH request won is read off the settled result, never assumed.
    const winner = fulfilled[0] as Project;
    const { winning, losing } = markersFor(winner.name);

    // The persisted secret is the WINNING request's value…
    expect((await loadProjectEnv(id)).STUB_API_TOKEN).toBe(winning);
    // …and the loser's value is nowhere: not in the env store…
    expect(await readFile(getProjectEnvPath(id), "utf-8")).not.toContain(
      losing,
    );
    // …not in the project record…
    const recordRaw = await readFile(raceConfigPath, "utf-8");
    expect(recordRaw).not.toContain(losing);
    // …and the winner's secret is not in the record either: secrets only ever
    // live in env storage.
    expect(recordRaw).not.toContain(winning);

    // Exactly ONE project record for that id, and it is the winner's.
    const stored = (await loadProjects(raceConfigPath)).filter(
      (p) => p.id === id,
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]?.name).toBe(winner.name);

    // No claim file, and no takeover tombstone, survives the race.
    expect(await readdir(getLocksDir())).toEqual([]);
  });

  it("answers exactly one 201 and one 409 for two concurrent POSTs of the same id, and stores the winner's secret", async () => {
    const id = `race-http-${Date.now()}`;

    const responses = await Promise.all([
      createProject(raceInput(id, "Race A", MARKER_A)),
      createProject(raceInput(id, "Race B", MARKER_B)),
    ]);

    // One request creates; the other is rejected as a duplicate — never both
    // and never neither.
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);

    const created = responses.find((r) => r.status === 201);
    const { winning, losing } = markersFor(String(created?.body.name));

    expect((await loadProjectEnv(id)).STUB_API_TOKEN).toBe(winning);
    const envRaw = await readFile(getProjectEnvPath(id), "utf-8");
    expect(envRaw).not.toContain(losing);
    const recordRaw = await readFile(raceConfigPath, "utf-8");
    expect(recordRaw).not.toContain(losing);
    expect(recordRaw).not.toContain(winning);

    expect(
      (await loadProjects(raceConfigPath)).filter((p) => p.id === id),
    ).toHaveLength(1);
    expect(await readdir(getLocksDir())).toEqual([]);
  });

  it("rejects a creation whose id is claimed elsewhere as a conflict instead of hanging", async () => {
    const id = `race-held-${Date.now()}`;
    const claimPath = getCreationClaimPath(id);

    // Another creation of this id holds the claim.
    let holderEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      holderEntered = resolve;
    });
    let releaseHolder!: () => void;
    const holderGate = new Promise<void>((resolve) => {
      releaseHolder = resolve;
    });
    const holder = withCreationClaim(id, async () => {
      holderEntered();
      await holderGate;
      return "held";
    });
    await entered;

    // The bounded wait turns into the documented 409 conflict, with a message
    // that says so — neither the duplicate-id message nor a hang.
    await expect(
      createProjectFromConnections(raceInput(id, "Race A", MARKER_A), {
        registry: testRegistry,
        configPath: raceConfigPath,
        claim: { waitTimeoutMs: 60, pollIntervalMs: 5 },
      }),
    ).rejects.toThrow(/already being created/);

    // The rejected creation wrote nothing at all: no secrets, no record…
    await expect(stat(getProjectEnvPath(id))).rejects.toThrow();
    expect(await loadProjects(raceConfigPath)).toEqual([]);
    // …and the holder's claim is untouched and still held.
    expect(await readdir(getLocksDir())).toEqual([path.basename(claimPath)]);

    releaseHolder();
    await expect(holder).resolves.toBe("held");
    // …and released by its holder, leaving nothing behind.
    expect(await readdir(getLocksDir())).toEqual([]);
  });

  it("leaves no claim behind when a creation is rejected as a duplicate, and writes no secret for it", async () => {
    const id = `race-dup-${Date.now()}`;

    await createProjectFromConnections(raceInput(id, "Race A", MARKER_A), {
      registry: testRegistry,
      configPath: raceConfigPath,
    });

    await expect(
      createProjectFromConnections(raceInput(id, "Race B", MARKER_B), {
        registry: testRegistry,
        configPath: raceConfigPath,
      }),
    ).rejects.toThrow(ConflictError);

    expect((await loadProjectEnv(id)).STUB_API_TOKEN).toBe(MARKER_A);
    expect(await readdir(getLocksDir())).toEqual([]);
    expect(
      (await loadProjects(raceConfigPath)).filter((p) => p.id === id),
    ).toHaveLength(1);
  });

  function raceLegacyPayload(
    id: string,
    name: string,
  ): Record<string, unknown> {
    return {
      id,
      name,
      repositoryPath: path.join(raceDir, "legacy-repo"),
      defaultBranch: "main",
      testCommand: "bun test",
      issueTracker: {
        provider: "jira",
        connectionId: "jira",
        jira: {
          host: "https://acme.atlassian.net",
          email: "dev@example.com",
          project: "ACME",
        },
      },
    };
  }

  it("answers exactly one 201 and one 409 when legacy creation races with normalized connections creation of the same id", async () => {
    const id = `race-legacy-norm-${Date.now()}`;
    const responses = await Promise.all([
      createProject(raceInput(id, "Norm Race", MARKER_A)),
      createProject(raceLegacyPayload(id, "Legacy Race")),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);

    const winner = responses.find((r) => r.status === 201);
    const stored = (await loadProjects(raceConfigPath)).filter(
      (p) => p.id === id,
    );
    expect(stored).toHaveLength(1);

    if (winner?.body.name === "Norm Race") {
      expect((await loadProjectEnv(id)).STUB_API_TOKEN).toBe(MARKER_A);
    } else {
      // Legacy won: normalized loser's secret was never written to env store
      await expect(stat(getProjectEnvPath(id))).rejects.toThrow();
    }
    expect(await readdir(getLocksDir())).toEqual([]);
  });

  it("answers exactly one 201 and one 409 when two legacy creations race for the same id", async () => {
    const id = `race-legacy-two-${Date.now()}`;
    const responses = await Promise.all([
      createProject(raceLegacyPayload(id, "Legacy A")),
      createProject(raceLegacyPayload(id, "Legacy B")),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const stored = (await loadProjects(raceConfigPath)).filter(
      (p) => p.id === id,
    );
    expect(stored).toHaveLength(1);
    expect(["Legacy A", "Legacy B"]).toContain(stored[0]?.name ?? "");
    expect(await readdir(getLocksDir())).toEqual([]);
  });

  it("fences a slow holder whose claim was lost or stolen before persisting secrets, preventing it from overwriting the winner's secrets", async () => {
    const id = `race-fenced-${Date.now()}`;
    const claimPath = getCreationClaimPath(id);

    let holderEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      holderEntered = resolve;
    });
    let releaseHolder!: () => void;
    const holderGate = new Promise<void>((resolve) => {
      releaseHolder = resolve;
    });

    // Slow Holder A acquires claim with heartbeat disabled, passes duplicate check, then pauses before secrets
    let holderToken = "";
    const slowHolder = withCreationClaim(
      id,
      async (claim) => {
        holderToken = claim.token;
        holderEntered();
        const existing = await loadProjects(raceConfigPath);
        if (existing.some((p) => p.id === id)) {
          throw new ConflictError(`Project with ID "${id}" already exists.`);
        }
        await holderGate;
        // Slow holder unpauses here. Must be fenced out before writing secrets!
        await claim.assertHeld();
        await saveProjectEnv(id, { STUB_API_TOKEN: MARKER_A });
        return { id } as Project;
      },
      { ttlMs: 50, heartbeat: false },
    );

    await entered;

    // Simulate holder process crashed/died past TTL by updating claim with dead PID and backdating
    await writeFile(
      claimPath,
      `${JSON.stringify({
        token: holderToken,
        pid: 99999999,
        createdAt: Date.now() - 200,
      })}\n`,
    );
    const past = new Date(Date.now() - 200);
    await utimes(claimPath, past, past);

    // Contender B reclaims and creates project with its secret
    const winnerB = await createProjectFromConnections(
      raceInput(id, "Winner B", MARKER_B),
      {
        registry: testRegistry,
        configPath: raceConfigPath,
        claim: { ttlMs: 1_000, waitTimeoutMs: 2_000, pollIntervalMs: 5 },
      },
    );
    expect(winnerB.name).toBe("Winner B");
    expect((await loadProjectEnv(id)).STUB_API_TOKEN).toBe(MARKER_B);

    // Now slow Holder A unpauses and tries to write secrets
    releaseHolder();
    await expect(slowHolder).rejects.toThrow(ClaimLostError);

    // Winner B's secrets and record remain untouched!
    expect((await loadProjectEnv(id)).STUB_API_TOKEN).toBe(MARKER_B);
    const stored = (await loadProjects(raceConfigPath)).filter(
      (p) => p.id === id,
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]?.name).toBe("Winner B");
    expect(await readdir(getLocksDir())).toEqual([]);
  });
});

describe("Redaction before serialization (connections payload)", () => {
  const marker = "synthetic-redaction-marker-4c8f";
  const gitHostMarker = "synthetic-githost-marker-8d21";

  function redactedPayload(
    id: string,
    connectionSecrets: { stub: string; github?: string },
  ): ConnectionsPayload {
    const connections: ConnectionsPayload["connections"] = [
      {
        providerId: "stub-capable",
        // Both roles when solo, or tracker role when paired with github:
        // the redaction surfaces are asserted on a project that can actually
        // exist under unique role ownership (#133 / Task 1).
        roles: connectionSecrets.github ? ["tracker"] : ["tracker", "gitHost"],
        config: {
          host: "https://stub.example",
          apiToken: connectionSecrets.stub,
          project: "redacted",
        },
      },
    ];
    if (connectionSecrets.github) {
      connections.push({
        providerId: "github",
        roles: ["gitHost"],
        config: {
          token: connectionSecrets.github,
          repoOwner: "acme",
          repository: "web",
        },
      });
    }
    return {
      id,
      name: "Redacted",
      workspacePath: tempDir,
      connections,
      repositories: [
        {
          id: `${id}-web`,
          name: "web",
          localPath: path.join(tempDir, "web"),
          role: "backend",
          primary: true,
        },
      ],
    };
  }

  /** Every response the API can emit for a project, as raw text. */
  async function projectSurfaces(id: string): Promise<Array<[string, string]>> {
    const paths = [
      "/api/projects",
      `/api/projects/${id}`,
      `/api/projects/${id}/readiness`,
      `/api/projects/${id}/tickets`,
      // The legacy tracker summary is covered for secret *values* only: its
      // `secretKey` field has always named the env variable (asserted in
      // test/projects-api.test.ts) and is outside this ticket's surfaces.
      `/api/projects/${id}/tracker`,
      `/api/projects/${id}/env`,
      "/api/providers/manifest",
    ];
    const surfaces: Array<[string, string]> = [];
    for (const p of paths) {
      const res = await fetch(`${baseUrl}${p}`);
      surfaces.push([p, await res.text()]);
    }
    return surfaces;
  }

  it("never serializes a connection secret value in any response or the stored record", async () => {
    const id = `redact-${Date.now()}`;
    const { status } = await createProject(
      redactedPayload(id, { stub: marker, github: gitHostMarker }),
    );
    expect(status).toBe(201);

    for (const [surface, text] of await projectSurfaces(id)) {
      expect(`${surface}:${text}`).not.toContain(marker);
      expect(`${surface}:${text}`).not.toContain(gitHostMarker);
    }

    // The record on disk carries no secret value either.
    const record = await readFile(configPath, "utf-8");
    expect(record).toContain(id);
    expect(record).not.toContain(marker);
    expect(record).not.toContain(gitHostMarker);

    // The secrets themselves are in env storage, under their declared keys.
    const env = await loadProjectEnv(id);
    expect(env.STUB_API_TOKEN).toBe(marker);
    expect(env.GITHUB_TOKEN).toBe(gitHostMarker);
  });

  it("never exposes a secret envKey in the creation response, project surfaces, record or manifest", async () => {
    const id = `redact-envkey-${Date.now()}`;
    const { status, body } = await createProject(
      redactedPayload(id, { stub: marker }),
    );
    expect(status).toBe(201);

    expect(JSON.stringify(body)).not.toContain("STUB_API_TOKEN");

    for (const [surface, text] of await projectSurfaces(id)) {
      if (surface.endsWith("/tracker")) continue;
      for (const envKey of [
        "STUB_API_TOKEN",
        "AZURE_DEVOPS_PAT",
        "JIRA_API_TOKEN",
        "GITHUB_TOKEN",
      ]) {
        expect(`${surface}:${text}`).not.toContain(envKey);
      }
    }

    expect(await readFile(configPath, "utf-8")).not.toContain("STUB_API_TOKEN");

    // The manifest declares the field as secret without its env target.
    const manifestText = await (
      await fetch(`${baseUrl}/api/providers/manifest`)
    ).text();
    expect(manifestText).not.toContain("envKey");
    expect(manifestText).not.toContain("STUB_API_TOKEN");
    expect(manifestText).toContain('"secret":true');
  });
});

describe("Secret update semantics on PATCH /api/projects/:id", () => {
  const backupMarker = "synthetic-backup-token-7a2d";
  let projectId: string;

  async function patch(
    body: Record<string, unknown>,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await fetch(`${baseUrl}/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : {} };
  }

  function connectionBody(
    config: Record<string, unknown>,
    clearSecrets?: string[],
  ): Record<string, unknown> {
    return {
      connections: [
        {
          providerId: "stub-optional-secret",
          // A full-replacement update must keep BOTH roles: the replacement
          // set is what the role-coverage gate checks (#133, #187).
          roles: ["tracker", "gitHost"],
          config,
        },
      ],
      ...(clearSecrets ? { clearSecrets } : {}),
    };
  }

  beforeAll(async () => {
    projectId = `update-${Date.now()}`;
    const { status } = await createProject({
      id: projectId,
      name: "Updatable",
      workspacePath: tempDir,
      connections: [
        {
          providerId: "stub-optional-secret",
          roles: ["tracker", "gitHost"],
          config: {
            host: "https://stub.example",
            apiToken: MARKER_STUB_TOKEN,
            backupToken: backupMarker,
            project: "updatable",
          },
        },
      ],
      repositories: [
        {
          id: `${projectId}-web`,
          name: "web",
          localPath: path.join(tempDir, "web"),
          role: "backend",
        },
      ],
    });
    expect(status).toBe(201);
  });

  it("keeps the stored secret when the secret field is missing", async () => {
    const { status } = await patch(
      connectionBody({ host: "https://stub.example", project: "renamed" }),
    );
    expect(status).toBe(200);

    const env = await loadProjectEnv(projectId);
    expect(env.STUB_API_TOKEN).toBe(MARKER_STUB_TOKEN);
    // Non-secret configuration is updated, and the legacy tracker view follows.
    const stored = await readStoredProject(projectId);
    expect(stored?.connections?.[0]?.config).toEqual({
      host: "https://stub.example",
      project: "renamed",
    });
    expect(stored?.issueTracker?.projectId).toBe("renamed");
  });

  it("keeps the stored secret when the secret field is empty (empty never means delete)", async () => {
    const { status } = await patch(
      connectionBody({
        host: "https://stub.example",
        apiToken: "",
        project: "renamed",
      }),
    );
    expect(status).toBe(200);
    expect((await loadProjectEnv(projectId)).STUB_API_TOKEN).toBe(
      MARKER_STUB_TOKEN,
    );
  });

  it("replaces the stored secret when a non-empty value is provided", async () => {
    const replacement = "synthetic-replacement-token-5e1c";
    const { status, body } = await patch(
      connectionBody({
        host: "https://stub.example",
        apiToken: replacement,
        project: "renamed",
      }),
    );
    expect(status).toBe(200);

    expect((await loadProjectEnv(projectId)).STUB_API_TOKEN).toBe(replacement);
    // The replacement never enters the record or the response.
    expect(JSON.stringify(body)).not.toContain(replacement);
    const record = await readFile(configPath, "utf-8");
    expect(record).not.toContain(replacement);
    expect(record).toContain(projectId);

    // Restore the original token for the remaining cases.
    await patch(
      connectionBody({
        host: "https://stub.example",
        apiToken: MARKER_STUB_TOKEN,
        project: "renamed",
      }),
    );
  });

  it("clears a stored secret when it is listed in clearSecrets", async () => {
    const { status } = await patch(
      connectionBody({ host: "https://stub.example", project: "renamed" }, [
        "backupToken",
      ]),
    );
    expect(status).toBe(200);

    const env = await loadProjectEnv(projectId);
    expect(env.STUB_BACKUP_TOKEN).toBeUndefined();
    // Clearing one secret leaves the others alone.
    expect(env.STUB_API_TOKEN).toBe(MARKER_STUB_TOKEN);
    const envFile = await readFile(getProjectEnvPath(projectId), "utf-8");
    expect(envFile).not.toContain("STUB_BACKUP_TOKEN");
  });

  it("fails with fieldErrors when clearing a required secret, and writes nothing", async () => {
    const before = await loadProjectEnv(projectId);
    const { status, body } = await patch(
      connectionBody({ host: "https://stub.example", project: "renamed" }, [
        "apiToken",
      ]),
    );
    expect(status).toBe(409);
    expect(body).toEqual({ fieldErrors: { apiToken: "REQUIRED" } });
    expect(await loadProjectEnv(projectId)).toEqual(before);
  });

  it("rejects a clearSecrets name the provider does not declare as a secret", async () => {
    const { status, body } = await patch(
      connectionBody({ host: "https://stub.example", project: "renamed" }, [
        "host",
      ]),
    );
    expect(status).toBe(409);
    expect(body).toEqual({ fieldErrors: { host: "INVALID" } });
  });

  it("rejects an update whose connections would drop a required role, with codes and no write", async () => {
    const envBefore = await loadProjectEnv(projectId);
    const recordBefore = await readStoredProject(projectId);
    // A secret that would land in env storage if the gate ran AFTER the writes.
    const unwritten = "synthetic-unwritten-token-9f3a";

    // The update REPLACES this provider's connection, so a single-role payload
    // would leave the project without a git host.
    const noGitHost = await patch({
      connections: [
        {
          providerId: "stub-optional-secret",
          roles: ["tracker"],
          config: {
            host: "https://stub.example",
            apiToken: unwritten,
            project: "stripped",
          },
        },
      ],
    });
    expect(noGitHost.status).toBe(409);
    expect(noGitHost.body).toEqual({
      formErrors: ["MISSING_GIT_HOST_CONNECTION"],
    });

    // …and without a tracker.
    const noTracker = await patch({
      connections: [
        {
          providerId: "stub-optional-secret",
          roles: ["gitHost"],
          config: {
            host: "https://stub.example",
            apiToken: unwritten,
            project: "stripped",
          },
        },
      ],
    });
    expect(noTracker.status).toBe(409);
    expect(noTracker.body).toEqual({
      formErrors: ["MISSING_TRACKER_CONNECTION"],
    });

    // Neither rejection wrote anything: the supplied secret never reached env
    // storage, and secrets and record are untouched.
    const envFile = await readFile(getProjectEnvPath(projectId), "utf-8");
    expect(envFile).not.toContain(unwritten);
    expect(await loadProjectEnv(projectId)).toEqual(envBefore);
    expect(await readStoredProject(projectId)).toEqual(recordBefore);
  });

  it("rejects an update whose connections give the tracker role two owners, with 409 INCOMPATIBLE_CONFIGURATION and no write", async () => {
    const envBefore = await loadProjectEnv(projectId);
    const recordBefore = await readStoredProject(projectId);
    const unwrittenSecret = "synthetic-duplicate-tracker-secret";

    // Replace semantics (#187): the payload IS the new connection set, so a
    // duplicate owner must appear INSIDE it — two connections claiming
    // ["tracker"] — for the one-owner rule to reject the update.
    const res = await patch({
      connections: [
        {
          providerId: "stub-tracker-only",
          roles: ["tracker"],
          config: {
            host: "https://stub.example",
            apiToken: unwrittenSecret,
            project: "dup-tracker",
          },
        },
        {
          providerId: "stub-optional-secret",
          roles: ["tracker", "gitHost"],
          config: {
            host: "https://stub.example",
            apiToken: MARKER_STUB_TOKEN,
            project: "dup-tracker-other",
          },
        },
      ],
    });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      formErrors: ["INCOMPATIBLE_CONFIGURATION"],
    });

    // Verify no secret write occurred:
    const envFile = await readFile(getProjectEnvPath(projectId), "utf-8");
    expect(envFile).not.toContain(unwrittenSecret);
    expect(await loadProjectEnv(projectId)).toEqual(envBefore);
    expect(await readStoredProject(projectId)).toEqual(recordBefore);
  });

  it("rejects an update whose connections give the gitHost role two owners, with 409 INCOMPATIBLE_CONFIGURATION and no write", async () => {
    const envBefore = await loadProjectEnv(projectId);
    const recordBefore = await readStoredProject(projectId);
    const unwrittenSecret = "synthetic-duplicate-githost-secret";

    // Replace semantics (#187): github with ["gitHost"] alongside
    // stub-optional-secret's ["gitHost"] gives the role two owners INSIDE the
    // replacement set.
    const res = await patch({
      connections: [
        {
          providerId: "github",
          roles: ["gitHost"],
          config: {
            token: unwrittenSecret,
            repoOwner: "acme",
            repository: "dup-repo",
          },
        },
        {
          providerId: "stub-optional-secret",
          roles: ["tracker", "gitHost"],
          config: {
            host: "https://stub.example",
            apiToken: MARKER_STUB_TOKEN,
            project: "dup-githost-other",
          },
        },
      ],
    });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      formErrors: ["INCOMPATIBLE_CONFIGURATION"],
    });

    const envFile = await readFile(getProjectEnvPath(projectId), "utf-8");
    expect(envFile).not.toContain(unwrittenSecret);
    expect(await loadProjectEnv(projectId)).toEqual(envBefore);
    expect(await readStoredProject(projectId)).toEqual(recordBefore);
  });

  it("rejects malformed normalized PATCH payloads with HTTP 400 and never reaches legacy merge", async () => {
    const envBefore = await loadProjectEnv(projectId);
    const recordBefore = await readStoredProject(projectId);

    // { connections: null } must be rejected with 400 and NEVER reach the legacy merge path
    const nullConnRes = await patch({ connections: null });
    expect(nullConnRes.status).toBe(400);

    // Non-array connections (string, object) must be rejected with 400
    const strConnRes = await patch({ connections: "not-an-array" });
    expect(strConnRes.status).toBe(400);

    const objConnRes = await patch({ connections: { providerId: "jira" } });
    expect(objConnRes.status).toBe(400);

    // Empty array of connections must be rejected with 400 (min 1 required)
    const emptyConnRes = await patch({ connections: [] });
    expect(emptyConnRes.status).toBe(400);

    // Boolean and number connections must also be rejected with 400
    const boolConnRes = await patch({ connections: false });
    expect(boolConnRes.status).toBe(400);

    const numConnRes = await patch({ connections: 123 });
    expect(numConnRes.status).toBe(400);

    // Verify project record and env were NEVER mutated
    expect(await loadProjectEnv(projectId)).toEqual(envBefore);
    expect(await readStoredProject(projectId)).toEqual(recordBefore);
  });
});

describe("Connection-set replace semantics on PATCH /api/projects/:id (#187)", () => {
  async function patchProject(
    id: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await fetch(`${baseUrl}/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : {} };
  }

  it("swaps a project's connections (Jira+Azure to GitHub for both roles), replacing the set and removing the old connections' env entries", async () => {
    const id = `swap-${Date.now()}`;
    const azurePat = "synthetic-azure-pat-6d2c";
    const created = await createProject({
      id,
      name: "Swap Me",
      workspacePath: tempDir,
      connections: [
        {
          providerId: "jira",
          roles: ["tracker"],
          config: {
            host: "https://swap.atlassian.net",
            email: "dev@example.com",
            apiToken: MARKER_JIRA_TOKEN,
            project: "SWAP",
          },
        },
        {
          providerId: "azure",
          roles: ["gitHost"],
          config: {
            orgUrl: "https://dev.azure.com/acme",
            project: "acme",
            pat: azurePat,
          },
        },
      ],
      repositories: [
        {
          id: `${id}-web`,
          name: "web",
          localPath: path.join(tempDir, "web"),
          role: "backend",
        },
      ],
    });
    expect(created.status).toBe(201);

    // Precondition, asserted: both connections' secrets are in env storage
    // before the swap.
    const before = await loadProjectEnv(id);
    expect(before.JIRA_API_TOKEN).toBe(MARKER_JIRA_TOKEN);
    expect(before.AZURE_DEVOPS_PAT).toBe(azurePat);

    const swapToken = "synthetic-github-swap-token-4b8e";
    const { status } = await patchProject(id, {
      connections: [
        {
          providerId: "github",
          roles: ["tracker", "gitHost"],
          config: {
            token: swapToken,
            repoOwner: "acme",
            repository: "web",
          },
        },
      ],
    });
    expect(status).toBe(200);

    // Replace: the stored connection set IS the requested set, nothing else.
    const stored = await readStoredProject(id);
    expect(stored?.connections?.map((c) => c.providerId)).toEqual(["github"]);
    expect(stored?.connections?.[0]?.roles).toEqual(["tracker", "gitHost"]);
    // The legacy tracker mirror follows the swap.
    expect(stored?.issueTracker?.provider).toBe("github");

    // Remove: the dropped connections' env entries are gone, and only the new
    // connection's secret remains.
    expect(await loadProjectEnv(id)).toEqual({ GITHUB_TOKEN: swapToken });
  });

  it("keeps a replacement set's env key that a dropped provider also declared, with the new value", async () => {
    const id = `swap-reused-key-${Date.now()}`;
    const oldToken = "synthetic-old-token-7a1d";
    const created = await createProject({
      id,
      name: "Swap Reused Key",
      workspacePath: tempDir,
      connections: [
        {
          providerId: "stub-optional-secret",
          roles: ["tracker", "gitHost"],
          config: {
            host: "https://stub.example",
            apiToken: oldToken,
            project: "swap-reuse-old",
          },
        },
      ],
      repositories: [
        {
          id: `${id}-web`,
          name: "web",
          localPath: path.join(tempDir, "web"),
          role: "backend",
        },
      ],
    });
    expect(created.status).toBe(201);
    expect((await loadProjectEnv(id)).STUB_API_TOKEN).toBe(oldToken);

    // The replacement swaps the provider while REUSING the env key the
    // dropped provider declared: the removal pass must not delete the key the
    // plan itself just wrote.
    const newToken = "synthetic-new-token-2c9f";
    const { status } = await patchProject(id, {
      connections: [
        {
          providerId: "stub-capable",
          roles: ["tracker", "gitHost"],
          config: {
            host: "https://stub.example",
            apiToken: newToken,
            project: "swap-reuse-new",
          },
        },
      ],
    });
    expect(status).toBe(200);

    const stored = await readStoredProject(id);
    expect(stored?.connections?.map((c) => c.providerId)).toEqual([
      "stub-capable",
    ]);
    // The kept key survived the drop-removal, with the replacement's value.
    expect(await loadProjectEnv(id)).toEqual({ STUB_API_TOKEN: newToken });
  });

  it("rejects an update whose connections declare the same env key with different values, like create does, with no write", async () => {
    const id = `update-env-conflict-${Date.now()}`;
    const created = await createProject({
      id,
      name: "Conflict Target",
      workspacePath: tempDir,
      connections: [
        {
          providerId: "stub-optional-secret",
          roles: ["tracker", "gitHost"],
          config: {
            host: "https://stub.example",
            apiToken: MARKER_STUB_TOKEN,
            project: "conflict-target",
          },
        },
      ],
      repositories: [
        {
          id: `${id}-web`,
          name: "web",
          localPath: path.join(tempDir, "web"),
          role: "backend",
        },
      ],
    });
    expect(created.status).toBe(201);

    const envBefore = await loadProjectEnv(id);
    const recordBefore = await readStoredProject(id);

    // Two DISTINCT providers, both declaring envKey STUB_API_TOKEN with
    // different values: a conflict, never a silent overwrite.
    const { status, body } = await patchProject(id, {
      connections: [
        {
          providerId: "stub-optional-secret",
          roles: ["tracker"],
          config: {
            host: "https://stub.example",
            apiToken: "conflict-value-a",
            project: "conflict-a",
          },
        },
        {
          providerId: "stub-capable",
          roles: ["gitHost"],
          config: {
            host: "https://stub.example",
            apiToken: "conflict-value-b",
            project: "conflict-b",
          },
        },
      ],
    });

    expect(status).toBe(409);
    expect(body).toEqual({ formErrors: ["INCOMPATIBLE_CONFIGURATION"] });
    // Nothing reached the store.
    expect(await loadProjectEnv(id)).toEqual(envBefore);
    expect(await readStoredProject(id)).toEqual(recordBefore);
  });

  it("rejects a creation whose connections declare the same env key with different values, before any write", async () => {
    const id = `create-env-conflict-${Date.now()}`;
    const { status, body } = await createProject({
      id,
      name: "Conflict Creation",
      workspacePath: tempDir,
      connections: [
        {
          providerId: "stub-optional-secret",
          roles: ["tracker"],
          config: {
            host: "https://stub.example",
            apiToken: "conflict-create-value-a",
            project: "conflict-create-a",
          },
        },
        {
          providerId: "stub-capable",
          roles: ["gitHost"],
          config: {
            host: "https://stub.example",
            apiToken: "conflict-create-value-b",
            project: "conflict-create-b",
          },
        },
      ],
      repositories: [
        {
          id: `${id}-web`,
          name: "web",
          localPath: path.join(tempDir, "web"),
          role: "backend",
        },
      ],
    });

    expect(status).toBe(409);
    expect(body).toEqual({ formErrors: ["INCOMPATIBLE_CONFIGURATION"] });
    // No env entry and no record for a rejected creation.
    expect(await loadProjectEnv(id)).toEqual({});
    expect((await loadProjects(configPath)).some((p) => p.id === id)).toBe(
      false,
    );
  });
});

describe("Concurrent project updates and claim fencing (#133 / #158 Task 2)", () => {
  it("serializes concurrent normalized PATCH operations through the claim, re-reading state from disk so neither loses updates", async () => {
    const concurrentId = `patch-race-${Date.now()}`;
    const initial = await createProject({
      id: concurrentId,
      name: "Concurrent Base",
      workspacePath: tempDir,
      connections: [
        {
          providerId: "stub-optional-secret",
          roles: ["tracker", "gitHost"],
          config: {
            host: "https://stub.example",
            apiToken: MARKER_STUB_TOKEN,
            backupToken: "initial-backup",
            project: "initial-proj",
          },
        },
      ],
      repositories: [
        {
          id: `${concurrentId}-repo`,
          name: "web",
          localPath: path.join(tempDir, "web"),
          role: "backend",
        },
      ],
    });
    expect(initial.status).toBe(201);

    const tokenA = "token-patch-a-999";
    const tokenB = "token-patch-b-888";

    // Two PATCHes started concurrently:
    const [resA, resB] = await Promise.all([
      fetch(`${baseUrl}/api/projects/${concurrentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Updated by A",
          connections: [
            {
              providerId: "stub-optional-secret",
              roles: ["tracker", "gitHost"],
              config: {
                host: "https://stub.example",
                apiToken: tokenA,
                project: "proj-a",
              },
            },
          ],
        }),
      }),
      fetch(`${baseUrl}/api/projects/${concurrentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connections: [
            {
              providerId: "stub-optional-secret",
              roles: ["tracker", "gitHost"],
              config: {
                host: "https://stub.example",
                backupToken: tokenB,
                project: "proj-b",
              },
            },
          ],
        }),
      }),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const finalEnv = await loadProjectEnv(concurrentId);
    expect(finalEnv.STUB_BACKUP_TOKEN).toBe(tokenB);
    const finalStored = await readStoredProject(concurrentId);
    expect(finalStored).toBeDefined();
    expect(await readdir(getLocksDir())).toEqual([]);
  });

  it("rejects a normalized CREATE racing against a PATCH on the same project ID as a 409 Conflict", async () => {
    const id = `patch-vs-create-norm-${Date.now()}`;
    const initial = await createProject(jiraAndGithubPayload(id));
    expect(initial.status).toBe(201);

    const [patchRes, createRes] = await Promise.all([
      fetch(`${baseUrl}/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Patched Project",
          connections: [
            {
              providerId: "jira",
              roles: ["tracker"],
              config: {
                host: "https://rocket.atlassian.net",
                email: "dev@example.com",
                project: "ROCKET",
              },
            },
            {
              providerId: "github",
              roles: ["gitHost"],
              config: { repoOwner: "acme", repository: "web" },
            },
          ],
        }),
      }),
      createProject(jiraAndGithubPayload(id)),
    ]);

    expect(patchRes.status).toBe(200);
    expect(createRes.status).toBe(409);
    expect((await readStoredProject(id))?.name).toBe("Patched Project");
    expect(await readdir(getLocksDir())).toEqual([]);
  });

  it("rejects a legacy CREATE racing against a PATCH on the same project ID as a 409 Conflict", async () => {
    const id = `patch-vs-create-legacy-${Date.now()}`;
    const initial = await createProject(jiraAndGithubPayload(id));
    expect(initial.status).toBe(201);

    const [patchRes, createRes] = await Promise.all([
      fetch(`${baseUrl}/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Patched Legacy Rival",
          connections: [
            {
              providerId: "jira",
              roles: ["tracker"],
              config: {
                host: "https://rocket.atlassian.net",
                email: "dev@example.com",
                project: "ROCKET",
              },
            },
            {
              providerId: "github",
              roles: ["gitHost"],
              config: { repoOwner: "acme", repository: "web" },
            },
          ],
        }),
      }),
      createProject({
        id,
        name: "Legacy Impostor",
        repositoryPath: path.join(tempDir, "legacy-repo"),
        defaultBranch: "main",
        testCommand: "bun test",
        issueTracker: {
          provider: "jira",
          connectionId: "jira",
          jira: {
            host: "https://acme.atlassian.net",
            email: "dev@example.com",
            project: "ACME",
          },
        },
      }),
    ]);

    expect(patchRes.status).toBe(200);
    expect(createRes.status).toBe(409);
    expect((await readStoredProject(id))?.name).toBe("Patched Legacy Rival");
    expect(await readdir(getLocksDir())).toEqual([]);
  });

  it("updates connections via updateProjectConnections directly", async () => {
    const directId = `direct-update-${Date.now()}`;
    const project = await createProjectFromConnections(
      {
        id: directId,
        name: "Direct Update Initial",
        workspacePath: tempDir,
        connections: [
          {
            providerId: "stub-optional-secret",
            roles: ["tracker", "gitHost"],
            config: {
              host: "https://stub.example",
              apiToken: "direct-token-init",
              backupToken: "direct-backup-init",
              project: "init",
            },
          },
        ],
        repositories: [
          {
            id: `${directId}-app`,
            name: "app",
            localPath: path.join(tempDir, "app"),
            role: "backend",
          },
        ],
      },
      { configPath, registry: testRegistry },
    );

    const updated = await updateProjectConnections(
      project,
      {
        name: "Direct Updated Name",
        connections: [
          {
            providerId: "stub-optional-secret",
            roles: ["tracker", "gitHost"],
            config: {
              host: "https://stub.example",
              project: "updated-direct",
            },
          },
        ],
      },
      { configPath, registry: testRegistry },
    );

    expect(updated.name).toBe("Direct Updated Name");
    expect(updated.connections?.[0]?.config.project).toBe("updated-direct");
  });
});
describe("POST /api/projects with a LEGACY payload (#133 correction 1)", () => {
  // A legacy record carries no `connections` array: its git host IS its
  // repository (`repositoryPath`, plus that repository's remote). The
  // role-coverage rule therefore applies to it in its own form — the tracker it
  // NAMES must be one the registry can serve — and the requirement is the same
  // one the connections branch enforces: no project exists without a usable
  // issue tracker, rejected before any write.
  function legacyPayload(
    id: string,
    issueTracker?: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      id,
      name: "Legacy App",
      repositoryPath: path.join(tempDir, "legacy-repo"),
      defaultBranch: "main",
      testCommand: "bun test",
      ...(issueTracker ? { issueTracker } : {}),
    };
  }

  it("rejects a bare legacy payload with 409 MISSING_TRACKER_CONNECTION — and writes no project and no secret", async () => {
    const id = `legacy-bare-${Date.now()}`;
    const { status, body } = await createProject(legacyPayload(id));

    expect(status).toBe(409);
    expect(body).toEqual({ formErrors: ["MISSING_TRACKER_CONNECTION"] });
    // Nothing persisted: no project record…
    expect(await readStoredProject(id)).toBeUndefined();
    // …and no env file, so no secret could have been written for it either.
    await expect(stat(getProjectEnvPath(id))).rejects.toThrow();
  });

  it("rejects a legacy payload whose tracker names no registry identity, whatever it does carry", async () => {
    const id = `legacy-unnamed-${Date.now()}`;
    const { status, body } = await createProject(
      legacyPayload(id, { projectId: "PROJ-1", orgUrl: "https://x.example" }),
    );

    expect(status).toBe(409);
    expect(body).toEqual({ formErrors: ["MISSING_TRACKER_CONNECTION"] });
    expect(await readStoredProject(id)).toBeUndefined();
  });

  it("rejects a legacy payload naming an unregistered provider with 409 UNKNOWN_PROVIDER", async () => {
    const id = `legacy-unknown-${Date.now()}`;
    const { status, body } = await createProject(
      legacyPayload(id, { provider: "no-such-tracker", connectionId: "x" }),
    );

    expect(status).toBe(409);
    expect(body).toEqual({ formErrors: ["UNKNOWN_PROVIDER"] });
    expect(await readStoredProject(id)).toBeUndefined();
  });

  it("rejects a legacy payload naming a registered provider that cannot serve the tracker role", async () => {
    const id = `legacy-incapable-${Date.now()}`;
    // Serves both roles but cannot list tickets: a tracker the registry knows
    // and still cannot be operated as one.
    const { status, body } = await createProject(
      legacyPayload(id, {
        provider: "stub-no-tickets",
        connectionId: "stub-no-tickets",
      }),
    );

    expect(status).toBe(409);
    expect(body).toEqual({ formErrors: ["INCOMPATIBLE_CONFIGURATION"] });
    expect(await readStoredProject(id)).toBeUndefined();
  });

  it("accepts a legacy payload with a usable issueTracker, named explicitly or by its namespaced view", async () => {
    const explicitId = `legacy-explicit-${Date.now()}`;
    const explicit = await createProject(
      legacyPayload(explicitId, {
        provider: "jira",
        connectionId: "jira",
        jira: {
          host: "https://acme.atlassian.net",
          email: "dev@example.com",
          project: "ACME",
        },
      }),
    );
    expect(explicit.status).toBe(201);
    // Read back through the runtime's own loader: a legacy record's git host IS
    // its repository, so `repositoryPath` is resolved from the primary
    // repository on the way in.
    const record = (await loadProjects()).find((p) => p.id === explicitId);
    expect(record?.repositoryPath).toBe(path.join(tempDir, "legacy-repo"));
    // The tracker view survived the gate untouched.
    expect(record?.issueTracker?.provider).toBe("jira");

    // The namespaced view ALONE is an identity too: it is the keying
    // `deriveIssueTracker` writes, so the view's key names its provider.
    const viewId = `legacy-view-${Date.now()}`;
    const view = await createProject(
      legacyPayload(viewId, {
        jira: {
          host: "https://acme.atlassian.net",
          email: "dev@example.com",
          project: "ACME",
        },
      }),
    );
    expect(view.status).toBe(201);
    expect((await loadProjects()).some((p) => p.id === viewId)).toBe(true);
  });
});

describe("Redaction before serialization — structured logs", () => {
  it("logs the connection configuration with every declared secret masked", async () => {
    const id = `log-${Date.now()}`;
    const secret = "synthetic-log-marker-6b3d";
    const captured: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown, ...rest: unknown[]) => {
      captured.push([message, ...rest].map(String).join(" "));
    };

    try {
      const { status } = await createProject({
        id,
        name: "Logged",
        workspacePath: tempDir,
        connections: [
          {
            providerId: "stub-capable",
            roles: ["tracker", "gitHost"],
            config: {
              host: "https://stub.example",
              apiToken: secret,
              project: "logged",
            },
          },
        ],
        repositories: [
          {
            id: `${id}-web`,
            name: "web",
            localPath: path.join(tempDir, "web"),
            role: "backend",
          },
        ],
      });
      expect(status).toBe(201);
    } finally {
      console.log = originalLog;
    }

    const creationLog = captured.find((line) =>
      line.includes("Project created from connections"),
    );
    expect(creationLog).toBeDefined();
    // The log really does carry the configuration (so the next assertion is
    // not vacuous)…
    expect(creationLog).toContain("https://stub.example");
    expect(creationLog).toContain("logged");
    // …with the declared secret masked, never as received.
    expect(creationLog).toContain("••••••••");
    expect(creationLog).not.toContain(secret);
  });
});
