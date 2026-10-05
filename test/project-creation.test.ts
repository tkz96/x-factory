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
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getProjectEnvPath } from "../src/paths.js";
import { loadProjectEnv } from "../src/project-env.js";
import type { Provider } from "../src/providers/contract.js";
import { resolveProjectProvider } from "../src/providers/project-config.js";
import { PROVIDER_REGISTRY } from "../src/providers/registry.js";
import { startServer } from "../src/server.js";
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

const testRegistry: Map<string, Provider> = new Map<string, Provider>([
  ...PROVIDER_REGISTRY,
  [capableStubProvider.id, capableStubProvider],
  [noTicketsStubProvider.id, noTicketsStubProvider],
  [noPullRequestsStubProvider.id, noPullRequestsStubProvider],
  [trackerOnlyStubProvider.id, trackerOnlyStubProvider],
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
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/projects`, {
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
    const resolved = resolveProjectProvider(stored as Project, env);
    expect(resolved.provider.id).toBe("jira");
    expect(resolved.config.host).toBe("https://rocket.atlassian.net");
    expect(Object.values(resolved.config)).toContain(MARKER_JIRA_TOKEN);
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
            roles: connection.roles ?? ["tracker"],
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
            roles: ["tracker"],
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

describe("Ordered writes for crash safety (connections payload)", () => {
  let crashDir: string;
  const originalDataDir = process.env.X_FACTORY_DATA_DIR;
  const originalConfigPath = process.env.X_FACTORY_CONFIG_PATH;

  beforeEach(async () => {
    crashDir = await mkdtemp(path.join(tmpdir(), "xf-crash-"));
    process.env.X_FACTORY_DATA_DIR = path.join(crashDir, "data");
    process.env.X_FACTORY_CONFIG_PATH = path.join(crashDir, "projects.json");
  });

  afterEach(async () => {
    await chmod(process.env.X_FACTORY_CONFIG_PATH ?? "", 0o644).catch(() => {});
    process.env.X_FACTORY_DATA_DIR = originalDataDir;
    process.env.X_FACTORY_CONFIG_PATH = originalConfigPath;
    await rm(crashDir, { recursive: true, force: true });
  });

  function crashPayload(id: string): ConnectionsPayload {
    return {
      id,
      name: "Crash Test",
      workspacePath: crashDir,
      connections: [
        {
          providerId: "stub-capable",
          roles: ["tracker"],
          config: {
            host: "https://stub.example",
            apiToken: MARKER_STUB_TOKEN,
            project: "crash",
          },
        },
      ],
      repositories: [
        {
          id: `${id}-web`,
          name: "web",
          localPath: path.join(crashDir, "web"),
          role: "backend",
        },
      ],
    };
  }

  async function storedIds(): Promise<string[]> {
    const raw = await readFile(
      process.env.X_FACTORY_CONFIG_PATH ?? "",
      "utf-8",
    );
    return (
      JSON.parse(raw) as { projects: Array<{ id: string }> }
    ).projects.map((p) => p.id);
  }

  it("creates no project at all when secret persistence fails", async () => {
    const id = `crash-secret-${Date.now()}`;
    // Block per-project env storage: <dataDir>/projects is a regular file, so
    // creating <dataDir>/projects/<id>/ fails.
    await mkdir(path.join(crashDir, "data"), { recursive: true });
    await writeFile(path.join(crashDir, "data", "projects"), "not a directory");

    const { status } = await createProject(crashPayload(id));
    expect(status).toBe(500);

    // No secret store for the project…
    await expect(stat(getProjectEnvPath(id))).rejects.toThrow();
    // …and no project record: a project never exists without its secrets.
    // (The projects file itself may be created empty by the read path — that
    // is not a project.)
    expect(await storedIds().catch(() => [])).toEqual([]);
  });

  it("leaves the secrets and no project when the commit point fails, then converges on retry", async () => {
    const id = `crash-commit-${Date.now()}`;
    const configPath = process.env.X_FACTORY_CONFIG_PATH ?? "";
    await writeFile(
      configPath,
      `${JSON.stringify({ projects: [] }, null, 2)}\n`,
    );

    // Make the projects file readable but not writable: step (3) fails after
    // step (2) has already persisted the secrets.
    await chmod(configPath, 0o444);
    // Precondition, asserted: this environment actually enforces read-only, so
    // the test cannot pass vacuously.
    await expect(writeFile(configPath, "blocked")).rejects.toThrow();

    const { status } = await createProject(crashPayload(id));
    expect(status).toBe(500);

    // Secrets landed first (idempotent, retry-safe)…
    expect((await loadProjectEnv(id)).STUB_API_TOKEN).toBe(MARKER_STUB_TOKEN);
    // …and the record did not commit.
    expect(await storedIds()).not.toContain(id);

    // A retry after the failure converges: same secret, one record.
    await chmod(configPath, 0o644);
    const retry = await createProject(crashPayload(id));
    expect(retry.status).toBe(201);
    expect(await storedIds()).toEqual([id]);
    expect((await loadProjectEnv(id)).STUB_API_TOKEN).toBe(MARKER_STUB_TOKEN);
  });
});
