// test/github-missing-scopes.test.ts — Verify Connection names the scopes a
// classic GitHub token is missing (full-run finding). The seam is the real
// verify route with the real (wrapped) GitHub provider; only GitHub's HTTP
// replies are stubbed.

import { describe, expect, it } from "bun:test";
import { handleVerifyRoute } from "../src/http/providers-controller.js";
import { createGithubProvider } from "../src/providers/github-module.js";
import {
  type ProviderRegistry,
  wrapProvider,
} from "../src/providers/registry.js";

function registryWithScopes(scopes: string): ProviderRegistry {
  const fetchFn = (async (url: string | URL | Request) => {
    if (String(url).endsWith("/user")) {
      return new Response(JSON.stringify({ login: "octocat" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-oauth-scopes": scopes,
        },
      });
    }
    return new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const provider = wrapProvider(createGithubProvider({ fetchFn }));
  return new Map([[provider.id, provider]]);
}

async function verify(scopes: string): Promise<unknown> {
  const req = new Request("http://localhost/api/providers/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      providerId: "github",
      role: "gitHost",
      config: { token: "ghp_test_token" },
    }),
  });
  const res = await handleVerifyRoute(req, registryWithScopes(scopes));
  expect(res.status).toBe(200);
  return res.json();
}

describe("GitHub Verify Connection with a token missing a scope", () => {
  it("returns the missing scope in the error envelope", async () => {
    expect(await verify("repo")).toEqual({
      code: "PERMISSION",
      context: "VERIFY",
      missingScopes: ["workflow"],
    });
  });

  it("returns every missing scope", async () => {
    expect(await verify("read:user")).toEqual({
      code: "PERMISSION",
      context: "VERIFY",
      missingScopes: ["repo", "workflow"],
    });
  });
});
