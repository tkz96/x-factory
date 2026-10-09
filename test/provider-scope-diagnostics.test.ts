// test/provider-scope-diagnostics.test.ts — "Verify scopes" on an existing
// project uses its STORED connection (#183).
//
// The scope diagnostic is a project-scoped tracker action:
// `POST /api/projects/{id}/tracker/scopes`. It resolves the tracker connection
// through the project connections module (`resolveProjectConnection`), so the
// config it probes with is the recorded connection plus the per-project env
// secrets — never anything the request body carries (the body is ignored
// entirely). Failures cross the boundary as the normalized (code, context)
// envelope; a raw provider message never reaches the client.
//
// The flat legacy routes this replaces — `POST /api/projects/test-scopes`,
// `/api/projects/test-azure-scopes`, `/api/projects/test-connection`,
// `/api/projects/test-tracker`, `/api/projects/discover-repositories` and the
// `/api/discovery/*` discovery aliases — are asserted gone here: no legacy
// provider alias route remains in the projects controller.
//
// Coverage notes (#183): the previous body-driven resolution tests are retired
// with the body-config seam they pinned — an explicit `providerId` in the
// request, the "No tracker connection resolved …" copy, and the
// canonical/legacy alias parity check. Their replacement is the stored-config
// dispatch, the project-scoped failure modes, and the 404s below, all at the
// HTTP API seam (`handleApi` with an injected registry).

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod/v4";
import { handleApi } from "../src/http/routes.js";
import type { Provider, ProviderConfig } from "../src/providers/contract.js";
import type { ProviderRegistry } from "../src/providers/registry.js";
import { stubProvider } from "./fixtures/stub-provider.js";

const STORED_HOST = "https://stored.example";
const STORED_PROJECT = "StoredProject";
const STORED_SECRET = "stored-secret-marker-5e2c";

/**
 * Capabilities the connection-set role rules demand of a tracker and a git
 * host — not the capability under test. They are present so project creation
 * accepts the connection set; nothing here calls them.
 */
const ROLE_CAPABILITIES = {
  async listTickets() {
    return [];
  },
  async listRepositories() {
    return [];
  },
  async createPullRequest() {
    return { url: "https://git.example/acme/app/pull/1" };
  },
  async findExistingPullRequest() {
    return null;
  },
};

/**
 * The stub's contract identity with NO scope capability — the honest capability
 * gap. It is spelled out rather than spread-with-`undefined` because
 * `exactOptionalPropertyTypes` forbids assigning `undefined` to an optional
 * capability, which is also the shape the gate wants us to dispatch on.
 */
const scopelessProvider: Provider = {
  id: "scopeless",
  displayName: "Scopeless Provider",
  roles: stubProvider.roles,
  iconRef: stubProvider.iconRef,
  configSchema: stubProvider.configSchema,
  verifyCredentials: (config) => stubProvider.verifyCredentials(config),
  toUserError: (raw, context) => stubProvider.toUserError(raw, context),
  ...ROLE_CAPABILITIES,
};

const verifyScopesCalls: ProviderConfig[] = [];

/** A tracker whose verifyScopes RECORDS the config it received, then reports. */
const verifyingProvider: Provider = {
  ...stubProvider,
  ...ROLE_CAPABILITIES,
  id: "verifying",
  displayName: "Verifying Provider",
  async verifyScopes(config: ProviderConfig) {
    verifyScopesCalls.push(config);
    return {
      findings: [{ capability: "listTickets", status: "confirmed" }],
      overPrivileged: false,
    };
  },
};

/** A tracker whose verifyScopes throws a raw provider message with a secret. */
const throwingProvider: Provider = {
  ...stubProvider,
  ...ROLE_CAPABILITIES,
  id: "throwing",
  displayName: "Throwing Provider",
  async verifyScopes(): Promise<never> {
    throw new Error(`upstream exploded for token ${STORED_SECRET}`);
  },
};

/**
 * The git-host connection of the test project. Its secret sits under its OWN
 * env key so it can never be confused with — or collide with — the tracker's.
 */
const gitHostProvider: Provider = {
  id: "githost",
  displayName: "Git Host",
  roles: ["gitHost"],
  iconRef: "provider-github",
  configSchema: z.object({
    namespace: z.string().min(1).meta({ label: "Namespace", uiType: "text" }),
    gitToken: z.string().min(1).meta({
      label: "Git token",
      uiType: "secret",
      secret: true,
      envKey: "STUB_GIT_TOKEN",
    }),
  }),
  async verifyCredentials() {
    return { status: "ok", warnings: [] };
  },
  toUserError: (_raw, context) => ({ code: "AUTH_INVALID", context }),
  ...ROLE_CAPABILITIES,
};

const registry: ProviderRegistry = new Map<string, Provider>([
  [scopelessProvider.id, scopelessProvider],
  [verifyingProvider.id, verifyingProvider],
  [throwingProvider.id, throwingProvider],
  [gitHostProvider.id, gitHostProvider],
]);

let baseDir: string;
const savedEnv = {
  config: process.env.X_FACTORY_CONFIG_PATH,
  data: process.env.X_FACTORY_DATA_DIR,
};

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeAll(async () => {
  baseDir = await mkdtemp(path.join(tmpdir(), "xf-scope-diagnostics-"));
  process.env.X_FACTORY_CONFIG_PATH = path.join(baseDir, "projects.json");
  process.env.X_FACTORY_DATA_DIR = path.join(baseDir, "data");
});

afterAll(async () => {
  restoreEnv("X_FACTORY_CONFIG_PATH", savedEnv.config);
  restoreEnv("X_FACTORY_DATA_DIR", savedEnv.data);
  await rm(baseDir, { recursive: true, force: true });
});

function api(method: string, route: string, body?: unknown): Promise<Response> {
  const url = new URL(`http://localhost:3777/api/${route}`);
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return handleApi(new Request(url, init), url, registry);
}

/**
 * A wizard-shaped project whose tracker is `trackerProviderId`. The token is a
 * declared secret, so creation routes it into per-project env storage — the
 * stored connection the scope diagnostic must resolve.
 */
async function createProject(id: string, trackerProviderId: string) {
  return api("POST", "projects", {
    id,
    name: "Diagnostic Project",
    workspacePath: baseDir,
    connections: [
      {
        providerId: trackerProviderId,
        roles: ["tracker"],
        config: {
          host: STORED_HOST,
          project: STORED_PROJECT,
          apiToken: STORED_SECRET,
        },
      },
      {
        // A second, distinct provider covers the git-host role: the registry
        // this seam injects ships no real GitHub provider.
        providerId: "githost",
        roles: ["gitHost"],
        config: { namespace: "acme", gitToken: "ghp_marker" },
      },
    ],
    repositories: [
      {
        id: `${id}-app`,
        name: "app",
        remote: "https://github.example/acme/app.git",
        defaultBranch: "main",
        localPath: path.join(baseDir, "app"),
        role: "backend",
        primary: true,
      },
    ],
  });
}

interface ScopesBody {
  ok?: boolean;
  overPrivileged?: boolean;
  scopes?: Record<string, unknown>;
  errors?: string[];
  warnings?: string[];
  error?: { code?: string; context?: string };
}

describe("Verify scopes on an existing project uses its stored connection (#183)", () => {
  it("probes with the recorded connection config and the env-stored secret", async () => {
    const created = await createProject("proj-scopes", "verifying");
    expect(created.status).toBe(201);

    const res = await api(
      "POST",
      "projects/proj-scopes/tracker/scopes",
      // A hostile body: nothing in it may reach the provider.
      { orgUrl: "https://evil.example", apiToken: "body-token" },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ScopesBody;
    expect(body).toEqual({
      ok: true,
      overPrivileged: false,
      scopes: { listTickets: true },
      errors: [],
      warnings: [],
    });

    // The config the provider received is the STORED connection: recorded
    // non-secret fields plus the secret merged back from env storage.
    expect(verifyScopesCalls.at(-1)).toEqual({
      host: STORED_HOST,
      project: STORED_PROJECT,
      apiToken: STORED_SECRET,
    });
  });

  it("reports the capability gap in provider-agnostic copy", async () => {
    const created = await createProject("proj-gap", "scopeless");
    expect(created.status).toBe(201);

    const res = await api("POST", "projects/proj-gap/tracker/scopes");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ScopesBody;
    expect(body).toEqual({
      ok: false,
      overPrivileged: false,
      scopes: {},
      errors: [
        "The resolved tracker provider does not support scope verification.",
      ],
      warnings: [],
    });
    // Provider-agnostic: the copy never names the provider.
    expect(JSON.stringify(body).toLowerCase()).not.toContain("scopeless");
  });

  it("normalizes a provider failure to the (code, context) envelope, never raw text", async () => {
    const created = await createProject("proj-throw", "throwing");
    expect(created.status).toBe(201);

    const res = await api("POST", "projects/proj-throw/tracker/scopes");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ScopesBody;
    expect(body.ok).toBe(false);
    // The normalized envelope, not the thrown message.
    expect(body.error).toEqual({ code: "AUTH_INVALID", context: "VERIFY" });
    const wire = JSON.stringify(body);
    expect(wire).not.toContain("upstream exploded");
    expect(wire).not.toContain(STORED_SECRET);
  });

  it("answers 404 for a project that is not recorded", async () => {
    const res = await api("POST", "projects/proj-missing/tracker/scopes");
    expect(res.status).toBe(404);
  });

  it("answers 400 when the project records no tracker connection", async () => {
    // A valid record whose connections cover only the git host: the tracker
    // role resolves to nothing.
    await writeFile(
      process.env.X_FACTORY_CONFIG_PATH ?? "",
      JSON.stringify({
        projects: [
          {
            id: "proj-no-tracker",
            name: "Trackerless",
            workspacePath: baseDir,
            issueTracker: { provider: "github", connectionId: "github" },
            connections: [
              {
                providerId: "github",
                roles: ["gitHost"],
                config: { token: "ghp_marker", repoOwner: "acme" },
              },
            ],
            repositories: [
              {
                id: "proj-no-tracker-app",
                name: "app",
                path: path.join(baseDir, "app"),
                defaultBranch: "main",
              },
            ],
          },
        ],
      }),
      "utf-8",
    );

    const res = await api("POST", "projects/proj-no-tracker/tracker/scopes");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("has no issue tracker configured");
  });
});

describe("no legacy provider alias route remains (#183)", () => {
  const legacyRoutes: Array<[string, string]> = [
    ["POST", "projects/test-scopes"],
    ["POST", "projects/test-azure-scopes"],
    ["POST", "projects/test-connection"],
    ["POST", "projects/test-tracker"],
    ["POST", "projects/discover-repositories"],
    ["POST", "discovery/discover-repositories"],
    ["POST", "discovery/discover"],
    ["POST", "discovery/repositories"],
  ];

  for (const [method, route] of legacyRoutes) {
    it(`${method} /api/${route} answers 404`, async () => {
      const res = await api(method, route, { projectId: "proj-scopes" });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error?: string };
      expect(body).toEqual({ error: "Endpoint not found." });
    });
  }
});
