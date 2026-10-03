// test/providers-github.test.ts — Comprehensive test suite for GitHub provider module (#138).
//
// Proves:
// 1. Provider contract conformance and serialization gate
// 2. Registration in static registry and exposure via #137 HTTP endpoints
// 3. P0 nested-config ambiguity detection (#129 repro cases)
// 4. toUserError: 403 rate-limit vs 403 permission vs 401 auth
// 5. parseQuickUrl coordinates and inferred name
// 6. createPullRequest: REST primary, gh CLI fallback, PR_CREATE_ONLY policy
// 7. findExistingPullRequest, listRepositories, and listTickets
// 8. Zero-mock except HTTP boundary (stubbing global fetch)

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  hasCapability,
  isProviderError,
  REQUIRED_WORKFLOW_LABEL,
} from "../src/providers/contract.js";
import {
  defaultGitHubDeps,
  type GitHubConfig,
  type GitHubFetch,
  type GitHubModuleDeps,
  GitHubProvider,
  gitHubConfigSchema,
  gitHubProvider,
  resolveGitHubConfig,
} from "../src/providers/github-module.js";
import { getProvider, PROVIDER_REGISTRY } from "../src/providers/registry.js";
import {
  type ProviderDescriptor,
  serializeProvider,
  serializeProviderConfigSchema,
} from "../src/providers/serializer.js";
import { startServer } from "../src/server.js";

let server: ReturnType<typeof startServer>;
let baseUrl: string;

beforeAll(() => {
  server = startServer(0);
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(async () => {
  await server.shutdown();
});

describe("GitHub Provider Contract & Metadata", () => {
  test("implements Provider<'github'> metadata correctly", () => {
    expect(gitHubProvider.id).toBe("github");
    expect(gitHubProvider.displayName).toBe("GitHub");
    expect(gitHubProvider.iconRef).toBe("provider-github");
    expect(gitHubProvider.roles).toEqual(["tracker", "gitHost"]);
  });

  test("declares expected capabilities via type-guards", () => {
    expect(hasCapability(gitHubProvider, "verifyScopes")).toBe(false);
    expect(hasCapability(gitHubProvider, "parseQuickUrl")).toBe(true);
    expect(hasCapability(gitHubProvider, "listRepositories")).toBe(true);
    expect(hasCapability(gitHubProvider, "listTickets")).toBe(true);
    expect(hasCapability(gitHubProvider, "createPullRequest")).toBe(true);
    expect(hasCapability(gitHubProvider, "findExistingPullRequest")).toBe(true);
  });

  test("configSchema serializes cleanly with secret metadata", () => {
    const fields = serializeProviderConfigSchema(gitHubProvider.configSchema);
    expect(fields.length).toBe(3);

    const tokenField = fields.find((f) => f.name === "token");
    expect(tokenField).toBeDefined();
    expect(tokenField?.secret).toBe(true);
    expect(tokenField?.type).toBe("secret");

    // Underlying zod metadata has envKey and secret
    const tokenMeta = gitHubConfigSchema.shape.token.meta();
    expect(tokenMeta).toMatchObject({
      secret: true,
      uiType: "secret",
      envKey: "GITHUB_TOKEN",
    });

    const ownerField = fields.find((f) => f.name === "owner");
    expect(ownerField).toBeDefined();
    expect(ownerField?.secret).toBeUndefined();
    expect(ownerField?.type).toBe("text");

    const repoField = fields.find((f) => f.name === "repo");
    expect(repoField).toBeDefined();
    expect(repoField?.secret).toBeUndefined();
    expect(repoField?.type).toBe("text");
  });

  test("serializeProvider descriptor produces valid contract envelope", () => {
    const descriptor = serializeProvider(gitHubProvider);
    expect(descriptor).not.toBeNull();
    if (!descriptor) {
      throw new Error("Expected descriptor to be defined");
    }
    expect(descriptor.id).toBe("github");
    expect(descriptor.displayName).toBe("GitHub");
    expect(descriptor.iconRef).toBe("provider-github");
    expect(descriptor.roles).toEqual(["tracker", "gitHost"]);
    expect(descriptor.configFields.length).toBe(3);
  });
});

describe("Static Registry & #137 Endpoints Integration", () => {
  test("registered in static registry", () => {
    expect(getProvider("github")).toBe(gitHubProvider);
    expect(PROVIDER_REGISTRY.get("github")).toBe(gitHubProvider);
  });

  test("GET /api/providers/manifest includes GitHub provider with serialized schema", async () => {
    const res = await fetch(`${baseUrl}/api/providers/manifest`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as ProviderDescriptor[];
    const gh = data.find((p) => p.id === "github");
    expect(gh).toBeDefined();
    expect(gh?.configFields.length).toBe(3);
  });

  test("POST /api/providers/parse-url parses GitHub URL with zero endpoint modifications", async () => {
    const res = await fetch(`${baseUrl}/api/providers/parse-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/octocat/Hello-World" }),
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toEqual({
      providerId: "github",
      configDraft: {
        owner: "octocat",
        repo: "Hello-World",
      },
      inferredName: "Hello-World",
    });
  });
});

describe("P0 Nested-Config Ambiguity Detection (#129)", () => {
  test("resolves clean flat configuration", () => {
    const resolved = resolveGitHubConfig({
      token: "ghp_secret123",
      owner: "acme-corp",
      repo: "roadrunner",
    });
    expect(resolved).toEqual({
      token: "ghp_secret123",
      owner: "acme-corp",
      repo: "roadrunner",
    });
  });

  test("resolves nested configurations when coordinates are identical/concordant", () => {
    const resolved = resolveGitHubConfig({
      token: "ghp_secret123",
      owner: "acme-corp",
      tracker: { owner: "acme-corp", repo: "roadrunner" },
      gitHost: { organization: "acme-corp", repo: "roadrunner" },
      orgUrl: "https://github.com/acme-corp/roadrunner",
    });
    expect(resolved).toEqual({
      token: "ghp_secret123",
      owner: "acme-corp",
      repo: "roadrunner",
    });
  });

  test("detects conflicting owners across nested objects (#129 repro)", () => {
    expect(() =>
      resolveGitHubConfig({
        token: "ghp_secret123",
        owner: "org-alpha",
        tracker: { owner: "org-beta" },
      }),
    ).toThrow(
      /Ambiguous configuration: conflicting owner\/organization values detected/,
    );
  });

  test("detects conflicting owners between tracker and gitHost (#129 repro)", () => {
    expect(() =>
      resolveGitHubConfig({
        token: "ghp_secret123",
        tracker: { organization: "org-alpha" },
        gitHost: { repoOwner: "org-gamma" },
      }),
    ).toThrow(
      /Ambiguous configuration: conflicting owner\/organization values detected/,
    );
  });

  test("detects conflicting owners between orgUrl and owner (#129 repro)", () => {
    expect(() =>
      resolveGitHubConfig({
        token: "ghp_secret123",
        owner: "org-alpha",
        orgUrl: "https://github.com/org-delta",
      }),
    ).toThrow(
      /Ambiguous configuration: conflicting owner\/organization values detected/,
    );
  });

  test("detects conflicting repositories across nested objects (#129 repro)", () => {
    expect(() =>
      resolveGitHubConfig({
        token: "ghp_secret123",
        repo: "repo-alpha",
        tracker: { repo: "repo-beta" },
      }),
    ).toThrow(
      /Ambiguous configuration: conflicting repository values detected/,
    );
  });

  test("detects conflicting tokens across nested objects", () => {
    expect(() =>
      resolveGitHubConfig({
        token: "token-one",
        gitHost: { token: "token-two" },
      }),
    ).toThrow(/Ambiguous configuration: conflicting token values detected/);
  });

  test("verifyCredentials rejects ambiguous configuration loudly", async () => {
    await expect(
      gitHubProvider.verifyCredentials({
        token: "ghp_secret123",
        owner: "org-a",
        tracker: { owner: "org-b" },
      }),
    ).rejects.toThrow(/Ambiguous configuration/);
  });
});

describe("toUserError Disambiguation", () => {
  test("maps 401 to AUTH_INVALID", () => {
    const error = { status: 401, message: "Unauthorized" };
    const mapped = gitHubProvider.toUserError(error, "VERIFY");
    expect(mapped).toEqual({ code: "AUTH_INVALID", context: "VERIFY" });
    expect(isProviderError(mapped)).toBe(true);
  });

  test("maps 404 to NOT_FOUND", () => {
    const error = { status: 404, message: "Not Found" };
    const mapped = gitHubProvider.toUserError(error, "TICKETS");
    expect(mapped).toEqual({ code: "NOT_FOUND", context: "TICKETS" });
  });

  test("maps 403 WITH x-ratelimit-remaining: 0 to RATE_LIMITED with retryAfterMs", () => {
    const resetTimeSec = Math.floor(Date.now() / 1000) + 60;
    const headers = new Headers({
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": String(resetTimeSec),
    });

    const error = { status: 403, headers };
    const mapped = gitHubProvider.toUserError(error, "DISCOVERY");

    expect(mapped.code).toBe("RATE_LIMITED");
    expect(mapped.context).toBe("DISCOVERY");
    expect(typeof mapped.retryAfterMs).toBe("number");
    expect(mapped.retryAfterMs ?? 0).toBeGreaterThan(0);
    expect(isProviderError(mapped)).toBe(true);
  });

  test("maps 403 WITH retry-after header to RATE_LIMITED with parsed milliseconds", () => {
    const headers = new Headers({
      "retry-after": "45",
    });

    const error = { status: 403, headers };
    const mapped = gitHubProvider.toUserError(error, "VERIFY");

    expect(mapped).toEqual({
      code: "RATE_LIMITED",
      context: "VERIFY",
      retryAfterMs: 45_000,
    });
  });

  test("maps 403 WITH rate limit message to RATE_LIMITED", () => {
    const error = Object.assign(new Error("API rate limit exceeded for user"), {
      status: 403,
    });

    const mapped = gitHubProvider.toUserError(error, "PR");
    expect(mapped.code).toBe("RATE_LIMITED");
    expect(mapped.context).toBe("PR");
  });

  test("maps 403 WITHOUT rate-limit headers to PERMISSION (distinct from AUTH_INVALID)", () => {
    const headers = new Headers({
      "x-ratelimit-remaining": "4950",
    });

    const error = {
      status: 403,
      headers,
      message: "Must have push access to repository",
    };
    const mapped = gitHubProvider.toUserError(error, "VERIFY");

    expect(mapped.code).toBe("PERMISSION");
    expect(mapped.code).not.toBe("AUTH_INVALID");
    expect(mapped.code).not.toBe("RATE_LIMITED");
    expect(mapped.context).toBe("VERIFY");
    expect(isProviderError(mapped)).toBe(true);
  });

  test("maps unknown errors to UNKNOWN", () => {
    const error = new Error("Network cable disconnected");
    const mapped = gitHubProvider.toUserError(error, "DISCOVERY");
    expect(mapped).toEqual({ code: "UNKNOWN", context: "DISCOVERY" });
  });

  test("passes through already normalized ProviderError", () => {
    const existing = {
      code: "RATE_LIMITED" as const,
      context: "TICKETS" as const,
      retryAfterMs: 12_000,
    };
    const mapped = gitHubProvider.toUserError(existing, "DISCOVERY");
    expect(mapped).toEqual({
      code: "RATE_LIMITED",
      context: "DISCOVERY",
      retryAfterMs: 12_000,
    });
  });
});

describe("parseQuickUrl", () => {
  test("parses standard https repository URL", () => {
    const draft = gitHubProvider.parseQuickUrl(
      "https://github.com/octocat/Spoon-Knife",
    );
    expect(draft).toEqual({
      configDraft: { owner: "octocat", repo: "Spoon-Knife" },
      inferredName: "Spoon-Knife",
    });
  });

  test("parses bare github.com URL", () => {
    const draft = gitHubProvider.parseQuickUrl(
      "github.com/octocat/Spoon-Knife",
    );
    expect(draft).toEqual({
      configDraft: { owner: "octocat", repo: "Spoon-Knife" },
      inferredName: "Spoon-Knife",
    });
  });

  test("parses .git suffix and git SSH URLs", () => {
    const draft = gitHubProvider.parseQuickUrl(
      "git@github.com:octocat/Spoon-Knife.git",
    );
    expect(draft).toEqual({
      configDraft: { owner: "octocat", repo: "Spoon-Knife" },
      inferredName: "Spoon-Knife",
    });
  });

  test("handles trailing slash, query parameters, and fragments", () => {
    const draft = gitHubProvider.parseQuickUrl(
      "https://github.com/octocat/Spoon-Knife/?tab=readme#readme",
    );
    expect(draft).toEqual({
      configDraft: { owner: "octocat", repo: "Spoon-Knife" },
      inferredName: "Spoon-Knife",
    });
  });

  test("returns null for non-GitHub URLs or incomplete paths", () => {
    expect(
      gitHubProvider.parseQuickUrl("https://gitlab.com/octocat/Spoon-Knife"),
    ).toBeNull();
    expect(
      gitHubProvider.parseQuickUrl("https://github.com/octocat"),
    ).toBeNull();
    expect(gitHubProvider.parseQuickUrl("not a url")).toBeNull();
  });
});

describe("HTTP Boundary Tests (Zero-mock except fetch)", () => {
  test("verifyCredentials returns ok status on successful GitHub API probe", async () => {
    const stubFetch: GitHubFetch = async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes("/user")) {
        return new Response(JSON.stringify({ login: "octocat" }), {
          status: 200,
        });
      }
      return new Response(null, { status: 404 });
    };

    const provider = new GitHubProvider({
      ...defaultGitHubDeps,
      fetch: stubFetch,
    });
    const config: GitHubConfig = { token: "ghp_validToken" };
    const res = await provider.verifyCredentials(config);
    expect(res.status).toBe("ok");
    expect(res.warnings).toEqual([]);
  });

  test("verifyCredentials throws HTTP error on invalid token (401)", async () => {
    const stubFetch: GitHubFetch = async () => {
      return new Response(JSON.stringify({ message: "Bad credentials" }), {
        status: 401,
      });
    };

    const provider = new GitHubProvider({
      ...defaultGitHubDeps,
      fetch: stubFetch,
    });
    let caught: unknown;
    try {
      await provider.verifyCredentials({ token: "ghp_invalid" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect((caught as { status?: number }).status).toBe(401);
    const userErr = provider.toUserError(caught, "VERIFY");
    expect(userErr.code).toBe("AUTH_INVALID");
  });

  test("verifyCredentials returns degraded when repository probe returns 404", async () => {
    const stubFetch: GitHubFetch = async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes("/user")) {
        return new Response(JSON.stringify({ login: "octocat" }), {
          status: 200,
        });
      }
      if (url.includes("/orgs/octocat")) {
        return new Response(JSON.stringify({ id: 1 }), { status: 200 });
      }
      if (url.includes("/repos/octocat/private-repo")) {
        return new Response(null, { status: 404 });
      }
      return new Response(null, { status: 200 });
    };

    const provider = new GitHubProvider({
      ...defaultGitHubDeps,
      fetch: stubFetch,
    });
    const res = await provider.verifyCredentials({
      token: "ghp_valid",
      owner: "octocat",
      repo: "private-repo",
    });

    expect(res.status).toBe("degraded");
    expect(res.warnings).toEqual([
      { kind: "CAPABILITY_UNCONFIRMED", capability: "createPullRequest" },
    ]);
  });
});

describe("createPullRequest (REST primary, gh CLI fallback, PR_CREATE_ONLY)", () => {
  test("REST API primary succeeds and does NOT invoke gh CLI executable", async () => {
    let fetchCalled = false;
    let cliCalled = false;

    const stubFetch: GitHubFetch = async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      fetchCalled = true;
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init?.body as string);
      expect(body.title).toBe("Add feature X");
      expect(body.body).toBe("Description for feature X");
      expect(body.head).toBe("feat/x");
      expect(body.base).toBe("main");

      return new Response(
        JSON.stringify({
          html_url: "https://github.com/octocat/Hello-World/pull/42",
          state: "open",
          head: { ref: "feat/x", sha: "abc1234" },
          base: { ref: "main" },
        }),
        { status: 201 },
      );
    };

    const customDeps: GitHubModuleDeps = {
      fetch: stubFetch,
      execCommand: async () => {
        cliCalled = true;
        throw new Error("gh CLI should not be called when REST succeeds!");
      },
    };

    const provider = new GitHubProvider(customDeps);
    const pr = await provider.createPullRequest(
      { token: "ghp_token", owner: "octocat", repo: "Hello-World" },
      {
        repository: "octocat/Hello-World",
        title: "Add feature X",
        description: "Description for feature X",
        sourceBranch: "feat/x",
        targetBranch: "main",
      },
    );

    expect(fetchCalled).toBe(true);
    expect(cliCalled).toBe(false);
    expect(pr.url).toBe("https://github.com/octocat/Hello-World/pull/42");
    expect(pr.status).toBe("open");
    expect(pr.sourceBranch).toBe("feat/x");
    expect(pr.targetBranch).toBe("main");
    expect(pr.lastMergeSourceCommit).toBe("abc1234");
  });

  test("falls back to gh CLI executable only when REST API fails", async () => {
    let cliArgsReceived: string[] = [];

    // REST fails with 500
    const stubFetch: GitHubFetch = async () => {
      return new Response("Internal Server Error", { status: 500 });
    };

    const customDeps: GitHubModuleDeps = {
      fetch: stubFetch,
      execCommand: async (_cmd: string, args: string[]) => {
        cliArgsReceived = args;
        return {
          command: "gh pr create ...",
          exitCode: 0,
          passed: true,
          stdout: "https://github.com/octocat/Hello-World/pull/43\n",
          stderr: "",
          durationMs: 10,
        };
      },
    };

    const provider = new GitHubProvider(customDeps);
    const pr = await provider.createPullRequest(
      { token: "ghp_token", owner: "octocat", repo: "Hello-World" },
      {
        repository: "octocat/Hello-World",
        title: "Fallback PR",
        description: "CLI fallback",
        sourceBranch: "feat/fallback",
        targetBranch: "main",
      },
    );

    expect(pr.url).toBe("https://github.com/octocat/Hello-World/pull/43");
    expect(cliArgsReceived).toContain("--repo");
    expect(cliArgsReceived).toContain("octocat/Hello-World");
    expect(cliArgsReceived).toContain("--head");
    expect(cliArgsReceived).toContain("feat/fallback");
  });

  test("throws REST error if both REST and gh CLI fail (does not hard-depend on gh)", async () => {
    const stubFetch: GitHubFetch = async () => {
      return new Response("REST creation failed", { status: 422 });
    };

    const customDeps: GitHubModuleDeps = {
      fetch: stubFetch,
      execCommand: async () => {
        return {
          command: "gh pr create",
          exitCode: 127,
          passed: false,
          stdout: "",
          stderr: "gh: command not found",
          durationMs: 5,
        };
      },
    };

    const provider = new GitHubProvider(customDeps);
    await expect(
      provider.createPullRequest(
        { token: "ghp_token", owner: "octocat", repo: "Hello-World" },
        {
          repository: "octocat/Hello-World",
          title: "PR Title",
          description: "PR Desc",
          sourceBranch: "feat/branch",
          targetBranch: "main",
        },
      ),
    ).rejects.toThrow(/HTTP 422/);
  });
});

describe("findExistingPullRequest, listRepositories & listTickets", () => {
  test("findExistingPullRequest locates existing open pull request via REST", async () => {
    const stubFetch: GitHubFetch = async () => {
      return new Response(
        JSON.stringify([
          {
            html_url: "https://github.com/octocat/Hello-World/pull/99",
            state: "open",
            head: { ref: "feature-branch", sha: "sha99" },
            base: { ref: "main" },
          },
        ]),
        { status: 200 },
      );
    };

    const provider = new GitHubProvider({
      ...defaultGitHubDeps,
      fetch: stubFetch,
    });
    const pr = await provider.findExistingPullRequest(
      { token: "ghp_tok", owner: "octocat", repo: "Hello-World" },
      { repository: "octocat/Hello-World", sourceBranch: "feature-branch" },
    );

    expect(pr).not.toBeNull();
    expect(pr?.url).toBe("https://github.com/octocat/Hello-World/pull/99");
    expect(pr?.sourceBranch).toBe("feature-branch");
    expect(pr?.lastMergeSourceCommit).toBe("sha99");
  });

  test("findExistingPullRequest returns null when branch is not found", async () => {
    const stubFetch: GitHubFetch = async () => {
      return new Response(JSON.stringify([]), { status: 200 });
    };

    const customDeps: GitHubModuleDeps = {
      fetch: stubFetch,
      execCommand: async () => ({
        command: "gh",
        exitCode: 1,
        passed: false,
        stdout: "",
        stderr: "",
        durationMs: 0,
      }),
    };
    const provider = new GitHubProvider(customDeps);

    const pr = await provider.findExistingPullRequest(
      { token: "ghp_tok", owner: "octocat", repo: "Hello-World" },
      { repository: "octocat/Hello-World", sourceBranch: "non-existent" },
    );

    expect(pr).toBeNull();
  });

  test("findExistingPullRequest throws when both REST and CLI lookup mechanisms fail", async () => {
    const stubFetch: GitHubFetch = async () => {
      return new Response("Internal Server Error", { status: 500 });
    };

    const customDeps: GitHubModuleDeps = {
      fetch: stubFetch,
      execCommand: async () => ({
        command: "gh",
        exitCode: 1,
        passed: false,
        stdout: "",
        stderr: "gh auth error",
        durationMs: 0,
      }),
    };
    const provider = new GitHubProvider(customDeps);

    await expect(
      provider.findExistingPullRequest(
        { token: "ghp_tok", owner: "octocat", repo: "Hello-World" },
        { repository: "octocat/Hello-World", sourceBranch: "non-existent" },
      ),
    ).rejects.toThrow(/HTTP 500/);
  });

  test("findExistingPullRequest returns null when CLI fallback fails with 'no pull requests found'", async () => {
    const stubFetch: GitHubFetch = async () => {
      return new Response("Internal Server Error", { status: 500 });
    };

    const customDeps: GitHubModuleDeps = {
      fetch: stubFetch,
      execCommand: async () => ({
        command: "gh",
        exitCode: 1,
        passed: false,
        stdout: "",
        stderr: "no pull requests found for branch 'non-existent'",
        durationMs: 0,
      }),
    };
    const provider = new GitHubProvider(customDeps);

    const pr = await provider.findExistingPullRequest(
      { token: "ghp_tok", owner: "octocat", repo: "Hello-World" },
      { repository: "octocat/Hello-World", sourceBranch: "non-existent" },
    );
    expect(pr).toBeNull();
  });

  test("listRepositories queries and transforms repositories", async () => {
    const stubFetch: GitHubFetch = async () => {
      return new Response(
        JSON.stringify([
          {
            id: 12345,
            name: "repo-alpha",
            clone_url: "https://github.com/octocat/repo-alpha.git",
            html_url: "https://github.com/octocat/repo-alpha",
            default_branch: "main",
          },
        ]),
        { status: 200 },
      );
    };

    const provider = new GitHubProvider({
      ...defaultGitHubDeps,
      fetch: stubFetch,
    });
    const repos = await provider.listRepositories({
      token: "ghp_tok",
      owner: "octocat",
    });

    expect(repos).toHaveLength(1);
    expect(repos[0]).toEqual({
      id: "12345",
      name: "repo-alpha",
      remote: "https://github.com/octocat/repo-alpha.git",
      defaultBranch: "main",
      webUrl: "https://github.com/octocat/repo-alpha",
    });
  });

  test("listRepositories paginates to retrieve all discoverable repositories", async () => {
    let callCount = 0;
    const stubFetch: GitHubFetch = async (_url) => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify([{ id: 1, name: "repo-1" }]), {
          status: 200,
          headers: {
            link: '<https://api.github.com/orgs/octocat/repos?page=2>; rel="next"',
          },
        });
      } else {
        return new Response(JSON.stringify([{ id: 2, name: "repo-2" }]), {
          status: 200,
        });
      }
    };

    const provider = new GitHubProvider({
      ...defaultGitHubDeps,
      fetch: stubFetch,
    });
    const repos = await provider.listRepositories({
      token: "ghp_tok",
      owner: "octocat",
    });

    expect(callCount).toBe(2);
    expect(repos).toHaveLength(2);
    expect(repos[0]?.name).toBe("repo-1");
    expect(repos[1]?.name).toBe("repo-2");
  });

  test("listTickets queries issues with workflow label and filters PRs", async () => {
    const stubFetch: GitHubFetch = async () => {
      return new Response(
        JSON.stringify([
          {
            number: 10,
            title: "Issue with required label",
            body: "Detailed description",
            state: "open",
            html_url: "https://github.com/octocat/repo/issues/10",
            labels: [{ name: REQUIRED_WORKFLOW_LABEL }, { name: "bug" }],
          },
          {
            number: 11,
            title: "Pull request with label",
            body: "PR body",
            state: "open",
            html_url: "https://github.com/octocat/repo/pull/11",
            pull_request: {
              url: "https://api.github.com/repos/octocat/repo/pulls/11",
            },
            labels: [{ name: REQUIRED_WORKFLOW_LABEL }],
          },
          {
            number: 12,
            title: "Issue without label",
            body: "No label",
            state: "open",
            html_url: "https://github.com/octocat/repo/issues/12",
            labels: [{ name: "enhancement" }],
          },
        ]),
        { status: 200 },
      );
    };

    const provider = new GitHubProvider({
      ...defaultGitHubDeps,
      fetch: stubFetch,
    });
    const tickets = await provider.listTickets(
      { token: "ghp_tok", owner: "octocat", repo: "Hello-World" },
      { requiredLabel: REQUIRED_WORKFLOW_LABEL },
    );

    expect(tickets).toHaveLength(1);
    const first = tickets[0];
    expect(first).toBeDefined();
    if (!first) {
      throw new Error("Expected ticket to be defined");
    }
    expect(first.id).toBe("10");
    expect(first.title).toBe("Issue with required label");
    expect(first.labels).toContain(REQUIRED_WORKFLOW_LABEL);
  });
});
