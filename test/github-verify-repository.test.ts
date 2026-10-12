// test/github-verify-repository.test.ts — Verify Connection checks the tracker's
// repository exists (full-run finding: a tracker pointing at a repository that
// does not exist verified as "Connected", then failed on the Tickets screen).
// The seam is the real verify route with the real (wrapped) GitHub provider;
// only GitHub's HTTP replies are stubbed.

import { describe, expect, it } from "bun:test";
import { handleVerifyRoute } from "../src/http/providers-controller.js";
import { createGithubProvider } from "../src/providers/github-module.js";
import {
  type ProviderRegistry,
  wrapProvider,
} from "../src/providers/registry.js";

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

function registry(existingRepos: string[], calls: string[]): ProviderRegistry {
  const fetchFn = (async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith("/user")) {
      return json({ login: "octocat" }, 200, {
        "x-oauth-scopes": "repo, workflow",
      });
    }
    const repo = u.match(/\/repos\/([^/?]+\/[^/?]+)$/)?.[1];
    if (repo !== undefined) {
      return existingRepos.includes(repo)
        ? json({ full_name: repo })
        : json({ message: "Not Found" }, 404);
    }
    return json([]);
  }) as typeof fetch;
  const provider = wrapProvider(createGithubProvider({ fetchFn }));
  return new Map([[provider.id, provider]]);
}

async function verifyTracker(
  repository: string,
  existingRepos: string[],
  calls: string[] = [],
): Promise<unknown> {
  const req = new Request("http://localhost/api/providers/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      providerId: "github",
      role: "tracker",
      config: { token: "ghp_test_token", repoOwner: "octocat", repository },
    }),
  });
  const res = await handleVerifyRoute(req, registry(existingRepos, calls));
  expect(res.status).toBe(200);
  return res.json();
}

describe("GitHub Verify Connection with a tracker repository", () => {
  it("fails with NOT_FOUND when the repository does not exist", async () => {
    const calls: string[] = [];
    expect(await verifyTracker("missing", ["octocat/calc"], calls)).toEqual({
      code: "NOT_FOUND",
      context: "VERIFY",
    });
    expect(calls.some((c) => c.endsWith("/repos/octocat/missing"))).toBe(true);
  });

  it("verifies when the repository exists", async () => {
    const result = (await verifyTracker("calc", ["octocat/calc"])) as {
      status?: string;
    };
    expect(result.status).toBe("ok");
  });
});
