import { describe, expect, it } from "bun:test";
import {
  isGitHubRateLimited,
  toGitHubUserError,
} from "../src/providers/github/errors.js";
import {
  extractFromGitHubUrl,
  resolveRepoCoordinates,
} from "../src/providers/github/urls.js";
import {
  verifyGitHubCredentials,
  verifyGitHubScopes,
} from "../src/providers/github/verification.js";
import { textResponse } from "./helpers/provider-test-helper.js";

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
      return textResponse("[]", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await verifyGitHubCredentials(
      { repoOwner: "octocat" },
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
        return textResponse("{}", { status: 200, headers });
      }
      if (urlStr.includes("/orgs/")) {
        return textResponse("Forbidden", { status: 403 });
      }
      return textResponse("[]", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await verifyGitHubCredentials(
      { token: "ghp_valid", repoOwner: "org-with-forbidden-repos" },
      mockFetch,
    );
    expect(result.status).toBe("degraded");
    expect(
      result.warnings.some((w) => w.capability === "listRepositories"),
    ).toBe(true);
  });
});

describe("github errors — toGitHubUserError and isGitHubRateLimited", () => {
  it("detects rate limits via isGitHubRateLimited", () => {
    expect(isGitHubRateLimited(429)).toBe(true);
    expect(isGitHubRateLimited(403, new Headers({ "retry-after": "10" }))).toBe(
      true,
    );
    expect(
      isGitHubRateLimited(403, new Headers({ "x-ratelimit-remaining": "0" })),
    ).toBe(true);
    expect(
      isGitHubRateLimited(403, undefined, "secondary rate limit detected"),
    ).toBe(true);
    expect(
      isGitHubRateLimited(403, undefined, "API rate limit exceeded for user"),
    ).toBe(true);
    expect(isGitHubRateLimited(401, new Headers({ "retry-after": "10" }))).toBe(
      false,
    );
    expect(isGitHubRateLimited(404)).toBe(false);
  });

  it("normalizes status-like objects", () => {
    const rateLimited = toGitHubUserError(
      { status: 429, headers: new Headers({ "retry-after": "2" }) },
      "VERIFY",
    );
    expect(rateLimited.code).toBe("RATE_LIMITED");
    expect(rateLimited.context).toBe("VERIFY");
    expect(rateLimited.retryAfterMs).toBe(2000);

    const auth = toGitHubUserError({ status: 401 }, "DISCOVERY");
    expect(auth.code).toBe("AUTH_INVALID");

    const perm = toGitHubUserError({ status: 403 }, "PR");
    expect(perm.code).toBe("PERMISSION");

    const notFound = toGitHubUserError({ status: 404 }, "TICKETS");
    expect(notFound.code).toBe("NOT_FOUND");

    const unknown = toGitHubUserError({ status: 500 }, "VERIFY");
    expect(unknown.code).toBe("UNKNOWN");
  });

  it("normalizes standard Error objects by inspecting messages", () => {
    expect(
      toGitHubUserError(new Error("API rate limit exceeded"), "VERIFY").code,
    ).toBe("RATE_LIMITED");
    expect(
      toGitHubUserError(new Error("Bad credentials provided"), "DISCOVERY")
        .code,
    ).toBe("AUTH_INVALID");
    expect(toGitHubUserError(new Error("Not found: 404"), "TICKETS").code).toBe(
      "NOT_FOUND",
    );
    expect(
      toGitHubUserError(new Error("Missing permission or scope"), "PR").code,
    ).toBe("PERMISSION");
    expect(
      toGitHubUserError(new Error("Something completely unknown"), "VERIFY")
        .code,
    ).toBe("UNKNOWN");
  });

  it("normalizes non-error primitives to UNKNOWN", () => {
    expect(toGitHubUserError("unexpected string", "VERIFY")).toEqual({
      code: "UNKNOWN",
      context: "VERIFY",
    });
    expect(toGitHubUserError(12345, "PR")).toEqual({
      code: "UNKNOWN",
      context: "PR",
    });
    expect(toGitHubUserError(null, "TICKETS")).toEqual({
      code: "UNKNOWN",
      context: "TICKETS",
    });
  });
});
