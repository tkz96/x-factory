// test/typed-config-entry-point.test.ts — One entry point turns raw config into
// the typed config an adapter receives (#186 review fixes).
//
// Covers: stored connections are migrated when read, every route that hands
// config to an adapter rejects conflicting legacy shapes (no HTTP call), the
// Azure legacy organization maps to its URL, and the tracker input schemas.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Repositories } from "../src/composition-root.js";
import { IssueTrackerInputSchema } from "../src/config-schema.js";
import { azureProvider } from "../src/providers/azure-module.js";
import { toTypedProviderConfig } from "../src/providers/config-validation.js";
import {
  createGithubProvider,
  githubProvider,
  resolveGitHubConfig,
} from "../src/providers/github-module.js";
import { migrateLegacyProviderConfig } from "../src/providers/legacy-migration.js";
import {
  loadProjectConnections,
  resolveProjectConnection,
} from "../src/providers/project-connections.js";
import { startServer } from "../src/server.js";
import { findDuplicateProject } from "../src/shared/project-identity.js";
import type { Project } from "../src/shared/types.js";
import { createTestRepositories } from "./helpers/composition.js";

function projectWith(partial: Record<string, unknown>): Project {
  return {
    id: "p1",
    name: "p1",
    repositories: [],
    ...partial,
  } as unknown as Project;
}

function storedGithub(config: Record<string, unknown>): Project {
  return projectWith({
    connections: [{ providerId: "github", roles: ["tracker"], config }],
  });
}

describe("Stored connections are migrated when read (#186)", () => {
  it("reads legacy owner/repo from a stored connection as repoOwner/repository", () => {
    const [connection] = loadProjectConnections(
      storedGithub({ owner: "acme", repo: "web", token: "ghp_x" }),
    );
    expect(connection?.config.repoOwner).toBe("acme");
    expect(connection?.config.repository).toBe("web");
    expect(connection?.config.token).toBe("ghp_x");
  });

  it("splits repo:'acme/web' in a stored connection", () => {
    const [connection] = loadProjectConnections(
      storedGithub({ repo: "acme/web" }),
    );
    expect(connection?.config.repoOwner).toBe("acme");
    expect(connection?.config.repository).toBe("web");
  });

  it("reads nested github and gitHost shapes in a stored connection", () => {
    const [nested] = loadProjectConnections(
      storedGithub({ github: { repoOwner: "acme", repository: "web" } }),
    );
    expect(nested?.config.repoOwner).toBe("acme");
    expect(nested?.config.repository).toBe("web");

    const [host] = loadProjectConnections(
      storedGithub({ gitHost: { token: "ghp_h", owner: "acme", repo: "api" } }),
    );
    expect(host?.config.token).toBe("ghp_h");
    expect(host?.config.repoOwner).toBe("acme");
    expect(host?.config.repository).toBe("api");
  });

  it("rejects a stored connection whose legacy shapes conflict", () => {
    expect(() =>
      loadProjectConnections(
        storedGithub({ repoOwner: "acme", gitHost: { owner: "other" } }),
      ),
    ).toThrow(/Configuration mismatch/);
  });

  it("resolves owner and repo of a stored legacy connection through the resolver", () => {
    const resolved = resolveProjectConnection(
      storedGithub({ owner: "acme", repo: "web" }),
      "tracker",
      { GITHUB_TOKEN: "ghp_env" },
    );
    expect(resolved).toBeDefined();
    const github = resolveGitHubConfig(resolved?.config ?? {});
    expect(github.owner).toBe("acme");
    expect(github.repo).toBe("web");
    expect(github.token).toBe("ghp_env");
  });

  it("keeps fields the migration does not own, such as requiredLabel", () => {
    const [connection] = loadProjectConnections(
      storedGithub({ owner: "acme", repo: "web", requiredLabel: "xf" }),
    );
    expect(connection?.config.requiredLabel).toBe("xf");
  });

  it("duplicate detection sees a stored legacy owner/repo connection", () => {
    const existing = projectWith({
      id: "existing",
      connections: [
        {
          providerId: "github",
          roles: ["tracker"],
          config: { owner: "acme", repo: "web" },
        },
      ],
    });
    const result = findDuplicateProject(
      [existing],
      "new-id",
      "github",
      "",
      "acme/web",
    );
    expect(result.isDuplicate).toBe(true);
  });

  it("a legacy issueTracker is narrowed to its own provider section", () => {
    const connections = loadProjectConnections(
      projectWith({
        issueTracker: {
          provider: "github",
          github: { repo: "acme/web" },
          azure: { orgUrl: "https://dev.azure.com/stale", project: "Old" },
        },
      }),
    );
    expect(connections[0]?.config.repoOwner).toBe("acme");
    expect(connections[0]?.config.repository).toBe("web");
  });

  it("a legacy issueTracker whose flat and namespaced owner disagree is rejected", () => {
    expect(() =>
      loadProjectConnections(
        projectWith({
          issueTracker: {
            provider: "github",
            owner: "acme",
            github: { repoOwner: "other", repository: "web" },
          },
        }),
      ),
    ).toThrow(/Configuration mismatch/);
  });
});

describe("toTypedProviderConfig is the one entry point (#186)", () => {
  it("rejects conflicting nested keys instead of silently stripping them", () => {
    const result = toTypedProviderConfig(githubProvider, {
      token: "ghp_a",
      repoOwner: "alpha",
      github: { repoOwner: "beta" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflict).toContain("Configuration mismatch");
      expect(result.fieldErrors).toEqual({ config: "INVALID" });
    }
  });

  it("returns schema-typed config for a legacy shape", () => {
    const result = toTypedProviderConfig(githubProvider, {
      githubToken: "ghp_a",
      owner: "acme",
      repo: "web",
    });
    expect(result).toEqual({
      ok: true,
      config: { token: "ghp_a", repoOwner: "acme", repository: "web" },
    });
  });

  it("passes a provider without legacy shapes through its schema unchanged", () => {
    const result = toTypedProviderConfig(
      { id: "other", configSchema: githubProvider.configSchema },
      { token: "t", repoOwner: "o" },
    );
    expect(result).toEqual({
      ok: true,
      config: { token: "t", repoOwner: "o" },
    });
  });

  it("makes no HTTP call for a conflicting config before reaching the adapter", async () => {
    let httpCalls = 0;
    const provider = createGithubProvider({
      fetchFn: (async () => {
        httpCalls++;
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
    });
    const typed = toTypedProviderConfig(provider, {
      token: "ghp_one",
      gitHost: { token: "ghp_two" },
    });
    expect(typed.ok).toBe(false);
    if (typed.ok) await provider.verifyScopes?.(typed.config);
    expect(httpCalls).toBe(0);
  });
});

describe("Azure legacy organization (#186)", () => {
  it("maps a legacy org to its dev.azure.com URL", () => {
    expect(
      migrateLegacyProviderConfig("azure", {
        organization: "acme-corp",
        project: "Backend",
      }),
    ).toEqual({
      orgUrl: "https://dev.azure.com/acme-corp",
      project: "Backend",
    });
    const typed = toTypedProviderConfig(azureProvider, {
      org: "acme-corp",
      project: "Backend",
    });
    expect(typed).toEqual({
      ok: true,
      config: { orgUrl: "https://dev.azure.com/acme-corp", project: "Backend" },
    });
  });

  it("rejects two legacy organizations that disagree", () => {
    expect(() =>
      migrateLegacyProviderConfig("azure", {
        org: "one",
        azure: { organization: "two" },
        project: "Backend",
      }),
    ).toThrow(/Configuration mismatch/);
  });

  it("verifyCredentials rejects a conflicting config before any request", async () => {
    await expect(
      azureProvider.verifyCredentials({
        orgUrl: "https://dev.azure.com/acme-corp",
        organization: "conflict-org",
        project: "Backend",
      }),
    ).rejects.toThrow(/Configuration mismatch/);
  });
});

describe("Tracker input schemas (#186)", () => {
  it("keeps legacy alias keys on the github view for the migration step", () => {
    const parsed = IssueTrackerInputSchema.parse({
      github: { owner: "acme", repo: "web" },
    });
    expect((parsed as { github: Record<string, unknown> }).github.owner).toBe(
      "acme",
    );
  });

  it("accepts a jira view without a project, which scopes ticket queries only when set", () => {
    const parsed = IssueTrackerInputSchema.safeParse({
      jira: { host: "acme.atlassian.net", email: "a@b.co" },
    });
    expect(parsed.success).toBe(true);
  });
});

describe("Routes hand adapters typed config (#186)", () => {
  let server: ReturnType<typeof startServer>;
  let repos: Repositories;
  let baseUrl: string;

  beforeAll(() => {
    repos = createTestRepositories();
    server = startServer(0, undefined, repos.db);
    baseUrl = `http://localhost:${server.port}`;
  });
  afterAll(() => {
    server.stop(true);
  });

  const conflictingGithub = {
    token: "ghp_a",
    repoOwner: "alpha",
    github: { repoOwner: "beta" },
  };

  async function post(path: string, body: unknown) {
    return fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("test-connection rejects a conflicting config without contacting the provider", async () => {
    const res = await post("/api/projects/test-connection", {
      provider: "github",
      ...conflictingGithub,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: false,
      error: "Connection settings are incomplete, invalid or conflicting.",
    });
  });

  it("discover-repositories rejects a conflicting config", async () => {
    const res = await post("/api/projects/discover-repositories", {
      provider: "github",
      ...conflictingGithub,
    });
    expect(res.status).toBe(400);
  });

  it("test-scopes rejects a conflicting config", async () => {
    const res = await post("/api/projects/test-scopes", {
      providerId: "github",
      ...conflictingGithub,
    });
    const body = (await res.json()) as { ok: boolean; errors: string[] };
    expect(body.ok).toBe(false);
    expect(body.errors).toEqual([
      "Connection settings are incomplete, invalid or conflicting.",
    ]);
  });

  it("providers/verify answers 409 with a codes-only envelope for a conflict", async () => {
    const res = await post("/api/providers/verify", {
      providerId: "github",
      config: conflictingGithub,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ fieldErrors: { config: "INVALID" } });
  });

  it("providers/repositories answers 409 for a conflict", async () => {
    const res = await post("/api/providers/repositories", {
      providerId: "github",
      config: conflictingGithub,
    });
    expect(res.status).toBe(409);
  });
});
