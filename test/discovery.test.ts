// test/discovery.test.ts — Unit tests for platform-agnostic repository discovery.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AzureDevOpsRepositoryDiscovery,
  discoverRepositories,
  GitHubRepositoryDiscovery,
  getDiscoveryProvider,
  JiraRepositoryDiscovery,
  LocalWorkspaceRepositoryDiscovery,
} from "../src/discovery/index.js";
import { execStrict } from "../src/proc.js";

describe("Repository Discovery Providers", () => {
  it("resolves providers from registry", () => {
    assert.ok(
      getDiscoveryProvider("azure") instanceof AzureDevOpsRepositoryDiscovery,
    );
    assert.ok(
      getDiscoveryProvider("github") instanceof GitHubRepositoryDiscovery,
    );
    assert.ok(getDiscoveryProvider("jira") instanceof JiraRepositoryDiscovery);
    assert.ok(
      getDiscoveryProvider("local") instanceof
        LocalWorkspaceRepositoryDiscovery,
    );
    assert.throws(
      () => getDiscoveryProvider("unknown"),
      /Unsupported discovery provider/,
    );
  });

  describe("AzureDevOpsRepositoryDiscovery", () => {
    it("validates required inputs", async () => {
      const provider = new AzureDevOpsRepositoryDiscovery();
      await assert.rejects(
        () =>
          provider.listRepositories({
            provider: "azure",
            orgUrl: "",
            project: "p",
            pat: "pat",
          }),
        /Organization URL is required/,
      );
      await assert.rejects(
        () =>
          provider.listRepositories({
            provider: "azure",
            orgUrl: "https://dev.azure.com/org",
            project: "",
            pat: "pat",
          }),
        /Project name is required/,
      );
      await assert.rejects(
        () =>
          provider.listRepositories({
            provider: "azure",
            orgUrl: "https://dev.azure.com/org",
            project: "p",
            pat: "",
          }),
        /Personal Access Token/,
      );
    });

    it("extracts organization and project from Azure DevOps URLs", async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = (async (url: string | URL | Request) => {
          assert.ok(
            String(url).includes(
              "https://dev.azure.com/xynotech/Converso/_apis/git/repositories",
            ),
          );
          return new Response(JSON.stringify({ value: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }) as unknown as typeof fetch;

        const provider = new AzureDevOpsRepositoryDiscovery();
        const repos = await provider.listRepositories({
          provider: "azure",
          primaryRepo: "https://dev.azure.com/xynotech/Converso",
          pat: "test-pat",
        });
        assert.equal(repos.length, 0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("normalizes Azure DevOps repositories", async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = (async (url: string | URL | Request) => {
          assert.ok(String(url).includes("_apis/git/repositories"));
          return new Response(
            JSON.stringify({
              value: [
                {
                  id: "az-repo-1",
                  name: "vendifai-web",
                  remoteUrl: "https://dev.azure.com/org/proj/_git/vendifai-web",
                  defaultBranch: "refs/heads/main",
                },
                {
                  id: "az-repo-2",
                  name: "vendifai-api",
                  url: "https://dev.azure.com/org/proj/_git/vendifai-api",
                  defaultBranch: "refs/heads/master",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }) as unknown as typeof fetch;

        const provider = new AzureDevOpsRepositoryDiscovery();
        const repos = await provider.listRepositories({
          provider: "azure",
          orgUrl: "https://dev.azure.com/org",
          project: "proj",
          pat: "secret-pat",
        });

        assert.equal(repos.length, 2);
        assert.equal(repos[0]?.name, "vendifai-web");
        assert.equal(repos[0]?.defaultBranch, "main");
        assert.equal(
          repos[0]?.remote,
          "https://dev.azure.com/org/proj/_git/vendifai-web",
        );
        assert.equal(repos[1]?.defaultBranch, "master");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("handles invalid PAT returning HTTP 401", async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = (async () =>
          new Response("Unauthorized", {
            status: 401,
          })) as unknown as typeof fetch;
        const provider = new AzureDevOpsRepositoryDiscovery();
        let thrownError: Error | undefined;
        try {
          await provider.listRepositories({
            provider: "azure",
            orgUrl: "https://dev.azure.com/org",
            project: "p",
            pat: "bad-pat",
          });
        } catch (err) {
          thrownError = err instanceof Error ? err : new Error(String(err));
        }
        assert.ok(thrownError, "Should throw error");
        assert.equal(
          thrownError.message,
          "Azure DevOps authentication failed. Verify your Personal Access Token (PAT).",
        );
        assert.ok(!thrownError.message.includes("<html>"));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("handles invalid PAT returning HTTP 403", async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = (async () =>
          new Response("Forbidden", {
            status: 403,
          })) as unknown as typeof fetch;
        const provider = new AzureDevOpsRepositoryDiscovery();
        let thrownError: Error | undefined;
        try {
          await provider.listRepositories({
            provider: "azure",
            orgUrl: "https://dev.azure.com/org",
            project: "p",
            pat: "bad-pat",
          });
        } catch (err) {
          thrownError = err instanceof Error ? err : new Error(String(err));
        }
        assert.ok(thrownError, "Should throw error");
        assert.equal(
          thrownError.message,
          "Azure DevOps authentication failed. Verify your Personal Access Token (PAT).",
        );
        assert.ok(!thrownError.message.includes("<html>"));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("handles HTTP 401 with HTML login page and never exposes raw HTML", async () => {
      const originalFetch = globalThis.fetch;
      const htmlBody = `<!DOCTYPE html>
<html>
<head><title>Sign in to your account</title></head>
<body>
  <form method="post" action="https://login.microsoftonline.com">
    <input type="text" name="loginfmt" />
    <button type="submit">Sign in</button>
  </form>
</body>
</html>`;
      try {
        globalThis.fetch = (async () =>
          new Response(htmlBody, {
            status: 401,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          })) as unknown as typeof fetch;
        const provider = new AzureDevOpsRepositoryDiscovery();
        let thrownError: Error | undefined;
        try {
          await provider.listRepositories({
            provider: "azure",
            orgUrl: "https://dev.azure.com/xynotech",
            project: "Converso",
            pat: "bad-pat",
          });
        } catch (err) {
          thrownError = err instanceof Error ? err : new Error(String(err));
        }
        assert.ok(thrownError, "Should throw error");
        assert.equal(
          thrownError.message,
          "Azure DevOps authentication failed. Verify your Personal Access Token (PAT).",
        );
        assert.ok(!thrownError.message.includes("<html>"));
        assert.ok(!thrownError.message.includes("</html>"));
        assert.ok(!thrownError.message.includes("<!DOCTYPE"));
        assert.ok(!thrownError.message.includes("<body"));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("handles HTTP 403 with HTML login page and never exposes raw HTML", async () => {
      const originalFetch = globalThis.fetch;
      const htmlBody = `<html><head><title>Access Denied</title></head><body><h1>403 Forbidden</h1></body></html>`;
      try {
        globalThis.fetch = (async () =>
          new Response(htmlBody, {
            status: 403,
            headers: { "Content-Type": "text/html" },
          })) as unknown as typeof fetch;
        const provider = new AzureDevOpsRepositoryDiscovery();
        let thrownError: Error | undefined;
        try {
          await provider.listRepositories({
            provider: "azure",
            orgUrl: "https://dev.azure.com/xynotech",
            project: "Converso",
            pat: "bad-pat",
          });
        } catch (err) {
          thrownError = err instanceof Error ? err : new Error(String(err));
        }
        assert.ok(thrownError, "Should throw error");
        assert.equal(
          thrownError.message,
          "Azure DevOps authentication failed. Verify your Personal Access Token (PAT).",
        );
        assert.ok(!thrownError.message.includes("<html>"));
        assert.ok(!thrownError.message.includes("</html>"));
        assert.ok(!thrownError.message.includes("<body"));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("handles HTTP 404 project-not-found response containing project and organization", async () => {
      const originalFetch = globalThis.fetch;
      const htmlBody = `<html><body>Azure DevOps 404 Resource Not Found</body></html>`;
      try {
        globalThis.fetch = (async () =>
          new Response(htmlBody, {
            status: 404,
            headers: { "Content-Type": "text/html" },
          })) as unknown as typeof fetch;
        const provider = new AzureDevOpsRepositoryDiscovery();
        let thrownError: Error | undefined;
        try {
          await provider.listRepositories({
            provider: "azure",
            orgUrl: "https://dev.azure.com/xynotech",
            project: "Converso",
            pat: "valid-pat",
          });
        } catch (err) {
          thrownError = err instanceof Error ? err : new Error(String(err));
        }
        assert.ok(thrownError, "Should throw error");
        assert.equal(
          thrownError.message,
          'Azure DevOps project "Converso" was not found at https://dev.azure.com/xynotech.',
        );
        assert.ok(!thrownError.message.includes("<html>"));
        assert.ok(!thrownError.message.includes("</html>"));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("handles other HTTP failure such as 500 with HTML or text body without exposing raw HTML", async () => {
      const originalFetch = globalThis.fetch;
      try {
        // 500 with HTML body
        const htmlBody = `<html><head><title>500 Internal Server Error</title></head><body><h1>Server Error</h1><p>Stack trace...</p></body></html>`;
        globalThis.fetch = (async () =>
          new Response(htmlBody, {
            status: 500,
            statusText: "Internal Server Error",
            headers: { "Content-Type": "text/html" },
          })) as unknown as typeof fetch;

        const provider = new AzureDevOpsRepositoryDiscovery();
        let htmlError: Error | undefined;
        try {
          await provider.listRepositories({
            provider: "azure",
            orgUrl: "https://dev.azure.com/xynotech",
            project: "Converso",
            pat: "valid-pat",
          });
        } catch (err) {
          htmlError = err instanceof Error ? err : new Error(String(err));
        }
        assert.ok(htmlError, "Should throw error");
        assert.equal(
          htmlError.message,
          "Azure DevOps API error (500): Internal Server Error",
        );
        assert.ok(!htmlError.message.includes("<html>"));
        assert.ok(!htmlError.message.includes("</html>"));
        assert.ok(!htmlError.message.includes("Stack trace"));

        // 500 with concise text body
        globalThis.fetch = (async () =>
          new Response("Database connection timed out", {
            status: 500,
            statusText: "Internal Server Error",
            headers: { "Content-Type": "text/plain" },
          })) as unknown as typeof fetch;

        let textError: Error | undefined;
        try {
          await provider.listRepositories({
            provider: "azure",
            orgUrl: "https://dev.azure.com/xynotech",
            project: "Converso",
            pat: "valid-pat",
          });
        } catch (err) {
          textError = err instanceof Error ? err : new Error(String(err));
        }
        assert.ok(textError, "Should throw error");
        assert.equal(
          textError.message,
          "Azure DevOps API error (500): Database connection timed out",
        );
        assert.ok(!textError.message.includes("<html>"));

        // 500 with JSON error body
        globalThis.fetch = (async () =>
          new Response(
            JSON.stringify({ message: "TF400813: Resource unavailable" }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            },
          )) as unknown as typeof fetch;

        let jsonError: Error | undefined;
        try {
          await provider.listRepositories({
            provider: "azure",
            orgUrl: "https://dev.azure.com/xynotech",
            project: "Converso",
            pat: "valid-pat",
          });
        } catch (err) {
          jsonError = err instanceof Error ? err : new Error(String(err));
        }
        assert.ok(jsonError, "Should throw error");
        assert.equal(
          jsonError.message,
          "Azure DevOps API error (500): TF400813: Resource unavailable",
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("handles 2xx with HTML login/redirect response and converts to clear authentication error", async () => {
      const originalFetch = globalThis.fetch;
      const htmlBody = `<!DOCTYPE html><html><head><title>Sign in to your account</title></head><body>Sign in to Azure DevOps</body></html>`;
      try {
        globalThis.fetch = (async () =>
          new Response(htmlBody, {
            status: 200,
            headers: { "Content-Type": "text/html" },
          })) as unknown as typeof fetch;

        const provider = new AzureDevOpsRepositoryDiscovery();
        let thrownError: Error | undefined;
        try {
          await provider.listRepositories({
            provider: "azure",
            orgUrl: "https://dev.azure.com/org",
            project: "proj",
            pat: "secret-pat",
          });
        } catch (err) {
          thrownError = err instanceof Error ? err : new Error(String(err));
        }
        assert.ok(thrownError, "Should throw error");
        assert.equal(
          thrownError.message,
          "Azure DevOps authentication failed. Verify your Personal Access Token (PAT).",
        );
        assert.ok(!thrownError.message.includes("<html>"));
        assert.ok(!thrownError.message.includes("</html>"));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("handles 2xx malformed JSON response with controlled validation error", async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = (async () =>
          new Response("{ not valid json at all", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })) as unknown as typeof fetch;

        const provider = new AzureDevOpsRepositoryDiscovery();
        let thrownError: Error | undefined;
        try {
          await provider.listRepositories({
            provider: "azure",
            orgUrl: "https://dev.azure.com/org",
            project: "proj",
            pat: "secret-pat",
          });
        } catch (err) {
          thrownError = err instanceof Error ? err : new Error(String(err));
        }
        assert.ok(thrownError, "Should throw error");
        assert.equal(
          thrownError.message,
          "Azure DevOps Repositories API response validation failed: Malformed JSON response.",
        );
        assert.ok(!thrownError.message.includes("SyntaxError"));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("throws descriptive error on 2xx JSON with invalid repository response shape", async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = (async () =>
          new Response(JSON.stringify({ value: [{ id: 123, name: null }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })) as unknown as typeof fetch;

        const provider = new AzureDevOpsRepositoryDiscovery();
        await assert.rejects(
          () =>
            provider.listRepositories({
              provider: "azure",
              orgUrl: "https://dev.azure.com/org",
              project: "proj",
              pat: "secret-pat",
            }),
          /Azure DevOps Repositories API response validation failed/,
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("successfully discovers 14-repository Azure/Converso case", async () => {
      const originalFetch = globalThis.fetch;
      const repos14 = Array.from({ length: 14 }, (_, i) => ({
        id: `converso-repo-${i + 1}`,
        name: `service-${i + 1}`,
        remoteUrl: `https://dev.azure.com/xynotech/Converso/_git/service-${i + 1}`,
        webUrl: `https://dev.azure.com/xynotech/Converso/_git/service-${i + 1}`,
        defaultBranch: i % 2 === 0 ? "refs/heads/main" : "refs/heads/master",
      }));

      try {
        globalThis.fetch = (async (url: string | URL | Request) => {
          assert.ok(
            String(url).includes(
              "https://dev.azure.com/xynotech/Converso/_apis/git/repositories",
            ),
          );
          return new Response(JSON.stringify({ value: repos14 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }) as unknown as typeof fetch;

        const provider = new AzureDevOpsRepositoryDiscovery();
        const repos = await provider.listRepositories({
          provider: "azure",
          orgUrl: "https://dev.azure.com/xynotech",
          project: "Converso",
          pat: "valid-converso-pat",
        });

        assert.equal(repos.length, 14);
        assert.equal(repos[0]?.id, "converso-repo-1");
        assert.equal(repos[0]?.name, "service-1");
        assert.equal(repos[0]?.defaultBranch, "main");
        assert.equal(
          repos[0]?.remote,
          "https://dev.azure.com/xynotech/Converso/_git/service-1",
        );
        assert.equal(repos[1]?.defaultBranch, "master");
        assert.equal(repos[13]?.name, "service-14");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("GitHubRepositoryDiscovery", () => {
    it("normalizes GitHub repositories", async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = (async () => {
          return new Response(
            JSON.stringify([
              {
                id: 12345,
                name: "vendifai-frontend",
                clone_url: "https://github.com/vendifai/frontend.git",
                html_url: "https://github.com/vendifai/frontend",
                default_branch: "main",
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }) as unknown as typeof fetch;

        const repos = await discoverRepositories({
          provider: "github",
          repoOwner: "vendifai",
          token: "ghp_mock",
        });

        assert.equal(repos.length, 1);
        assert.equal(repos[0]?.id, "12345");
        assert.equal(repos[0]?.name, "vendifai-frontend");
        assert.equal(
          repos[0]?.remote,
          "https://github.com/vendifai/frontend.git",
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("throws descriptive error on malformed GitHub repository response", async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = (async () =>
          new Response(JSON.stringify({ notAnArray: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })) as unknown as typeof fetch;

        const provider = new GitHubRepositoryDiscovery();
        await assert.rejects(
          () =>
            provider.listRepositories({
              provider: "github",
              token: "gh-token",
              repoOwner: "test-owner",
            }),
          /GitHub Repositories API response validation failed/,
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("JiraRepositoryDiscovery", () => {
    it("discovers Jira components as repository candidates", async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = (async (url: string | URL | Request) => {
          assert.ok(
            String(url).includes("/rest/api/3/project/PROJ/components"),
          );
          return new Response(
            JSON.stringify([
              {
                id: "1001",
                name: "vendifai-frontend",
                description: "UI web app",
              },
              {
                id: "1002",
                name: "vendifai-backend",
                description: "API microservice",
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }) as unknown as typeof fetch;

        const repos = await discoverRepositories({
          provider: "jira",
          project: "PROJ",
          jiraHost: "company.atlassian.net",
          jiraEmail: "dev@company.com",
          jiraToken: "api-token",
        });

        assert.equal(repos.length, 2);
        assert.equal(repos[0]?.name, "vendifai-frontend");
        assert.equal(repos[1]?.name, "vendifai-backend");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("falls back to local workspace discovery when workspacePath is supplied", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "xf-jira-local-"));
      try {
        const repoA = path.join(root, "repo-jira-a");
        await execStrict("git", ["init", repoA]);
        await execStrict("git", ["config", "user.email", "a@test.com"], {
          cwd: repoA,
        });
        await execStrict("git", ["config", "user.name", "A"], { cwd: repoA });

        const repos = await discoverRepositories({
          provider: "jira",
          project: "PROJ",
          workspacePath: root,
        });

        assert.equal(repos.length, 1);
        assert.equal(repos[0]?.name, "repo-jira-a");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("safely falls back when Jira components response is malformed", async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = (async () =>
          new Response(JSON.stringify({ notAnArray: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })) as unknown as typeof fetch;

        const repos = await discoverRepositories({
          provider: "jira",
          project: "PROJ",
          jiraHost: "company.atlassian.net",
          jiraEmail: "dev@company.com",
          jiraToken: "api-token",
        });
        assert.deepEqual(repos, []);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("LocalWorkspaceRepositoryDiscovery", () => {
    it("discovers git repositories in local directory", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "xf-local-disc-"));
      try {
        const repoA = path.join(root, "repo-a");
        const repoB = path.join(root, "repo-b");
        const notRepo = path.join(root, "not-repo");

        await execStrict("git", ["init", repoA]);
        await execStrict("git", ["config", "user.email", "a@test.com"], {
          cwd: repoA,
        });
        await execStrict("git", ["config", "user.name", "A"], { cwd: repoA });
        await execStrict(
          "git",
          ["remote", "add", "origin", "https://github.com/org/repo-a.git"],
          { cwd: repoA },
        );

        await execStrict("git", ["init", repoB]);
        await execStrict("git", ["config", "user.email", "b@test.com"], {
          cwd: repoB,
        });
        await execStrict("git", ["config", "user.name", "B"], { cwd: repoB });

        await mkdir(notRepo, { recursive: true });
        await writeFile(path.join(notRepo, "file.txt"), "hello");

        const provider = new LocalWorkspaceRepositoryDiscovery();
        const discovered = await provider.listRepositories({
          provider: "local",
          workspacePath: root,
        });

        assert.equal(discovered.length, 2);
        const names = discovered.map((d) => d.name).sort();
        assert.deepEqual(names, ["repo-a", "repo-b"]);

        const repoADiscovered = discovered.find((d) => d.name === "repo-a");
        assert.equal(
          repoADiscovered?.remote,
          "https://github.com/org/repo-a.git",
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });
});
