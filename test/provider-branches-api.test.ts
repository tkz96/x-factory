// test/provider-branches-api.test.ts — POST /api/providers/branches: the
// branches of one repository of a git-host connection, so the user can pick
// the repository's base branch. Same layering as /repositories.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type {
  Provider,
  ProviderErrorEnvelope,
} from "../src/providers/contract.js";
import { startServer } from "../src/server.js";
import { stubProvider } from "./fixtures/stub-provider.js";

const seen: Array<{ id: string; remote: string }> = [];

const branchStub: Provider = {
  ...stubProvider,
  id: "stub-branches",
  async listBranches(_config, repository) {
    seen.push({ id: repository.id, remote: repository.remote ?? "" });
    return ["develop", "main", "release/1.0"];
  },
};
const failingStub: Provider = {
  ...branchStub,
  id: "stub-branches-failing",
  async listBranches() {
    throw new Error("Fatal: upstream secret text");
  },
  toUserError(_raw, context): ProviderErrorEnvelope {
    return { code: "AUTH_INVALID", context };
  },
};
const registry = new Map<string, Provider>([
  [branchStub.id, branchStub],
  [failingStub.id, failingStub],
  [stubProvider.id, { ...stubProvider, roles: ["gitHost"] }],
]);
const config = { host: "https://stub.example", apiToken: "t", project: "acme" };

let server: ReturnType<typeof startServer>;
let baseUrl: string;
const post = (body: unknown) =>
  fetch(`${baseUrl}/api/providers/branches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeAll(() => {
  server = startServer(0, undefined, undefined, registry);
  baseUrl = `http://localhost:${server.port}`;
});
afterAll(async () => {
  await server.shutdown();
});

describe("POST /api/providers/branches", () => {
  it("returns the repository's branches and passes the repository to the provider", async () => {
    const res = await post({
      providerId: "stub-branches",
      role: "gitHost",
      config,
      repository: { id: "repo-1", remote: "https://stub.example/a/b.git" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      providerId: "stub-branches",
      branches: ["develop", "main", "release/1.0"],
    });
    expect(seen.at(-1)).toEqual({
      id: "repo-1",
      remote: "https://stub.example/a/b.git",
    });
  });

  it("rejects a request without a repository id with 400", async () => {
    expect(
      (await post({ providerId: "stub-branches", config, repository: {} }))
        .status,
    ).toBe(400);
    expect((await post({ providerId: "stub-branches", config })).status).toBe(
      400,
    );
  });

  it("rejects a provider without listBranches with 409 INCAPABLE_PROVIDER", async () => {
    const res = await post({
      providerId: "stub",
      config,
      repository: { id: "r" },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ formErrors: ["INCAPABLE_PROVIDER"] });
  });

  it("normalizes a provider failure to the DISCOVERY envelope without leaking text", async () => {
    const res = await post({
      providerId: "stub-branches-failing",
      config,
      repository: { id: "r" },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      code: "AUTH_INVALID",
      context: "DISCOVERY",
    });
    expect(text).not.toContain("secret text");
  });
});
