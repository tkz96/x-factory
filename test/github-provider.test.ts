// test/github-provider.test.ts — Comprehensive test suite for GitHub Provider module (#138).
//
// Acceptance Criteria Covered:
// 1. Registered in the static registry via one import line; zero edits outside provider module
// 2. Repository discovery works with wizard-shaped inputs (nested provider config, not flat env)
// 3. toUserError maps rate-limited 403s distinctly from permission 403s (with retryAfterMs)
// 4. parseQuickUrl recognizes github.com/owner/repo URLs, returning git-host config draft + inferred name
// 5. PR create/lookup via REST exclusively using explicit credentials; no CLI fallback or ambient auth
// 6. PR capabilities enforce create-only safety invariant via shared contract type-guard
// 7. configSchema is Zod with secret-field metadata; serializes through generic serializer
// 8. Zero-mock tests except at the HTTP boundary

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  hasCapability,
  isProviderError,
  PR_CREATE_ONLY,
  REQUIRED_WORKFLOW_LABEL,
} from "../src/providers/contract.js";
import {
  createGithubProvider,
  detectGitHubConfigMismatch,
  GitHubHttpError,
  githubConfigSchema,
  githubProvider,
  parseGitHubQuickUrl,
  resolveGitHubConfig,
  toGitHubUserError,
} from "../src/providers/github-module.js";
import {
  getProvider,
  listProviders,
  requireProvider,
} from "../src/providers/registry.js";
import {
  serializeProvider,
  serializeProviderConfigSchema,
} from "../src/providers/serializer.js";
import { startServer } from "../src/server.js";

describe("GitHub Provider Module (Ticket #138)", () => {
  describe("Registration & Contract Conformance", () => {
    it("is registered in the static provider registry with expected identity and roles", () => {
      const provider = getProvider("github");
      expect(provider).toBeDefined();
      expect(provider?.id).toBe("github");
      expect(provider?.displayName).toBe("GitHub");
      expect(provider?.roles).toEqual(["tracker", "gitHost"]);
      expect(provider?.iconRef).toBe("provider-github");

      const required = requireProvider("github");
      expect(required).toBe(githubProvider);

      const all = listProviders();
      expect(all.some((p) => p.id === "github")).toBe(true);
    });

    it("declares and implements all required and optional provider capabilities", () => {
      expect(typeof githubProvider.verifyCredentials).toBe("function");
      expect(typeof githubProvider.toUserError).toBe("function");

      expect(hasCapability(githubProvider, "verifyScopes")).toBe(true);
      expect(hasCapability(githubProvider, "listRepositories")).toBe(true);
      expect(hasCapability(githubProvider, "listTickets")).toBe(true);
      expect(hasCapability(githubProvider, "parseQuickUrl")).toBe(true);
      expect(hasCapability(githubProvider, "createPullRequest")).toBe(true);
      expect(hasCapability(githubProvider, "findExistingPullRequest")).toBe(
        true,
      );
    });

    it("strictly adheres to the PR_CREATE_ONLY safety invariant (no merge/close capabilities)", () => {
      expect(PR_CREATE_ONLY).toBe("create-only");
      const providerAny = githubProvider as unknown as Record<string, unknown>;
      expect(providerAny.mergePullRequest).toBeUndefined();
      expect(providerAny.closePullRequest).toBeUndefined();
      expect(providerAny.abandonPullRequest).toBeUndefined();
      expect(providerAny.deletePullRequest).toBeUndefined();
      expect(providerAny.updatePullRequest).toBeUndefined();
    });
  });

  describe("Schema Validation & Serializer Gate", () => {
    it("serializes through the generic serializer gate with zero errors", () => {
      const descriptor = serializeProvider(githubProvider);
      expect(descriptor).not.toBeNull();
      expect(descriptor?.id).toBe("github");
      expect(descriptor?.displayName).toBe("GitHub");
      expect(descriptor?.roles).toEqual(["tracker", "gitHost"]);
      expect(descriptor?.iconRef).toBe("provider-github");
      expect(descriptor?.capabilities).toContain("createPullRequest");
      expect(descriptor?.capabilities).toContain("listRepositories");
      expect(descriptor?.capabilities).toContain("parseQuickUrl");

      const fields = serializeProviderConfigSchema(githubProvider.configSchema);
      expect(fields.length).toBe(3);

      const tokenField = fields.find((f) => f.name === "token");
      expect(tokenField).toBeDefined();
      expect(tokenField?.type).toBe("secret");
      expect(tokenField?.secret).toBe(true);
      expect(tokenField?.required).toBe(true);
      expect(tokenField).not.toHaveProperty("envKey");

      const ownerField = fields.find((f) => f.name === "repoOwner");
      expect(ownerField).toBeDefined();
      expect(ownerField?.type).toBe("text");
      expect(ownerField?.required).toBe(false);

      const repoField = fields.find((f) => f.name === "repository");
      expect(repoField).toBeDefined();
      expect(repoField?.type).toBe("text");
      expect(repoField?.required).toBe(false);
    });

    it("filters schema fields by role: tracker includes repository, gitHost excludes repository, dual-role includes once", () => {
      const trackerDesc = serializeProvider(githubProvider, "tracker");
      expect(trackerDesc).not.toBeNull();
      expect(
        trackerDesc?.configFields.some((f) => f.name === "repository"),
      ).toBe(true);

      const gitHostDesc = serializeProvider(githubProvider, "gitHost");
      expect(gitHostDesc).not.toBeNull();
      expect(
        gitHostDesc?.configFields.some((f) => f.name === "repository"),
      ).toBe(false);

      const dualRoleDesc = serializeProvider(githubProvider);
      expect(dualRoleDesc).not.toBeNull();
      const repoFields = dualRoleDesc?.configFields.filter(
        (f) => f.name === "repository",
      );
      expect(repoFields).toHaveLength(1);
    });

    it("NEVER exposes envKey in serialized client-facing descriptors", () => {
      const fields = serializeProviderConfigSchema(githubProvider.configSchema);
      for (const field of fields) {
        expect("envKey" in field).toBe(false);
      }
      const rawMeta = githubConfigSchema.shape.token.meta();
      expect(rawMeta).toMatchObject({
        secret: true,
        envKey: "GITHUB_TOKEN",
      });
    });

    it("validates valid configurations and rejects missing required token", () => {
      const valid = githubConfigSchema.safeParse({
        token: "ghp_1234567890abcdef",
        repoOwner: "octocat",
        repository: "hello-world",
      });
      expect(valid.success).toBe(true);

      const validMinimal = githubConfigSchema.safeParse({
        token: "ghp_1234567890abcdef",
      });
      expect(validMinimal.success).toBe(true);

      const missingToken = githubConfigSchema.safeParse({
        repoOwner: "octocat",
      });
      expect(missingToken.success).toBe(false);

      const emptyToken = githubConfigSchema.safeParse({
        token: "",
      });
      expect(emptyToken.success).toBe(false);
    });
  });

  describe("P0 Nested-Config Ambiguity Detection (#129 fix)", () => {
    it("resolves flat wizard configuration correctly", () => {
      const config = {
        token: "ghp_flat_token",
        repoOwner: "my-org",
        repository: "my-repo",
      };
      const resolved = resolveGitHubConfig(config);
      expect(resolved.token).toBe("ghp_flat_token");
      expect(resolved.owner).toBe("my-org");
      expect(resolved.repo).toBe("my-repo");
    });

    it("resolves wizard-shaped nested configurations (gitHost container)", () => {
      const config = {
        gitHost: {
          token: "ghp_githost_token",
          repoOwner: "enterprise-org",
          repository: "backend-service",
        },
      };
      const resolved = resolveGitHubConfig(config);
      expect(resolved.token).toBe("ghp_githost_token");
      expect(resolved.owner).toBe("enterprise-org");
      expect(resolved.repo).toBe("backend-service");
    });

    it("resolves nested configurations inside connections array (#131 payload shape)", () => {
      const config = {
        connections: [
          {
            providerId: "github",
            roles: ["gitHost"],
            config: {
              token: "ghp_conn_token",
              repoOwner: "vendifai",
            },
          },
        ],
      };
      const resolved = resolveGitHubConfig(config);
      expect(resolved.token).toBe("ghp_conn_token");
      expect(resolved.owner).toBe("vendifai");
    });

    it("detects and rejects conflicting owner configurations across nested objects (#129)", () => {
      const conflictingOwner = {
        repoOwner: "org-alpha",
        github: {
          repoOwner: "org-beta",
        },
      };
      const check = detectGitHubConfigMismatch(conflictingOwner);
      expect(check.mismatch).toBe(true);
      expect(check.error).toContain("Configuration mismatch");
      expect(check.error).toContain("org-alpha");
      expect(check.error).toContain("org-beta");

      expect(() => resolveGitHubConfig(conflictingOwner)).toThrow(
        /Configuration mismatch/,
      );
    });

    it("detects and rejects conflicting token values across nested objects (#129)", () => {
      const conflictingToken = {
        token: "ghp_token_one",
        gitHost: {
          token: "ghp_token_two",
        },
      };
      const check = detectGitHubConfigMismatch(conflictingToken);
      expect(check.mismatch).toBe(true);
      expect(check.error).toContain("conflicting token values");
      expect(() => resolveGitHubConfig(conflictingToken)).toThrow(
        /conflicting token values/,
      );
    });

    it("detects and rejects conflicting repository values across nested objects (#129)", () => {
      const conflictingRepo = {
        repository: "repo-one",
        gitHost: {
          repo: "repo-two",
        },
      };
      const check = detectGitHubConfigMismatch(conflictingRepo);
      expect(check.mismatch).toBe(true);
      expect(check.error).toContain("Configuration mismatch");
      expect(() => resolveGitHubConfig(conflictingRepo)).toThrow(
        /Configuration mismatch/,
      );
    });

    it("accepts consistent nested configurations without error", () => {
      const consistent = {
        repoOwner: "my-org",
        github: {
          repoOwner: "my-org",
          token: "ghp_token_123",
        },
      };
      const check = detectGitHubConfigMismatch(consistent);
      expect(check.mismatch).toBe(false);
      const resolved = resolveGitHubConfig(consistent);
      expect(resolved.owner).toBe("my-org");
      expect(resolved.token).toBe("ghp_token_123");
    });

    it("resolves mixed GitHub + Jira configuration without false mismatch (#131 / #138)", () => {
      const mixedConfig = {
        gitHost: {
          providerId: "github",
          repoOwner: "acme-corp",
          repository: "core-repo",
          token: "ghp_github_secret_token",
        },
        tracker: {
          providerId: "jira",
          host: "https://acme.atlassian.net",
          project: "CORE",
          apiToken: "jira_secret_api_token",
          email: "dev@acme.com",
        },
      };

      const check = detectGitHubConfigMismatch(mixedConfig);
      expect(check.mismatch).toBe(false);

      const resolved = resolveGitHubConfig(mixedConfig);
      expect(resolved.owner).toBe("acme-corp");
      expect(resolved.repo).toBe("core-repo");
      expect(resolved.token).toBe("ghp_github_secret_token");
    });

    it("resolves mixed-provider connections array payload without false mismatch (#131)", () => {
      const mixedConnections = {
        connections: [
          {
            providerId: "github",
            roles: ["gitHost"],
            config: {
              repoOwner: "enterprise-org",
              repository: "service-repo",
              token: "ghp_conn_token",
            },
          },
          {
            providerId: "jira",
            roles: ["tracker"],
            config: {
              host: "https://enterprise.atlassian.net",
              project: "PROJ",
              apiToken: "jira_different_token",
            },
          },
        ],
      };

      const check = detectGitHubConfigMismatch(mixedConnections);
      expect(check.mismatch).toBe(false);

      const resolved = resolveGitHubConfig(mixedConnections);
      expect(resolved.owner).toBe("enterprise-org");
      expect(resolved.repo).toBe("service-repo");
      expect(resolved.token).toBe("ghp_conn_token");
    });

    it("still fails closed when genuine conflicting GitHub values are present alongside Jira (#138)", () => {
      const conflictingMixed = {
        gitHost: {
          providerId: "github",
          repoOwner: "acme-corp",
          token: "ghp_tok_1",
        },
        github: {
          repoOwner: "competing-corp",
          token: "ghp_tok_2",
        },
        tracker: {
          providerId: "jira",
          host: "https://acme.atlassian.net",
          project: "CORE",
          apiToken: "jira_secret_token",
        },
      };

      const check = detectGitHubConfigMismatch(conflictingMixed);
      expect(check.mismatch).toBe(true);
      expect(check.error).toContain("Configuration mismatch");
      expect(() => resolveGitHubConfig(conflictingMixed)).toThrow(
        /Configuration mismatch/,
      );
    });
  });

  describe("Error Normalization (toUserError)", () => {
    it("maps 401 Unauthorized to AUTH_INVALID", () => {
      const headers = new Headers();
      const err = new GitHubHttpError("Bad credentials", {
        status: 401,
        headers,
      });
      const normalized = toGitHubUserError(err, "VERIFY");
      expect(normalized).toEqual({
        code: "AUTH_INVALID",
        context: "VERIFY",
      });
      expect(isProviderError(normalized)).toBe(true);
    });

    it("maps 403 Forbidden without rate-limit headers to PERMISSION (distinct from AUTH_INVALID)", () => {
      const headers = new Headers();
      const err = new GitHubHttpError("Must have admin rights to Repository", {
        status: 403,
        headers,
      });
      const normalized = toGitHubUserError(err, "PR");
      expect(normalized).toEqual({
        code: "PERMISSION",
        context: "PR",
      });
      expect(isProviderError(normalized)).toBe(true);
    });

    it("maps 403 Forbidden with x-ratelimit-remaining: 0 to RATE_LIMITED with computed retryAfterMs", () => {
      const resetEpochSeconds = Math.floor((Date.now() + 60_000) / 1000);
      const headers = new Headers({
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(resetEpochSeconds),
      });
      const err = new GitHubHttpError("API rate limit exceeded", {
        status: 403,
        headers,
        isRateLimit: true,
      });
      const normalized = toGitHubUserError(err, "DISCOVERY");
      expect(normalized.code).toBe("RATE_LIMITED");
      expect(normalized.context).toBe("DISCOVERY");
      expect(typeof normalized.retryAfterMs).toBe("number");
      expect(Number(normalized.retryAfterMs)).toBeGreaterThan(0);
      expect(isProviderError(normalized)).toBe(true);
    });

    it("maps 403 with Retry-After header to RATE_LIMITED with retryAfterMs", () => {
      const headers = new Headers({
        "retry-after": "45",
      });
      const err = new GitHubHttpError(
        "You have exceeded a secondary rate limit",
        {
          status: 403,
          headers,
          isRateLimit: true,
        },
      );
      const normalized = toGitHubUserError(err, "TICKETS");
      expect(normalized).toEqual({
        code: "RATE_LIMITED",
        context: "TICKETS",
        retryAfterMs: 45000,
      });
    });

    it("maps 429 Too Many Requests to RATE_LIMITED with retryAfterMs", () => {
      const headers = new Headers({
        "retry-after": "30",
      });
      const err = new GitHubHttpError("Too Many Requests", {
        status: 429,
        headers,
        isRateLimit: true,
      });
      const normalized = toGitHubUserError(err, "DISCOVERY");
      expect(normalized).toEqual({
        code: "RATE_LIMITED",
        context: "DISCOVERY",
        retryAfterMs: 30000,
      });
    });

    it("maps 404 Not Found to NOT_FOUND", () => {
      const headers = new Headers();
      const err = new GitHubHttpError("Not Found", { status: 404, headers });
      const normalized = toGitHubUserError(err, "VERIFY");
      expect(normalized).toEqual({
        code: "NOT_FOUND",
        context: "VERIFY",
      });
    });

    it("maps unexpected generic errors to UNKNOWN", () => {
      const err = new Error("Connection reset by peer");
      const normalized = toGitHubUserError(err, "DISCOVERY");
      expect(normalized).toEqual({
        code: "UNKNOWN",
        context: "DISCOVERY",
      });
    });

    it("never leaks raw provider error text, headers, or messages across boundary", () => {
      const sensitiveBody = {
        message: "Internal server trace: /var/github/secret-key.pem exposed",
      };
      const err = new GitHubHttpError("Fatal upstream dump", {
        status: 500,
        headers: new Headers({ "x-github-request-id": "secret-req-id" }),
        bodyText: JSON.stringify(sensitiveBody),
      });
      const normalized = toGitHubUserError(err, "PR");
      const json = JSON.stringify(normalized);
      expect(json).not.toContain("secret-key");
      expect(json).not.toContain("secret-req-id");
      expect(json).not.toContain("dump");
      expect(normalized).toEqual({
        code: "UNKNOWN",
        context: "PR",
      });
    });
  });

  describe("Quick-URL Intake (parseQuickUrl)", () => {
    it("parses standard HTTPS GitHub repository URL", () => {
      const parsed = parseGitHubQuickUrl("https://github.com/facebook/react");
      expect(parsed).toEqual({
        configDraft: {
          repoOwner: "facebook",
          repository: "react",
        },
        inferredName: "react",
      });
    });

    it("parses GitHub URL with trailing .git suffix", () => {
      const parsed = parseGitHubQuickUrl(
        "https://github.com/torvalds/linux.git",
      );
      expect(parsed).toEqual({
        configDraft: {
          repoOwner: "torvalds",
          repository: "linux",
        },
        inferredName: "linux",
      });
    });

    it("parses SSH git@github.com URL", () => {
      const parsed = parseGitHubQuickUrl("git@github.com:openai/gpt-3.git");
      expect(parsed).toEqual({
        configDraft: {
          repoOwner: "openai",
          repository: "gpt-3",
        },
        inferredName: "gpt-3",
      });
    });

    it("parses bare github.com/owner/repo URL without protocol", () => {
      const parsed = parseGitHubQuickUrl("github.com/vercel/next.js");
      expect(parsed).toEqual({
        configDraft: {
          repoOwner: "vercel",
          repository: "next.js",
        },
        inferredName: "next.js",
      });
    });

    it("parses deep GitHub URL (pull request or branch view) and infers repo name", () => {
      const parsed = parseGitHubQuickUrl(
        "https://github.com/tkz96/x-factory/pull/153",
      );
      expect(parsed).toEqual({
        configDraft: {
          repoOwner: "tkz96",
          repository: "x-factory",
        },
        inferredName: "x-factory",
      });
    });

    it("parses organization URL and infers organization name", () => {
      const parsed = parseGitHubQuickUrl("https://github.com/facebook");
      expect(parsed).toEqual({
        configDraft: {
          repoOwner: "facebook",
        },
        inferredName: "facebook",
      });
    });

    it("returns null for non-GitHub domains and attacker domains", () => {
      expect(parseGitHubQuickUrl("https://gitlab.com/owner/repo")).toBeNull();
      expect(
        parseGitHubQuickUrl("https://dev.azure.com/org/proj/_git/repo"),
      ).toBeNull();
      expect(
        parseGitHubQuickUrl("https://evil-github.com/owner/repo"),
      ).toBeNull();
      expect(
        parseGitHubQuickUrl("https://github.com.attacker.com/owner/repo"),
      ).toBeNull();
      expect(parseGitHubQuickUrl("")).toBeNull();
      expect(parseGitHubQuickUrl("not-a-valid-url")).toBeNull();
    });

    it("accepts valid GitHub URLs when repository or path contains strings like gitlab.com or atlassian.net", () => {
      const gitlabRepo = parseGitHubQuickUrl(
        "https://github.com/my-org/gitlab.com-migration",
      );
      expect(gitlabRepo).toEqual({
        configDraft: {
          repoOwner: "my-org",
          repository: "gitlab.com-migration",
        },
        inferredName: "gitlab.com-migration",
      });

      const atlassianRepo = parseGitHubQuickUrl(
        "https://github.com/my-org/atlassian.net-sync",
      );
      expect(atlassianRepo).toEqual({
        configDraft: {
          repoOwner: "my-org",
          repository: "atlassian.net-sync",
        },
        inferredName: "atlassian.net-sync",
      });

      const azureRepo = parseGitHubQuickUrl(
        "https://github.com/my-org/dev.azure.com-mirror",
      );
      expect(azureRepo).toEqual({
        configDraft: {
          repoOwner: "my-org",
          repository: "dev.azure.com-mirror",
        },
        inferredName: "dev.azure.com-mirror",
      });
    });
  });

  describe("Repository Discovery (listRepositories)", () => {
    it("discovers organization repositories end-to-end with nested configuration", async () => {
      const fakeFetch: typeof fetch = (async (url: string | URL | Request) => {
        const urlStr = String(url);
        expect(urlStr).toContain("/orgs/acme/repos?per_page=100&type=all");
        return new Response(
          JSON.stringify([
            {
              id: 101,
              name: "frontend-app",
              clone_url: "https://github.com/acme/frontend-app.git",
              html_url: "https://github.com/acme/frontend-app",
              default_branch: "main",
            },
            {
              id: 102,
              name: "service-gateway",
              clone_url: "https://github.com/acme/service-gateway.git",
              html_url: "https://github.com/acme/service-gateway",
              default_branch: "develop",
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }) as typeof fetch;

      const provider = createGithubProvider({ fetchFn: fakeFetch });
      const repos = await provider.listRepositories?.({
        gitHost: {
          token: "ghp_valid_token",
          repoOwner: "acme",
        },
      });

      expect(repos).toHaveLength(2);
      expect(repos?.[0]).toEqual({
        id: "101",
        name: "frontend-app",
        remote: "https://github.com/acme/frontend-app.git",
        defaultBranch: "main",
        webUrl: "https://github.com/acme/frontend-app",
      });
      expect(repos?.[1]?.defaultBranch).toBe("develop");
    });

    it("falls back to user repository endpoint when organization returns 404", async () => {
      const calls: string[] = [];
      const fakeFetch: typeof fetch = (async (url: string | URL | Request) => {
        const urlStr = String(url);
        calls.push(urlStr);
        if (urlStr.includes("/orgs/")) {
          return new Response(JSON.stringify({ message: "Not Found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/users/")) {
          return new Response(
            JSON.stringify([
              {
                id: 201,
                name: "personal-portfolio",
                clone_url: "https://github.com/octocat/personal-portfolio.git",
                html_url: "https://github.com/octocat/personal-portfolio",
                default_branch: "main",
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      }) as typeof fetch;

      const provider = createGithubProvider({ fetchFn: fakeFetch });
      const repos = await provider.listRepositories?.({
        token: "ghp_token",
        repoOwner: "octocat",
      });

      expect(calls.length).toBe(2);
      expect(calls[0]).toContain("/orgs/octocat/repos");
      expect(calls[1]).toContain("/users/octocat/repos");
      expect(repos).toHaveLength(1);
      expect(repos?.[0]?.name).toBe("personal-portfolio");
    });

    it("fetches authenticated user repos when no owner is configured", async () => {
      let requestedUrl = "";
      const fakeFetch: typeof fetch = (async (url: string | URL | Request) => {
        requestedUrl = String(url);
        return new Response(
          JSON.stringify([
            {
              id: 301,
              name: "my-collab-repo",
              clone_url: "https://github.com/collab/my-collab-repo.git",
              default_branch: "main",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;

      const provider = createGithubProvider({ fetchFn: fakeFetch });
      const repos = await provider.listRepositories?.({
        token: "ghp_token",
      });

      expect(requestedUrl).toContain("/user/repos");
      expect(repos).toHaveLength(1);
      expect(repos?.[0]?.name).toBe("my-collab-repo");
    });

    it("handles pagination via Link rel=next header", async () => {
      let page = 1;
      const fakeFetch: typeof fetch = (async () => {
        if (page === 1) {
          page++;
          return new Response(
            JSON.stringify([
              { id: 1, name: "repo-page-1", default_branch: "main" },
            ]),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                Link: '<https://api.github.com/orgs/myorg/repos?page=2>; rel="next"',
              },
            },
          );
        }
        return new Response(
          JSON.stringify([
            { id: 2, name: "repo-page-2", default_branch: "main" },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }) as unknown as typeof fetch;

      const provider = createGithubProvider({ fetchFn: fakeFetch });
      const repos = await provider.listRepositories?.({
        token: "ghp_token",
        repoOwner: "myorg",
      });

      expect(repos).toHaveLength(2);
      expect(repos?.map((r) => r.name)).toEqual(["repo-page-1", "repo-page-2"]);
    });

    it("follows pagination beyond 10 pages and returns all repositories across at least 11 pages", async () => {
      const TOTAL_PAGES = 12;
      const fakeFetch: typeof fetch = (async (url: string | URL | Request) => {
        const urlStr = String(url);
        const match = urlStr.match(/[?&]page=(\d+)/);
        const currentPage = match?.[1] ? Number.parseInt(match[1], 10) : 1;

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (currentPage < TOTAL_PAGES) {
          headers.Link = `<https://api.github.com/orgs/myorg/repos?page=${currentPage + 1}>; rel="next"`;
        }

        return new Response(
          JSON.stringify([
            {
              id: currentPage,
              name: `repo-page-${currentPage}`,
              default_branch: "main",
            },
          ]),
          { status: 200, headers },
        );
      }) as unknown as typeof fetch;

      const provider = createGithubProvider({ fetchFn: fakeFetch });
      const repos = await provider.listRepositories?.({
        token: "ghp_token",
        repoOwner: "myorg",
      });

      expect(repos).toHaveLength(TOTAL_PAGES);
      expect(repos?.map((r) => r.name)).toEqual(
        Array.from({ length: TOTAL_PAGES }, (_, i) => `repo-page-${i + 1}`),
      );
    });

    it("terminates safely when a pagination Link header repeats a previously visited URL", async () => {
      const calls: string[] = [];
      const fakeFetch: typeof fetch = (async (url: string | URL | Request) => {
        const urlStr = String(url);
        calls.push(urlStr);

        if (urlStr.includes("page=2")) {
          return new Response(
            JSON.stringify([
              { id: 2, name: "repo-page-2", default_branch: "main" },
            ]),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                Link: '<https://api.github.com/orgs/myorg/repos?page=2>; rel="next"',
              },
            },
          );
        }

        return new Response(
          JSON.stringify([
            { id: 1, name: "repo-page-1", default_branch: "main" },
          ]),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              Link: '<https://api.github.com/orgs/myorg/repos?page=2>; rel="next"',
            },
          },
        );
      }) as unknown as typeof fetch;

      const provider = createGithubProvider({ fetchFn: fakeFetch });
      const repos = await provider.listRepositories?.({
        token: "ghp_token",
        repoOwner: "myorg",
      });

      expect(calls.length).toBe(2);
      expect(repos).toHaveLength(2);
      expect(repos?.map((r) => r.name)).toEqual(["repo-page-1", "repo-page-2"]);
    });
  });

  describe("Pull Request Lifecycle (createPullRequest & findExistingPullRequest)", () => {
    it("creates pull request using GitHub REST API with explicit provider credentials", async () => {
      let capturedPayload: unknown = null;
      let capturedAuth = "";
      const fakeFetch: typeof fetch = (async (
        url: string | URL | Request,
        init?: RequestInit,
      ) => {
        expect(String(url)).toBe(
          "https://api.github.com/repos/octocat/hello-world/pulls",
        );
        expect(init?.method).toBe("POST");
        const h = init?.headers;
        if (h instanceof Headers) {
          capturedAuth = h.get("authorization") || "";
        } else {
          capturedAuth = String(
            (h as Record<string, string>)?.Authorization || "",
          );
        }
        if (init?.body) {
          capturedPayload = JSON.parse(String(init.body));
        }

        return new Response(
          JSON.stringify({
            html_url: "https://github.com/octocat/hello-world/pull/42",
            state: "open",
            head: { ref: "feature-branch", sha: "commit-sha-abc123" },
            base: { ref: "main" },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;

      const provider = createGithubProvider({
        fetchFn: fakeFetch,
      });

      const pr = await provider.createPullRequest?.(
        { token: "ghp_secret_token", repoOwner: "octocat" },
        {
          repository: "hello-world",
          title: "feat: add super feature",
          description: "Resolves #101",
          sourceBranch: "feature-branch",
          targetBranch: "main",
        },
      );

      expect(capturedAuth).toBe("Bearer ghp_secret_token");
      expect(capturedPayload).toEqual({
        title: "feat: add super feature",
        body: "Resolves #101",
        head: "feature-branch",
        base: "main",
      });
      expect(pr).toEqual({
        url: "https://github.com/octocat/hello-world/pull/42",
        status: "open",
        sourceBranch: "feature-branch",
        targetBranch: "main",
        lastMergeSourceCommit: "commit-sha-abc123",
      });
    });

    it("propagates REST API failure directly without fallback on pull request creation", async () => {
      const failingFetch: typeof fetch = (async () => {
        return new Response(
          JSON.stringify({ message: "Must have push access to repository" }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      const provider = createGithubProvider({
        fetchFn: failingFetch,
      });

      let caughtError: unknown = null;
      try {
        await provider.createPullRequest?.(
          { token: "ghp_token", repoOwner: "octocat" },
          {
            repository: "hello-world",
            title: "fix: failing PR",
            description: "API failure propagation test",
            sourceBranch: "fix-branch",
            targetBranch: "main",
          },
        );
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect((caughtError as GitHubHttpError).status).toBe(403);
      const userErr = provider.toUserError(caughtError, "PR");
      expect(userErr).toEqual({
        code: "PERMISSION",
        context: "PR",
      });
      expect(isProviderError(userErr)).toBe(true);
    });

    it("throws provider error and normalizes without leaking when 201 response lacks html_url", async () => {
      const malformedFetch: typeof fetch = (async () => {
        return new Response(
          JSON.stringify({
            id: 999,
            state: "open",
            head: { ref: "feature-branch" },
            base: { ref: "main" },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      const provider = createGithubProvider({ fetchFn: malformedFetch });
      let caughtError: unknown = null;
      try {
        await provider.createPullRequest?.(
          { token: "ghp_secret_token", repoOwner: "octocat" },
          {
            repository: "hello-world",
            title: "feat: add feature",
            description: "Some desc",
            sourceBranch: "feature-branch",
            targetBranch: "main",
          },
        );
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError instanceof Error).toBe(true);
      expect((caughtError as Error).message).toContain("html_url");

      const userErr = provider.toUserError(caughtError, "PR");
      expect(userErr).toEqual({
        code: "UNKNOWN",
        context: "PR",
      });
      expect(isProviderError(userErr)).toBe(true);
    });

    it("finds existing pull request using REST API and returns null when not found", async () => {
      const fakeFetch: typeof fetch = (async (url: string | URL | Request) => {
        const urlStr = String(url);
        expect(urlStr).toContain("/pulls?");
        if (urlStr.includes("head=octocat%3Aexisting-branch")) {
          return new Response(
            JSON.stringify([
              {
                html_url: "https://github.com/octocat/hello-world/pull/77",
                state: "open",
                head: { ref: "existing-branch", sha: "sha-777" },
                base: { ref: "main" },
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("[]", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      const provider = createGithubProvider({ fetchFn: fakeFetch });

      const found = await provider.findExistingPullRequest?.(
        { token: "ghp_token", repoOwner: "octocat" },
        {
          repository: "hello-world",
          sourceBranch: "existing-branch",
        },
      );

      expect(found).toEqual({
        url: "https://github.com/octocat/hello-world/pull/77",
        status: "open",
        sourceBranch: "existing-branch",
        targetBranch: "main",
        lastMergeSourceCommit: "sha-777",
      });

      const notFound = await provider.findExistingPullRequest?.(
        { token: "ghp_token", repoOwner: "octocat" },
        {
          repository: "hello-world",
          sourceBranch: "non-existent-branch",
        },
      );

      expect(notFound).toBeNull();
    });

    it("throws on 403 from findExistingPullRequest instead of returning null", async () => {
      const forbiddenFetch: typeof fetch = (async () => {
        return new Response(JSON.stringify({ message: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;

      const provider = createGithubProvider({ fetchFn: forbiddenFetch });
      let caught: unknown;
      try {
        await provider.findExistingPullRequest?.(
          { token: "ghp_token", repoOwner: "octocat" },
          { repository: "hello-world", sourceBranch: "my-branch" },
        );
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      expect((caught as GitHubHttpError).status).toBe(403);
      const userErr = provider.toUserError(caught, "PR");
      expect(userErr.code).toBe("PERMISSION");
    });

    it("throws on 500 from findExistingPullRequest instead of returning null", async () => {
      const serverErrorFetch: typeof fetch = (async () => {
        return new Response(
          JSON.stringify({ message: "Internal Server Error" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      }) as unknown as typeof fetch;

      const provider = createGithubProvider({ fetchFn: serverErrorFetch });
      let caught: unknown;
      try {
        await provider.findExistingPullRequest?.(
          { token: "ghp_token", repoOwner: "octocat" },
          { repository: "hello-world", sourceBranch: "my-branch" },
        );
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      expect((caught as GitHubHttpError).status).toBe(500);
    });

    it("throws on 404 from findExistingPullRequest (repository not found, not 'no PR')", async () => {
      // GET /repos/{owner}/{repo}/pulls returning 404 means the repository
      // cannot be resolved — bad owner/repo config. It does NOT mean "no PR exists".
      // The correct response is to throw so the caller can surface the config error.
      const notFoundFetch: typeof fetch = (async () => {
        return new Response(JSON.stringify({ message: "Not Found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;

      const provider = createGithubProvider({ fetchFn: notFoundFetch });
      let caught: unknown;
      try {
        await provider.findExistingPullRequest?.(
          { token: "ghp_token", repoOwner: "octocat" },
          { repository: "hello-world", sourceBranch: "my-branch" },
        );
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      expect((caught as GitHubHttpError).status).toBe(404);
      const userErr = provider.toUserError(caught, "PR");
      expect(userErr.code).toBe("NOT_FOUND");
    });
  });

  describe("Ticket Listing (listTickets)", () => {
    it("lists issues filtered by required workflow label and ignores PRs", async () => {
      const fakeFetch: typeof fetch = (async (url: string | URL | Request) => {
        const urlStr = String(url);
        expect(urlStr).toContain(
          `labels=${encodeURIComponent(REQUIRED_WORKFLOW_LABEL)}`,
        );
        return new Response(
          JSON.stringify([
            {
              number: 10,
              title: "Implement GitHub Module",
              body: "## Requirements\n- Feature complete\n- Passes gates",
              labels: [
                { name: REQUIRED_WORKFLOW_LABEL },
                { name: "enhancement" },
              ],
              html_url: "https://github.com/octocat/hello-world/issues/10",
              updated_at: "2026-10-04T12:00:00Z",
            },
            {
              number: 11,
              title: "Pull Request titled as issue",
              body: "Should be ignored",
              pull_request: { url: "https://..." },
              labels: [{ name: REQUIRED_WORKFLOW_LABEL }],
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;

      const provider = createGithubProvider({ fetchFn: fakeFetch });
      const tickets = await provider.listTickets?.(
        {
          token: "ghp_token",
          repoOwner: "octocat",
          repository: "hello-world",
        },
        { requiredLabel: REQUIRED_WORKFLOW_LABEL },
      );

      expect(tickets).toHaveLength(1);
      expect(tickets?.[0]).toEqual({
        id: "GH-10",
        title: "Implement GitHub Module",
        description: "## Requirements\n- Feature complete\n- Passes gates",
        acceptanceCriteria: ["Feature complete", "Passes gates"],
        labels: [REQUIRED_WORKFLOW_LABEL, "enhancement"],
        url: "https://github.com/octocat/hello-world/issues/10",
        provider: "github",
        updatedAt: "2026-10-04T12:00:00Z",
      });
    });

    it("requests state=open and excludes closed issues from the work queue", async () => {
      let capturedUrl = "";
      const fakeFetch: typeof fetch = (async (url: string | URL | Request) => {
        capturedUrl = String(url);
        // Fake API honours state=open like the real GitHub API:
        // only the open issue is returned; the closed one is absent.
        return new Response(
          JSON.stringify([
            {
              number: 20,
              title: "Open issue",
              body: "Acceptance Criteria:\n- Must work",
              state: "open",
              labels: [{ name: REQUIRED_WORKFLOW_LABEL }],
              html_url: "https://github.com/octocat/hello-world/issues/20",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;

      const provider = createGithubProvider({ fetchFn: fakeFetch });
      const tickets = await provider.listTickets?.(
        { token: "ghp_token", repoOwner: "octocat", repository: "hello-world" },
        { requiredLabel: REQUIRED_WORKFLOW_LABEL },
      );

      // The URL must request open issues only
      expect(capturedUrl).toContain("state=open");
      expect(capturedUrl).not.toContain("state=all");

      // Only the open issue is in the result — the closed one is excluded
      expect(tickets).toHaveLength(1);
      const first = tickets?.[0];
      expect(first?.id).toBe("GH-20");
      expect(first?.title).toBe("Open issue");
    });

    it("works with a tracker configuration containing repository", async () => {
      let capturedUrl = "";
      const fakeFetch: typeof fetch = (async (url: string | URL | Request) => {
        capturedUrl = String(url);
        return new Response(
          JSON.stringify([
            {
              number: 30,
              title: "Tracker issue",
              body: "Acceptance Criteria:\n- Done",
              state: "open",
              labels: [{ name: REQUIRED_WORKFLOW_LABEL }],
              html_url: "https://github.com/octocat/tracker-repo/issues/30",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;

      const provider = createGithubProvider({ fetchFn: fakeFetch });
      const tickets = await provider.listTickets?.(
        {
          tracker: {
            token: "ghp_tracker_token",
            repoOwner: "octocat",
            repository: "tracker-repo",
          },
        },
        { requiredLabel: REQUIRED_WORKFLOW_LABEL },
      );

      expect(capturedUrl).toContain("/repos/octocat/tracker-repo/issues");
      expect(tickets).toHaveLength(1);
      const first = tickets?.[0];
      expect(first?.id).toBe("GH-30");
      expect(first?.title).toBe("Tracker issue");
    });
  });

  describe("Verification & Scopes (verifyCredentials & verifyScopes)", () => {
    it("returns status: 'ok' when classic PAT includes 'repo' scope", async () => {
      const fakeFetch: typeof fetch = (async (url: string | URL | Request) => {
        const urlStr = String(url);
        if (urlStr.endsWith("/user")) {
          return new Response(JSON.stringify({ login: "octocat" }), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "x-oauth-scopes": "repo, read:org",
            },
          });
        }
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      const provider = createGithubProvider({ fetchFn: fakeFetch });
      const result = await provider.verifyCredentials({
        token: "ghp_full_repo_token",
      });

      expect(result).toEqual({
        status: "ok",
        warnings: [],
      });
    });

    it("returns status: 'degraded' with CAPABILITY_UNCONFIRMED when PAT lacks 'repo' scope", async () => {
      const fakeFetch: typeof fetch = (async (url: string | URL | Request) => {
        const urlStr = String(url);
        if (urlStr.endsWith("/user")) {
          return new Response(JSON.stringify({ login: "octocat" }), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "x-oauth-scopes": "read:user, public_repo",
            },
          });
        }
        return new Response("{}", { status: 200 });
      }) as typeof fetch;

      const provider = createGithubProvider({ fetchFn: fakeFetch });
      const result = await provider.verifyCredentials({
        token: "ghp_public_only_token",
      });

      expect(result.status).toBe("degraded");
      expect(result.warnings).toEqual([
        {
          kind: "CAPABILITY_UNCONFIRMED",
          capability: "createPullRequest",
        },
      ]);
    });

    it("returns status: 'degraded' when fine-grained PAT provides no x-oauth-scopes header", async () => {
      const fakeFetch: typeof fetch = (async (url: string | URL | Request) => {
        const urlStr = String(url);
        if (urlStr.endsWith("/user")) {
          return new Response(JSON.stringify({ login: "fine-grained-user" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("{}", { status: 200 });
      }) as typeof fetch;

      const provider = createGithubProvider({ fetchFn: fakeFetch });
      const result = await provider.verifyCredentials({
        token: "github_pat_fine_grained",
      });

      expect(result.status).toBe("degraded");
      expect(result.warnings).toEqual([
        {
          kind: "CAPABILITY_UNCONFIRMED",
          capability: "createPullRequest",
        },
      ]);
    });

    it("reports scope findings and overPrivileged status via verifyScopes", async () => {
      const fakeFetch: typeof fetch = (async () => {
        return new Response(JSON.stringify({ login: "admin-user" }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-oauth-scopes": "repo, delete_repo, admin:org",
          },
        });
      }) as unknown as typeof fetch;

      const provider = createGithubProvider({ fetchFn: fakeFetch });
      const report = await provider.verifyScopes?.({
        token: "ghp_admin_token",
      });

      expect(report).toBeDefined();
      expect(report?.overPrivileged).toBe(true);
      expect(report?.findings).toContainEqual({
        capability: "listRepositories",
        status: "confirmed",
      });
      expect(report?.findings).toContainEqual({
        capability: "createPullRequest",
        status: "confirmed",
      });
    });

    it("verifyScopes reports all capabilities as unconfirmed for fine-grained PAT (no x-oauth-scopes header)", async () => {
      // Fine-grained PATs do not return x-oauth-scopes. Absence of the header means
      // we cannot confirm capabilities from scope introspection — they must be unconfirmed.
      const fakeFetch: typeof fetch = (async () => {
        return new Response(JSON.stringify({ login: "fine-grained-user" }), {
          status: 200,
          // No x-oauth-scopes header — fine-grained PAT behaviour
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;

      const provider = createGithubProvider({ fetchFn: fakeFetch });
      const report = await provider.verifyScopes?.({
        token: "github_pat_fine_grained",
      });

      expect(report).toBeDefined();
      expect(report?.findings).toContainEqual({
        capability: "listRepositories",
        status: "unconfirmed",
      });
      expect(report?.findings).toContainEqual({
        capability: "listTickets",
        status: "unconfirmed",
      });
      expect(report?.findings).toContainEqual({
        capability: "createPullRequest",
        status: "unconfirmed",
      });
    });

    it("throws 404 when configured owner is not found during verifyCredentials", async () => {
      const fakeFetch: typeof fetch = (async (url: string | URL | Request) => {
        const urlStr = String(url);
        if (urlStr.endsWith("/user")) {
          return new Response(JSON.stringify({ login: "octocat" }), {
            status: 200,
            headers: { "x-oauth-scopes": "repo" },
          });
        }
        return new Response(JSON.stringify({ message: "Not Found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      const provider = createGithubProvider({ fetchFn: fakeFetch });
      let caughtErr: unknown;
      try {
        await provider.verifyCredentials({
          token: "ghp_token",
          repoOwner: "non-existent-org",
        });
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeDefined();
      expect((caughtErr as GitHubHttpError).status).toBe(404);
      const userErr = provider.toUserError(caughtErr, "VERIFY");
      expect(userErr).toEqual({
        code: "NOT_FOUND",
        context: "VERIFY",
      });
    });
  });

  describe("HTTP API Endpoints Integration (#137)", () => {
    let server: ReturnType<typeof startServer>;
    let baseUrl: string;

    beforeAll(() => {
      server = startServer(0);
      baseUrl = `http://localhost:${server.port}`;
    });

    afterAll(async () => {
      await server.shutdown();
    });

    it("GET /api/providers/manifest includes github provider with expected descriptor", async () => {
      const res = await fetch(`${baseUrl}/api/providers/manifest`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as Array<{ id: string }>;
      const github = data.find((p) => p.id === "github");
      expect(github).toBeDefined();
    });

    it("POST /api/providers/parse-url parses github.com URL successfully", async () => {
      const res = await fetch(`${baseUrl}/api/providers/parse-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://github.com/facebook/react" }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        matched: boolean;
        providerId?: string;
        inferredName?: string;
      };
      expect(data.matched).toBe(true);
      expect(data.providerId).toBe("github");
      expect(data.inferredName).toBe("react");
    });
  });
});
