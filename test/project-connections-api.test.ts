// test/project-connections-api.test.ts — Project connections, seen at the HTTP
// API seam (#172).
//
// `handleApi` runs with an injected provider registry. The Jira and GitHub
// providers keep their REAL configuration schemas (so the secret `envKey`
// metadata is what routes secrets), while their network calls are recorded
// fakes. Expected values are literals.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getProject } from "../src/config.js";
import { defaultCreatePullRequest } from "../src/executors/deliver.js";
import { handleApi } from "../src/http/routes.js";
import { azureProvider } from "../src/providers/azure-module.js";
import type { Provider, ProviderConfig } from "../src/providers/contract.js";
import { githubConfigSchema } from "../src/providers/github/config.js";
import { ProviderHttpError } from "../src/providers/http.js";
import { jiraProvider } from "../src/providers/jira-module.js";
import type { ProviderRegistry } from "../src/providers/registry.js";
import { findDuplicateProject } from "../src/shared/project-identity.js";
import type { Project } from "../src/shared/types.js";
import { createTestRepositories } from "./helpers/composition.js";

const JIRA_MARKER = "jira-marker-7f3a";
const GITHUB_MARKER = "ghp_marker_91bc";
const PROJECT_ID = "conn-api-rocket";

const calls = {
  jiraVerify: [] as ProviderConfig[],
  jiraTickets: [] as ProviderConfig[],
  azureVerify: [] as ProviderConfig[],
  pullRequests: [] as Array<{ config: ProviderConfig; repository: string }>,
  azurePullRequests: [] as Array<{
    config: ProviderConfig;
    repository: string;
  }>,
};

/** When set, the next Jira verification throws this message (error-path tests). */
let jiraVerifyFailure: string | null = null;

/** When set, Jira ticket listing throws this raw failure (error-path tests). */
let jiraTicketsFailure: Error | null = null;

// The real Jira schema and wire-independent behaviour; only the calls are
// recorded, so the config each capability receives is observable.
const recordingJira: Provider<"jira"> = {
  ...jiraProvider,
  async verifyCredentials(config) {
    calls.jiraVerify.push(config);
    if (jiraVerifyFailure !== null) throw new Error(jiraVerifyFailure);
    return { status: "ok", warnings: [] };
  },
  async listTickets(config) {
    calls.jiraTickets.push(config);
    if (jiraTicketsFailure !== null) throw jiraTicketsFailure;
    return [];
  },
};

// A git host with the real GitHub schema and a recorded pull-request call.
const recordingGitHub: Provider<"github"> = {
  id: "github",
  displayName: "GitHub",
  roles: ["gitHost"],
  iconRef: "provider-github",
  configSchema: githubConfigSchema,
  async verifyCredentials() {
    return { status: "ok", warnings: [] };
  },
  toUserError(_raw, context) {
    return { code: "AUTH_INVALID", context };
  },
  async listRepositories() {
    return [];
  },
  async findExistingPullRequest() {
    return null;
  },
  async createPullRequest(config, input) {
    calls.pullRequests.push({ config, repository: input.repository });
    return { url: "https://github.example/acme/web/pull/1" };
  },
};

// The real Azure schema; verification and pull requests are recorded.
const recordingAzure: Provider<"azure"> = {
  ...azureProvider,
  async verifyCredentials(config) {
    calls.azureVerify.push(config);
    return { status: "ok", warnings: [] };
  },
  async findExistingPullRequest() {
    return null;
  },
  async createPullRequest(config, input) {
    calls.azurePullRequests.push({ config, repository: input.repository });
    return { url: "https://dev.azure.com/acme/Rocket/_git/web/pullrequest/7" };
  },
};

const repos = createTestRepositories();

const registry: ProviderRegistry = new Map<string, Provider>([
  [recordingJira.id, recordingJira],
  [recordingGitHub.id, recordingGitHub],
  [recordingAzure.id, recordingAzure],
]);

let tempDir: string;
const savedEnv = {
  config: process.env.X_FACTORY_CONFIG_PATH,
  data: process.env.X_FACTORY_DATA_DIR,
};

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "xf-conn-api-"));
  process.env.X_FACTORY_CONFIG_PATH = path.join(tempDir, "projects.json");
  process.env.X_FACTORY_DATA_DIR = path.join(tempDir, "data");
});

afterAll(async () => {
  restoreEnv("X_FACTORY_CONFIG_PATH", savedEnv.config);
  restoreEnv("X_FACTORY_DATA_DIR", savedEnv.data);
  await rm(tempDir, { recursive: true, force: true });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function api(method: string, route: string, body?: unknown): Promise<Response> {
  const url = new URL(`http://localhost:3777/api/${route}`);
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return handleApi(new Request(url, init), url, {
    repos,
    providerRegistry: registry,
  });
}

/** A wizard-shaped project: Jira tracker, GitHub git host, both with secrets. */
async function createJiraProject(id: string): Promise<Response> {
  return api("POST", "projects", {
    id,
    name: "Rocket",
    workspacePath: tempDir,
    connections: [
      {
        providerId: "jira",
        roles: ["tracker"],
        config: {
          host: "https://rocket.atlassian.net",
          email: "dev@example.com",
          apiToken: JIRA_MARKER,
          project: "ROCKET",
        },
      },
      {
        providerId: "github",
        roles: ["gitHost"],
        config: {
          token: GITHUB_MARKER,
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
  });
}

describe("project connections at the HTTP seam", () => {
  test("tickets load for a Jira project, with the secret saved under the schema's apiToken", async () => {
    const created = await createJiraProject(PROJECT_ID);
    expect(created.status).toBe(201);

    const res = await api("GET", `projects/${PROJECT_ID}/tickets`);
    expect(res.status).toBe(200);
    expect(calls.jiraTickets.at(-1)).toMatchObject({
      host: "https://rocket.atlassian.net",
      email: "dev@example.com",
      apiToken: JIRA_MARKER,
    });
  });

  test.each([
    [401, undefined, 401, "AUTH_INVALID", undefined],
    [403, undefined, 403, "PERMISSION", undefined],
    [404, undefined, 404, "NOT_FOUND", undefined],
    [429, "30", 429, "RATE_LIMITED", 30000],
    [500, undefined, 502, "UNKNOWN", undefined],
  ] as const)(
    "a provider %i on tickets answers %i with the normalized body and no raw text",
    async (providerStatus, retryAfter, httpStatus, code, retryAfterMs) => {
      jiraTicketsFailure = new ProviderHttpError(
        "RAW-PROVIDER-TEXT-31d0 internal trace",
        {
          status: providerStatus,
          headers: new Headers(retryAfter ? { "Retry-After": retryAfter } : {}),
        },
      );
      try {
        const res = await api("GET", `projects/${PROJECT_ID}/tickets`);
        expect(res.status).toBe(httpStatus);
        const body = (await res.json()) as Record<string, unknown>;
        expect(Object.keys(body).sort()).toEqual(
          retryAfterMs === undefined
            ? ["code", "context", "error"]
            : ["code", "context", "error", "retryAfterMs"],
        );
        expect(body.code).toBe(code);
        expect(body.context).toBe("TICKETS");
        expect(body.retryAfterMs).toBe(retryAfterMs);
        expect(String(body.error)).not.toContain("RAW-PROVIDER-TEXT");
        expect(res.headers.get("Retry-After")).toBe(retryAfter ?? null);
      } finally {
        jiraTicketsFailure = null;
      }
    },
  );

  test("the tracker test passes for a Jira project using the saved secret", async () => {
    const res = await api("POST", `projects/${PROJECT_ID}/tracker/test`, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      message: "Jira Cloud connection successful.",
    });
    expect(calls.jiraVerify.at(-1)).toMatchObject({ apiToken: JIRA_MARKER });
  });

  test("the tracker summary reports the Jira secret under its env key", async () => {
    const res = await api("GET", `projects/${PROJECT_ID}/tracker`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      provider: "jira",
      hasSecret: true,
      secretKey: "JIRA_API_TOKEN",
    });
  });

  test("a credentials update through the generic token alias stores the Jira secret", async () => {
    const res = await api("PUT", `projects/${PROJECT_ID}/tracker/credentials`, {
      token: "rotated-jira-token",
    });
    expect(res.status).toBe(200);

    const env = await readFile(
      path.join(
        process.env.X_FACTORY_DATA_DIR as string,
        "projects",
        PROJECT_ID,
        ".env",
      ),
      "utf-8",
    );
    expect(env).toContain("JIRA_API_TOKEN=rotated-jira-token");
  });

  test("delivery goes through the git host connection and uses its saved secret", async () => {
    const project = (await getProject(PROJECT_ID)) as Project;
    const url = await defaultCreatePullRequest(
      project,
      { branch: "xf/feature", worktree: tempDir, prTitle: "t", prBody: "b" },
      registry,
    );
    expect(url).toBe("https://github.example/acme/web/pull/1");
    expect(calls.pullRequests.at(-1)).toMatchObject({
      config: { token: GITHUB_MARKER, repoOwner: "acme", repository: "web" },
    });
  });
});

describe("duplicate detection for wizard-created connections", () => {
  test("a GitHub project stored as connections (owner + repository) is recognised", () => {
    const existing: Project = {
      id: "web-existing",
      name: "Web",
      issueTracker: { provider: "jira", connectionId: "jira" } as never,
      connections: [
        {
          providerId: "github",
          roles: ["gitHost"],
          config: { repoOwner: "acme", repository: "web" },
        },
      ],
      repositories: [],
      repositoryPath: "/mock",
      defaultBranch: "main",
      testCommand: "test",
    };
    const result = findDuplicateProject(
      [existing],
      "brand-new",
      "github",
      "",
      "acme/web",
    );
    expect(result.isDuplicate).toBe(true);
    expect(result.type).toBe("external_identity");
    expect(result.existingProject?.id).toBe("web-existing");
  });
});

describe("migration keeps the connections the project now has", () => {
  test("a migrated connections-based project resolves to its new tracker provider", async () => {
    const id = "conn-api-migrate";
    const created = await api("POST", "projects", {
      id,
      name: "Migrate Me",
      workspacePath: tempDir,
      connections: [
        {
          providerId: "jira",
          roles: ["tracker"],
          config: {
            host: "https://rocket.atlassian.net",
            email: "dev@example.com",
            apiToken: JIRA_MARKER,
            project: "ROCKET",
          },
        },
        {
          providerId: "github",
          roles: ["gitHost"],
          config: {
            token: GITHUB_MARKER,
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
    });
    expect(created.status).toBe(201);

    const migrated = await api("POST", `projects/${id}/migrate`, {
      targetProvider: "azure",
      azure: { orgUrl: "https://dev.azure.com/acme", project: "Rocket" },
      secrets: { pat: "azure-pat-4d2e" },
    });
    expect(migrated.status).toBe(201);

    const summary = await api("GET", `projects/${id}-azure/tracker`);
    expect(await summary.json()).toMatchObject({
      provider: "azure",
      hasSecret: true,
      secretKey: "AZURE_DEVOPS_PAT",
    });
  });
});

describe("git host delivery and identity through Azure", () => {
  test("a Jira tracker with an Azure git host delivers through Azure, with its saved PAT", async () => {
    const id = "conn-api-azure-host";
    const created = await api("POST", "projects", {
      id,
      name: "Azure Host",
      workspacePath: tempDir,
      connections: [
        {
          providerId: "jira",
          roles: ["tracker"],
          config: {
            host: "https://rocket.atlassian.net",
            email: "dev@example.com",
            apiToken: JIRA_MARKER,
            project: "ROCKET",
          },
        },
        {
          providerId: "azure",
          roles: ["gitHost"],
          config: {
            orgUrl: "https://dev.azure.com/acme",
            project: "Rocket",
            pat: "azure-pat-saved-1",
          },
        },
      ],
      repositories: [
        {
          id: `${id}-web`,
          name: "web",
          remote: "https://dev.azure.com/acme/Rocket/_git/web",
          defaultBranch: "main",
          localPath: path.join(tempDir, "web"),
          role: "frontend",
          primary: true,
        },
      ],
    });
    expect(created.status).toBe(201);

    const project = (await getProject(id)) as Project;
    const url = await defaultCreatePullRequest(
      project,
      { branch: "xf/azure", worktree: tempDir, prTitle: "t", prBody: "b" },
      registry,
    );
    expect(url).toBe(
      "https://dev.azure.com/acme/Rocket/_git/web/pullrequest/7",
    );
    expect(calls.azurePullRequests.at(-1)).toMatchObject({
      config: {
        orgUrl: "https://dev.azure.com/acme",
        pat: "azure-pat-saved-1",
      },
      repository: "web",
    });
  });

  test("an Azure connections-based project is recognised as a duplicate by its organization and project", () => {
    const existing: Project = {
      id: "azure-existing",
      name: "Azure",
      issueTracker: { provider: "jira", connectionId: "jira" } as never,
      connections: [
        {
          providerId: "azure",
          roles: ["tracker", "gitHost"],
          config: { orgUrl: "https://dev.azure.com/acme/", project: "Rocket" },
        },
      ],
      repositories: [],
      repositoryPath: "/mock",
      defaultBranch: "main",
      testCommand: "test",
    };
    const result = findDuplicateProject(
      [existing],
      "brand-new-azure",
      "azure",
      "https://dev.azure.com/acme",
      "Rocket",
    );
    expect(result.isDuplicate).toBe(true);
    expect(result.type).toBe("external_identity");
    expect(result.existingProject?.id).toBe("azure-existing");
  });
});

describe("tracker credentials and errors", () => {
  test("a credentials update for an unregistered provider is rejected and saves nothing", async () => {
    // The project is valid under the full registry; the request is served by a
    // registry that no longer knows its Jira tracker.
    const withoutJira: ProviderRegistry = new Map<string, Provider>([
      [recordingGitHub.id, recordingGitHub],
    ]);
    const url = new URL(
      `http://localhost:3777/api/projects/${PROJECT_ID}/tracker/credentials`,
    );
    const res = await handleApi(
      new Request(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "should-not-be-saved" }),
      }),
      url,
      { repos, providerRegistry: withoutJira },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("not registered"),
    });
    const env = await readFile(
      path.join(
        process.env.X_FACTORY_DATA_DIR as string,
        "projects",
        PROJECT_ID,
        ".env",
      ),
      "utf-8",
    );
    expect(env).not.toContain("should-not-be-saved");
  });

  test("a test that fails with a saved secret in its message never returns that secret", async () => {
    // The saved Jira secret is the one the rotation test stored.
    const SAVED = "rotated-jira-token";
    jiraVerifyFailure = `auth rejected for token ${SAVED}`;
    try {
      const res = await api("POST", `projects/${PROJECT_ID}/tracker/test`, {});
      // A thrown provider failure is a provider error (the raw message maps to
      // UNKNOWN → 502), so only the canonical envelope crosses the boundary.
      expect(res.status).toBe(502);
      const body = (await res.json()) as {
        error?: string;
        code?: string;
        context?: string;
      };
      expect(body).toEqual({
        error:
          "An unexpected error occurred while verifying the connection. Try again.",
        code: "UNKNOWN",
        context: "VERIFY",
      });
      const wire = JSON.stringify(body);
      expect(wire).not.toContain(SAVED);
      expect(wire).not.toContain("auth rejected");
    } finally {
      jiraVerifyFailure = null;
    }
  });
});
