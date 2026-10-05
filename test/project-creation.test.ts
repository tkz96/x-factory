// test/project-creation.test.ts — Project creation from the normalized
// connections payload (#145 / parent spec #133).
//
// Highest seam: the real HTTP route with providers injected through the
// explicit static registry. Env storage and the projects config file are
// pointed at a temp dir through the documented path env overrides, so no
// real ~/.x-factory or repository state is touched. Only synthetic
// credentials are used.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
});
