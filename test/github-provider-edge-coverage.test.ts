import { describe, expect, it } from "bun:test";
import {
  extractFromGitHubUrl,
  resolveRepoCoordinates,
} from "../src/providers/github/urls.js";
import {
  verifyGitHubCredentials,
  verifyGitHubScopes,
} from "../src/providers/github/verification.js";

describe("github urls — extractFromGitHubUrl and resolveRepoCoordinates", () => {
  it("extracts coordinates from SSH urls", () => {
    expect(extractFromGitHubUrl("git@github.com:facebook/react.git")).toEqual({
      owner: "facebook",
      repo: "react",
    });

    expect(extractFromGitHubUrl("ssh://git@github.com:facebook/react")).toEqual(
      { owner: "facebook", repo: "react" },
    );
  });

  it("extracts single segment owner-only URLs", () => {
    expect(extractFromGitHubUrl("https://github.com/facebook")).toEqual({
      owner: "facebook",
    });
  });

  it("returns null for non-github or malformed URLs", () => {
    expect(
      extractFromGitHubUrl("https://gitlab.com/facebook/react"),
    ).toBeNull();
    expect(extractFromGitHubUrl("not a url")).toBeNull();
    expect(extractFromGitHubUrl("")).toBeNull();
  });

  it("resolves repo coordinates from various strings", () => {
    expect(resolveRepoCoordinates("facebook/react")).toEqual({
      owner: "facebook",
      repo: "react",
    });
    expect(
      resolveRepoCoordinates("https://github.com/facebook/react.git"),
    ).toEqual({
      owner: "facebook",
      repo: "react",
    });
    expect(resolveRepoCoordinates("git@github.com:facebook/react.git")).toEqual(
      {
        owner: "facebook",
        repo: "react",
      },
    );
    expect(resolveRepoCoordinates("react", "facebook")).toEqual({
      owner: "facebook",
      repo: "react",
    });
    expect(() => resolveRepoCoordinates("react")).toThrow(
      /Cannot resolve GitHub repository "react": no owner or organization specified/,
    );
  });
});

describe("github verification — edge coverage", () => {
  it("throws 401 when neither token nor owner is provided", async () => {
    await expect(verifyGitHubCredentials({})).rejects.toThrow();
  });

  it("verifies unauthenticated public owner", async () => {
    const mockFetch: typeof fetch = (async () => {
      return new Response("[]", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await verifyGitHubCredentials(
      { owner: "octocat" },
      mockFetch,
    );
    expect(result.status).toBe("degraded");
    expect(
      result.warnings.some((w) => w.capability === "createPullRequest"),
    ).toBe(true);
  });

  it("reports missing/unconfirmed capabilities when verifyGitHubScopes has no token", async () => {
    const report = await verifyGitHubScopes({});
    expect(report.findings.length).toBe(4);
    expect(report.findings[0]?.status).toBe("missing");
  });

  it("handles org repos 403 by returning CAPABILITY_UNCONFIRMED for listRepositories", async () => {
    const mockFetch: typeof fetch = (async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("/user")) {
        const headers = new Headers();
        headers.set("x-oauth-scopes", "repo");
        return new Response("{}", { status: 200, headers });
      }
      if (urlStr.includes("/orgs/")) {
        return new Response("Forbidden", { status: 403 });
      }
      return new Response("[]", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await verifyGitHubCredentials(
      { token: "ghp_valid", owner: "org-with-forbidden-repos" },
      mockFetch,
    );
    expect(result.status).toBe("degraded");
    expect(
      result.warnings.some((w) => w.capability === "listRepositories"),
    ).toBe(true);
  });
});
