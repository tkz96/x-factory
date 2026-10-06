// test/provider-describe-api.test.ts — POST /api/providers/describe
// (spec #133 story 34), the generic surface that publishes a provider's
// connection identity.
//
// The route is the ONLY way a surface can learn an identity, so the properties
// asserted here are the ones the whole feature rests on:
//   1. a provider that declares `describeConnection` gets its identity
//      published, end-to-end, with the REAL provider modules registered;
//   2. a provider without the capability is a SAFE FALLBACK, not an error —
//      200 with `identity: null`;
//   3. a configuration that identifies nothing is the same safe fallback;
//   4. the payload never carries a provider-generated message, and never any
//      byte of a secret or of a configuration value the provider did not
//      choose to publish.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { azureProvider } from "../src/providers/azure-module.js";
import type { Provider } from "../src/providers/contract.js";
import { githubProvider } from "../src/providers/github-module.js";
import { jiraProvider } from "../src/providers/jira-module.js";
import { startServer } from "../src/server.js";
import { stubProvider } from "./fixtures/stub-provider.js";

/** Distinctive synthetic markers — never real credentials. */
const GITHUB_TOKEN_MARKER = "ghp_describe_marker_github_11ce";
const AZURE_PAT_MARKER = "pat_describe_marker_azure_77ba";
const JIRA_TOKEN_MARKER = "atl_describe_marker_jira_34fd";
const JIRA_EMAIL_MARKER = "describe-marker@example.invalid";
/** What a contract-violating provider throws — must never reach the wire. */
const THROWN_MARKER = "describe-marker-provider-throw-9e6a";

/** A provider whose `describeConnection` throws rather than answering. */
const throwingProvider: Provider = {
  ...stubProvider,
  id: "stub-throwing",
  displayName: "Throwing Stub",
  describeConnection() {
    throw new Error(`config ${GITHUB_TOKEN_MARKER} ${THROWN_MARKER}`);
  },
};

const testRegistry: ReadonlyMap<string, Provider> = new Map<string, Provider>([
  [githubProvider.id, githubProvider],
  [azureProvider.id, azureProvider],
  [jiraProvider.id, jiraProvider],
  [stubProvider.id, stubProvider],
  [throwingProvider.id, throwingProvider],
]);

let server: ReturnType<typeof startServer>;
let baseUrl: string;

beforeAll(() => {
  server = startServer(0, undefined, undefined, testRegistry);
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(async () => {
  await server.shutdown();
});

/** Posts one describe request and returns the status plus the RAW body text. */
async function describeConnection(
  payload: Record<string, unknown>,
): Promise<{ status: number; raw: string; body: unknown }> {
  const res = await fetch(`${baseUrl}/api/providers/describe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const raw = await res.text();
  return { status: res.status, raw, body: JSON.parse(raw) };
}

/** No markered secret, secret field NAME, or thrown text in the bytes. */
function expectNoSecretBytes(raw: string): void {
  for (const marker of [
    GITHUB_TOKEN_MARKER,
    AZURE_PAT_MARKER,
    JIRA_TOKEN_MARKER,
    JIRA_EMAIL_MARKER,
    THROWN_MARKER,
  ]) {
    expect(raw).not.toContain(marker);
  }
  // The secret field NAMES are not echoed either — neither as a key nor as a
  // value. The describe payload publishes only what the provider composed.
  expect(raw).not.toContain("apiToken");
  expect(raw).not.toContain("token");
  expect(raw).not.toContain("pat");
}

/** The success payload is exactly `providerId` + `identity`, nothing else. */
function expectOnlyIdentityKeys(body: unknown): void {
  expect(Object.keys(body as object).sort()).toEqual([
    "identity",
    "providerId",
  ]);
}

describe("POST /api/providers/describe", () => {
  it("publishes GitHub's owner/repo identity, never its token", async () => {
    const { status, raw, body } = await describeConnection({
      providerId: "github",
      config: {
        token: GITHUB_TOKEN_MARKER,
        repoOwner: "octo-org",
        repository: "rocket",
      },
    });

    expect(status).toBe(200);
    expect(body).toEqual({ providerId: "github", identity: "octo-org/rocket" });
    expectOnlyIdentityKeys(body);
    expectNoSecretBytes(raw);
  });

  it("publishes Azure DevOps's organization/Project identity, never its PAT", async () => {
    const { status, raw, body } = await describeConnection({
      providerId: "azure",
      config: {
        orgUrl: "https://dev.azure.com/acme",
        project: "MyProject",
        pat: AZURE_PAT_MARKER,
      },
    });

    expect(status).toBe(200);
    expect(body).toEqual({ providerId: "azure", identity: "acme/MyProject" });
    expectOnlyIdentityKeys(body);
    expectNoSecretBytes(raw);
  });

  it("publishes Jira's host/project identity, never its token or email", async () => {
    const { status, raw, body } = await describeConnection({
      providerId: "jira",
      config: {
        host: "https://acme.atlassian.net",
        email: JIRA_EMAIL_MARKER,
        apiToken: JIRA_TOKEN_MARKER,
        project: "ROCK",
      },
    });

    expect(status).toBe(200);
    expect(body).toEqual({
      providerId: "jira",
      identity: "acme.atlassian.net/ROCK",
    });
    expectOnlyIdentityKeys(body);
    expectNoSecretBytes(raw);
  });

  it("is a safe fallback — not an error — for a provider without the capability", async () => {
    const { status, raw, body } = await describeConnection({
      providerId: "stub",
      config: {
        host: "https://stub.example",
        apiToken: GITHUB_TOKEN_MARKER,
        project: "rocket",
      },
    });

    expect(status).toBe(200);
    expect(body).toEqual({ providerId: "stub", identity: null });
    expectOnlyIdentityKeys(body);
    expectNoSecretBytes(raw);
  });

  it("answers identity: null for a configuration that identifies nothing", async () => {
    const { status, body } = await describeConnection({
      providerId: "github",
      // A token alone identifies no repository.
      config: { token: GITHUB_TOKEN_MARKER },
    });

    expect(status).toBe(200);
    expect(body).toEqual({ providerId: "github", identity: null });
  });

  it("answers identity: null — not the 409 field ladder — for a configuration its provider rejects", async () => {
    // GitHub's schema requires a token; the ACTION routes report that as a 409
    // fieldErrors envelope, while describing a connection blocks nothing and
    // must never become a second error surface.
    const { status, body } = await describeConnection({
      providerId: "github",
      config: { repoOwner: "octo-org" },
    });

    expect(status).toBe(200);
    expect(body).toEqual({ providerId: "github", identity: null });
  });

  it("answers identity: null when the provider's capability throws, without publishing the thrown text", async () => {
    const { status, raw, body } = await describeConnection({
      providerId: "stub-throwing",
      config: {
        host: "https://stub.example",
        apiToken: GITHUB_TOKEN_MARKER,
        project: "rocket",
      },
    });

    expect(status).toBe(200);
    expect(body).toEqual({ providerId: "stub-throwing", identity: null });
    expect(raw).not.toContain(THROWN_MARKER);
    expect(raw).not.toContain(GITHUB_TOKEN_MARKER);
  });

  it("mirrors the prelude's codes-only 409 for an unknown provider", async () => {
    const { status, raw, body } = await describeConnection({
      providerId: "not-registered",
      config: { anything: GITHUB_TOKEN_MARKER },
    });

    expect(status).toBe(409);
    expect(body).toEqual({ formErrors: ["UNKNOWN_PROVIDER"] });
    // Codes only: no provider-generated message, and no echoed configuration.
    expect(Object.keys(body as object)).toEqual(["formErrors"]);
    expectNoSecretBytes(raw);
  });

  it("mirrors the prelude's codes-only 409 for a role the provider cannot serve", async () => {
    const { status, body } = await describeConnection({
      providerId: "jira",
      role: "gitHost",
      config: {
        host: "https://acme.atlassian.net",
        apiToken: JIRA_TOKEN_MARKER,
      },
    });

    expect(status).toBe(409);
    expect(body).toEqual({ formErrors: ["INCOMPATIBLE_CONFIGURATION"] });
    expect(Object.keys(body as object)).toEqual(["formErrors"]);
  });

  it("rejects a body with no configuration as a transport error, not a semantic one", async () => {
    const res = await fetch(`${baseUrl}/api/providers/describe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "github" }),
    });

    expect(res.status).toBe(400);
  });
});
