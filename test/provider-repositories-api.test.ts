// test/provider-repositories-api.test.ts — Integration tests for
// POST /api/providers/repositories (spec #133, ticket #144).
//
// Proves the discovery route mirrors the settled #137 layering:
// transport validation (400) → unknown provider (409) → role compatibility
// (409) → provider config schema (409, fieldErrors) → capability (409) →
// execution, with thrown provider errors normalizing to the DISCOVERY
// envelope in a 200 body. No provider-generated message or body text ever
// crosses this boundary.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type {
  Provider,
  ProviderError,
  ProviderRepository,
} from "../src/providers/contract.js";
import { startServer } from "../src/server.js";
import { stubProvider } from "./fixtures/stub-provider.js";

const DISCOVERED_REPOSITORIES: ProviderRepository[] = [
  {
    id: "repo-1",
    name: "rocket-app",
    remote: "https://stub.example/acme/rocket-app.git",
    defaultBranch: "main",
    webUrl: "https://stub.example/acme/rocket-app",
  },
  {
    id: "repo-2",
    name: "rocket-infra",
    remote: "https://stub.example/acme/rocket-infra.git",
    defaultBranch: "trunk",
  },
];

/** Raw text a provider might leak — never allowed to reach the client. */
const PROVIDER_BODY_TEXT =
  "Fatal: HttpError 401 from upstream — see https://stub.example/docs/tokens";

const discoveryStubProvider: Provider = {
  ...stubProvider,
  id: "stub-repos",
  displayName: "Stub Repository Provider",
  async listRepositories(_config): Promise<ProviderRepository[]> {
    return DISCOVERED_REPOSITORIES;
  },
};

const incapableStubProvider: Provider = {
  ...stubProvider,
  id: "stub-incapable",
  displayName: "Stub Without Discovery",
  // Declares gitHost but does not implement listRepositories (Jira-as-git-host).
  roles: ["gitHost"],
};

const trackerOnlyDiscoveryProvider: Provider = {
  ...discoveryStubProvider,
  id: "stub-tracker-only-discovery",
  displayName: "Tracker Only Discovery Stub",
  roles: ["tracker"],
};

const failingDiscoveryProvider: Provider = {
  ...discoveryStubProvider,
  id: "stub-repos-failing",
  displayName: "Failing Discovery Stub",
  async listRepositories(): Promise<ProviderRepository[]> {
    throw new Error(PROVIDER_BODY_TEXT);
  },
  toUserError(_raw, context): ProviderError {
    return { code: "AUTH_INVALID", context };
  },
};

const testRegistry = new Map<string, Provider>([
  [discoveryStubProvider.id, discoveryStubProvider],
  [incapableStubProvider.id, incapableStubProvider],
  [trackerOnlyDiscoveryProvider.id, trackerOnlyDiscoveryProvider],
  [failingDiscoveryProvider.id, failingDiscoveryProvider],
]);

let server: ReturnType<typeof startServer>;
let baseUrl: string;

const validConfig = {
  host: "https://stub.example",
  apiToken: "token-123",
  project: "acme",
};

async function discover(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/providers/repositories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeAll(() => {
  server = startServer(0, undefined, undefined, testRegistry);
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(async () => {
  await server.shutdown();
});

describe("POST /api/providers/repositories", () => {
  it("returns the discovered repositories in a provider-agnostic envelope", async () => {
    const res = await discover({
      providerId: "stub-repos",
      role: "gitHost",
      config: validConfig,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      providerId: string;
      roles: string[];
      repositories: ProviderRepository[];
    };

    expect(body.providerId).toBe("stub-repos");
    expect(body.roles).toEqual(["gitHost"]);
    expect(body.repositories).toEqual(DISCOVERED_REPOSITORIES);
  });

  it("normalizes the role alias 'git-host' to 'gitHost' in the envelope", async () => {
    const res = await discover({
      providerId: "stub-repos",
      role: "git-host",
      config: validConfig,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { roles: string[] };
    expect(body.roles).toEqual(["gitHost"]);
  });

  it("rejects malformed JSON and a failing request shape with 400", async () => {
    expect((await discover("not-valid-json{")).status).toBe(400);
    expect((await discover({ config: validConfig })).status).toBe(400);
    expect((await discover({ providerId: "stub-repos" })).status).toBe(400);
  });

  it("rejects an unknown provider id with 409 UNKNOWN_PROVIDER", async () => {
    const res = await discover({
      providerId: "no-such-provider",
      role: "gitHost",
      config: validConfig,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ formErrors: ["UNKNOWN_PROVIDER"] });
  });

  it("rejects a role the provider does not declare with 409 INCOMPATIBLE_CONFIGURATION", async () => {
    const res = await discover({
      providerId: "stub-tracker-only-discovery",
      role: "gitHost",
      config: validConfig,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      formErrors: ["INCOMPATIBLE_CONFIGURATION"],
    });
  });

  it("rejects a config schema failure with 409 fieldErrors (REQUIRED vs INVALID)", async () => {
    const res = await discover({
      providerId: "stub-repos",
      role: "gitHost",
      config: { host: 42, project: "acme" },
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { fieldErrors: Record<string, string> };
    expect(body.fieldErrors.apiToken).toBe("REQUIRED");
    expect(body.fieldErrors.host).toBe("INVALID");
    expect(body.fieldErrors.project).toBeUndefined();
  });

  it("rejects a provider without listRepositories with 409 INCAPABLE_PROVIDER", async () => {
    const res = await discover({
      providerId: "stub-incapable",
      role: "gitHost",
      config: validConfig,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ formErrors: ["INCAPABLE_PROVIDER"] });
  });

  it("normalizes a thrown provider error to the DISCOVERY envelope without leaking provider text", async () => {
    const res = await discover({
      providerId: "stub-repos-failing",
      role: "gitHost",
      config: validConfig,
    });

    expect(res.status).toBe(200);
    const rawBody = await res.text();
    expect(JSON.parse(rawBody)).toEqual({
      code: "AUTH_INVALID",
      context: "DISCOVERY",
    });
    expect(rawBody).not.toContain(PROVIDER_BODY_TEXT);
    expect(rawBody).not.toContain("Fatal");
    expect(rawBody).not.toContain("upstream");
  });

  it("is documented in the OpenAPI spec, and unknown provider paths stay 404", async () => {
    const unknown = await fetch(`${baseUrl}/api/providers/no-such-route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(unknown.status).toBe(404);

    const openapi = (await (
      await fetch(`${baseUrl}/api/openapi.json`)
    ).json()) as { paths: Record<string, unknown> };
    expect(Object.keys(openapi.paths)).toContain("/api/providers/repositories");
  });
});
