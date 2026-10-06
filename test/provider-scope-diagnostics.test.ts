// test/provider-scope-diagnostics.test.ts — The scope diagnostic resolves its
// provider GENERICALLY (#141 correction).
//
// The route resolves the provider from the request's own `providerId`, otherwise
// from the project's recorded tracker connection, then dispatches through
// `hasCapability(provider, "verifyScopes")`. Nothing in the controller names a
// provider — proven here by driving the route with a provider the production
// registry does not ship, injected through the registry seam, and by asserting
// that both failure messages name no provider.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { handleProjectsRoute } from "../src/http/projects-controller.js";
import type { Provider } from "../src/providers/contract.js";
import { stubProvider } from "./fixtures/stub-provider.js";

let baseDir: string;
const savedConfigPath = process.env.X_FACTORY_CONFIG_PATH;

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
};

const registry = new Map<string, Provider>([
  [stubProvider.id, stubProvider],
  [scopelessProvider.id, scopelessProvider],
]);

interface DiagnosticBody {
  ok?: boolean;
  overPrivileged?: boolean;
  scopes?: Record<string, unknown>;
  errors?: string[];
  warnings?: string[];
}

/** POSTs the scope-diagnostic route and returns its status and JSON body. */
async function postScopes(body: unknown): Promise<{
  status: number;
  data: DiagnosticBody;
}> {
  const req = new Request("http://localhost/api/projects/test-azure-scopes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await handleProjectsRoute(
    "POST",
    "test-azure-scopes",
    undefined,
    2,
    req,
    undefined,
    registry,
  );
  return {
    status: res?.status ?? 0,
    data: ((await res?.json()) ?? {}) as DiagnosticBody,
  };
}

/** Writes a one-project configuration whose tracker connection is `providerId`. */
async function writeProject(
  id: string,
  trackerProviderId: string,
): Promise<void> {
  await writeFile(
    process.env.X_FACTORY_CONFIG_PATH ?? "",
    JSON.stringify({
      projects: [
        {
          id,
          name: "Diagnostic Project",
          workspacePath: baseDir,
          issueTracker: {
            provider: trackerProviderId,
            connectionId: trackerProviderId,
          },
          repositories: [
            {
              id: `${id}-app`,
              name: "app",
              path: baseDir,
              defaultBranch: "main",
              role: "backend",
            },
          ],
        },
      ],
    }),
    "utf-8",
  );
}

beforeAll(async () => {
  baseDir = await mkdtemp(path.join(tmpdir(), "xf-scope-diagnostics-"));
  process.env.X_FACTORY_CONFIG_PATH = path.join(baseDir, "projects.json");
});

afterAll(async () => {
  if (savedConfigPath === undefined) delete process.env.X_FACTORY_CONFIG_PATH;
  else process.env.X_FACTORY_CONFIG_PATH = savedConfigPath;
  await rm(baseDir, { recursive: true, force: true });
});

describe("scope diagnostic resolves its provider generically (#141)", () => {
  it("dispatches to the provider recorded on the project's tracker connection", async () => {
    await writeProject("proj-stub", "stub");

    const { status, data } = await postScopes({ projectId: "proj-stub" });

    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.scopes).toEqual({ listTickets: true });
    expect(data.overPrivileged).toBe(false);
    expect(data.errors).toEqual([]);
  });

  it("honours an explicit providerId over the project's connection", async () => {
    await writeProject("proj-scopeless", "scopeless");

    const { data } = await postScopes({
      projectId: "proj-scopeless",
      providerId: "stub",
    });

    expect(data.ok).toBe(true);
    expect(data.scopes).toEqual({ listTickets: true });
  });

  it("reports the capability gap in provider-agnostic copy", async () => {
    await writeProject("proj-scopeless", "scopeless");

    const { status, data } = await postScopes({ projectId: "proj-scopeless" });

    expect(status).toBe(200);
    expect(data.ok).toBe(false);
    expect(data.scopes).toEqual({});
    expect(data.errors).toEqual([
      "The resolved tracker provider does not support scope verification.",
    ]);
    expect(JSON.stringify(data).toLowerCase()).not.toContain("azure");
  });

  it("reports an unresolved diagnostic instead of guessing a provider", async () => {
    // The payload the integration suite posts: no projectId, no providerId.
    const { status, data } = await postScopes({ orgUrl: "", project: "" });

    expect(status).toBe(200);
    expect(data.ok).toBe(false);
    expect(data.scopes).toEqual({});
    expect(data.errors?.[0]).toContain("No tracker connection resolved");
    expect(JSON.stringify(data).toLowerCase()).not.toContain("azure");
  });

  it("resolves nothing for a project id that is not recorded", async () => {
    await writeProject("proj-stub", "stub");

    const { data } = await postScopes({ projectId: "proj-does-not-exist" });

    expect(data.ok).toBe(false);
    expect(data.errors?.[0]).toContain("No tracker connection resolved");
  });
});
