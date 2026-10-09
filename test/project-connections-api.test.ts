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
import type { Provider, ProviderConfig } from "../src/providers/contract.js";
import { githubConfigSchema } from "../src/providers/github/config.js";
import { jiraProvider } from "../src/providers/jira-module.js";
import type { ProviderRegistry } from "../src/providers/registry.js";
import { findDuplicateProject } from "../src/shared/project-identity.js";
import type { Project } from "../src/shared/types.js";

const JIRA_MARKER = "jira-marker-7f3a";
const GITHUB_MARKER = "ghp_marker_91bc";
const PROJECT_ID = "conn-api-rocket";

const calls = {
  jiraVerify: [] as ProviderConfig[],
  jiraTickets: [] as ProviderConfig[],
  pullRequests: [] as Array<{ config: ProviderConfig; repository: string }>,
};

// The real Jira schema and wire-independent behaviour; only the calls are
// recorded, so the config each capability receives is observable.
const recordingJira: Provider<"jira"> = {
  ...jiraProvider,
  async verifyCredentials(config) {
    calls.jiraVerify.push(config);
    return { status: "ok", warnings: [] };
  },
  async listTickets(config) {
    calls.jiraTickets.push(config);
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

const registry: ProviderRegistry = new Map<string, Provider>([
  [recordingJira.id, recordingJira],
  [recordingGitHub.id, recordingGitHub],
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
  const url = new URL(`http://localhost/api/${route}`);
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return handleApi(new Request(url, init), url, registry);
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
