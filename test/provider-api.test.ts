// test/provider-api.test.ts — Integration tests for provider API surface (#137).
//
// Tests the HTTP/API boundary for:
// - GET /api/providers/manifest
// - POST /api/providers/verify
// - POST /api/providers/parse-url
// Proves validation layering (transport 400, semantic 409, DB 500),
// the critical security invariant (envKey never exposed),
// and curl demoability using the stub provider.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { execStrict } from "../src/proc.js";
import type {
  Provider,
  ProviderError,
  VerificationResult,
} from "../src/providers/contract.js";
import type { ProviderDescriptor } from "../src/providers/serializer.js";
import { startServer } from "../src/server.js";
import { stubProvider } from "./fixtures/stub-provider.js";

let server: ReturnType<typeof startServer>;
let baseUrl: string;

// Injected test registry with stub provider + degraded stub provider + failing stub provider
const degradedStubProvider: Provider = {
  ...stubProvider,
  id: "stub-degraded",
  displayName: "Degraded Stub Provider",
  async verifyCredentials(_config) {
    return {
      status: "degraded",
      warnings: [
        {
          kind: "CAPABILITY_UNCONFIRMED",
          capability: "verifyScopes",
        },
      ],
    };
  },
};

const failingStubProvider: Provider = {
  ...stubProvider,
  id: "stub-failing",
  displayName: "Failing Stub Provider",
  async verifyCredentials(_config) {
    throw new Error("Invalid access token");
  },
  toUserError(_raw, context) {
    return {
      code: "AUTH_INVALID",
      context,
    };
  },
};

const trackerOnlyStubProvider: Provider = {
  ...stubProvider,
  id: "stub-tracker-only",
  displayName: "Tracker Only Stub",
  roles: ["tracker"],
};

const testRegistry = new Map<string, Provider>([
  [stubProvider.id, stubProvider],
  [degradedStubProvider.id, degradedStubProvider],
  [failingStubProvider.id, failingStubProvider],
  [trackerOnlyStubProvider.id, trackerOnlyStubProvider],
]);

beforeAll(() => {
  server = startServer(0, undefined, undefined, testRegistry);
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(async () => {
  await server.shutdown();
});

describe("GET /api/providers/manifest", () => {
  it("returns descriptors: id, displayName, roles, iconRef, capabilities, configFields", async () => {
    const res = await fetch(`${baseUrl}/api/providers/manifest`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as ProviderDescriptor[];

    expect(Array.isArray(body)).toBe(true);
    const stub = body.find((p) => p.id === "stub");
    expect(stub).toBeDefined();
    expect(stub?.displayName).toBe("Stub Provider");
    expect(stub?.roles).toEqual(["tracker", "gitHost"]);
    expect(stub?.iconRef).toBe("provider-stub");
    expect(stub?.capabilities).toEqual(["verifyScopes", "parseQuickUrl"]);
    expect(stub?.configFields).toEqual([
      {
        name: "host",
        label: "Host",
        type: "url",
        required: true,
      },
      {
        name: "apiToken",
        label: "API token",
        type: "secret",
        required: true,
        secret: true,
        help: "Stored in per-project environment storage.",
      },
      {
        name: "project",
        label: "Project",
        type: "text",
        required: true,
      },
    ]);
  });

  it("supports role filtering with ?role=git-host and ?role=tracker", async () => {
    // 1. git-host filter (should exclude tracker-only stub)
    const gitHostRes = await fetch(
      `${baseUrl}/api/providers/manifest?role=git-host`,
    );
    expect(gitHostRes.status).toBe(200);
    const gitHostBody = (await gitHostRes.json()) as Array<{ id: string }>;
    expect(gitHostBody.some((p) => p.id === "stub")).toBe(true);
    expect(gitHostBody.some((p) => p.id === "stub-tracker-only")).toBe(false);

    // 2. camelCase gitHost filter
    const gitHostCamelRes = await fetch(
      `${baseUrl}/api/providers/manifest?role=gitHost`,
    );
    expect(gitHostCamelRes.status).toBe(200);
    const gitHostCamelBody = (await gitHostCamelRes.json()) as Array<{
      id: string;
    }>;
    expect(gitHostCamelBody.some((p) => p.id === "stub-tracker-only")).toBe(
      false,
    );

    // 3. tracker filter (should include tracker-only stub)
    const trackerRes = await fetch(
      `${baseUrl}/api/providers/manifest?role=tracker`,
    );
    expect(trackerRes.status).toBe(200);
    const trackerBody = (await trackerRes.json()) as Array<{ id: string }>;
    expect(trackerBody.some((p) => p.id === "stub-tracker-only")).toBe(true);
  });

  it("returns 400 for invalid role filter query parameter", async () => {
    const res = await fetch(`${baseUrl}/api/providers/manifest?role=superrole`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Invalid role filter");
  });

  it("CRITICAL SECURITY INVARIANT: never exposes envKey or secret metadata across HTTP boundary", async () => {
    const res = await fetch(`${baseUrl}/api/providers/manifest`);
    expect(res.status).toBe(200);

    const rawText = await res.text();
    // 1. Assert envKey is absent in raw JSON response text
    expect(rawText).not.toContain("envKey");
    expect(rawText).not.toContain("STUB_API_TOKEN");

    // 2. Assert no descriptor configField carries envKey
    const descriptors = JSON.parse(rawText) as Array<{
      configFields: Record<string, unknown>[];
    }>;
    for (const desc of descriptors) {
      for (const field of desc.configFields) {
        expect(field).not.toHaveProperty("envKey");
      }
    }
  });

  it("validates cross-role field-name uniqueness in plain code", async () => {
    const res = await fetch(`${baseUrl}/api/providers/manifest`);
    expect(res.status).toBe(200);
    const descriptors = (await res.json()) as Array<{
      configFields: Array<{ name: string }>;
    }>;

    for (const desc of descriptors) {
      const names = desc.configFields.map((f) => f.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    }
  });
});

describe("POST /api/providers/verify", () => {
  it("returns ideal VerificationResult (status: ok) on valid configuration", async () => {
    const res = await fetch(`${baseUrl}/api/providers/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "stub",
        role: "tracker",
        config: {
          host: "https://stub.example",
          apiToken: "valid-token",
          project: "rocket",
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as VerificationResult;
    expect(body).toEqual({
      status: "ok",
      warnings: [],
    });
  });

  it("returns degraded VerificationResult with contract capability warnings", async () => {
    const res = await fetch(`${baseUrl}/api/providers/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "stub-degraded",
        role: "tracker",
        config: {
          host: "https://stub.example",
          apiToken: "valid-token",
          project: "rocket",
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as VerificationResult;
    expect(body.status).toBe("degraded");
    expect(body.warnings).toEqual([
      {
        kind: "CAPABILITY_UNCONFIRMED",
        capability: "verifyScopes",
      },
    ]);
  });

  it("returns normalized ProviderError envelope when provider throws error", async () => {
    const res = await fetch(`${baseUrl}/api/providers/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "stub-failing",
        role: "tracker",
        config: {
          host: "https://stub.example",
          apiToken: "rejected-token",
          project: "rocket",
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as ProviderError;
    expect(body).toEqual({
      code: "AUTH_INVALID",
      context: "VERIFY",
    });
  });

  it("rejects transport invalid input with 400 (missing providerId, non-object config)", async () => {
    // Missing providerId
    const res1 = await fetch(`${baseUrl}/api/providers/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {},
      }),
    });
    expect(res1.status).toBe(400);

    // Non-object config
    const res2 = await fetch(`${baseUrl}/api/providers/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "stub",
        config: "not-an-object",
      }),
    });
    expect(res2.status).toBe(400);

    // Invalid role
    const res3 = await fetch(`${baseUrl}/api/providers/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "stub",
        role: "invalid-role",
        config: {},
      }),
    });
    expect(res3.status).toBe(400);
  });

  it("rejects provider semantic validation with 409 (missing required fields)", async () => {
    const res = await fetch(`${baseUrl}/api/providers/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "stub",
        role: "tracker",
        config: {
          host: "https://stub.example",
          // apiToken and project are missing
        },
      }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      fieldErrors?: Record<string, string>;
    };
    expect(body.fieldErrors).toBeDefined();
    expect(body.fieldErrors?.apiToken).toBe("REQUIRED");
    expect(body.fieldErrors?.project).toBe("REQUIRED");
  });

  it("rejects provider semantic validation with 409 on incompatible role", async () => {
    const res = await fetch(`${baseUrl}/api/providers/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "stub-tracker-only",
        role: "gitHost",
        config: {
          host: "https://stub.example",
          apiToken: "valid-token",
          project: "rocket",
        },
      }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { formErrors?: string[] };
    expect(body.formErrors).toEqual(["INCOMPATIBLE_CONFIGURATION"]);
  });

  it("rejects provider semantic validation with 409 on unknown provider", async () => {
    const res = await fetch(`${baseUrl}/api/providers/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "does-not-exist",
        role: "tracker",
        config: {},
      }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { formErrors?: string[] };
    expect(body.formErrors).toEqual(["UNKNOWN_PROVIDER"]);
  });
});

describe("POST /api/providers/parse-url", () => {
  it("returns { providerId, configDraft, inferredName } for a recognized URL", async () => {
    const res = await fetch(`${baseUrl}/api/providers/parse-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://stub.example/acme/rocket",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      providerId: string;
      configDraft: Record<string, unknown>;
      inferredName: string;
    };
    expect(body).toEqual({
      providerId: "stub",
      configDraft: {
        host: "https://stub.example",
        project: "rocket",
      },
      inferredName: "rocket",
    });
  });

  it("returns UNKNOWN envelope carrying original URL in context for unrecognized URL", async () => {
    const unrecognizedUrl = "https://unrecognized.example/org/repo";
    const res = await fetch(`${baseUrl}/api/providers/parse-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: unrecognizedUrl,
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      code: string;
      context: { url: string };
      url: string;
    };
    expect(body.code).toBe("UNKNOWN");
    expect(body.context).toEqual({ url: unrecognizedUrl });
    expect(body.url).toBe(unrecognizedUrl);
  });

  it("rejects transport invalid input with 400 (missing or empty url)", async () => {
    const res = await fetch(`${baseUrl}/api/providers/parse-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("API Validation Layering (Cross-layer tests)", () => {
  it("proves transport validation (zod) rejects invalid transport inputs with 400", async () => {
    // 1. Invalid JSON body
    const res1 = await fetch(`${baseUrl}/api/providers/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-valid-json{",
    });
    expect(res1.status).toBe(400);

    // 2. Transport schema failure
    const res2 = await fetch(`${baseUrl}/api/providers/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "" }),
    });
    expect(res2.status).toBe(400);
  });

  it("proves provider semantic validation rejects semantic issues with 409", async () => {
    const res = await fetch(`${baseUrl}/api/providers/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "stub",
        role: "tracker",
        config: {
          host: "https://stub.example",
          // missing apiToken
          project: "rocket",
        },
      }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { fieldErrors: Record<string, string> };
    expect(body.fieldErrors?.apiToken).toBe("REQUIRED");
  });

  it("proves DB constraint / unexpected errors surface as 500", async () => {
    // Test that an unexpected database or system failure maps to 500
    // using a provider that throws an unexpected non-domain/DB-style error outside toUserError
    const crashingProvider: Provider = {
      ...stubProvider,
      id: "stub-crashing",
      displayName: "Crashing Stub",
      async verifyCredentials() {
        throw new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed: runs.id");
      },
      toUserError(err) {
        // If it throws instead of normalizing
        throw err;
      },
    };

    const crashingRegistry = new Map<string, Provider>([
      [crashingProvider.id, crashingProvider],
    ]);
    const crashServer = startServer(0, undefined, undefined, crashingRegistry);

    try {
      const res = await fetch(
        `http://localhost:${crashServer.port}/api/providers/verify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providerId: "stub-crashing",
            config: {
              host: "https://stub.example",
              apiToken: "tok",
              project: "proj",
            },
          }),
        },
      );
      expect(res.status).toBe(500);
    } finally {
      crashServer.stop(true);
    }
  });
});

describe("Curl-demoable flow with stub provider", () => {
  it("proves all three endpoints can be driven via curl commands", async () => {
    // 1. GET /api/providers/manifest via curl
    const manifestCurl = await execStrict(
      "curl",
      ["-s", `${baseUrl}/api/providers/manifest`],
      { cwd: process.cwd() },
    );
    const manifestJson = JSON.parse(manifestCurl.stdout);
    expect(Array.isArray(manifestJson)).toBe(true);
    expect(manifestJson.some((p: { id: string }) => p.id === "stub")).toBe(
      true,
    );

    // 2. POST /api/providers/verify via curl
    const verifyCurl = await execStrict(
      "curl",
      [
        "-s",
        "-X",
        "POST",
        `${baseUrl}/api/providers/verify`,
        "-H",
        "Content-Type: application/json",
        "-d",
        JSON.stringify({
          providerId: "stub",
          role: "tracker",
          config: {
            host: "https://stub.example",
            apiToken: "valid-token",
            project: "rocket",
          },
        }),
      ],
      { cwd: process.cwd() },
    );
    const verifyJson = JSON.parse(verifyCurl.stdout);
    expect(verifyJson).toEqual({ status: "ok", warnings: [] });

    // 3. POST /api/providers/parse-url via curl
    const parseUrlCurl = await execStrict(
      "curl",
      [
        "-s",
        "-X",
        "POST",
        `${baseUrl}/api/providers/parse-url`,
        "-H",
        "Content-Type: application/json",
        "-d",
        JSON.stringify({
          url: "https://stub.example/acme/rocket",
        }),
      ],
      { cwd: process.cwd() },
    );
    const parseUrlJson = JSON.parse(parseUrlCurl.stdout);
    expect(parseUrlJson).toEqual({
      providerId: "stub",
      configDraft: {
        host: "https://stub.example",
        project: "rocket",
      },
      inferredName: "rocket",
    });
  });
});
